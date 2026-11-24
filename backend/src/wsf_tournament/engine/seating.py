"""Table shapes, seats per side, seat numbering and geometry (HANDOFF §5.1).

Coordinates are screen-style (y grows downward). The table occupies the box (0,0)–(w,h)
with its long axis horizontal and w = 1. Seats sit ON the table edge; each comes with the
outward normal (nx, ny) so the renderer can push the seat circle off the edge by however
many pixels it likes. Numbering is clockwise on screen, seat 1 at the top-left of a
rectangle/square or at 12 o'clock on a circle/oval.
"""

import bisect
import math
from dataclasses import asdict, dataclass

SHAPES = ("rectangle", "square", "oval", "circle")
SPOON_LAYOUTS = ("center", "between")
OVAL_ASPECT = 1.6
RECT_ASPECT = 2.0  # the mockups draw every rectangle at about 2:1


@dataclass(frozen=True)
class TableConfig:
    shape: str = "rectangle"
    max_long: int = 4  # rectangle: per long side (top, bottom)
    max_end: int = 2  # rectangle: per end (left, right)
    max_side: int = 3  # square: per side
    spoon_layout: str = "center"

    def __post_init__(self):
        if self.shape not in SHAPES:
            raise ValueError(f"shape must be one of {SHAPES}")
        if self.spoon_layout not in SPOON_LAYOUTS:
            raise ValueError(f"spoon_layout must be one of {SPOON_LAYOUTS}")
        for name in ("max_long", "max_end", "max_side"):
            v = getattr(self, name)
            if not isinstance(v, int) or v < 0:
                raise ValueError(f"{name} must be a non-negative integer")
        if self.shape == "rectangle" and self.max_long < 1:
            raise ValueError("a rectangle needs at least one seat per long side")
        if self.shape == "square" and self.max_side < 1:
            raise ValueError("a square needs at least one seat per side")

    @classmethod
    def from_dict(cls, d: dict) -> "TableConfig":
        allowed = {"shape", "max_long", "max_end", "max_side", "spoon_layout"}
        unknown = set(d) - allowed
        if unknown:
            raise ValueError(f"unknown table field(s): {sorted(unknown)}")
        return cls(**d)

    def to_dict(self) -> dict:
        return asdict(self)

    @property
    def capacity(self) -> int | None:
        """None = no per-side limit (circle, oval)."""
        if self.shape == "rectangle":
            return 2 * self.max_long + 2 * self.max_end
        if self.shape == "square":
            return 4 * self.max_side
        return None

    @property
    def size(self) -> tuple[float, float]:
        """(w, h) of the table box. w is always 1."""
        if self.shape == "rectangle":
            return 1.0, 1.0 / RECT_ASPECT
        if self.shape == "oval":
            return 1.0, 1.0 / OVAL_ASPECT
        return 1.0, 1.0


def fits(cfg: TableConfig, players: int) -> bool:
    return cfg.capacity is None or players <= cfg.capacity


def side_counts(cfg: TableConfig, n: int) -> list[int]:
    """Seats on [top, right, bottom, left]. Only for rectangle and square.

    shortcut: rectangle fills long sides first, ends take the overflow (confirmed
    2026-11-16); change it here if WSF wants ends filled earlier.
    """
    if not fits(cfg, n):
        raise ValueError(f"{n} players don't fit at a table for {cfg.capacity}")
    if cfg.shape == "rectangle":
        long = min(n, 2 * cfg.max_long)
        rest = n - long
        return [math.ceil(long / 2), math.ceil(rest / 2), long // 2, rest // 2]
    if cfg.shape == "square":
        # Extras go to opposite sides first (top, bottom, then right, left) so players
        # face each other instead of bunching on two neighbouring sides.
        extra = [i in (0, 2, 1, 3)[: n % 4] for i in range(4)]
        return [n // 4 + e for e in extra]
    raise ValueError(f"{cfg.shape} has no sides")


@dataclass(frozen=True)
class EdgePoint:
    x: float
    y: float
    nx: float  # outward normal
    ny: float


class Perimeter:
    """Arc-length parametrisation of the table edge, clockwise from the start point."""

    def __init__(self, cfg: TableConfig):
        self.cfg = cfg
        self.w, self.h = cfg.size
        if cfg.shape in ("rectangle", "square"):
            self.length = 2 * (self.w + self.h)
            self._samples = None
        else:
            # Numeric arc length of the ellipse; θ=0 at 12 o'clock, increasing clockwise.
            a, b, steps = self.w / 2, self.h / 2, 4096
            thetas = [2 * math.pi * i / steps for i in range(steps + 1)]
            pts = [(a * math.sin(t), -b * math.cos(t)) for t in thetas]
            cum = [0.0]
            for (x0, y0), (x1, y1) in zip(pts, pts[1:], strict=False):
                cum.append(cum[-1] + math.hypot(x1 - x0, y1 - y0))
            self.length = cum[-1]
            self._samples = (thetas, cum)

    def point(self, s: float) -> EdgePoint:
        s %= self.length
        w, h = self.w, self.h
        if self._samples is None:
            if s < w:
                return EdgePoint(s, 0.0, 0.0, -1.0)  # top, left → right
            s -= w
            if s < h:
                return EdgePoint(w, s, 1.0, 0.0)  # right, top → bottom
            s -= h
            if s < w:
                return EdgePoint(w - s, h, 0.0, 1.0)  # bottom, right → left
            s -= w
            return EdgePoint(0.0, h - s, -1.0, 0.0)  # left, bottom → top
        thetas, cum = self._samples
        i = min(bisect.bisect_right(cum, s), len(cum) - 1)
        t0, t1, c0, c1 = thetas[i - 1], thetas[i], cum[i - 1], cum[i]
        t = t0 + (t1 - t0) * ((s - c0) / (c1 - c0) if c1 > c0 else 0)
        a, b = w / 2, h / 2
        x, y = a * math.sin(t), -b * math.cos(t)
        nx, ny = x / (a * a), y / (b * b)
        norm = math.hypot(nx, ny)
        return EdgePoint(w / 2 + x, h / 2 + y, nx / norm, ny / norm)

    def seat_arcs(self, n: int) -> list[float]:
        """Arc position of each seat, in seat-number order (clockwise)."""
        if n == 0:
            return []
        if self.cfg.shape in ("circle", "oval"):
            return [self.length * i / n for i in range(n)]
        w, h = self.w, self.h
        top, right, bottom, left = side_counts(self.cfg, n)
        arcs = []
        for start, side_len, k in (
            (0, w, top),
            (w, h, right),
            (w + h, w, bottom),
            (2 * w + h, h, left),
        ):
            arcs += [start + side_len * (j + 0.5) / k for j in range(k)]
        return arcs


def seat_layout(cfg: TableConfig, n: int) -> list[dict]:
    """[{seat_no, x, y, nx, ny}] for n seats."""
    per = Perimeter(cfg)
    out = []
    for i, s in enumerate(per.seat_arcs(n)):
        p = per.point(s)
        out.append({"seat_no": i + 1, "x": p.x, "y": p.y, "nx": p.nx, "ny": p.ny})
    return out
