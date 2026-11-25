import math

import pytest

from wsf_tournament.engine.seating import Perimeter, TableConfig, seat_layout, side_counts

RECT_4_2 = TableConfig("rectangle", max_long=4, max_end=2)


# Sides are [top, right, bottom, left]; HANDOFF lists the examples as top, bottom, ends.
@pytest.mark.parametrize(
    "n, expected",
    [
        (9, [4, 1, 3, 1]),  # never one end seat with the other end empty
        (10, [4, 1, 4, 1]),
        (11, [4, 2, 4, 1]),
        (12, [4, 2, 4, 2]),
        (7, [4, 0, 3, 0]),
        (8, [4, 0, 4, 0]),
        (2, [1, 0, 1, 0]),
    ],
)
def test_rectangle_fills_long_sides_first(n, expected):
    assert side_counts(RECT_4_2, n) == expected


def test_rectangle_rejects_over_capacity():
    assert RECT_4_2.capacity == 12
    with pytest.raises(ValueError):
        side_counts(RECT_4_2, 13)


def test_square_fills_opposite_sides_first():
    sq = TableConfig("square", max_side=3)
    assert side_counts(sq, 5) == [2, 1, 1, 1]
    assert side_counts(sq, 6) == [2, 1, 2, 1]  # top and bottom, not top and right
    assert side_counts(sq, 7) == [2, 2, 2, 1]
    assert side_counts(sq, 10) == [3, 2, 3, 2]
    assert side_counts(sq, 12) == [3, 3, 3, 3]
    for n in range(1, 13):
        counts = side_counts(sq, n)
        assert sum(counts) == n and max(counts) - min(counts) <= 1
    with pytest.raises(ValueError):
        side_counts(sq, 13)


def test_circle_and_oval_have_no_limit():
    assert TableConfig("circle").capacity is None
    assert TableConfig("oval").capacity is None


def test_rectangle_numbering_is_clockwise_from_top_left():
    seats = seat_layout(RECT_4_2, 10)
    w, h = RECT_4_2.size
    top, right, bottom, left = seats[0:4], seats[4:5], seats[5:9], seats[9:10]
    assert all(s["y"] == 0 for s in top)
    assert [s["x"] for s in top] == sorted(s["x"] for s in top)  # left → right
    assert all(s["x"] == w for s in right)
    assert all(s["y"] == h for s in bottom)
    assert [s["x"] for s in bottom] == sorted((s["x"] for s in bottom), reverse=True)
    assert all(s["x"] == 0 for s in left)
    assert seats[0]["seat_no"] == 1 and seats[-1]["seat_no"] == 10
    assert (top[0]["nx"], top[0]["ny"]) == (0, -1)  # outward normal points up


def test_square_numbering_with_several_per_side():
    seats = seat_layout(TableConfig("square", max_side=3), 12)
    w, h = TableConfig("square").size
    assert [s["y"] for s in seats[:3]] == [0, 0, 0]
    assert [s["x"] for s in seats[3:6]] == [w, w, w]
    assert [s["y"] for s in seats[3:6]] == sorted(s["y"] for s in seats[3:6])  # top → bottom
    assert [s["x"] for s in seats[9:]] == [0, 0, 0]
    assert [s["y"] for s in seats[9:]] == sorted((s["y"] for s in seats[9:]), reverse=True)


@pytest.mark.parametrize("shape", ["circle", "oval"])
def test_round_tables_start_at_12_oclock_and_go_clockwise(shape):
    cfg = TableConfig(shape)
    w, h = cfg.size
    seats = seat_layout(cfg, 8)
    assert seats[0]["x"] == pytest.approx(w / 2)
    assert seats[0]["y"] == pytest.approx(0)
    assert seats[1]["x"] > w / 2  # clockwise on screen = to the right first
    assert seats[2]["x"] == pytest.approx(w, abs=1e-6)  # 3 o'clock
    for s in seats:  # every seat on the ellipse
        assert ((s["x"] - w / 2) / (w / 2)) ** 2 + (
            (s["y"] - h / 2) / (h / 2)
        ) ** 2 == pytest.approx(1)


def test_oval_seats_equal_arc_length_apart():
    cfg = TableConfig("oval")
    per = Perimeter(cfg)
    pts = [per.point(s) for s in per.seat_arcs(10)]
    # chord lengths between neighbours vary on an oval, but the arcs are equal
    arcs = per.seat_arcs(10)
    gaps = [(arcs[(i + 1) % 10] - arcs[i]) % per.length for i in range(10)]
    assert max(gaps) - min(gaps) < 1e-9
    w, h = cfg.size
    assert per.length == pytest.approx(
        math.pi * (3 * (w / 2 + h / 2) - math.sqrt((3 * w / 2 + h / 2) * (w / 2 + 3 * h / 2))),
        rel=1e-4,
    )  # Ramanujan's approximation
    assert len({(round(p.x, 6), round(p.y, 6)) for p in pts}) == 10


def test_table_config_validation():
    with pytest.raises(ValueError):
        TableConfig("hexagon")
    with pytest.raises(ValueError):
        TableConfig("rectangle", spoon_layout="pile")
    with pytest.raises(ValueError):
        TableConfig.from_dict({"shape": "circle", "legs": 4})
    with pytest.raises(ValueError):
        TableConfig("rectangle", max_long=0)
