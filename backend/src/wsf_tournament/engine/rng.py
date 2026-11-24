"""Every random draw in the app lives in this file.

There are three draws: who sits where, which gap between players has no spoon, and who
plays in which division. Nothing else in the app is left to chance.

The app records each result the moment it is drawn (in the tournament's event log), so a
draw is never quietly redone: undo, redo and rewind reuse the recorded result.
"""

from random import Random, SystemRandom

from .divisions import division_sizes

# The random source the live app uses. SystemRandom asks the operating system for
# randomness (the same kind used for passwords and encryption), so nobody can predict or
# replay it, including whoever runs the app. Tests pass in a predictable source instead.
SOURCE = SystemRandom()


def shuffle_seats(player_ids: list[str], rng: Random) -> list[str]:
    """Seat everyone at random: the first name returned sits in seat 1, the next in
    seat 2, and so on. Every possible seating order is equally likely (rule 1.3.2)."""
    return rng.sample(player_ids, len(player_ids))


def pick_empty_gap(seat_count: int, rng: Random) -> int:
    """Pick the gap that gets no spoon, for the "spoons between players" layout (rule 1.2.2).

    A table with N seats has N gaps; gap 0 is between seats 1 and 2, gap 1 between seats
    2 and 3, and the last one between the last seat and seat 1. Each gap is equally likely.
    """
    return rng.randrange(seat_count)


def draw_divisions(player_ids: list[str], count: int, rng: Random) -> list[list[str]]:
    """Split players into `count` divisions at random (rule 2.1.3).

    Shuffle everyone, then deal them out in order: the first few go to division A, the
    next few to B, and so on. Division sizes differ by at most one player.
    """
    shuffled = rng.sample(player_ids, len(player_ids))
    divisions, start = [], 0
    for size in division_sizes(len(player_ids), count):
        divisions.append(shuffled[start : start + size])
        start += size
    return divisions
