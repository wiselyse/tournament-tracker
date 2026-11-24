from harness import Game


def finish(v):
    return {p["name"]: (p["finish_place"], p["finish_tied"]) for p in v["players"]}


def test_single_table_reverse_elimination_order():
    g = Game(5)
    g.do("start")
    order = []
    while not g.view["tournament"]["completed"]:
        order.append(g.seated()[0])
        g.out()
    v = g.view
    places = {p["id"]: p["finish_place"] for p in v["players"]}
    assert [places[pid] for pid in order] == [5, 4, 3, 2]
    assert places[v["tournament"]["champion_id"]] == 1
    assert not any(p["finish_tied"] for p in v["players"])


def test_places_while_running_count_the_players_still_alive():
    g = Game(6)
    g.do("start")
    first = g.seated()[0]
    v = g.out()
    places = {p["id"]: p["finish_place"] for p in v["players"]}
    assert places[first] == 6
    assert sum(p is None for p in places.values()) == 5


def test_ties_across_divisions():
    # 30 players: A(8) B(8) C(7) D(7). First outs of A and B both had 8 left → T-29.
    # Next: A, B second outs (7 left) + C, D first outs (7 left) → T-25.
    g = Game(30, seed=6)
    g.do("start")
    while len(g.view["stages"]) == 1:
        if any(p["type"] == "cutoff" for p in g.view["prompts"]):
            g.confirm()
        else:
            g.out()
    places = sorted(
        (p["finish_place"], p["finish_tied"]) for p in g.view["players"] if p["status"] == "out"
    )
    assert places[-2:] == [(29, True), (29, True)]
    assert places[-6:-2] == [(25, True)] * 4
    assert len(places) == 16  # 30 − 14 advanced


def test_dq_ranks_like_an_out_and_withdrawals_are_unranked():
    g = Game(5)
    g.do("start")
    a, b = g.seated()[:2]
    g.do("withdraw", player_id=a)  # unranked, and the rest close up
    g.do("disqualify", player_id=b)  # 4 left when DQ'd → 4th
    v = g.play_out()
    places = {p["id"]: p for p in v["players"]}
    assert places[a]["finish_place"] is None and places[a]["status"] == "withdrawn"
    assert places[b]["finish_place"] == 4 and places[b]["out_round"] == 1
    assert sorted(p["finish_place"] for p in v["players"] if p["finish_place"]) == [1, 2, 3, 4]
