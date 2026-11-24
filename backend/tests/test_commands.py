import pytest

from harness import Game
from wsf_tournament.engine.commands import create_tournament
from wsf_tournament.engine.events import CommandError
from wsf_tournament.engine.history import sequence


def started(n=6, **kw):
    g = Game(n, **kw)
    g.do("start")
    return g


# ---------------------------------------------------------------- setup and start


def test_create_validates():
    with pytest.raises(CommandError, match="already a player"):
        create_tournament("T", None, ["Kit", "kit "], {"shape": "circle"}, None, 0)
    with pytest.raises(CommandError, match="don't fit"):
        create_tournament(
            "T",
            None,
            [f"P{i}" for i in range(13)],
            {"shape": "rectangle", "max_long": 4, "max_end": 2},
            None,
            0,
        )
    with pytest.raises(CommandError, match="unknown rule"):
        create_tournament("T", None, ["A", "B"], {"shape": "circle"}, {"nope": 1}, 0)
    with pytest.raises(CommandError, match="name is required"):
        create_tournament(" ", None, ["A", "B"], {"shape": "circle"}, None, 0)


def test_create_with_divisions_checks_the_largest_division_not_the_headcount():
    # 33 players at a 16-seat table is fine: the biggest group is the final table of 16.
    create_tournament(
        "T",
        None,
        [f"P{i}" for i in range(33)],
        {"shape": "rectangle", "max_long": 6, "max_end": 2},
        None,
        0,
    )


def test_default_spoon_layout_comes_from_rules():
    g = Game(4, table={"shape": "circle"}, rules={"spoon_layout": "between"})
    assert g.view["table_config"]["spoon_layout"] == "between"


def test_start_needs_two_players():
    g = Game(1)
    with pytest.raises(CommandError, match="at least 2"):
        g.do("start")


def test_gameplay_blocked_before_start():
    g = Game(4)
    with pytest.raises(CommandError, match="no round"):
        g.do("mark_out", player_id="p1")


def test_single_table_start():
    v = started(8).view
    assert v["tournament"]["started"] and not v["tournament"]["uses_divisions"]
    assert [st["is_final"] for st in v["stages"]] == [True]
    assert v["round"]["no"] == 1
    assert len(v["round"]["seats"]) == 8
    assert len(v["round"]["spoons"]) == 7
    assert all(p["status"] == "in" for p in v["players"])
    with pytest.raises(CommandError, match="already started"):
        started(4).do("start")


# ---------------------------------------------------------------- rounds


def test_mark_out_starts_a_new_random_round():
    g = started(8)
    first = g.seated()
    v = g.out()
    assert v["round"]["no"] == 2
    assert len(v["round"]["seats"]) == 7
    assert len(v["round"]["spoons"]) == 6
    assert first[0] not in g.seated()
    assert g.last_group_types() == ["PlayerEliminated", "RoundEnded", "RoundStarted"]


def test_cannot_mark_out_twice():
    g = started(6)
    victim = g.seated()[0]
    g.do("mark_out", player_id=victim)
    with pytest.raises(CommandError):
        g.do("mark_out", player_id=victim)


def test_final_out_crowns_champion():
    g = started(3)
    g.out()
    last_two = g.seated()
    v = g.do("mark_out", player_id=last_two[0])
    assert v["tournament"]["completed"]
    assert v["tournament"]["champion_id"] == last_two[1]
    assert v["round"]["ended"] and v["round"]["ended_at"] == g.now
    with pytest.raises(CommandError, match="over"):
        g.do("reroll")
    g.do("rename_player", player_id=last_two[1], name="Champ")  # still allowed


def test_reroll_and_swap():
    g = started(10, seed=3)
    before = g.seated()
    g.do("reroll")
    assert sorted(g.seated()) == sorted(before) and g.seated() != before
    a, b = g.seated()[0], g.seated()[4]
    g.do("swap_seats", seat_a=1, seat_b=5)
    assert g.seated()[0] == b and g.seated()[4] == a
    with pytest.raises(CommandError):
        g.do("swap_seats", seat_a=1, seat_b=1)
    with pytest.raises(CommandError):
        g.do("swap_seats", seat_a=1, seat_b=11)


def test_between_layout_records_and_shows_the_empty_gap():
    g = started(10, table={"shape": "circle", "spoon_layout": "between"})
    r = g.view["round"]
    assert len(r["spoons"]) == 9
    a, b = r["empty_gap"]["seats"]
    assert b == a % 10 + 1
    seen = set()
    for _ in range(10):  # every re-roll draws a new empty gap
        seen.add(g.do("reroll")["round"]["empty_gap"]["seats"][0])
    assert len(seen) > 1


def test_change_table_applies_at_next_seating_or_on_reroll():
    g = started(6, table={"shape": "circle"})
    g.do("change_table", table={"shape": "rectangle", "max_long": 2, "max_end": 1})
    assert g.view["round"]["table"]["shape"] == "circle"  # current round unchanged
    assert g.view["table_config"]["shape"] == "rectangle"
    g.out()
    assert g.view["round"]["table"]["shape"] == "rectangle"
    g.do("change_table", table={"shape": "oval", "spoon_layout": "between"}, reroll=True)
    assert g.view["round"]["table"]["shape"] == "oval"
    assert g.view["round"]["empty_gap"] is not None
    with pytest.raises(CommandError, match="don't fit"):
        g.do("change_table", table={"shape": "rectangle", "max_long": 1, "max_end": 0})
    with pytest.raises(CommandError):
        g.do("change_table", table={"shape": "triangle"})


def test_stoppage_pauses_the_round_timer():
    g = started(4)
    g.do("start_stoppage")
    assert g.view["round"]["paused_since"] is not None
    g.do("end_stoppage")
    r = g.view["round"]
    assert r["paused_since"] is None and r["paused_ms"] == 1000
    g.do("start_stoppage")
    with pytest.raises(CommandError, match="already stopped"):
        g.do("start_stoppage")
    g.do("end_stoppage")
    with pytest.raises(CommandError, match="isn't stopped"):
        g.do("end_stoppage")


def test_out_during_stoppage_closes_it():
    g = started(4)
    g.do("start_stoppage")
    g.out()
    assert g.view["round"]["paused_since"] is None
    assert "StoppageEnded" in [e.type for e in g.events]


# ---------------------------------------------------------------- stalemates


def test_stalemates():
    g = started(8)
    a, b, c, d, e = g.seated()[:5]
    with pytest.raises(CommandError, match="at least 2"):
        g.do("open_stalemate", player_ids=[a])
    with pytest.raises(CommandError, match="at least 2"):
        g.do("open_stalemate", player_ids=[a, a])
    g.do("open_stalemate", player_ids=[a, b])
    g.do("open_stalemate", player_ids=[c, d, e])  # several at once, ≥2 each
    assert len(g.view["open_stalemates"]) == 2
    with pytest.raises(CommandError, match="already in an open stalemate"):
        g.do("open_stalemate", player_ids=[a, g.seated()[5]])
    with pytest.raises(CommandError, match="stalemate first"):
        g.do("mark_out", player_id=g.seated()[6])
    with pytest.raises(CommandError, match="stalemate's players"):
        g.do("resolve_stalemate", stalemate_id="s1", loser_id=c)
    v = g.do("resolve_stalemate", stalemate_id="s1", loser_id=a)
    assert all(p["status"] == "in" for p in v["players"])  # conceding a spoon isn't going out
    assert v["timeline"][-1]["winner_ids"] == [b]
    # Rule 2.2.2 (2026): 3 players, 2 spoons; the one left without a spoon concedes.
    v = g.do("resolve_stalemate", stalemate_id="s2", loser_id=d)
    assert v["timeline"][-1]["winner_ids"] == [c, e] and v["timeline"][-1]["loser_ids"] == [d]
    assert "concedes" in v["timeline"][-1]["label"]
    assert v["open_stalemates"] == []
    g.do("open_stalemate", player_ids=[a, b])
    g.do("cancel_stalemate", stalemate_id="s3")
    assert g.view["open_stalemates"] == []
    assert g.view["round"]["no"] == 1  # stalemates never end the round
    g.out()


# ---------------------------------------------------------------- penalties


def test_second_false_grab_prompts_dq():
    g = started(6)
    kit = g.seated()[0]
    g.do("log_penalty", player_id=kit, kind="false_grab")
    assert g.view["prompts"] == []
    v = g.do("log_penalty", player_id=kit, kind="false_grab", note="grabbed early")
    assert {"type": "dq", "player_id": kit, "kind": "false_grab"} in v["prompts"]
    assert next(p for p in v["players"] if p["id"] == kit)["status"] == "in"  # not automatic
    v = g.do("disqualify", player_id=kit)
    assert next(p for p in v["players"] if p["id"] == kit)["status"] == "dq"
    assert v["prompts"] == []


@pytest.mark.parametrize("kind", ["spoon_tamper", "hand_manipulation"])
def test_immediate_dq_in_one_group_and_round_goes_on(kind):
    g = started(6)
    kit = g.seated()[0]
    v = g.do("log_penalty", player_id=kit, kind=kind)
    assert g.last_group_types() == ["PenaltyLogged", "PlayerEliminated"]
    assert next(p for p in v["players"] if p["id"] == kit)["status"] == "dq"
    assert v["round"]["no"] == 1 and not v["round"]["ended"]
    assert len(v["round"]["spoons"]) == 4  # 5 active players left
    assert len(v["round"]["seats"]) == 6  # the seat stays until the next seating
    g.out()
    assert len(g.view["round"]["seats"]) == 4


def test_other_penalties_only_log():
    g = started(6)
    kit = g.seated()[0]
    for _ in range(3):
        g.do("log_penalty", player_id=kit, kind="card_pass")
    for kind in ("delayed_pass", "premature_grab", "physical_harm"):
        g.do("log_penalty", player_id=kit, kind=kind)
    v = g.view
    kit_v = next(p for p in v["players"] if p["id"] == kit)
    assert kit_v["status"] == "in" and kit_v["penalties"]["card_pass"] == 3
    assert v["timeline"][-4]["label"].endswith("improper card passing (3rd) · card forfeit")
    assert v["timeline"][-5]["label"].endswith("(2nd) · warning")
    with pytest.raises(CommandError, match="kind"):
        g.do("log_penalty", player_id=kit, kind="rudeness")


def test_dq_cancels_the_players_open_stalemate():
    g = started(6)
    a, b = g.seated()[:2]
    g.do("open_stalemate", player_ids=[a, b])
    g.do("disqualify", player_id=a)
    assert g.view["open_stalemates"] == []
    assert g.last_group_types() == ["StalemateCancelled", "PlayerEliminated"]


def test_dq_or_withdrawal_that_leaves_one_player_ends_the_tournament():
    g = started(2)
    a, b = g.seated()
    v = g.do("withdraw", player_id=a)
    assert v["tournament"]["completed"] and v["tournament"]["champion_id"] == b


# ---------------------------------------------------------------- roster


def test_add_and_rename():
    g = Game(3)
    g.do("add_player", name="  Ann   Lee ")
    assert g.view["players"][-1]["name"] == "Ann Lee"
    with pytest.raises(CommandError, match="already"):
        g.do("add_player", name="ann lee")
    g.do("rename_player", player_id="p1", name="Bo")
    with pytest.raises(CommandError, match="already"):
        g.do("rename_player", player_id="p2", name="BO")
    g.do("rename_player", player_id="p1", name="bo")  # own name, different case
    g.do("start")
    assert len(g.view["round"]["seats"]) == 4


def test_add_player_on_single_table_joins_next_round():
    g = started(4)
    g.do("add_player", name="Late")
    late = g.pid("Late")
    assert late not in g.seated()
    assert next(p for p in g.view["players"] if p["id"] == late)["status"] == "in"
    g.out()
    assert late in g.seated()


def test_add_player_respects_table_capacity():
    g = started(4, table={"shape": "rectangle", "max_long": 2, "max_end": 0})
    with pytest.raises(CommandError, match="don't fit"):
        g.do("add_player", name="Late")


def test_withdraw_before_start():
    g = Game(3)
    g.do("withdraw", player_id="p1")
    g.do("start")
    assert len(g.view["round"]["seats"]) == 2


# ---------------------------------------------------------------- divisions


def test_21_players_two_divisions_then_final():
    g = started(21, seed=5)
    v = g.view
    assert v["tournament"]["uses_divisions"]
    st = v["stages"][0]
    assert [len(d["player_ids"]) for d in st["divisions"]] == [11, 10]
    assert [d["status"] for d in st["divisions"]] == ["playing", "waiting"]
    assert v["active_division_id"] == "A" and v["next_division_id"] == "B"
    assert len(v["round"]["seats"]) == 11
    assert (
        next(p for p in v["players"] if p["id"] in st["divisions"][1]["player_ids"])["status"]
        == "waiting"
    )

    v = g.play_to_cutoff()  # 11 → 5
    assert len(g.seated()) == 5 and v["round"]["ended"]
    assert v["stages"][0]["divisions"][0]["status"] == "cutoff"
    assert g.last_group_types() == ["PlayerEliminated", "RoundEnded"]  # waits for the organiser
    with pytest.raises(CommandError, match="no round"):
        g.out()

    v = g.confirm()
    assert v["active_division_id"] == "B" and len(v["round"]["seats"]) == 10
    assert v["stages"][0]["divisions"][0]["status"] == "complete"
    assert sum(p["status"] == "advanced" for p in v["players"]) == 5

    g.play_to_cutoff()
    v = g.confirm()
    assert len(v["stages"]) == 2 and v["stages"][1]["is_final"]
    assert len(v["stages"][1]["divisions"][0]["player_ids"]) == 10
    assert v["active_division_id"] == "final" and len(v["round"]["seats"]) == 10


def test_30_players_runs_three_stages_to_a_champion():
    g = started(30, seed=11)
    v = g.play_out()
    assert [len(st["divisions"]) for st in v["stages"]] == [4, 2, 1]
    assert [d["label"] for st in v["stages"] for d in st["divisions"]] == [
        "A",
        "B",
        "C",
        "D",
        "E",
        "F",
        "Final",
    ]
    assert [
        d["advancing_ids"] and len(d["advancing_ids"]) for d in v["stages"][0]["divisions"]
    ] == [4, 4, 3, 3]
    assert len(v["stages"][2]["divisions"][0]["player_ids"]) == 6
    champ = v["tournament"]["champion_id"]
    assert next(p for p in v["players"] if p["id"] == champ)["finish_place"] == 1


def test_choose_next_division():
    g = started(30, seed=2)
    g.play_to_cutoff()
    with pytest.raises(CommandError, match="isn't waiting"):
        g.confirm(next_division_id="A")
    v = g.confirm(next_division_id="C")
    assert v["active_division_id"] == "C" and v["next_division_id"] == "B"


def test_confirm_requires_cutoff():
    g = started(21)
    with pytest.raises(CommandError, match="cutoff"):
        g.confirm()


def test_dq_can_trigger_the_cutoff_and_fewer_advance():
    g = started(21, seed=4)
    g.out(5)  # A: 11 → 6, target 5
    v = g.do("disqualify", player_id=g.seated()[0])
    assert any(p["type"] == "cutoff" for p in v["prompts"])
    assert v["round"]["ended"]
    v = g.do("disqualify", player_id=g.seated()[0])  # another DQ while waiting: no backfill
    assert len(next(p for p in v["prompts"] if p["type"] == "cutoff")["advancing_ids"]) == 4
    v = g.confirm()
    assert len(v["stages"][0]["divisions"][0]["advancing_ids"]) == 4


def test_dq_of_a_waiting_player_has_no_round():
    g = started(21, seed=4)
    waiting = next(p for p in g.view["players"] if p["status"] == "waiting")
    v = g.do("disqualify", player_id=waiting["id"])
    dq = next(p for p in v["players"] if p["id"] == waiting["id"])
    assert dq["status"] == "dq" and dq["out_round"] is None
    seated = g.seated()[0]
    v = g.do("disqualify", player_id=seated)
    assert next(p for p in v["players"] if p["id"] == seated)["out_round"] == 1


def test_add_player_while_divisions_run():
    g = started(21, seed=1)
    g.do("add_player", name="Late1")  # B hasn't started → joins B
    assert g.view["stages"][0]["divisions"][1]["player_ids"][-1] == g.pid("Late1")
    g.play_to_cutoff()
    g.confirm()  # B starts; no waiting division left
    g.do("add_player", name="Late2")
    late2 = next(p for p in g.view["players"] if p["name"] == "Late2")
    assert late2["division_id"] is None and late2["status"] == "waiting"
    assert len(g.seated()) == 11  # B had 10 + Late1
    g.play_to_cutoff()
    v = g.confirm()  # pool = 5 + 5 advancers + Late2
    final = v["stages"][1]["divisions"][0]
    assert v["stages"][1]["is_final"] and late2["id"] in final["player_ids"]
    assert len(final["player_ids"]) == 11


def test_dq_reaching_cutoff_during_stoppage_closes_it():
    g = started(21, seed=4)
    g.out(5)
    g.do("start_stoppage")
    v = g.do("disqualify", player_id=g.seated()[0])
    assert v["round"]["ended"] and v["round"]["paused_since"] is None
    assert v["round"]["paused_ms"] == 1000


def test_dq_that_ends_the_round_cancels_every_open_stalemate():
    g = started(21, seed=4)
    g.out(5)  # A: 6 left, target 5
    a, b, c = g.seated()[:3]
    g.do("open_stalemate", player_ids=[a, b])
    v = g.do("disqualify", player_id=c)
    assert v["round"]["ended"] and v["open_stalemates"] == []
    g.confirm()
    g.out()  # division B isn't blocked by A's stalemate


def test_late_add_skips_full_divisions():
    g = started(48, table={"shape": "circle"})  # 4 × 12
    g.play_to_cutoff()
    g.confirm()  # B playing, C and D waiting and full
    v = g.do("add_player", name="Late")
    late = next(p for p in v["players"] if p["name"] == "Late")
    assert late["division_id"] is None  # → next stage's draw, never a 13th seat
    assert all(len(d["player_ids"]) == 12 for d in v["stages"][0]["divisions"])


def test_late_add_fills_the_first_waiting_division_with_room():
    g = started(30, table={"shape": "circle"})  # A 8, B 8, C 7, D 7
    v = g.do("add_player", name="Late")
    assert v["stages"][0]["divisions"][1]["player_ids"][-1] == g.pid("Late")


def test_2026_defaults_and_rules_snapshot():
    # New tournaments get the 2026 rulebook and keep a full copy of it in their first event.
    events = create_tournament(
        "T", None, [f"P{i}" for i in range(17)], {"shape": "circle"}, None, 0
    )
    rules = events[0].payload["rules_overrides"]
    assert (rules["division_threshold"], rules["max_per_table"], rules["spoon_layout"]) == (
        16,
        16,
        "between",
    )
    assert events[-1].payload["spoon_layout"] == "between"
    g = Game(17, rules=None)
    g.events = sequence(events, [])
    g.cursor = len(g.events)
    v = g.do("start")
    assert [len(d["player_ids"]) for d in v["stages"][0]["divisions"]] == [9, 8]


def test_dealers_rule_1_3_3():
    from wsf_tournament.engine.view import dealer_seats

    assert dealer_seats(9, 8) == [1, 5]  # the rule's own example
    assert dealer_seats(8, 8) == [1, 5]
    assert dealer_seats(16, 8) == [1, 9]
    assert dealer_seats(7, 8) == [1]
    v = Game(9).do("start")
    assert v["round"]["dealers"] == [1, 5]
