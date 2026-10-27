"""Persistence for the stores under data/.

Stores keep their state in memory and save it whole. It lives in data/manus.db (SQLite, WAL), keyed
by the store's old JSON file name: a store with path data/projects.json is the "projects" store. On
first load a store's JSON file is imported and renamed to *.json.bak.

- items: a list of dicts with an "id" (projects, schedules, users, ...), kept in order.
- docs: one JSON value per name (agents, providers, personal-<uid>, ...).

The database holds secrets (password hashes, API keys, connector tokens), so it is created 0600.
The write_* helpers remain for the files that are still files (session logs, secret.key).
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
from collections.abc import Iterable
from pathlib import Path

log = logging.getLogger("manus.storage")

DB_NAME = "manus.db"
SCHEMA = """
CREATE TABLE IF NOT EXISTS items (
    store TEXT NOT NULL,
    id TEXT NOT NULL,
    pos INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (store, id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS docs (
    name TEXT PRIMARY KEY,
    data TEXT NOT NULL
) WITHOUT ROWID;
"""

_conns: dict[Path, sqlite3.Connection] = {}
_lock = threading.RLock()  # one connection per database, shared with to_thread workers


def write_bytes(path: Path, data: bytes, private: bool = False) -> None:
    """Write via a temp file and rename, so a reader (or a crash) never sees a half-written file.

    private: the file holds secrets (password hashes, API keys, tokens) and is created 0600 from the
    start, never briefly readable under the default umask.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600 if private else 0o644)
    try:
        if private:
            os.fchmod(fd, 0o600)  # a stale tmp left by an older version may have looser bits
        with os.fdopen(fd, "wb") as f:
            fd = -1
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
    finally:
        if fd != -1:
            os.close(fd)
    tmp.replace(path)


def write_text(path: Path, text: str, private: bool = False) -> None:
    write_bytes(path, text.encode("utf-8"), private)


def _db(directory: Path) -> sqlite3.Connection:
    key = directory.resolve()
    with _lock:
        conn = _conns.get(key)
        if conn is None:
            key.mkdir(parents=True, exist_ok=True)
            path = key / DB_NAME
            os.close(os.open(path, os.O_RDWR | os.O_CREAT, 0o600))  # -wal / -shm inherit its mode
            os.chmod(path, 0o600)
            conn = sqlite3.connect(path, isolation_level=None, check_same_thread=False)
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.execute("PRAGMA busy_timeout=5000")
            conn.executescript(SCHEMA)
            _conns[key] = conn
        return conn


def close_all() -> None:
    with _lock:
        for conn in _conns.values():
            conn.close()
        _conns.clear()


class _tx:
    """BEGIN IMMEDIATE ... COMMIT under the process lock (rolls back on error)."""

    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    def __enter__(self) -> sqlite3.Connection:
        _lock.acquire()
        try:
            self.conn.execute("BEGIN IMMEDIATE")
        except BaseException:
            _lock.release()
            raise
        return self.conn

    def __exit__(self, exc_type, *_):
        try:
            self.conn.execute("ROLLBACK" if exc_type else "COMMIT")
        finally:
            _lock.release()


def _put_items(conn: sqlite3.Connection, name: str, items: Iterable[dict]) -> None:
    conn.execute("DELETE FROM items WHERE store = ?", (name,))
    conn.executemany("INSERT OR REPLACE INTO items (store, id, pos, data) VALUES (?, ?, ?, ?)",
                     ((name, str(it["id"]), i, json.dumps(it, ensure_ascii=False)) for i, it in enumerate(items)))


def _put_doc(conn: sqlite3.Connection, name: str, data) -> None:
    conn.execute("INSERT OR REPLACE INTO docs (name, data) VALUES (?, ?)", (name, json.dumps(data, ensure_ascii=False)))


def _import_legacy(path: Path, put) -> None:
    """Move an existing JSON file into the database once. The file wins: it is only there if this
    store has not been imported yet, or an older version of the app wrote it after a downgrade."""
    if not path.exists():
        return
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        with _tx(_db(path.parent)) as conn:
            put(conn, data)
    except (ValueError, KeyError, TypeError):
        log.exception("could not import %s; moved aside as .corrupt", path)
        path.replace(path.with_name(path.name + ".corrupt"))
        return
    path.replace(path.with_name(path.name + ".bak"))
    log.info("imported %s into %s", path.name, DB_NAME)


def load_items(path: Path) -> list[dict]:
    name = path.stem
    _import_legacy(path, lambda conn, data: _put_items(conn, name, data))
    with _lock:
        rows = _db(path.parent).execute("SELECT data FROM items WHERE store = ? ORDER BY pos", (name,)).fetchall()
    return [json.loads(r[0]) for r in rows]


def save_items(path: Path, items: Iterable[dict]) -> None:
    with _tx(_db(path.parent)) as conn:
        _put_items(conn, path.stem, items)


def load_doc(path: Path):
    """The stored value, or None when there is none."""
    name = path.stem
    _import_legacy(path, lambda conn, data: _put_doc(conn, name, data))
    with _lock:
        row = _db(path.parent).execute("SELECT data FROM docs WHERE name = ?", (name,)).fetchone()
    return json.loads(row[0]) if row else None


def save_doc(path: Path, data) -> None:
    with _tx(_db(path.parent)) as conn:
        _put_doc(conn, path.stem, data)
