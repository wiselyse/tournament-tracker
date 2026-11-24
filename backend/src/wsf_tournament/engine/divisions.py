"""Stage and division maths (rule 2.1.3, HANDOFF §5.5)."""

import math
import string

from .rules import RulesConfig


def division_count(players: int, rules: RulesConfig) -> int:
    """0 means this stage is a single final table."""
    if players <= rules.max_per_table:
        return 0
    d = 2
    while d < math.ceil(players / rules.max_per_table):
        d *= 2
    return d


def division_sizes(players: int, count: int) -> list[int]:
    """Split as evenly as possible, larger divisions first."""
    base, extra = divmod(players, count)
    return [base + 1 if i < extra else base for i in range(count)]


def advance_target(size: int) -> int:
    """Top half, rounded down, advances."""
    return size // 2


def uses_divisions(total_players: int, rules: RulesConfig) -> bool:
    return total_players > rules.division_threshold


def stage_plan(total_players: int, rules: RulesConfig) -> list[dict]:
    """Every stage from the first to the final table, assuming no DQs or withdrawals.

    Each entry: {"sizes": [...]} for a division stage or {"final": n} for the final table.
    """
    if not uses_divisions(total_players, rules):
        return [{"final": total_players}]
    stages, p = [], total_players
    while (d := division_count(p, rules)) > 0:
        sizes = division_sizes(p, d)
        stages.append({"sizes": sizes})
        p = sum(advance_target(s) for s in sizes)
    stages.append({"final": p})
    return stages


def division_label(index: int) -> str:
    """A, B, … Z, AA, AB, … (labels continue across stages)."""
    letters = string.ascii_uppercase
    label = ""
    index += 1
    while index:
        index, r = divmod(index - 1, 26)
        label = letters[r] + label
    return label
