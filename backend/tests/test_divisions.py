from collections import Counter
from random import Random

import pytest

from wsf_tournament.engine.divisions import division_label, stage_plan
from wsf_tournament.engine.rng import draw_divisions
from wsf_tournament.engine.rules import DEFAULT_RULES

V2_1 = DEFAULT_RULES.with_overrides({"division_threshold": 20, "max_per_table": 12})


# HANDOFF §5.5 test table (rulebook v2.1)
@pytest.mark.parametrize(
    "players, plan",
    [
        (12, [{"final": 12}]),
        (20, [{"final": 20}]),
        (21, [{"sizes": [11, 10]}, {"final": 10}]),
        (25, [{"sizes": [7, 6, 6, 6]}, {"final": 12}]),
        (30, [{"sizes": [8, 8, 7, 7]}, {"sizes": [7, 7]}, {"final": 6}]),
        (48, [{"sizes": [12, 12, 12, 12]}, {"sizes": [12, 12]}, {"final": 12}]),
        (50, [{"sizes": [7, 7, 6, 6, 6, 6, 6, 6]}, {"sizes": [12, 12]}, {"final": 12}]),
    ],
)
def test_stage_plan(players, plan):
    assert stage_plan(players, V2_1) == plan


# 2026 rulebook (proposal 2026-3): divisions above 16, at most 16 per table
@pytest.mark.parametrize(
    "players, plan",
    [
        (16, [{"final": 16}]),
        (17, [{"sizes": [9, 8]}, {"final": 8}]),
        (18, [{"sizes": [9, 9]}, {"final": 8}]),
        (32, [{"sizes": [16, 16]}, {"final": 16}]),
        (33, [{"sizes": [9, 8, 8, 8]}, {"final": 16}]),
        (50, [{"sizes": [13, 13, 12, 12]}, {"sizes": [12, 12]}, {"final": 12}]),
    ],
)
def test_stage_plan_2026(players, plan):
    assert stage_plan(players, DEFAULT_RULES) == plan


def test_rules_config_drives_the_plan():
    rules = DEFAULT_RULES.with_overrides({"division_threshold": 10, "max_per_table": 8})
    assert stage_plan(12, rules) == [{"sizes": [6, 6]}, {"final": 6}]
    with pytest.raises(ValueError):
        DEFAULT_RULES.with_overrides({"max_per_tabel": 8})


@pytest.mark.parametrize("players, count", [(21, 2), (30, 4), (50, 8), (13, 2)])
def test_draw_is_balanced_and_complete(players, count):
    ids = [f"p{i}" for i in range(players)]
    groups = draw_divisions(ids, count, Random(7))
    sizes = [len(g) for g in groups]
    assert len(groups) == count and max(sizes) - min(sizes) <= 1
    assert Counter(p for g in groups for p in g) == Counter(ids)


def test_labels():
    assert [division_label(i) for i in (0, 1, 25, 26, 27)] == ["A", "B", "Z", "AA", "AB"]


@pytest.mark.parametrize(
    "bad",
    [
        {"max_per_table": 0},
        {"max_per_table": "12"},
        {"division_threshold": -1},
        {"false_grab_dq_at": 0},
        {"spoon_layout": "pile"},
        {"between_inset": 0.9},
        {"immediate_dq": ["rudeness"]},
    ],
)
def test_bad_rule_overrides_are_rejected(bad):
    with pytest.raises(ValueError):
        DEFAULT_RULES.with_overrides(bad)
