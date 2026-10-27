"""Persistence: crash-safe file writes, the SQLite stores, and the one-time import of old JSON files."""

import json
import os
import stat

from app import storage


def mode(p) -> int:
    return stat.S_IMODE(os.stat(p).st_mode)


def test_write_text_replaces_atomically(tmp_path):
    p = tmp_path / "sub" / "meta.json"
    storage.write_text(p, "一")
    storage.write_text(p, "二")
    assert p.read_text(encoding="utf-8") == "二"
    assert [f.name for f in p.parent.iterdir()] == ["meta.json"]


def test_private_files_are_0600_even_over_a_stale_tmp(tmp_path):
    p = tmp_path / "secret.key"
    stale = tmp_path / "secret.key.tmp"
    stale.write_text("old")
    stale.chmod(0o644)
    storage.write_bytes(p, b"\x00\x01", private=True)
    assert p.read_bytes() == b"\x00\x01" and mode(p) == 0o600
    assert not stale.exists()


def test_items_keep_order_and_survive_reopen(tmp_path):
    path = tmp_path / "projects.json"
    assert storage.load_items(path) == []
    storage.save_items(path, [{"id": "b", "name": "乙"}, {"id": "a", "name": "甲"}])
    storage.save_items(path, [{"id": "b", "name": "乙"}, {"id": "c"}])  # a removed, c added
    storage.close_all()
    assert storage.load_items(path) == [{"id": "b", "name": "乙"}, {"id": "c"}]
    assert not path.exists()  # nothing written back as JSON
    assert mode(tmp_path / storage.DB_NAME) == 0o600


def test_docs_are_separate_by_name(tmp_path):
    a, b = tmp_path / "personal-u1.json", tmp_path / "personal-u2.json"
    assert storage.load_doc(a) is None
    storage.save_doc(a, {"instructions": "x"})
    assert storage.load_doc(a) == {"instructions": "x"} and storage.load_doc(b) is None


def test_legacy_json_is_imported_once_and_kept_as_bak(tmp_path):
    path = tmp_path / "schedules.json"
    path.write_text(json.dumps([{"id": "s1"}]))
    assert storage.load_items(path) == [{"id": "s1"}]
    assert not path.exists() and (tmp_path / "schedules.json.bak").exists()
    storage.save_items(path, [{"id": "s2"}])
    assert storage.load_items(path) == [{"id": "s2"}]  # the .bak is not imported again


def test_corrupt_legacy_json_is_moved_aside(tmp_path):
    path = tmp_path / "users.json"
    path.write_text("{not json")
    assert storage.load_items(path) == []
    assert (tmp_path / "users.json.corrupt").read_text() == "{not json"
