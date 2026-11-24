"""SQLite persistence: one row per tournament (metadata + cursor) and its event log.

Name, date and archived live on the tournament row rather than in events: renaming a
tournament or archiving it isn't something you'd want undo to roll back.
"""

import json
import sqlite3
import uuid
from contextlib import closing
from pathlib import Path

from .engine.events import Event

SCHEMA = """
CREATE TABLE IF NOT EXISTS tournaments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    date TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    cursor INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
    tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    grp INTEGER NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (tournament_id, seq)
);
CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL
);
"""


class NotFound(Exception):
    pass


class Store:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with closing(self._connect()) as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.executescript(SCHEMA)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    @staticmethod
    def _insert_events(conn, tid: str, events: list[Event]) -> None:
        conn.executemany(
            "INSERT INTO events (tournament_id, seq, grp, type, payload, at) VALUES (?,?,?,?,?,?)",
            [(tid, e.seq, e.group, e.type, json.dumps(e.payload), e.at) for e in events],
        )

    def create(
        self,
        name: str,
        date: str | None,
        events: list[Event],
        cursor: int,
        now: int,
        archived: bool = False,
    ) -> str:
        tid = uuid.uuid4().hex[:12]
        with closing(self._connect()) as conn, conn:
            conn.execute(
                "INSERT INTO tournaments (id, name, date, archived, cursor, created_at, updated_at)"
                " VALUES (?,?,?,?,?,?,?)",
                (tid, name, date, int(archived), cursor, now, now),
            )
            self._insert_events(conn, tid, events)
        return tid

    def all(self) -> list[dict]:
        with closing(self._connect()) as conn:
            rows = conn.execute("SELECT * FROM tournaments ORDER BY updated_at DESC").fetchall()
        return [dict(r) for r in rows]

    def get(self, tid: str) -> dict:
        with closing(self._connect()) as conn:
            row = conn.execute("SELECT * FROM tournaments WHERE id=?", (tid,)).fetchone()
        if row is None:
            raise NotFound(tid)
        return dict(row)

    def events(self, tid: str) -> list[Event]:
        with closing(self._connect()) as conn:
            rows = conn.execute(
                "SELECT * FROM events WHERE tournament_id=? ORDER BY seq", (tid,)
            ).fetchall()
        return [
            Event(r["type"], json.loads(r["payload"]), r["at"], r["seq"], r["grp"]) for r in rows
        ]

    def save_log(self, tid: str, keep: int, new: list[Event], cursor: int, now: int) -> None:
        """Keep the first `keep` events, drop the rest, append `new`, move the cursor."""
        with closing(self._connect()) as conn, conn:
            conn.execute("DELETE FROM events WHERE tournament_id=? AND seq>?", (tid, keep))
            self._insert_events(conn, tid, new)
            self._touch(conn, tid, now, cursor=cursor)

    def set_cursor(self, tid: str, cursor: int, now: int) -> None:
        with closing(self._connect()) as conn, conn:
            self._touch(conn, tid, now, cursor=cursor)

    def update(self, tid: str, now: int, **fields) -> None:
        """name / date / archived."""
        with closing(self._connect()) as conn, conn:
            self._touch(conn, tid, now, **fields)

    @staticmethod
    def _touch(conn, tid: str, now: int, **fields) -> None:
        fields["updated_at"] = now
        sets = ", ".join(f"{k}=?" for k in fields)
        cur = conn.execute(f"UPDATE tournaments SET {sets} WHERE id=?", (*fields.values(), tid))
        if cur.rowcount == 0:
            raise NotFound(tid)

    def delete(self, tid: str) -> None:
        with closing(self._connect()) as conn, conn:
            if conn.execute("DELETE FROM tournaments WHERE id=?", (tid,)).rowcount == 0:
                raise NotFound(tid)

    def settings(self) -> dict:
        with closing(self._connect()) as conn:
            row = conn.execute("SELECT data FROM settings WHERE id=1").fetchone()
        return json.loads(row["data"]) if row else {}

    def save_settings(self, data: dict) -> None:
        with closing(self._connect()) as conn, conn:
            conn.execute(
                "INSERT INTO settings (id, data) VALUES (1, ?)"
                " ON CONFLICT(id) DO UPDATE SET data=excluded.data",
                (json.dumps(data),),
            )
