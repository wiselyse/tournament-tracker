import pytest

from harness import Game
from wsf_tournament.engine.events import CommandError, HistoryDiverges
from wsf_tournament.engine.replay import replay
from wsf_tournament.engine.view import tournament_view


def test_replay_is_deterministic():
    g = Game(21, seed=9)
    g.do("start")
    g.out(3)
    for k in range(1, g.cursor + 1):
        assert tournament_view(g.events, k) == tournament_view(list(g.events), k)
    assert replay(g.events).timeline == replay(g.events).timeline


def test_undo_redo_move_by_whole_command_group():
    g = Game(6)
    g.do("start")
    after_start = g.view
    g.out()
    assert g.last_group_types() == ["PlayerEliminated", "RoundEnded", "RoundStarted"]
    g.undo()

    def same(v):
        return {k: x for k, x in v.items() if k not in ("head", "can_redo")}

    assert same(g.view) == same(after_start)
    assert g.view["can_redo"] and g.view["head"] > g.view["cursor"]
    g.redo()
    assert g.view["round"]["no"] == 2 and not g.view["can_redo"]


def test_creation_cannot_be_undone():
    g = Game(4)
    assert not g.view["can_undo"]
    with pytest.raises(CommandError):
        g.undo()
    g.do("start")
    g.undo()
    assert not g.view["tournament"]["started"]
    with pytest.raises(CommandError):
        g.undo()


def test_command_after_undo_diverges_unless_discarding():
    g = Game(6)
    g.do("start")
    g.out(2)
    g.undo()
    with pytest.raises(HistoryDiverges) as exc:
        g.do("reroll")
    assert exc.value.discarded == 3 and exc.value.actions == 1
    head = len(g.events)
    g.do("reroll", discard_future=True)
    assert len(g.events) == head - 3 + 1
    assert not g.view["can_redo"]
    assert [e.seq for e in g.events] == list(range(1, len(g.events) + 1))


def test_rewind_to_any_event_lands_on_its_group_end():
    g = Game(6)
    g.do("start")
    g.out()
    g.out()
    eliminated = [e for e in g.events if e.type == "PlayerEliminated"][0]
    g.rewind(eliminated.seq)
    assert g.view["round"]["no"] == 2
    assert g.events[g.cursor - 1].type == "RoundStarted"
    with pytest.raises(CommandError):
        g.rewind(999)


def test_undo_cutoff_confirmation_restores_the_prompt():
    g = Game(21, seed=3)
    g.do("start")
    g.play_to_cutoff()
    g.confirm()
    g.undo()
    assert any(p["type"] == "cutoff" for p in g.view["prompts"])
    g.undo()  # "Undo last out" on the cutoff card
    assert g.view["prompts"] == [] and not g.view["round"]["ended"]
