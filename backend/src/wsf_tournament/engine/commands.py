"""Commands → events (HANDOFF §4.3). Each handler validates against the current state and
emits events; every emitted event is applied immediately, so follow-on decisions (end the
round? cutoff? next stage?) read the same state the reducer produces."""

from collections.abc import Callable
from random import Random

from . import rng
from .divisions import (
    advance_target,
    division_count,
    division_label,
    stage_plan,
    uses_divisions,
)
from .events import CommandError, Event
from .replay import ALIVE, State, apply
from .rules import DEFAULT_RULES, PENALTY_KINDS, RulesConfig
from .seating import TableConfig, fits

FINAL_ID = "final"


class Ctx:
    def __init__(self, state: State, now: int, rng: Random):
        self.state, self.now, self.rng = state, now, rng
        self.events: list[Event] = []

    def emit(self, type_: str, **payload) -> None:
        ev = Event(type_, payload, self.now)
        apply(self.state, ev)
        self.events.append(ev)


# ---------------------------------------------------------------- helpers


def _require(cond, message: str) -> None:
    if not cond:
        raise CommandError(message)


def _arg(cmd: dict, key: str, kind: type):
    v = cmd.get(key)
    _require(
        isinstance(v, kind) and not isinstance(v, bool), f"'{key}' is required ({kind.__name__})"
    )
    return v


def _clean_name(state: State, raw, exclude: str | None = None) -> str:
    _require(isinstance(raw, str) and raw.strip(), "name is required")
    name = " ".join(raw.split())
    _require(len(name) <= 40, "name is too long (max 40 characters)")
    taken = {p.name.casefold() for pid, p in state.players.items() if pid != exclude}
    _require(name.casefold() not in taken, f"there is already a player called {name}")
    return name


def _player(state: State, cmd: dict, key: str = "player_id"):
    pid = _arg(cmd, key, str)
    _require(pid in state.players, f"unknown player {pid}")
    return state.players[pid]


def _round_live(state: State):
    r = state.round
    _require(r is not None and not r.ended and not state.completed, "no round in progress")
    return r


def _table_check(cfg: TableConfig, players: int) -> None:
    _require(
        fits(cfg, players),
        f"{players} players don't fit this table (capacity {cfg.capacity}); change the table first",
    )


def _seating(ctx: Ctx, div_id: str | None = None) -> dict:
    s = ctx.state
    div_id = div_id or s.active_division_id
    seated = [p for p in s.alive_in(div_id) if s.players[p].status == "in"]
    _table_check(s.table, len(seated))
    seats = rng.shuffle_seats(seated, ctx.rng)
    gap = rng.pick_empty_gap(len(seats), ctx.rng) if s.table.spoon_layout == "between" else None
    return {"seat_assignment": seats, "empty_gap": gap}


def _start_round(ctx: Ctx, div_id: str | None = None) -> None:
    """Seat the next round. The event names its division: with several divisions in a stage
    they take turns, and replay follows whose turn it is from here."""
    div_id = div_id or ctx.state.active_division_id
    ctx.emit(
        "RoundStarted",
        round_no=ctx.state.rounds_played + 1,
        division_id=div_id,
        **_seating(ctx, div_id),
    )


def _play_division(ctx: Ctx, div_id: str) -> None:
    """Give the table to `div_id`: its first round starts it, later ones just seat it."""
    if ctx.state.divisions[div_id].status == "waiting":
        _start_division(ctx, div_id)
    else:
        _start_round(ctx, div_id)


def _end_round(ctx: Ctx) -> None:
    """End the live round, if any. Open stalemates can't outlive it."""
    r = ctx.state.round
    if r and not r.ended:
        for sid in list(ctx.state.open_stalemates):
            ctx.emit("StalemateCancelled", stalemate_id=sid)
        ctx.emit("RoundEnded", round_no=r.no)


def _complete(ctx: Ctx, alive: list[str]) -> None:
    _end_round(ctx)
    ctx.emit("TournamentCompleted", champion_id=alive[0] if len(alive) == 1 else None)


def _start_division(ctx: Ctx, div_id: str) -> None:
    s = ctx.state
    div = s.divisions[div_id]
    alive = s.alive_in(div_id)
    ctx.emit(
        "DivisionStarted",
        division_id=div_id,
        advance_target=None if div.final else advance_target(len(alive)),
    )
    if div.final and len(alive) <= 1:
        _complete(ctx, alive)
    else:
        _start_round(ctx)


def _create_stage(ctx: Ctx, pool: list[str], force_final: bool = False) -> None:
    s = ctx.state
    if len(pool) <= 1:
        _complete(ctx, pool)
        return
    no = len(s.stages) + 1
    count = 0 if force_final else division_count(len(pool), s.rules)
    if count == 0:
        _table_check(s.table, len(pool))
        ctx.emit(
            "StageCreated",
            stage_no=no,
            final=True,
            divisions=[{"division_id": FINAL_ID, "label": "Final", "player_ids": pool}],
        )
        _start_division(ctx, FINAL_ID)
        return
    used = sum(1 for d in s.divisions.values() if not d.final)
    groups = rng.draw_divisions(pool, count, ctx.rng)
    _table_check(s.table, max(len(g) for g in groups))
    divs = []
    for i, g in enumerate(groups):
        label = division_label(used + i)
        divs.append({"division_id": label, "label": label, "player_ids": g})
    ctx.emit("StageCreated", stage_no=no, final=False, divisions=divs)
    _start_division(ctx, divs[0]["division_id"])


def _after_elimination(ctx: Ctx, round_over: bool) -> None:
    """Decide what follows an elimination in the active division."""
    s = ctx.state
    div = s.active_division
    if div is None:
        return
    alive = s.alive_in(div.id)
    if div.final and len(alive) <= 1:
        _complete(ctx, alive)
    elif div.status == "cutoff":
        _end_round(ctx)  # wait for the organiser to confirm who advances
    elif round_over:
        # Divisions take turns: each round goes to the next one still playing (A, B, C, A…).
        _play_division(ctx, s.next_division(div.id))


def _eliminate(ctx: Ctx, pid: str, reason: str) -> None:
    """DQ or withdrawal. Doesn't end the round unless it settles the division."""
    s = ctx.state
    for sm in list(s.open_stalemates.values()):
        if pid in sm.player_ids:
            ctx.emit("StalemateCancelled", stalemate_id=sm.id)
    in_active = s.players[pid].division_id == s.active_division_id
    ctx.emit("PlayerEliminated", player_id=pid, reason=reason)
    if in_active:
        _after_elimination(ctx, round_over=False)


def _alive(state: State, cmd: dict):
    pl = _player(state, cmd)
    _require(pl.status in ALIVE, f"{pl.name} is already out")
    return pl


# ---------------------------------------------------------------- command handlers


def cmd_start(ctx: Ctx, cmd: dict) -> None:
    s = ctx.state
    _require(not s.started, "the tournament has already started")
    pool = [pid for pid, p in s.players.items() if p.status in ALIVE]
    _require(len(pool) >= 2, "need at least 2 players")
    _table_check(s.table, _largest_group(s))
    _create_stage(ctx, pool, force_final=not uses_divisions(len(pool), s.rules))


def _round_winner(s: State, cmd: dict, loser_id: str) -> dict:
    """Optional: who won the round (got four of a kind). Kept off the event when not given."""
    if cmd.get("winner_id") is None:
        return {}
    r = s.round
    w = _player(s, cmd, "winner_id")
    _require(
        w.id in r.seats and w.status == "in" and w.id != loser_id,
        "the winner must be another player at the table",
    )
    return {"winner_id": w.id}


def _round_out(ctx: Ctx, pid: str, reason: str, extra: dict) -> None:
    """The round's loser goes out, the round ends and play moves on."""
    r = ctx.state.round
    if r.paused_since is not None:
        ctx.emit("StoppageEnded")
    ctx.emit("PlayerEliminated", player_id=pid, reason=reason, **extra)
    _end_round(ctx)  # also closes any other open stalemate
    _after_elimination(ctx, round_over=True)


def cmd_mark_out(ctx: Ctx, cmd: dict) -> None:
    s = ctx.state
    r = _round_live(s)
    pl = _alive(s, cmd)
    _require(pl.id in r.seats and pl.status == "in", f"{pl.name} isn't playing this round")
    _require(not s.open_stalemates, "resolve or cancel the open stalemate first")
    _round_out(ctx, pl.id, "round", _round_winner(s, cmd, pl.id))


def cmd_open_stalemate(ctx: Ctx, cmd: dict) -> None:
    s = ctx.state
    r = _round_live(s)
    ids = cmd.get("player_ids")
    _require(
        isinstance(ids, list) and len(set(ids)) == len(ids) and len(ids) >= 2,
        "a stalemate needs at least 2 different players",
    )
    busy = {p for sm in s.open_stalemates.values() for p in sm.player_ids}
    for pid in ids:
        _require(pid in s.players, f"unknown player {pid}")
        pl = s.players[pid]
        _require(pl.status == "in" and pid in r.seats, f"{pl.name} isn't playing this round")
        _require(pid not in busy, f"{pl.name} is already in an open stalemate")
    ctx.emit("StalemateOpened", stalemate_id=f"s{s.stalemates_opened + 1}", player_ids=ids)


def _stalemate(s: State, cmd: dict):
    sid = _arg(cmd, "stalemate_id", str)
    _require(sid in s.open_stalemates, f"no open stalemate {sid}")
    return s.open_stalemates[sid]


def cmd_resolve_stalemate(ctx: Ctx, cmd: dict) -> None:
    """Rule 2.2.2: the player left without a spoon loses the stalemate, which loses them the
    round: they go out and the round ends, just like marking them out."""
    s = ctx.state
    sm = _stalemate(s, cmd)
    loser = _arg(cmd, "loser_id", str)
    _require(loser in sm.player_ids, "pick one of the stalemate's players")
    extra = _round_winner(s, cmd, loser)
    ctx.emit("StalemateResolved", stalemate_id=sm.id, loser_id=loser)
    _round_out(ctx, loser, "stalemate", extra)


def cmd_cancel_stalemate(ctx: Ctx, cmd: dict) -> None:
    ctx.emit("StalemateCancelled", stalemate_id=_stalemate(ctx.state, cmd).id)


def cmd_log_penalty(ctx: Ctx, cmd: dict) -> None:
    s = ctx.state
    pl = _alive(s, cmd)
    kind = cmd.get("kind")
    _require(kind in PENALTY_KINDS, f"kind must be one of {PENALTY_KINDS}")
    note = cmd.get("note") or None
    _require(note is None or isinstance(note, str), "note must be text")
    ctx.emit("PenaltyLogged", player_id=pl.id, kind=kind, note=note)
    if kind in s.rules.immediate_dq:
        _eliminate(ctx, pl.id, "dq")


def cmd_disqualify(ctx: Ctx, cmd: dict) -> None:
    _eliminate(ctx, _alive(ctx.state, cmd).id, "dq")


def cmd_withdraw(ctx: Ctx, cmd: dict) -> None:
    _eliminate(ctx, _alive(ctx.state, cmd).id, "withdrawn")


def cmd_add_player(ctx: Ctx, cmd: dict) -> None:
    s = ctx.state
    name = _clean_name(s, cmd.get("name"))
    target = None
    if s.started:
        # HANDOFF §13.4: the first division that hasn't started (and has room), else the
        # next stage's draw; on a single/final table, the table itself.
        stage = s.stage
        if stage["final"]:
            target = stage["division_ids"][0]
            _table_check(s.table, len(s.alive_in(target)) + 1)
        else:
            room = min(s.table.capacity or s.rules.max_per_table, s.rules.max_per_table)
            target = next(
                (
                    d
                    for d in stage["division_ids"]
                    if s.divisions[d].status == "waiting" and len(s.alive_in(d)) < room
                ),
                None,
            )
    ctx.emit("PlayerAdded", player_id=f"p{len(s.players) + 1}", name=name, division_id=target)


def cmd_rename_player(ctx: Ctx, cmd: dict) -> None:
    pl = _player(ctx.state, cmd)
    ctx.emit("PlayerRenamed", player_id=pl.id, name=_clean_name(ctx.state, cmd.get("name"), pl.id))


def cmd_reroll(ctx: Ctx, cmd: dict) -> None:
    _round_live(ctx.state)
    ctx.emit("SeatsRerolled", **_seating(ctx))


def cmd_swap_seats(ctx: Ctx, cmd: dict) -> None:
    r = _round_live(ctx.state)
    a, b = _arg(cmd, "seat_a", int), _arg(cmd, "seat_b", int)
    _require(
        1 <= a <= len(r.seats) and 1 <= b <= len(r.seats) and a != b, "pick two different seats"
    )
    ctx.emit("SeatsSwapped", seat_a=a, seat_b=b)


def cmd_change_table(ctx: Ctx, cmd: dict) -> None:
    s = ctx.state
    raw = cmd.get("table")
    _require(isinstance(raw, dict), "'table' is required")
    try:
        cfg = TableConfig.from_dict(raw)
    except (TypeError, ValueError) as e:
        raise CommandError(str(e)) from e
    _table_check(cfg, _largest_group(s))
    ctx.emit("TableConfigured", **cfg.to_dict())
    if cmd.get("reroll") and s.round and not s.round.ended:
        ctx.emit("SeatsRerolled", **_seating(ctx))


def _largest_group(s: State) -> int:
    """Most players that will need this table at once, as things stand."""
    if not s.started:
        alive = sum(1 for p in s.players.values() if p.status in ALIVE)
        plan = stage_plan(alive, s.rules)
        return max(max(st.get("sizes", [st.get("final", 0)])) for st in plan)
    if s.completed:
        return 0
    return max(
        [
            len(s.alive_in(d))
            for d in s.stage["division_ids"]
            if s.divisions[d].status in ("waiting", "playing")
        ]
        or [0]
    )


def cmd_start_play(ctx: Ctx, cmd: dict) -> None:
    """Start the clock: the round's, or with `stalemate_id` that stalemate's. Seats are drawn
    first, then the organiser starts play when everyone is ready."""
    s = ctx.state
    r = _round_live(s)
    if cmd.get("stalemate_id") is not None:
        sm = _stalemate(s, cmd)
        _require(sm.started_at is None, "the stalemate has already started")
        ctx.emit("PlayStarted", stalemate_id=sm.id)
    else:
        _require(r.play_started_at is None, "the round has already started")
        ctx.emit("PlayStarted")


def cmd_start_stoppage(ctx: Ctx, cmd: dict) -> None:
    r = _round_live(ctx.state)
    _require(r.play_started_at is not None, "start the round first")
    _require(r.paused_since is None, "play is already stopped")
    ctx.emit("StoppageStarted")


def cmd_end_stoppage(ctx: Ctx, cmd: dict) -> None:
    r = _round_live(ctx.state)
    _require(r.paused_since is not None, "play isn't stopped")
    ctx.emit("StoppageEnded")


def cmd_confirm_cutoff(ctx: Ctx, cmd: dict) -> None:
    s = ctx.state
    div_id = _arg(cmd, "division_id", str)
    _require(
        div_id in s.divisions and s.divisions[div_id].status == "cutoff",
        f"division {div_id} hasn't reached its cutoff",
    )
    ctx.emit("DivisionCutoffConfirmed", division_id=div_id, advancing_ids=s.alive_in(div_id))
    if s.round and not s.round.ended:
        return  # confirmed a division away from the table; its round carries on
    nxt = s.next_division(div_id)
    if nxt is not None:
        _play_division(ctx, nxt)
        return
    if any(s.divisions[d].status != "complete" for d in s.stage["division_ids"]):
        return  # another division still waits for its cutoff to be confirmed
    pool = [
        pid
        for pid, p in s.players.items()
        if p.status == "advanced" or (p.status == "waiting" and p.division_id is None)
    ]
    _create_stage(ctx, pool)


HANDLERS: dict[str, Callable[[Ctx, dict], None]] = {
    "start": cmd_start,
    "mark_out": cmd_mark_out,
    "open_stalemate": cmd_open_stalemate,
    "resolve_stalemate": cmd_resolve_stalemate,
    "cancel_stalemate": cmd_cancel_stalemate,
    "log_penalty": cmd_log_penalty,
    "disqualify": cmd_disqualify,
    "withdraw": cmd_withdraw,
    "add_player": cmd_add_player,
    "rename_player": cmd_rename_player,
    "reroll": cmd_reroll,
    "swap_seats": cmd_swap_seats,
    "change_table": cmd_change_table,
    "start_play": cmd_start_play,
    "start_stoppage": cmd_start_stoppage,
    "end_stoppage": cmd_end_stoppage,
    "confirm_cutoff": cmd_confirm_cutoff,
}


def execute(state: State, cmd: dict, now: int, rng: Random) -> list[Event]:
    """Validate `cmd` against `state` (which is consumed) and return the new events."""
    kind = cmd.get("type")
    _require(kind in HANDLERS, f"unknown command {kind!r}")
    if state.completed:
        _require(kind == "rename_player", "the tournament is over")
    ctx = Ctx(state, now, rng)
    HANDLERS[kind](ctx, cmd)
    return ctx.events


def create_tournament(
    name: str,
    date: str | None,
    players: list[str],
    table: dict,
    rules_overrides: dict | None,
    now: int,
) -> list[Event]:
    """Events for a brand-new tournament (the setup wizard's result)."""
    _require(isinstance(name, str) and name.strip(), "tournament name is required")
    try:
        rules: RulesConfig = DEFAULT_RULES.with_overrides(rules_overrides)
        cfg = TableConfig.from_dict({"spoon_layout": rules.spoon_layout, **(table or {})})
    except (TypeError, ValueError) as e:
        raise CommandError(str(e)) from e
    _require(isinstance(players, list), "players must be a list of names")
    ctx = Ctx(State(), now, Random())
    # Full snapshot, not just overrides: next year's rule changes mustn't alter this tournament.
    ctx.emit("TournamentCreated", name=name.strip(), date=date, rules_overrides=rules.to_dict())
    for raw in players:
        name_ = _clean_name(ctx.state, raw)
        ctx.emit(
            "PlayerAdded", player_id=f"p{len(ctx.state.players) + 1}", name=name_, division_id=None
        )
    ctx.emit("TableConfigured", **cfg.to_dict())
    _table_check(cfg, _largest_group(ctx.state))
    return ctx.events
