"""Crash-safe writes for the JSON files under data/."""

from __future__ import annotations

import json
import os
from pathlib import Path


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


def write_json(path: Path, data, private: bool = False, indent: int | None = 1) -> None:
    write_text(path, json.dumps(data, ensure_ascii=False, indent=indent), private)
