from random import Random, SystemRandom

from wsf_tournament.engine import rng


def test_live_app_uses_the_operating_systems_random_source():
    assert isinstance(rng.SOURCE, SystemRandom)


def test_seats_and_gap_are_drawn_from_the_players_given():
    players = [f"p{i}" for i in range(16)]
    seats = rng.shuffle_seats(players, Random(1))
    assert sorted(seats) == sorted(players)  # everyone seated exactly once
    assert all(0 <= rng.pick_empty_gap(16, Random(i)) < 16 for i in range(50))
