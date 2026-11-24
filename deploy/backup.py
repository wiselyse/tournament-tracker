"""Copy tournaments.db to backups/tournaments-YYYY-MM-DD.db and keep the newest KEEP copies.

Uses SQLite's online backup API, so it is safe while the app is running (a plain file
copy could catch the database mid-write). Stdlib only: runs with the system python3.

    WSF_DATA_DIR=~/apps/wsf-data python3 backup.py
"""

import datetime
import os
import sqlite3
import sys
from contextlib import closing
from pathlib import Path

KEEP = 60


def backup(data_dir: Path, today: datetime.date, keep: int = KEEP) -> Path | None:
    src = data_dir / "tournaments.db"
    if not src.exists():
        return None
    out = data_dir / "backups"
    out.mkdir(exist_ok=True)
    dest = out / f"tournaments-{today.isoformat()}.db"
    tmp = dest.with_suffix(".tmp")
    with closing(sqlite3.connect(src)) as s, closing(sqlite3.connect(tmp)) as d:
        s.backup(d)
    tmp.replace(dest)  # never leave a half-written backup under the real name
    for old in sorted(out.glob("tournaments-*.db"))[:-keep]:
        old.unlink()
    return dest


if __name__ == "__main__":
    data = os.environ.get("WSF_DATA_DIR") or (sys.argv[1] if len(sys.argv) > 1 else "")
    if not data:
        sys.exit("set WSF_DATA_DIR or pass the data directory")
    dest = backup(Path(data).expanduser(), datetime.date.today())
    print(f"backed up to {dest}" if dest else "no tournaments.db yet; nothing to back up")
