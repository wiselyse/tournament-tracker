import math

import pytest

from wsf_tournament.engine.seating import Perimeter, TableConfig
from wsf_tournament.engine.spoons import active_empty_gap, between_layout, center_layout

CIRCLE = TableConfig("circle", spoon_layout="between")
RECT = TableConfig("rectangle", max_long=4, max_end=2, spoon_layout="between")


@pytest.mark.parametrize("n", [2, 3, 7, 10, 12])
def test_center_row(n):
    cfg = TableConfig("rectangle", max_long=6, max_end=2)
    spoons = center_layout(cfg, n)
    assert len(spoons) == n - 1
    w, h = cfg.size
    assert all(s["y"] == h / 2 for s in spoons)
    xs = [s["x"] for s in spoons]
    steps = [b - a for a, b in zip(xs, xs[1:], strict=False)] + [w - xs[-1], xs[0]]
    assert max(steps) - min(steps) < 1e-9  # even spacing, equal margins
    assert [s["rot"] for s in spoons] == [(-90 if i % 2 == 0 else 90) for i in range(n - 1)]


def _between(cfg, n, e):
    per = Perimeter(cfg)
    return between_layout(cfg, per.seat_arcs(n), e, 1 / 3), per


def _close(a, b):
    return math.isclose(a["x"], b["x"], abs_tol=1e-9) and math.isclose(a["y"], b["y"], abs_tol=1e-9)


@pytest.mark.parametrize("n", [3, 4, 8, 10])
@pytest.mark.parametrize("e", [0, 2])
def test_between_places_n_minus_1_and_skips_empty_gap(n, e):
    (spoons, marker), _ = _between(RECT, n, e)
    assert len(spoons) == n - 1
    assert not any(_close(s, marker) for s in spoons)


def test_between_neighbours_move_a_third_of_a_seat_so_spacing_is_even():
    # Rule 1.2.2 (2026): on a straight side, the spoons either side of the empty gap move
    # ⅓ of a seat toward it, so the spoons across that stretch are evenly spaced.
    cfg = TableConfig("rectangle", max_long=8, max_end=0, spoon_layout="between")
    (spoons, marker), _ = _between(cfg, 16, 3)  # empty gap between top seats 4 and 5
    assert marker["x"] == pytest.approx(0.5)
    top = sorted(s["x"] for s in spoons if s["y"] < cfg.size[1] / 2)
    near = [x for x in top if abs(x - marker["x"]) < 0.15]
    # un-nudged they'd sit at the gap midpoints 0.375 and 0.625; each moves ⅓ of a seat (1/8)
    assert near == pytest.approx([0.375 + 1 / 24, 0.625 - 1 / 24])
    assert near[1] - near[0] == pytest.approx(1 / 8 * 4 / 3)


def test_corner_gap_spoon_is_on_the_track_and_angled():
    per = Perimeter(RECT)  # 4 long / 2 end: 12 seats, a gap at every corner
    arcs = per.seat_arcs(12)
    (spoons, _), _ = _between(RECT, 12, 6)
    w, h = RECT.size
    d = min(w, h) / 3
    seats = [per.point(a) for a in arcs]
    for i in (3, 11):  # top-right and top-left corner gaps (not beside the empty gap 6)
        a, b = seats[i], seats[(i + 1) % 12]
        mx, my = (a.x + b.x) / 2, (a.y + b.y) / 2
        sp = min(spoons, key=lambda s: math.dist((s["x"], s["y"]), (mx, my)))
        on_x = math.isclose(sp["x"], d) or math.isclose(sp["x"], w - d)
        on_y = math.isclose(sp["y"], d) or math.isclose(sp["y"], h - d)
        assert on_x or on_y  # on the track, `inset` in from the edges
        assert d - 1e-9 <= sp["x"] <= w - d + 1e-9 and d - 1e-9 <= sp["y"] <= h - d + 1e-9
        assert sp["rot"] % 90 != 0  # angled into the table


@pytest.mark.parametrize("cfg", [RECT, CIRCLE, TableConfig("oval", spoon_layout="between")])
def test_between_spoon_heads_point_into_the_table(cfg):
    # The bowl points into the table, the handle toward the players.
    for n in (5, 9, 12):
        (spoons, _), _ = _between(cfg, n, 4)
        w, h = cfg.size
        for s in spoons:
            hx, hy = math.cos(math.radians(s["rot"])), math.sin(math.radians(s["rot"]))
            assert hx * (s["x"] - w / 2) + hy * (s["y"] - h / 2) < 0


def test_between_small_tables():
    (spoons, marker), _ = _between(CIRCLE, 2, 0)
    assert len(spoons) == 1 and marker is not None
    (spoons, _), _ = _between(CIRCLE, 3, 1)
    assert len(spoons) == 2
    assert _between(CIRCLE, 1, 0)[0] == ([], None)


def test_active_empty_gap_mapping():
    assert active_empty_gap(6, 3, [0, 1, 3, 4, 5]) == 2  # empty seat still active
    assert active_empty_gap(6, 2, [0, 1, 3, 4, 5]) == 1  # seat 2 left: merge into gap after 1
    assert active_empty_gap(6, 0, [1, 2]) == 1  # wraps to the last active seat


@pytest.mark.parametrize(
    "cfg, ns",
    [
        (RECT, [6, 9, 10, 12]),
        (TableConfig("square", max_side=3, spoon_layout="between"), [5, 6, 8, 10, 12]),
        (TableConfig("rectangle", max_long=6, max_end=0, spoon_layout="between"), [7, 12]),
        (TableConfig("rectangle", max_long=6, max_end=2, spoon_layout="between"), [13, 14, 16]),
        (TableConfig("rectangle", max_long=5, max_end=2, spoon_layout="between"), [11, 12, 14]),
        (TableConfig("rectangle", max_long=8, max_end=0, spoon_layout="between"), [15, 16]),
        (TableConfig("oval", spoon_layout="between"), [12, 16]),
        (CIRCLE, [12, 16]),
    ],
)
def test_between_spoons_stay_inset_and_apart_at_corners(cfg, ns):
    w, h = cfg.size
    depth = min(w, h) / 3 if cfg.shape != "square" else 0.2
    margin = depth / 2  # at least half the inset from every edge
    for n in ns:
        for e in range(n):
            (spoons, marker), _ = _between(cfg, n, e)
            for s in [*spoons, marker]:
                assert margin - 1e-9 <= s["x"] <= w - margin + 1e-9, (n, e, s)
                assert margin - 1e-9 <= s["y"] <= h - margin + 1e-9, (n, e, s)
            pts = [(s["x"], s["y"]) for s in spoons]
            closest = min(math.dist(a, b) for i, a in enumerate(pts) for b in pts[i + 1 :])
            assert closest > 0.05, (n, e)  # no two spoons on top of each other


@pytest.mark.parametrize("n, e", [(12, 7), (14, 0), (16, 5)])
def test_same_side_gap_spoon_is_equidistant_from_both_players(n, e):
    # Along the middle of a long side, a spoon sits straight in from the gap's midpoint.
    # (Nearer the corners the spoons spread round the track instead.)
    cfg = TableConfig("rectangle", max_long=6, max_end=2, spoon_layout="between")
    per = Perimeter(cfg)
    w, h = cfg.size
    arcs = per.seat_arcs(n)
    (spoons, _), _ = _between(cfg, n, e)
    seats = [per.point(a) for a in arcs]
    checked = 0
    for i in set(range(n)) - {(e - 1) % n, e, (e + 1) % n}:
        a, b = seats[i], seats[(i + 1) % n]
        if (a.nx, a.ny) != (b.nx, b.ny) or a.ny == 0:
            continue  # wraps a corner, or on an end
        if not all(h / 2 <= p.x <= w - h / 2 for p in (a, b)):
            continue  # near a corner
        mid = ((a.x + b.x) / 2 - a.nx * h / 3, (a.y + b.y) / 2 - a.ny * h / 3)
        assert any(math.dist(mid, (s["x"], s["y"])) < 1e-9 for s in spoons), i
        checked += 1
    assert checked >= 2
