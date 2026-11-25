"""Spoon layouts (rule 1.1.2, HANDOFF §5.3–5.4). Same coordinate system as seating.py.

`rot` is the direction the spoon's HEAD points, in degrees, screen-style:
0 = right (+x), 90 = down (+y), -90 = up.
"""

import math

from .seating import Perimeter, TableConfig


def active_empty_gap(seat_count: int, empty_gap: int, active: list[int]) -> int:
    """Map the round's empty gap (gap after seat index `empty_gap`, 0-based, among all
    seats) onto the gaps between the seats still active. When a seat empties mid-round,
    its two gaps merge into the gap after the previous active seat."""
    if not active:
        raise ValueError("no active seats")
    if empty_gap in active:
        return active.index(empty_gap)
    before = [i for i, s in enumerate(active) if s < empty_gap]
    return before[-1] if before else len(active) - 1


def center_layout(cfg: TableConfig, players: int) -> list[dict]:
    """players − 1 spoons in one row along the long axis, evenly spaced, heads alternating."""
    w, h = cfg.size
    return [
        {"x": w * (i + 1) / players, "y": h / 2, "rot": -90 if i % 2 == 0 else 90}
        for i in range(players - 1)
    ]


def _toward_middle(cfg: TableConfig, x: float, y: float) -> float:
    """Heading (degrees) from (x, y) to the nearest point of the table's middle line, so
    the spoon's head (the bowl) points into the table and the handle toward the players."""
    w, h = cfg.size
    cx = min(max(x, h / 2), w - h / 2)  # the middle line runs along the long axis
    return math.degrees(math.atan2(h / 2 - y, cx - x))


class _Track:
    """The rectangle `d` in from every edge of a boxed table, where the spoons lie,
    parametrised by arc length clockwise from its top-left corner."""

    def __init__(self, w: float, h: float, d: float):
        self.x0, self.y0, self.x1, self.y1 = d, d, w - d, h - d
        self.iw, self.ih = self.x1 - self.x0, self.y1 - self.y0
        self.length = 2 * (self.iw + self.ih)

    def arc(self, x: float, y: float, w: float, h: float) -> float:
        """Arc where the line from the table's middle line out to edge point (x, y) crosses
        the track. Straight in along the long sides; spread around the corners."""
        qx, qy = min(max(x, h / 2), w - h / 2), h / 2
        dx, dy = x - qx, y - qy
        t = min(
            (self.x1 - qx) / dx if dx > 0 else (self.x0 - qx) / dx if dx < 0 else math.inf,
            (self.y1 - qy) / dy if dy > 0 else (self.y0 - qy) / dy if dy < 0 else math.inf,
        )
        x, y, eps = qx + dx * t, qy + dy * t, 1e-12
        if y <= self.y0 + eps and x < self.x1 - eps:
            return x - self.x0  # top
        if x >= self.x1 - eps and y < self.y1 - eps:
            return self.iw + y - self.y0  # right
        if y >= self.y1 - eps and x > self.x0 + eps:
            return self.iw + self.ih + self.x1 - x  # bottom
        return 2 * self.iw + self.ih + self.y1 - y  # left

    def point(self, s: float) -> tuple[float, float]:
        s %= self.length
        for side_len, f in (
            (self.iw, lambda t: (self.x0 + t, self.y0)),
            (self.ih, lambda t: (self.x1, self.y0 + t)),
            (self.iw, lambda t: (self.x1 - t, self.y1)),
            (self.ih, lambda t: (self.x0, self.y1 - t)),
        ):
            if s <= side_len:
                return f(s)
            s -= side_len
        return self.x0, self.y0


def between_layout(cfg: TableConfig, seat_arcs: list[float], empty_gap: int, inset: float):
    """Rule 1.2.2 (adopted 2026): one spoon per gap between neighbouring seats, about 12 in
    from the edge (`inset` × the table's short side) and the same distance from both
    players; one random gap is left empty. Heads (bowls) point into the table.

    `seat_arcs` are the active seats' arc positions in clockwise order; gap i lies between
    seat i and seat i+1 (wrapping).
    - Rectangle/square: every spoon lies on the "track", the rectangle `inset` in from the
      edges. Each seat is projected onto the track along the line from the table's middle
      line, and the spoon goes halfway between its two players' projections: straight in
      at the gap's midpoint along a side, and spread evenly round the corners (strict
      equidistance there piles two or three spoons onto the track's corner).
    - Circle/oval: on the same shape `inset` in, opposite the gap's midpoint.
    - The empty gap keeps its spot: the marker (drawn as a red spoon) sits exactly where
      that gap's spoon would be, and no other spoon moves. The table evens them out in person.
    - Rectangle with an empty end: the gap between the last top player and the first
      bottom player (or back) sits on the middle line, between the two players, but no
      nearer the end than the track the other spoons lie on.
    - Two players: their one spoon sits dead centre, so it's the same reach for both.
    Returns (spoons, empty_marker).
    """
    per = Perimeter(cfg)
    n = len(seat_arcs)
    if n < 2:
        return [], None
    w, h = cfg.size
    if n == 2:
        return [{"x": w / 2, "y": h / 2, "rot": 0.0}], None
    depth = inset * min(w, h)
    if cfg.shape == "square":
        # shortcut: at ⅓ in, a square's track is so small that seats either side of a corner
        # map to the same track point and their spoons coincide; 0.2 keeps them apart.
        # Revisit if WSF ever plays on a square table.
        depth = min(depth, 0.2)
    seats = [per.point(s) for s in seat_arcs]

    if cfg.shape in ("rectangle", "square"):
        track = _Track(w, h, depth)
        L = track.length
        proj = [track.arc(p.x, p.y, w, h) for p in seats]

        def gap_arc(i: int) -> float:
            return proj[i] + ((proj[(i + 1) % n] - proj[i]) % L) / 2

        def at(s: float) -> dict:
            x, y = track.point(s)
            return {"x": x, "y": y, "rot": _toward_middle(cfg, x, y)}

        def across(i: int) -> dict | None:
            """Gap i's spot if its players face each other across an empty rectangle end."""
            a, b = seats[i], seats[(i + 1) % n]
            if cfg.shape != "rectangle" or a.ny == b.ny or 0 in (a.ny, b.ny):
                return None
            # Lined up with the two players, but no nearer the end than the other spoons' track.
            x = min(max((a.x + b.x) / 2, track.x0), track.x1)
            return {"x": x, "y": h / 2, "rot": 180.0 if x > w / 2 else 0.0}
    else:
        L = per.length
        a, b = w / 2, h / 2
        gaps = [(seat_arcs[(i + 1) % n] - seat_arcs[i]) % L or L for i in range(n)]

        def gap_arc(i: int) -> float:
            return seat_arcs[i] + gaps[i] / 2

        def across(i: int) -> None:
            return None

        def at(s: float) -> dict:
            # The ellipse `depth` in at its ends, not an offset curve: at an oval's tight
            # ends an offset `depth` in folds over itself and bunches the spoons.
            p = per.point(s)
            x, y = a + (p.x - a) * (a - depth) / a, b + (p.y - b) * (b - depth) / b
            return {"x": x, "y": y, "rot": _toward_middle(cfg, x, y)}

    e = empty_gap % n
    marc = gap_arc(e)
    marker = across(e) or at(marc)
    spoons = [across(i) or at(gap_arc(i)) for i in range(n) if i != e]
    return spoons, marker
