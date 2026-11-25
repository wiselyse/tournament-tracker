"""Drive a tournament through the engine the same way the API does."""

from random import Random

from wsf_tournament.engine.commands import create_tournament
from wsf_tournament.engine.history import redo, rewind, run_command, sequence, undo
from wsf_tournament.engine.replay import replay
from wsf_tournament.engine.view import tournament_view

CIRCLE = {"shape": "circle"}
# Most flow tests were written against rulebook v2.1 (divisions above 20, 12 per table, centre
# pile); they pin it so the 2026 defaults don't change what they check.
V2_1 = {"division_threshold": 20, "max_per_table": 12, "spoon_layout": "center"}


class Game:
    def __init__(self, n=10, table=None, seed=0, rules=None, names=None):
        self.rng = Random(seed)
        self.now = 1_000_000
        names = names or [f"P{i + 1}" for i in range(n)]
        self.events = sequence(
            create_tournament(
                "Test",
                "2026-11-26",
                names,
                table or CIRCLE,
                V2_1 if rules is None else rules,
                self.now,
            ),
            [],
        )
        self.cursor = len(self.events)

    def do(self, type_, discard_future=False, **args):
        self.now += 1000
        self.events, self.cursor = run_command(
            self.events, self.cursor, {"type": type_, **args}, self.now, self.rng, discard_future
        )
        return self.view

    def undo(self):
        self.cursor = undo(self.events, self.cursor)

    def redo(self):
        self.cursor = redo(self.events, self.cursor)

    def rewind(self, seq):
        self.cursor = rewind(self.events, seq)

    @property
    def view(self):
        return tournament_view(self.events, self.cursor)

    @property
    def state(self):
        return replay(self.events[: self.cursor])

    def pid(self, name):
        return next(p.id for p in self.state.players.values() if p.name == name)

    def seated(self):
        """Active players in the current round, in seat order."""
        return [s["player_id"] for s in self.view["round"]["seats"] if s["active"]]

    def out(self, n=1):
        for _ in range(n):
            self.do("mark_out", player_id=self.seated()[0])
        return self.view

    def play_to_cutoff(self):
        while not any(p["type"] == "cutoff" for p in self.view["prompts"]):
            self.out()
        return self.view

    def confirm(self, **args):
        """Confirm the (first) division waiting at its cutoff."""
        div = next(p["division_id"] for p in self.view["prompts"] if p["type"] == "cutoff")
        return self.do("confirm_cutoff", division_id=div, **args)

    def alive(self, div):
        """Players still in division `div`."""
        d = next(d for st in self.view["stages"] for d in st["divisions"] if d["id"] == div)
        ids = set(d["player_ids"])
        return sum(
            p["id"] in ids and p["status"] in ("in", "waiting") for p in self.view["players"]
        )

    def play_until(self, pred):
        """Mark out whoever's first at the table (divisions take turns) until pred(view)."""
        while not pred(self.view):
            self.out()
        return self.view

    def play_out(self):
        """Play the whole tournament to a champion."""
        while not self.view["tournament"]["completed"]:
            if any(p["type"] == "cutoff" for p in self.view["prompts"]):
                self.confirm()
            else:
                self.out()
        return self.view

    def last_group_types(self):
        g = self.events[self.cursor - 1].group
        return [e.type for e in self.events[: self.cursor] if e.group == g]
