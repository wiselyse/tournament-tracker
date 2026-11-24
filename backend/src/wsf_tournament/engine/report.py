"""History the Report, Survival chart and story exports need (HANDOFF §3 v1.1).

The live State only keeps the current round, so this walks the events once, applying
each one and noting what the round-by-round view needs: who sat which round, where each
stalemate, penalty and out happened, and how long everything took.
"""

from .events import Event
from .replay import State, apply, stalemate_result
from .standings import places


def report(events: list[Event]) -> dict:
    s = State()
    rounds: dict[int, dict] = {}
    marks: dict[str, list[dict]] = {}
    seated: dict[str, set[int]] = {}
    stalemate_round: dict[str, int | None] = {}
    won: dict[str, int] = {}
    stoppages = 0
    first_at = last_at = None

    def mark(pid: str, kind: str, rnd: int | None) -> None:
        if rnd is not None:
            marks.setdefault(pid, []).append({"round": rnd, "type": kind})

    for ev in events:
        p = ev.payload
        if ev.type == "StalemateResolved":
            sm = s.open_stalemates[p["stalemate_id"]]
            stalemate_round[sm.id] = sm.round_no
            winners, losers = stalemate_result(sm.player_ids, p)
        apply(s, ev)
        cur = s.round.no if s.round else None
        if ev.type in ("RoundStarted", "SeatsRerolled"):
            if ev.type == "RoundStarted":
                rounds[cur] = {
                    "no": cur,
                    "division_id": s.round.division_id,
                    "started_at": ev.at,
                    "ended_at": None,
                    "ms": None,  # playing time, stoppages excluded (like the Live timer)
                    "players": len(p["seat_assignment"]),
                    "out": [],
                    "stalemates": 0,
                    "penalties": 0,
                }
                first_at = first_at if first_at is not None else ev.at
            for pid in p["seat_assignment"]:
                seated.setdefault(pid, set()).add(cur)
        elif ev.type == "RoundEnded":
            rnd = rounds[p["round_no"]]
            rnd["ended_at"], rnd["ms"] = ev.at, ev.at - rnd["started_at"] - s.round.paused_ms
            last_at = ev.at
        elif ev.type == "PlayerEliminated":
            rnd = s.players[p["player_id"]].out_round
            if rnd is not None:
                rounds[rnd]["out"].append(p["player_id"])
            mark(p["player_id"], {"round": "out", "dq": "dq"}.get(p["reason"], "withdrawn"), rnd)
        elif ev.type == "StalemateOpened" and cur is not None:
            rounds[cur]["stalemates"] += 1
        elif ev.type == "StalemateResolved":
            rnd = stalemate_round[p["stalemate_id"]]
            for pid in winners:
                won[pid] = won.get(pid, 0) + 1
                mark(pid, "won", rnd)
            for pid in losers:
                mark(pid, "lost", rnd)
        elif ev.type == "PenaltyLogged" and cur is not None and s.round and not s.round.ended:
            rounds[cur]["penalties"] += 1
            mark(p["player_id"], "penalty", cur)
        elif ev.type == "StoppageStarted":
            stoppages += 1
        elif ev.type == "TournamentCompleted":
            last_at = ev.at

    finish = places(s)
    players = []
    for pid, pl in s.players.items():
        played = sorted(seated.get(pid, ()))
        players.append(
            {
                "id": pid,
                "name": pl.name,
                "status": "champion" if pid == s.champion_id else pl.status,
                "place": finish[pid][0],
                "tied": finish[pid][1],
                "out_round": pl.out_round,
                "rounds": played,  # every round this player sat at the table
                "stalemates_won": won.get(pid, 0),
                "stalemates_lost": sum(1 for m in marks.get(pid, []) if m["type"] == "lost"),
                "penalties": sum(pl.penalties.values()),
                "marks": sorted(marks.get(pid, []), key=lambda m: m["round"]),
            }
        )
    players.sort(
        key=lambda x: (
            x["place"] is None and x["status"] == "withdrawn",
            x["place"] if x["place"] is not None else 0,
            x["name"],
        )
    )

    timed = [r for r in rounds.values() if r["ms"] is not None]
    longest = max(timed, key=lambda r: r["ms"], default=None)
    shortest = min(timed, key=lambda r: r["ms"], default=None)
    top_stalemate = max(players, key=lambda x: x["stalemates_won"], default=None)
    return {
        "completed": s.completed,
        "champion_id": s.champion_id,
        "rounds": [rounds[k] for k in sorted(rounds)],
        "players": players,
        "stats": {
            "players": sum(1 for x in s.players.values() if x.status != "withdrawn"),
            "rounds": len(rounds),
            "total_ms": (last_at - first_at) if first_at is not None and last_at else 0,
            "stalemates": s.stalemates_opened,
            "penalties": sum(sum(x.penalties.values()) for x in s.players.values()),
            "dqs": sum(1 for x in s.players.values() if x.status == "dq"),
            "stoppages": stoppages,
            "divisions": sum(1 for d in s.divisions.values() if not d.final),
            "longest_round": longest and {"no": longest["no"], "ms": longest["ms"]},
            "shortest_round": shortest and {"no": shortest["no"], "ms": shortest["ms"]},
            "most_stalemates_won": (
                {"player_id": top_stalemate["id"], "count": top_stalemate["stalemates_won"]}
                if top_stalemate and top_stalemate["stalemates_won"]
                else None
            ),
        },
    }
