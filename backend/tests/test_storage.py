"""Crash-safe JSON writes: content, permissions, and no stray temp files."""

import json
import os
import stat

from app import storage


def mode(p) -> int:
    return stat.S_IMODE(os.stat(p).st_mode)


def test_write_json_replaces_atomically(tmp_path):
    p = tmp_path / "sub" / "items.json"
    storage.write_json(p, [{"name": "一"}])
    storage.write_json(p, [{"name": "二"}])
    assert json.loads(p.read_text(encoding="utf-8")) == [{"name": "二"}]
    assert [f.name for f in p.parent.iterdir()] == ["items.json"]


def test_private_files_are_0600_even_over_a_stale_tmp(tmp_path):
    p = tmp_path / "users.json"
    stale = tmp_path / "users.json.tmp"
    stale.write_text("old")
    stale.chmod(0o644)
    storage.write_json(p, [], private=True)
    assert mode(p) == 0o600
    assert not stale.exists()


def test_write_bytes(tmp_path):
    p = tmp_path / "secret.key"
    storage.write_bytes(p, b"\x00\x01", private=True)
    assert p.read_bytes() == b"\x00\x01" and mode(p) == 0o600
