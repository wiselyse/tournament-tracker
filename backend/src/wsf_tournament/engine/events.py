"""Events are the only source of truth (HANDOFF §4). Every random draw is stored in its
event's payload, so replay is deterministic."""

from dataclasses import dataclass, field

EVENT_TYPES = (
    "TournamentCreated",
    "PlayerAdded",
    "PlayerRenamed",
    "TableConfigured",
    "StageCreated",
    "DivisionStarted",
    "RoundStarted",
    "SeatsRerolled",
    "SeatsSwapped",
    "StalemateOpened",
    "StalemateResolved",
    "StalemateCancelled",
    "PenaltyLogged",
    "PlayerEliminated",
    "RoundEnded",
    "PlayStarted",  # the organiser started the round's (or a stalemate's) clock
    "StoppageStarted",
    "StoppageEnded",
    "DivisionCutoffConfirmed",
    "TournamentCompleted",
)


@dataclass(frozen=True)
class Event:
    type: str
    payload: dict = field(default_factory=dict)
    at: int = 0  # epoch milliseconds
    seq: int = 0  # 1-based position in the log
    group: int = 0  # one command = one group; undo/redo move by group

    def to_dict(self) -> dict:
        return {
            "seq": self.seq,
            "group": self.group,
            "type": self.type,
            "payload": self.payload,
            "at": self.at,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Event":
        if d["type"] not in EVENT_TYPES:
            raise ValueError(f"unknown event type {d['type']!r}")
        return cls(
            type=d["type"],
            payload=d.get("payload", {}),
            at=d.get("at", 0),
            seq=d.get("seq", 0),
            group=d.get("group", 0),
        )


class CommandError(Exception):
    """The command is invalid for the current state (→ HTTP 422)."""


class HistoryDiverges(Exception):
    """A command was sent while the cursor is behind the head (→ HTTP 409)."""

    def __init__(self, discarded: int, actions: int = 1):
        super().__init__(f"{discarded} later event(s) would be replaced")
        self.discarded = discarded  # events
        self.actions = actions  # command groups: what the operator thinks of as "actions"
