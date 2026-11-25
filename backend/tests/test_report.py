import pytest

from harness import Game
from wsf_tournament.engine.events import CommandError
from wsf_tournament.engine.report import report


def test_report_tracks_rounds_marks_and_stats():
    g = Game(4, seed=2)
    g.do("start")
    a, b, c, d = g.seated()
    g.do("log_penalty", player_id=a, kind="false_grab")
    g.do("open_stalemate", player_ids=[b, c])
    g.do("resolve_stalemate", stalemate_id="s1", loser_id=c)  # c out: round 1 ends
    g.do("start_play")
    g.do("start_stoppage")
    g.do("end_stoppage")
    g.do("mark_out", player_id=d)  # round 2 ends
    g.play_out()
    r = report(g.events[: g.cursor])

    assert r["completed"] and r["champion_id"]
    assert [x["no"] for x in r["rounds"]] == [1, 2, 3]
    assert r["rounds"][0]["out"] == [c] and r["rounds"][0]["stalemates"] == 1
    assert r["rounds"][0]["outs"] == [{"player_id": c, "reason": "stalemate"}]
    assert r["rounds"][0]["penalties"] == 1 and r["rounds"][0]["players"] == 4
    assert all(x["ended_at"] for x in r["rounds"])
    # Playing time runs from "Start round", and the stoppage (1 s on the harness clock) isn't in it.
    second = r["rounds"][1]
    assert second["play_started_at"] == second["started_at"] + 1000
    assert second["ms"] == second["ended_at"] - second["play_started_at"] - 1000

    by = {p["id"]: p for p in r["players"]}
    assert [p["place"] for p in r["players"]] == [1, 2, 3, 4]  # sorted by finish
    assert by[r["champion_id"]]["status"] == "champion"
    assert by[r["champion_id"]]["rounds"] == [1, 2, 3]
    assert by[d]["rounds"] == [1, 2] and by[d]["marks"] == [{"round": 2, "type": "out"}]
    assert {"round": 1, "type": "penalty"} in by[a]["marks"]
    assert {"round": 1, "type": "won"} in by[b]["marks"] and by[b]["stalemates_won"] == 1
    assert by[c]["rounds"] == [1] and by[c]["stalemates_lost"] == 1
    assert by[c]["marks"] == [{"round": 1, "type": "lost"}, {"round": 1, "type": "out"}]

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


def test_round_winner_is_recorded_and_counted():
    g = Game(5, seed=4)
    g.do("start")
    a, b, c, *_ = g.seated()
    g.do("log_penalty", player_id=c, kind="delayed_pass")
    g.do("open_stalemate", player_ids=[a, c])
    g.do("resolve_stalemate", stalemate_id="s1", loser_id=c, winner_id=b)  # c out, b won
    out = [e for e in g.view["timeline"] if e["type"] == "PlayerEliminated"][-1]
    assert " wins the round · " in out["label"] and out["label"].endswith("out (Stalemate)")
    x, y, *_ = g.seated()
    g.do("mark_out", player_id=x, winner_id=y)
    g.do("mark_out", player_id=g.seated()[0])  # winner not recorded
    r = report(g.events[: g.cursor])

    first, second, third = r["rounds"][:3]
    assert first["winner_id"] == b and second["winner_id"] == y and third["winner_id"] is None
    assert first["stalemate_results"] == [{"player_ids": [a, c], "loser_ids": [c]}]
    assert first["penalty_list"] == [{"player_id": c, "kind": "delayed_pass"}]
    # Each round's seating, drawn like the Live table, for the round story.
    seats = first["seating"]["seats"]
    assert len(seats) == 5 and {s["player_id"] for s in seats} == {p["id"] for p in r["players"]}
    assert first["seating"]["dealers"] == [1]
    wins = {p["id"]: p["round_wins"] for p in r["players"]}
    assert wins[b] == 1 + (y == b) and sum(wins.values()) == 2
    assert r["stats"]["most_round_wins"]["count"] >= 1


def test_round_winner_must_be_someone_else_at_the_table():
    g = Game(4, seed=1)
    g.do("start")
    a, *_ = g.seated()
    with pytest.raises(CommandError, match="winner"):
        g.do("mark_out", player_id=a, winner_id=a)
