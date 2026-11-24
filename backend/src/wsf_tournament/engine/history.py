"""The event log and its cursor (HANDOFF §4.1). State is always replay(events[:cursor]);
undo, redo and rewind only move the cursor, a whole command group at a time. The first
group (tournament creation) can't be undone."""

from dataclasses import replace
from random import Random

from .commands import execute
from .events import CommandError, Event, HistoryDiverges
from .replay import replay


def _group_start(events: list[Event], i: int) -> int:
    """Index of the first event in the group containing events[i]."""
    g = events[i].group
    while i > 0 and events[i - 1].group == g:
        i -= 1
    return i


def _group_end(events: list[Event], i: int) -> int:
    """Index just past the last event in the group containing events[i]."""
    g = events[i].group
    while i < len(events) and events[i].group == g:
        i += 1
    return i


def can_undo(events: list[Event], cursor: int) -> bool:
    return cursor > 0 and _group_start(events, cursor - 1) > 0


def can_redo(events: list[Event], cursor: int) -> bool:
    return cursor < len(events)


def undo(events: list[Event], cursor: int) -> int:
    if not can_undo(events, cursor):
        raise CommandError("nothing to undo")
    return _group_start(events, cursor - 1)


def redo(events: list[Event], cursor: int) -> int:
    if not can_redo(events, cursor):
        raise CommandError("nothing to redo")
    return _group_end(events, cursor)


def rewind(events: list[Event], seq: int) -> int:
    """Cursor that includes event `seq` and the rest of its group."""
    if not 1 <= seq <= len(events):
        raise CommandError(f"no event {seq}")
    return _group_end(events, seq - 1)


def sequence(new: list[Event], after: list[Event]) -> list[Event]:
    """Number new events as one group appended to `after`."""
    group = (after[-1].group if after else 0) + 1
    return [replace(ev, seq=len(after) + i + 1, group=group) for i, ev in enumerate(new)]


def run_command(
    events: list[Event], cursor: int, cmd: dict, now: int, rng: Random, discard_future: bool = False
) -> tuple[list[Event], int]:
    """Apply a command. Returns (the full new log, new cursor); the log is truncated at the
    cursor first when `discard_future` is set."""
    if cursor < len(events) and not discard_future:
        raise HistoryDiverges(len(events) - cursor, len({e.group for e in events[cursor:]}))
    kept = events[:cursor]
    new = sequence(execute(replay(kept), cmd, now, rng), kept)
    return kept + new, len(kept) + len(new)
