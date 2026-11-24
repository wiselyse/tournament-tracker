"""Finishing places (HANDOFF §5.6).

- Anyone still alive ranks above anyone eliminated.
- A player knocked out in a later stage ranks above one knocked out earlier.
- Within a stage, fewer players left in your division when you went out = better. On a
  single/final table that is exactly reverse elimination order; across divisions it
  produces ties ("T-13").
- A DQ ranks like an elimination in that round. Withdrawals are unranked ("WD") and are
  ignored when counting the others.
"""

from .replay import ALIVE, State


def _key(state: State, pid: str) -> tuple:
    pl = state.players[pid]
    if pl.status in ALIVE:
        return (1, 0, 0)
    remaining = pl.out_remaining if pl.out_remaining is not None else 10**9
    return (0, pl.out_stage or 0, -remaining)


def places(state: State) -> dict[str, tuple[int | None, bool]]:
    """{player_id: (place, tied)}. Place is None for players still alive (except the
    champion) and for withdrawals."""
    ranked = [pid for pid, pl in state.players.items() if pl.status != "withdrawn"]
    keys = {pid: _key(state, pid) for pid in ranked}
    out: dict[str, tuple[int | None, bool]] = {}
    for pid, pl in state.players.items():
        if pl.status == "withdrawn":
            out[pid] = (None, False)
        elif pid == state.champion_id:
            out[pid] = (1, False)
        elif pl.status in ALIVE:
            out[pid] = (None, False)
        else:
            k = keys[pid]
            better = sum(1 for q in ranked if keys[q] > k)
            tied = sum(1 for q in ranked if q != pid and keys[q] == k) > 0
            out[pid] = (better + 1, tied)
    return out
