"""The derived state the API returns (HANDOFF §4.4). Plain JSON-able dicts only."""

from .divisions import stage_plan, uses_divisions
from .events import Event
from .history import can_redo, can_undo
from .replay import ALIVE, State, replay
from .rules import RulesConfig
from .seating import Perimeter, TableConfig, fits, seat_layout
from .spoons import active_empty_gap, between_layout, center_layout
from .standings import places


def table_geometry(
    cfg: TableConfig, seat_count: int, active: list[int], empty_gap: int | None, inset: float
) -> dict:
    """Seats, spoons and the empty-gap marker for `seat_count` seats, of which the seat
    indices in `active` are still playing."""
    w, h = cfg.size
    seats = seat_layout(cfg, seat_count)
    empty = None
    if cfg.spoon_layout == "between" and empty_gap is not None and active:
        arcs = Perimeter(cfg).seat_arcs(seat_count)
        e = active_empty_gap(seat_count, empty_gap, active)
        spoons, marker = between_layout(cfg, [arcs[i] for i in active], e, inset)
        if marker:
            a, b = active[e], active[(e + 1) % len(active)]
            empty = {"seats": [a + 1, b + 1], "x": marker["x"], "y": marker["y"]}
    else:
        spoons = center_layout(cfg, len(active)) if active else []
    return {
        "table": {**cfg.to_dict(), "w": w, "h": h},
        "seats": seats,
        "spoons": spoons,
        "empty_gap": empty,
    }


def _round_view(s: State) -> dict | None:
    r = s.round
    if r is None:
        return None
    active = [i for i, pid in enumerate(r.seats) if s.players[pid].status == "in"]
    geo = table_geometry(r.table, len(r.seats), active, r.empty_gap, s.rules.between_inset)
    for seat, pid in zip(geo["seats"], r.seats, strict=True):
        seat["player_id"] = pid
        seat["active"] = s.players[pid].status == "in"
    return {
        "no": r.no,
        "division_id": r.division_id,
        "started_at": r.started_at,
        "ended": r.ended,
        "ended_at": r.ended_at,
        "paused_ms": r.paused_ms,
        "paused_since": r.paused_since,
        # Rule 1.3.3: seat 1 deals (seats are random, so a fixed seat is fair); from
        # `second_dealer_at` players a second dealer sits halfway round, rounding down.
        "dealers": dealer_seats(len(r.seats), s.rules.second_dealer_at),
        **geo,
    }


def dealer_seats(players: int, second_at: int) -> list[int]:
    return [1, 1 + players // 2] if players >= second_at else [1]


def preview(players: int, cfg: TableConfig, rules: RulesConfig) -> dict:
    """Setup wizard / Change-table preview: the stage plan, whether the table fits, and
    the table drawn for its biggest group (empty gap shown between the last and first seat)."""
    plan = stage_plan(players, rules) if players >= 2 else []
    largest = max((max(st.get("sizes", [st.get("final", 0)])) for st in plan), default=players)
    n = largest if fits(cfg, largest) else cfg.capacity
    return {
        "players": players,
        "capacity": cfg.capacity,
        "largest_group": largest,
        "fits": fits(cfg, largest),
        "uses_divisions": uses_divisions(players, rules),
        "stage_plan": plan,
        **table_geometry(cfg, n, list(range(n)), n - 1 if n else None, rules.between_inset),
    }


def _prompts(s: State) -> list[dict]:
    out = []
    for pl in s.players.values():
        if pl.status in ALIVE and pl.penalties.get("false_grab", 0) >= s.rules.false_grab_dq_at:
            out.append({"type": "dq", "player_id": pl.id, "kind": "false_grab"})
    div = s.active_division
    if div and div.status == "cutoff":
        out.append({"type": "cutoff", "division_id": div.id, "advancing_ids": s.alive_in(div.id)})
    return out


def state_view(s: State) -> dict:
    finish = places(s)
    stage = s.stage
    waiting = (
        [d for d in stage["division_ids"] if s.divisions[d].status == "waiting"] if stage else []
    )
    total = sum(1 for p in s.players.values() if p.status != "withdrawn")
    return {
        "tournament": {
            "name": s.name,
            "date": s.date,
            "created_at": s.created_at,
            "started": s.started,
            "completed": s.completed,
            "champion_id": s.champion_id,
            "uses_divisions": any(not st["final"] for st in s.stages)
            if s.started
            else uses_divisions(total, s.rules),
        },
        "rules": s.rules.to_dict(),
        "table_config": {**s.table.to_dict(), "capacity": s.table.capacity},
        "stages": [
            {
                "no": st["no"],
                "is_final": st["final"],
                "divisions": [
                    {
                        "id": d.id,
                        "label": d.label,
                        "status": d.status,
                        "player_ids": d.player_ids,
                        "advance_target": d.advance_target,
                        "advancing_ids": d.advancing_ids,
                    }
                    for d in (s.divisions[i] for i in st["division_ids"])
                ],
            }
            for st in s.stages
        ],
        "active_division_id": s.active_division_id,
        "next_division_id": waiting[0] if waiting else None,
        "round": _round_view(s),
        "rounds_played": s.rounds_played,
        "open_stalemates": [
            {"id": sm.id, "player_ids": sm.player_ids, "opened_at": sm.opened_at}
            for sm in s.open_stalemates.values()
        ],
        "players": [
            {
                "id": p.id,
                "name": p.name,
                "status": p.status,
                "division_id": p.division_id,
                "penalties": p.penalties,
                "out_round": p.out_round,
                "finish_place": finish[p.id][0],
                "finish_tied": finish[p.id][1],
            }
            for p in s.players.values()
        ],
        "prompts": _prompts(s),
        "timeline": s.timeline,
    }


def tournament_view(events: list[Event], cursor: int) -> dict:
    return {
        **state_view(replay(events[:cursor])),
        "cursor": cursor,
        "head": len(events),
        "can_undo": can_undo(events, cursor),
        "can_redo": can_redo(events, cursor),
    }
