import datetime
import importlib.util
import sqlite3
from contextlib import closing
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "backup", Path(__file__).resolve().parents[2] / "deploy" / "backup.py"
)
backup_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(backup_mod)


def test_backup_copies_and_prunes(tmp_path):
    assert backup_mod.backup(tmp_path, datetime.date(2026, 11, 26)) is None  # no db yet
    with closing(sqlite3.connect(tmp_path / "tournaments.db")) as conn, conn:
        conn.execute("CREATE TABLE t (x)")
        conn.execute("INSERT INTO t VALUES (42)")
    for day in range(1, 6):
        dest = backup_mod.backup(tmp_path, datetime.date(2026, 11, day), keep=3)
    with closing(sqlite3.connect(dest)) as conn:
        assert conn.execute("SELECT x FROM t").fetchone() == (42,)
        assert conn.execute("PRAGMA integrity_check").fetchone() == ("ok",)
    names = sorted(p.name for p in (tmp_path / "backups").iterdir())
    assert names == [f"tournaments-2026-11-0{d}.db" for d in (3, 4, 5)]
