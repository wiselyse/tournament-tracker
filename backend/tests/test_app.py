import pytest
from fastapi.testclient import TestClient

from wsf_tournament.app import create_app

SETUP = {
    "name": "WSF Winter Open",
    "date": "2026-11-26",
    "players": ["Kit", "Bo", "Ann", "Dee", "Eli", "Fay"],
    "table": {"shape": "rectangle", "max_long": 4, "max_end": 2},
}


@pytest.fixture
def client(tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<title>app</title>")
    (dist / "assets" / "app.js").write_text("console.log(1)")
    return TestClient(create_app(data_dir=tmp_path / "data", dist=dist))


@pytest.fixture
def tid(client):
    return client.post("/api/tournaments", json=SETUP).json()["id"]


def cmd(client, tid, **body):
    return client.post(f"/api/tournaments/{tid}/commands", json=body)


def stable(v):
    """A view minus the server clock."""
    return {k: x for k, x in v.items() if k != "server_now"}


def seated(v):
    return [s["player_id"] for s in v["round"]["seats"] if s["active"]]


def test_health(client):
    assert client.get("/api/health").json() == {"ok": True}


def test_frontend_serving(client):
    assert client.get("/").text == "<title>app</title>"
    assert client.get("/t/abc/live").text == "<title>app</title>"  # client-side route
    assert client.get("/assets/app.js").text == "console.log(1)"
    assert client.get("/api/nope").status_code == 404
    assert client.get("/../../etc/passwd").text == "<title>app</title>"


def test_create_and_get(client):
    r = client.post("/api/tournaments", json=SETUP)
    assert r.status_code == 201
    v = r.json()
    assert v["tournament"]["name"] == "WSF Winter Open"
    assert [p["name"] for p in v["players"]] == SETUP["players"]
    assert v["cursor"] == v["head"] == 8 and not v["can_undo"]
    assert stable(client.get(f"/api/tournaments/{v['id']}").json()) == stable(v)
    assert client.get("/api/tournaments/nope").status_code == 404


def test_create_rejects_bad_setup(client):
    bad = {**SETUP, "players": SETUP["players"] * 3}
    r = client.post("/api/tournaments", json=bad)
    assert r.status_code == 422 and "already a player" in r.json()["detail"]
    r = client.post("/api/tournaments", json={**SETUP, "table": {"shape": "hexagon"}})
    assert r.status_code == 422


def test_play_through_commands(client, tid):
    v = client.post(f"/api/tournaments/{tid}/start").json()
    assert v["round"]["no"] == 1 and len(v["round"]["spoons"]) == 5
    v = cmd(client, tid, type="mark_out", player_id=seated(v)[0]).json()
    assert v["round"]["no"] == 2
    assert v["round_names"]["2"]["short"] == "R2"  # int keys survive JSON as strings
    rep = client.get(f"/api/tournaments/{tid}/report").json()
    assert rep["round_names"]["1"]["name"] == "Round 1"
    r = cmd(client, tid, type="mark_out", player_id="nobody")
    assert r.status_code == 422 and "unknown player" in r.json()["detail"]
    r = cmd(client, tid, type="explode")
    assert r.status_code == 422
    while not v["tournament"]["completed"]:
        v = cmd(client, tid, type="mark_out", player_id=seated(v)[0]).json()
    assert v["tournament"]["champion_id"]
    listed = client.get("/api/tournaments").json()
    assert listed[0]["status"] == "complete" and listed[0]["champion"]


def test_state_survives_a_restart(client, tid, tmp_path):
    client.post(f"/api/tournaments/{tid}/start")
    before = client.get(f"/api/tournaments/{tid}").json()
    again = TestClient(create_app(data_dir=tmp_path / "data", dist=tmp_path / "dist"))
    assert stable(again.get(f"/api/tournaments/{tid}").json()) == stable(before)


def test_undo_redo_rewind_and_409(client, tid):
    v = client.post(f"/api/tournaments/{tid}/start").json()
    v = cmd(client, tid, type="mark_out", player_id=seated(v)[0]).json()
    v = client.post(f"/api/tournaments/{tid}/undo").json()
    assert v["round"]["no"] == 1 and v["can_redo"]
    v = client.post(f"/api/tournaments/{tid}/redo").json()
    assert v["round"]["no"] == 2

    v = client.post(f"/api/tournaments/{tid}/rewind", json={"seq": 9}).json()
    assert v["round"]["no"] == 1 and v["head"] > v["cursor"]
    r = cmd(client, tid, type="reroll")
    assert r.status_code == 409
    assert r.json()["detail"] == {"error": "history_diverges", "discarded": 3, "actions": 1}
    v = cmd(client, tid, type="reroll", discard_future=True).json()
    assert v["head"] == v["cursor"] and not v["can_redo"]

    assert client.post(f"/api/tournaments/{tid}/redo").status_code == 422
    assert client.post(f"/api/tournaments/{tid}/rewind", json={"seq": 999}).status_code == 422


def test_patch_archive_duplicate_delete(client, tid):
    v = client.patch(f"/api/tournaments/{tid}", json={"name": " New ", "archived": True}).json()
    assert v["tournament"]["name"] == "New" and v["archived"]
    assert client.patch(f"/api/tournaments/{tid}", json={"name": " "}).status_code == 422

    cmd(client, tid, type="withdraw", player_id="p6")
    cmd(client, tid, type="add_player", name="Gus")
    dup = client.post(f"/api/tournaments/{tid}/duplicate", json={"date": "2027-11-25"}).json()
    assert dup["id"] != tid and dup["tournament"]["name"] == "New (copy)"
    assert [p["name"] for p in dup["players"]] == ["Kit", "Bo", "Ann", "Dee", "Eli", "Gus"]
    assert dup["table_config"]["max_long"] == 4 and not dup["tournament"]["started"]

    assert client.delete(f"/api/tournaments/{tid}").status_code == 204
    assert client.get(f"/api/tournaments/{tid}").status_code == 404
    assert client.delete(f"/api/tournaments/{tid}").status_code == 404
    assert [t["id"] for t in client.get("/api/tournaments").json()] == [dup["id"]]


def test_export_import_round_trip(client, tid):
    v = client.post(f"/api/tournaments/{tid}/start").json()
    cmd(client, tid, type="mark_out", player_id=seated(v)[0])
    client.post(f"/api/tournaments/{tid}/undo")  # cursor behind head survives the trip
    r = client.get(f"/api/tournaments/{tid}/export.json")
    assert "attachment" in r.headers["content-disposition"]
    exported = r.json()
    new = client.post("/api/tournaments/import", json=exported).json()
    old = client.get(f"/api/tournaments/{tid}").json()
    for k in ("players", "round", "timeline", "cursor", "head", "stages"):
        assert new[k] == old[k]


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d.update(format="other"),
        lambda d: d["events"].pop(3),
        lambda d: d["events"][2].update(type="Nope"),
        lambda d: d["tournament"].update(cursor=999),
        lambda d: d["events"][8]["payload"]["divisions"][0]["player_ids"].append("ghost"),
        lambda d: d["events"][10]["payload"].update(seat_assignment=["ghost", "p1"]),
    ],
)
def test_import_rejects_bad_files(client, tid, mutate):
    client.post(f"/api/tournaments/{tid}/start")
    data = client.get(f"/api/tournaments/{tid}/export.json").json()
    assert [e["type"] for e in data["events"][8:11]] == [
        "StageCreated",
        "DivisionStarted",
        "RoundStarted",
    ]
    mutate(data)
    assert client.post("/api/tournaments/import", json=data).status_code == 422


def test_preview(client):
    r = client.post(
        "/api/preview",
        json={
            "players": 30,
            "rules_overrides": {"division_threshold": 20, "max_per_table": 12},  # v2.1
            "table": {"shape": "rectangle", "max_long": 4, "max_end": 2, "spoon_layout": "between"},
        },
    )
    v = r.json()
    assert v["fits"] and v["uses_divisions"] and v["largest_group"] == 8
    assert v["stage_plan"][0] == {"sizes": [8, 8, 7, 7]}
    assert len(v["seats"]) == 8 and len(v["spoons"]) == 7
    assert v["empty_gap"]["seats"] == [8, 1]
    v = client.post("/api/preview", json={"players": 14, "table": {"shape": "square"}}).json()
    assert not v["fits"] and v["capacity"] == 12 and len(v["seats"]) == 12
    assert (
        client.post("/api/preview", json={"players": 5, "table": {"shape": "x"}}).status_code == 422
    )
    assert (
        client.post("/api/preview", json={"players": 1, "table": {"shape": "circle"}}).json()[
            "stage_plan"
        ]
        == []
    )


def test_invalid_command_with_discard_future_keeps_history(client, tid):
    v = client.post(f"/api/tournaments/{tid}/start").json()
    cmd(client, tid, type="mark_out", player_id=seated(v)[0])
    head = client.post(f"/api/tournaments/{tid}/undo").json()["head"]
    r = cmd(client, tid, type="mark_out", player_id="nobody", discard_future=True)
    assert r.status_code == 422
    v = client.get(f"/api/tournaments/{tid}").json()
    assert v["head"] == head and v["can_redo"]


def test_list_survives_a_broken_log(client, tid, tmp_path):
    import sqlite3

    with sqlite3.connect(tmp_path / "data" / "tournaments.db") as conn:
        conn.execute("UPDATE events SET payload='{}' WHERE seq=2")
    listed = client.get("/api/tournaments").json()
    assert listed[0]["status"] == "error"


def test_export_filename_is_ascii(client, tid):
    client.patch(f"/api/tournaments/{tid}", json={"name": "Spöön Cup 🥄"})
    r = client.get(f"/api/tournaments/{tid}/export.json")
    assert r.status_code == 200 and 'filename="Sp--n-Cup.json"' in r.headers["content-disposition"]


def test_settings_are_defaults_for_new_tournaments(client):
    s = client.get("/api/settings").json()
    assert s["rules"]["max_per_table"] == 16 and s["default_table"] == {"shape": "rectangle"}
    bad = client.put("/api/settings", json={"rules_overrides": {"max_per_table": 0}})
    assert bad.status_code == 422
    s = client.put(
        "/api/settings",
        json={
            "rules_overrides": {"spoon_layout": "between", "false_grab_dq_at": 3},
            "default_table": {"shape": "oval"},
        },
    ).json()
    assert s["rules"]["false_grab_dq_at"] == 3 and s["rule_defaults"]["false_grab_dq_at"] == 2

    p = client.post("/api/preview", json={"players": 21, "table": {"shape": "circle"}}).json()
    assert p["uses_divisions"]  # defaults: 21 > 20
    # The preview follows Settings, like create does.
    client.put(
        "/api/settings",
        json={
            "rules_overrides": {
                "division_threshold": 30,
                "spoon_layout": "between",
                "false_grab_dq_at": 3,
            },
            "default_table": {"shape": "oval"},
        },
    )
    p = client.post("/api/preview", json={"players": 21, "table": {"shape": "circle"}}).json()
    assert not p["uses_divisions"] and p["table"]["spoon_layout"] == "between"
    client.put(
        "/api/settings",
        json={
            "rules_overrides": {"spoon_layout": "between", "false_grab_dq_at": 3},
            "default_table": {"shape": "oval"},
        },
    )
    v = client.post("/api/tournaments", json={"name": "T", "players": ["A", "B"]}).json()
    assert v["table_config"]["shape"] == "oval" and v["table_config"]["spoon_layout"] == "between"
    assert v["rules"]["false_grab_dq_at"] == 3

    # A tournament keeps the rules it was created with.
    client.put("/api/settings", json={"rules_overrides": {}, "default_table": {"shape": "circle"}})
    assert client.get(f"/api/tournaments/{v['id']}").json()["rules"]["false_grab_dq_at"] == 3
    explicit = client.post("/api/tournaments", json={**SETUP, "rules_overrides": {}}).json()
    assert explicit["rules"]["false_grab_dq_at"] == 2
