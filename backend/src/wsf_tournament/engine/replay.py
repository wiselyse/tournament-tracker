"""events → State. `apply` is a plain reducer: it never decides anything, it only records
what the event says. Decisions (who is seated, what happens after an out) live in
commands.py, which applies each event as it emits it so it can inspect the result."""

from dataclasses import dataclass, field

from .events import Event
from .rules import DEFAULT_RULES, RulesConfig
from .seating import TableConfig

ALIVE = ("in", "waiting", "advanced")

PENALTY_LABELS = {
    "delayed_pass": "delayed passing",
    "false_grab": "false spoon grab",
    "premature_grab": "premature spoon grab",
    "spoon_tamper": "spoon tampering",
    "card_pass": "improper card passing",
    "hand_manipulation": "hand manipulation",
    "physical_harm": "physical harm",
}


@dataclass
class Player:
    id: str
    name: str
    status: str = "waiting"  # in | waiting | advanced | out | dq | withdrawn
    division_id: str | None = None
    stage_no: int = 0  # latest stage this player entered
    penalties: dict[str, int] = field(default_factory=dict)
    out_round: int | None = None
    out_stage: int | None = None
    out_remaining: int | None = None  # players left in the division (incl. them) when out


@dataclass
class Division:
    id: str
    label: str
    stage_no: int
    final: bool
    player_ids: list[str]
    status: str = "waiting"  # waiting | playing | cutoff | complete
    advance_target: int | None = None
    advancing_ids: list[str] | None = None


@dataclass
class Round:
    no: int
    division_id: str
    seats: list[str]  # player id by seat index (seat_no = index + 1)
    empty_gap: int | None  # "between" layout: gap after seat index k (0-based)
    table: TableConfig  # table in force when these seats were drawn
    started_at: int
    ended: bool = False
    ended_at: int | None = None
    paused_ms: int = 0
    paused_since: int | None = None


@dataclass
class Stalemate:
    id: str
    player_ids: list[str]
    opened_at: int
    round_no: int | None


@dataclass
class State:
    name: str = ""
    date: str | None = None
    created_at: int = 0
    rules: RulesConfig = DEFAULT_RULES
    table: TableConfig = field(default_factory=TableConfig)
    players: dict[str, Player] = field(default_factory=dict)
    divisions: dict[str, Division] = field(default_factory=dict)
    stages: list[dict] = field(default_factory=list)  # {no, final, division_ids}
    active_division_id: str | None = None
    round: Round | None = None
    rounds_played: int = 0
    open_stalemates: dict[str, Stalemate] = field(default_factory=dict)
    stalemates_opened: int = 0
    eliminations: list[str] = field(default_factory=list)  # player ids, in order
    champion_id: str | None = None
    completed: bool = False
    timeline: list[dict] = field(default_factory=list)

    @property
    def started(self) -> bool:
        return bool(self.stages)

    @property
    def stage(self) -> dict | None:
        return self.stages[-1] if self.stages else None

    @property
    def active_division(self) -> Division | None:
        return self.divisions.get(self.active_division_id) if self.active_division_id else None

    def alive_in(self, division_id: str) -> list[str]:
        return [
            p for p in self.divisions[division_id].player_ids if self.players[p].status in ALIVE
        ]

    def name_of(self, pid: str) -> str:
        return self.players[pid].name


def _names(state: State, ids) -> str:
    return " vs ".join(state.name_of(p) for p in ids)


def _ordinal(n: int) -> str:
    suffix = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def stalemate_result(player_ids: list[str], payload: dict) -> tuple[list[str], list[str]]:
    """(winners, losers). New events name the loser (rule 2.2.2, 2026-10); events written
    before that named the single winner of a two-player stalemate."""
    if "loser_id" in payload:
        return [x for x in player_ids if x != payload["loser_id"]], [payload["loser_id"]]
    return [payload["winner_id"]], [x for x in player_ids if x != payload["winner_id"]]


def apply(state: State, ev: Event) -> None:
    p = ev.payload
    t = ev.type
    label = t
    extra: dict = {}

    if t == "TournamentCreated":
        state.name, state.date, state.created_at = p["name"], p.get("date"), ev.at
        state.rules = DEFAULT_RULES.with_overrides(p.get("rules_overrides"))
        label = "Tournament created"

    elif t == "PlayerAdded":
        pl = Player(p["player_id"], p["name"])
        div_id = p.get("division_id")
        if div_id:
            div = state.divisions[div_id]
            div.player_ids.append(pl.id)
            pl.division_id, pl.stage_no = div_id, div.stage_no
            pl.status = "in" if div.status == "playing" else "waiting"
        state.players[pl.id] = pl
        label = f"{pl.name} added"
        extra["player_ids"] = [pl.id]

    elif t == "PlayerRenamed":
        pl = state.players[p["player_id"]]
        label = f"{pl.name} renamed to {p['name']}"
        pl.name = p["name"]
        extra["player_ids"] = [pl.id]

    elif t == "TableConfigured":
        state.table = TableConfig.from_dict(p)
        cfg = state.table
        limits = {
            "rectangle": f" {cfg.max_long}/{cfg.max_end}",
            "square": f" {cfg.max_side}/side",
        }.get(cfg.shape, "")
        label = f"Table: {cfg.shape}{limits} · spoons {cfg.spoon_layout}"

    elif t == "StageCreated":
        no = p["stage_no"]
        ids = []
        for d in p["divisions"]:
            div = Division(
                d["division_id"], d["label"], no, p.get("final", False), list(d["player_ids"])
            )
            state.divisions[div.id] = div
            ids.append(div.id)
            for pid in div.player_ids:
                pl = state.players[pid]
                pl.status, pl.division_id, pl.stage_no = "waiting", div.id, no
        state.stages.append({"no": no, "final": p.get("final", False), "division_ids": ids})
        if p.get("final"):
            n = len(p["divisions"][0]["player_ids"])
            label = f"{'One table' if no == 1 else 'Final table'} · {n} players"
        else:
            label = f"Stage {no} · {len(ids)} divisions drawn"

    elif t == "DivisionStarted":
        div = state.divisions[p["division_id"]]
        div.status, div.advance_target = "playing", p.get("advance_target")
        state.active_division_id = div.id
        for pid in state.alive_in(div.id):
            state.players[pid].status = "in"
        if div.final:
            label = "Final table started" if div.stage_no > 1 else "Play started"
        else:
            label = f"Division {div.label} started"

    elif t in ("RoundStarted", "SeatsRerolled"):
        if t == "RoundStarted":
            state.rounds_played = p["round_no"]
            state.round = Round(
                p["round_no"],
                state.active_division_id,
                list(p["seat_assignment"]),
                p.get("empty_gap"),
                state.table,
                ev.at,
            )
            label = f"Round {p['round_no']} · {len(p['seat_assignment'])} players"
        else:
            r = state.round
            r.seats, r.empty_gap, r.table = (
                list(p["seat_assignment"]),
                p.get("empty_gap"),
                state.table,
            )
            label = "Seats re-rolled"

    elif t == "SeatsSwapped":
        seats = state.round.seats
        a, b = p["seat_a"] - 1, p["seat_b"] - 1
        seats[a], seats[b] = seats[b], seats[a]
        label = f"Seats {p['seat_a']} & {p['seat_b']} swapped"

    elif t == "StalemateOpened":
        sm = Stalemate(
            p["stalemate_id"], list(p["player_ids"]), ev.at, state.round.no if state.round else None
        )
        state.open_stalemates[sm.id] = sm
        state.stalemates_opened += 1
        label = f"Stalemate: {_names(state, sm.player_ids)}"
        extra.update(stalemate_id=sm.id, player_ids=sm.player_ids)

    elif t == "StalemateResolved":
        sm = state.open_stalemates.pop(p["stalemate_id"])
        winners, losers = stalemate_result(sm.player_ids, p)
        if len(winners) == 1:
            label = f"{state.name_of(winners[0])} wins stalemate vs {_names(state, losers)}"
        else:
            kept = ", ".join(map(state.name_of, winners))
            label = f"{state.name_of(losers[0])} concedes the stalemate ({kept} keep spoons)"
        extra.update(
            stalemate_id=sm.id, player_ids=sm.player_ids, winner_ids=winners, loser_ids=losers
        )

    elif t == "StalemateCancelled":
        sm = state.open_stalemates.pop(p["stalemate_id"])
        label = f"Stalemate cancelled: {_names(state, sm.player_ids)}"
        extra.update(stalemate_id=sm.id, player_ids=sm.player_ids)

    elif t == "PenaltyLogged":
        pl = state.players[p["player_id"]]
        n = pl.penalties.get(p["kind"], 0) + 1
        pl.penalties[p["kind"]] = n
        label = f"{pl.name} — {PENALTY_LABELS[p['kind']]} ({_ordinal(n)})"
        if p["kind"] == "card_pass":
            forfeit = n >= state.rules.card_pass_forfeit_at
            label += " · card forfeit" if forfeit else " · warning"
        extra.update(player_ids=[pl.id], kind=p["kind"], count=n)

    elif t == "PlayerEliminated":
        pl = state.players[p["player_id"]]
        reason = p["reason"]
        if pl.division_id:
            pl.out_remaining = len(state.alive_in(pl.division_id))
        pl.status = {"round": "out", "dq": "dq", "withdrawn": "withdrawn"}[reason]
        # Only a player in the running round goes out "in" it (not one waiting elsewhere).
        r = state.round
        playing = r is not None and not r.ended and pl.division_id == r.division_id
        pl.out_round = r.no if playing else None
        pl.out_stage = pl.stage_no
        state.eliminations.append(pl.id)
        div = state.divisions.get(pl.division_id) if pl.division_id else None
        if (
            div
            and div.status == "playing"
            and div.advance_target is not None
            and len(state.alive_in(div.id)) <= div.advance_target
        ):
            div.status = "cutoff"
        label = {
            "round": f"{pl.name} out",
            "dq": f"{pl.name} disqualified",
            "withdrawn": f"{pl.name} withdrew",
        }[reason]
        extra.update(player_ids=[pl.id], reason=reason)

    elif t == "RoundEnded":
        r = state.round
        r.ended, r.ended_at = True, ev.at
        if r.paused_since is not None:  # an out during a stoppage closes it
            r.paused_ms += ev.at - r.paused_since
            r.paused_since = None
        label = f"Round {p['round_no']} ended"

    elif t == "StoppageStarted":
        state.round.paused_since = ev.at
        label = "Stoppage called"

    elif t == "StoppageEnded":
        r = state.round
        r.paused_ms += ev.at - r.paused_since
        r.paused_since = None
        label = "Play resumed"

    elif t == "DivisionCutoffConfirmed":
        div = state.divisions[p["division_id"]]
        div.status, div.advancing_ids = "complete", list(p["advancing_ids"])
        for pid in div.advancing_ids:
            state.players[pid].status = "advanced"
        state.active_division_id = None
        label = f"Division {div.label}: {len(div.advancing_ids)} advance"

    elif t == "TournamentCompleted":
        state.completed, state.champion_id = True, p.get("champion_id")
        if state.active_division:
            state.active_division.status = "complete"
        label = (
            f"{state.name_of(state.champion_id)} wins the tournament"
            if state.champion_id
            else "Tournament completed"
        )

    else:
        raise ValueError(f"unknown event type {t!r}")

    state.timeline.append(
        {
            "seq": ev.seq,
            "group": ev.group,
            "type": t,
            "at": ev.at,
            "label": label,
            "round_no": state.round.no if state.round else None,
            **extra,
        }
    )


def replay(events: list[Event]) -> State:
    state = State()
    for ev in events:
        apply(state, ev)
    return state
