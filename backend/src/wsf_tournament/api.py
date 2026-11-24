"""HTTP API (HANDOFF §7). Every mutation returns the full derived state."""

import threading
import time
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .engine import history, rng
from .engine.commands import create_tournament
from .engine.events import CommandError, Event, HistoryDiverges
from .engine.replay import replay
from .engine.report import report
from .engine.rules import DEFAULT_RULES
from .engine.seating import TableConfig
from .engine.view import preview, tournament_view
from .store import NotFound, Store

EXPORT_FORMAT = "wsf-tournament/1"

# One operator, but a double-tap can still send two commands at once: serialise writes.
_write_lock = threading.Lock()


def _now() -> int:
    return int(time.time() * 1000)


class CreateBody(BaseModel):
    name: str
    date: str | None = None
    players: list[str] = Field(default_factory=list)
    table: dict[str, Any] | None = None  # None → Settings' default table
    rules_overrides: dict[str, Any] | None = None  # None → Settings' rule overrides


class PatchBody(BaseModel):
    name: str | None = None
    date: str | None = None
    archived: bool | None = None


class SettingsBody(BaseModel):
    rules_overrides: dict[str, Any] = Field(default_factory=dict)
    default_table: dict[str, Any] = Field(default_factory=lambda: {"shape": "rectangle"})


class PreviewBody(BaseModel):
    players: int = Field(ge=0, le=500)
    table: dict[str, Any]
    rules_overrides: dict[str, Any] | None = None


class RewindBody(BaseModel):
    seq: int


class DuplicateBody(BaseModel):
    name: str | None = None
    date: str | None = None


def build_router(store: Store) -> APIRouter:
    router = APIRouter(prefix="/api")

    def load(tid: str) -> tuple[dict, list[Event]]:
        try:
            return store.get(tid), store.events(tid)
        except NotFound:
            raise HTTPException(404, "tournament not found") from None

    def view(tid: str) -> dict:
        meta, events = load(tid)
        v = tournament_view(events, meta["cursor"])
        v["id"] = tid
        v["archived"] = bool(meta["archived"])
        v["tournament"].update(name=meta["name"], date=meta["date"])
        v["server_now"] = _now()  # lets the UI correct its clock for round timers
        return v

    def new_tournament(name, date, players, table, rules) -> str:
        now = _now()
        try:
            created = create_tournament(name, date, players, table, rules, now)
        except CommandError as e:
            raise HTTPException(422, str(e)) from None
        events = history.sequence(created, [])
        return store.create(name.strip(), date, events, len(events), now)

    @router.get("/health")
    def health() -> dict:
        return {"ok": True}

    @router.post("/preview")
    def preview_table(body: PreviewBody) -> dict:
        """Setup wizard / Change table: stage plan, fit check and geometry, no tournament."""
        overrides = body.rules_overrides
        if overrides is None:  # same defaulting as create: Settings' rules
            overrides = store.settings().get("rules_overrides") or None
        try:
            rules = DEFAULT_RULES.with_overrides(overrides)
            cfg = TableConfig.from_dict({"spoon_layout": rules.spoon_layout, **body.table})
        except (TypeError, ValueError) as e:
            raise HTTPException(422, str(e)) from None
        return preview(body.players, cfg, rules)

    @router.get("/tournaments")
    def list_tournaments() -> list[dict]:
        out = []
        for meta in store.all():
            row = {
                "id": meta["id"],
                "name": meta["name"],
                "date": meta["date"],
                "archived": bool(meta["archived"]),
                "created_at": meta["created_at"],
                "updated_at": meta["updated_at"],
            }
            try:
                s = replay(store.events(meta["id"])[: meta["cursor"]])
            except Exception:  # one unreadable log mustn't hide the others
                out.append({**row, "status": "error", "players": 0, "rounds": 0, "champion": None})
                continue
            out.append(
                {
                    **row,
                    "status": "complete" if s.completed else "live" if s.started else "setup",
                    "players": sum(1 for p in s.players.values() if p.status != "withdrawn"),
                    "rounds": s.rounds_played,
                    "champion": s.players[s.champion_id].name if s.champion_id else None,
                }
            )
        return out

    @router.post("/tournaments", status_code=201)
    def create(body: CreateBody) -> dict:
        defaults = get_settings()
        rules = body.rules_overrides
        if rules is None:  # each tournament keeps its own copy, so later edits don't leak in
            rules = defaults["rules_overrides"] or None
        table = body.table if body.table is not None else defaults["default_table"]
        tid = new_tournament(body.name, body.date, body.players, table, rules)
        return view(tid)

    @router.get("/settings")
    def get_settings() -> dict:
        """Server-wide defaults for new tournaments (shared by every device)."""
        saved = SettingsBody(**store.settings())
        rules = DEFAULT_RULES.with_overrides(saved.rules_overrides)
        return {
            **saved.model_dump(),
            "rules": rules.to_dict(),
            "rule_defaults": DEFAULT_RULES.to_dict(),
        }

    @router.put("/settings")
    def put_settings(body: SettingsBody) -> dict:
        try:
            rules = DEFAULT_RULES.with_overrides(body.rules_overrides)
            TableConfig.from_dict({"spoon_layout": rules.spoon_layout, **body.default_table})
        except (TypeError, ValueError) as e:
            raise HTTPException(422, str(e)) from None
        store.save_settings(body.model_dump())
        return get_settings()

    @router.get("/tournaments/{tid}")
    def get(tid: str) -> dict:
        return view(tid)

    def command(tid: str, cmd: dict) -> dict:
        discard = bool(cmd.pop("discard_future", False))
        with _write_lock:
            meta, events = load(tid)
            cursor = meta["cursor"]
            try:
                log, new_cursor = history.run_command(
                    events, cursor, cmd, _now(), rng.SOURCE, discard
                )
            except HistoryDiverges as e:
                return JSONResponse(
                    status_code=409,
                    content={
                        "detail": {
                            "error": "history_diverges",
                            "discarded": e.discarded,
                            "actions": e.actions,
                        }
                    },
                )
            except CommandError as e:
                raise HTTPException(422, str(e)) from None
            store.save_log(tid, cursor, log[cursor:], new_cursor, _now())
        return view(tid)

    @router.post("/tournaments/{tid}/start")
    def start(tid: str, body: dict[str, Any] | None = None) -> Any:
        return command(tid, {**(body or {}), "type": "start"})

    @router.post("/tournaments/{tid}/commands")
    def commands(tid: str, body: dict[str, Any]) -> Any:
        return command(tid, dict(body))

    def move_cursor(tid: str, fn) -> dict:
        with _write_lock:
            meta, events = load(tid)
            try:
                cursor = fn(events, meta["cursor"])
            except CommandError as e:
                raise HTTPException(422, str(e)) from None
            store.set_cursor(tid, cursor, _now())
        return view(tid)

    @router.post("/tournaments/{tid}/undo")
    def undo(tid: str) -> dict:
        return move_cursor(tid, history.undo)

    @router.post("/tournaments/{tid}/redo")
    def redo(tid: str) -> dict:
        return move_cursor(tid, history.redo)

    @router.post("/tournaments/{tid}/rewind")
    def rewind(tid: str, body: RewindBody) -> dict:
        return move_cursor(tid, lambda events, _cursor: history.rewind(events, body.seq))

    @router.post("/tournaments/{tid}/duplicate", status_code=201)
    def duplicate(tid: str, body: DuplicateBody | None = None) -> dict:
        meta, events = load(tid)
        s = replay(events[: meta["cursor"]])
        body = body or DuplicateBody()
        players = [p.name for p in s.players.values() if p.status != "withdrawn"]
        rules = events[0].payload.get("rules_overrides")
        new = new_tournament(
            body.name or f"{meta['name']} (copy)", body.date, players, s.table.to_dict(), rules
        )
        return view(new)

    @router.patch("/tournaments/{tid}")
    def patch(tid: str, body: PatchBody) -> dict:
        fields = body.model_dump(exclude_unset=True)
        if "name" in fields:
            if not (fields["name"] or "").strip():
                raise HTTPException(422, "tournament name is required")
            fields["name"] = fields["name"].strip()
        if "archived" in fields:
            fields["archived"] = int(bool(fields["archived"]))
        load(tid)
        if fields:
            store.update(tid, _now(), **fields)
        return view(tid)

    @router.delete("/tournaments/{tid}", status_code=204)
    def delete(tid: str) -> None:
        try:
            store.delete(tid)
        except NotFound:
            raise HTTPException(404, "tournament not found") from None

    @router.get("/tournaments/{tid}/report")
    def get_report(tid: str) -> dict:
        """Round-by-round history for the Report, Survival chart and story exports."""
        meta, events = load(tid)
        return report(events[: meta["cursor"]])

    @router.get("/tournaments/{tid}/export.json")
    def export(tid: str) -> JSONResponse:
        meta, events = load(tid)
        body = {
            "format": EXPORT_FORMAT,
            "exported_at": _now(),
            "tournament": {k: meta[k] for k in ("name", "date", "cursor", "created_at")}
            | {"archived": bool(meta["archived"])},
            "events": [e.to_dict() for e in events],
        }
        safe = "".join(c if c.isascii() and c.isalnum() else "-" for c in meta["name"])
        safe = safe.strip("-") or "tournament"  # HTTP headers must be ASCII-safe
        return JSONResponse(
            body, headers={"Content-Disposition": f'attachment; filename="{safe}.json"'}
        )

    @router.post("/tournaments/import", status_code=201)
    async def import_(request: Request) -> dict:
        try:
            body = await request.json()
            if body.get("format") != EXPORT_FORMAT:
                raise ValueError(f"not a {EXPORT_FORMAT} export")
            events = [Event.from_dict(e) for e in body["events"]]
            if [e.seq for e in events] != list(range(1, len(events) + 1)) or not events:
                raise ValueError("events must be numbered 1…n")
            if events[0].type != "TournamentCreated":
                raise ValueError("the first event must be TournamentCreated")
            meta = body.get("tournament", {})
            cursor = int(meta.get("cursor", len(events)))
            if not 1 <= cursor <= len(events):
                raise ValueError("cursor out of range")
            # The whole log must replay and render (redo reaches past the cursor).
            tournament_view(events, len(events))
            tournament_view(events, cursor)
        except Exception as e:  # anything malformed in an uploaded file is a 422
            raise HTTPException(422, f"invalid export: {e}") from None
        name = meta.get("name") or events[0].payload.get("name") or "Imported"
        tid = store.create(
            name, meta.get("date"), events, cursor, _now(), bool(meta.get("archived"))
        )
        return view(tid)

    return router
