from harness import Game
from wsf_tournament.engine.report import report


def test_report_tracks_rounds_marks_and_stats():
    g = Game(4, seed=2)
    g.do("start")
    a, b, c, d = g.seated()
    g.do("log_penalty", player_id=a, kind="false_grab")
    g.do("open_stalemate", player_ids=[b, c])
    g.do("resolve_stalemate", stalemate_id="s1", loser_id=c)
    g.do("start_stoppage")
    g.do("end_stoppage")
    g.do("mark_out", player_id=d)  # round 1 ends
    g.do("mark_out", player_id=g.seated()[0])  # round 2 ends
    g.play_out()
    r = report(g.events[: g.cursor])

    assert r["completed"] and r["champion_id"]
    assert [x["no"] for x in r["rounds"]] == [1, 2, 3]
    assert r["rounds"][0]["out"] == [d] and r["rounds"][0]["stalemates"] == 1
    assert r["rounds"][0]["penalties"] == 1 and r["rounds"][0]["players"] == 4
    assert all(x["ended_at"] for x in r["rounds"])
    first = r["rounds"][0]  # the stoppage (1 s on the harness clock) isn't playing time
    assert first["ms"] == first["ended_at"] - first["started_at"] - 1000

    by = {p["id"]: p for p in r["players"]}
    assert [p["place"] for p in r["players"]] == [1, 2, 3, 4]  # sorted by finish
    assert by[r["champion_id"]]["status"] == "champion"
    assert by[r["champion_id"]]["rounds"] == [1, 2, 3]
    assert by[d]["rounds"] == [1] and by[d]["marks"] == [{"round": 1, "type": "out"}]
    assert {"round": 1, "type": "penalty"} in by[a]["marks"]
    assert {"round": 1, "type": "won"} in by[b]["marks"] and by[b]["stalemates_won"] == 1
    assert {"round": 1, "type": "lost"} in by[c]["marks"] and by[c]["stalemates_lost"] == 1

    st = r["stats"]
    assert (st["players"], st["rounds"], st["stalemates"], st["penalties"], st["stoppages"]) == (
        4,
        3,
        1,
        1,
        1,
    )
    assert st["total_ms"] > 0 and st["longest_round"]["ms"] >= st["shortest_round"]["ms"]
    assert st["most_stalemates_won"] == {"player_id": b, "count": 1}


def test_report_with_divisions_only_counts_rounds_a_player_sat():
    g = Game(21, seed=3)
    g.do("start")
    v = g.play_out()
    r = report(g.events[: g.cursor])
    assert r["stats"]["divisions"] == 2
    b_player = v["stages"][0]["divisions"][1]["player_ids"][0]
    played = next(p for p in r["players"] if p["id"] == b_player)["rounds"]
    first_b = next(x["no"] for x in r["rounds"] if x["division_id"] == "B")
    assert played and min(played) >= first_b  # never sat a division A round
    assert sum(len(x["out"]) for x in r["rounds"]) == 20


def test_report_api(tmp_path):
    from fastapi.testclient import TestClient

    from wsf_tournament.app import create_app

    c = TestClient(create_app(data_dir=tmp_path / "d", dist=tmp_path / "x"))
    tid = c.post(
        "/api/tournaments",
        json={"name": "T", "players": ["A", "B", "C"], "table": {"shape": "circle"}},
    ).json()["id"]
    c.post(f"/api/tournaments/{tid}/start")
    r = c.get(f"/api/tournaments/{tid}/report").json()
    assert r["rounds"][0]["players"] == 3 and not r["completed"]
    assert c.get("/api/tournaments/nope/report").status_code == 404
