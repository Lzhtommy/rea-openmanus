"""Scheduled tasks: next-run calculation per frequency and validation."""

import os
import tempfile
from datetime import datetime

os.environ.setdefault("MANUS_LLM_API_KEY", "test")
os.environ.setdefault("MANUS_DATA_DIR", tempfile.mkdtemp(prefix="manus-test-"))

import pytest  # noqa: E402

from app.scheduler import ScheduleError, describe, next_run, validate  # noqa: E402

NOW = datetime(2026, 10, 22, 10, 30)  # a Thursday


def test_next_run_kinds():
    assert next_run(validate({"kind": "daily", "time": "09:00"}), NOW) == datetime(2026, 10, 23, 9, 0)
    assert next_run(validate({"kind": "daily", "time": "11:15"}), NOW) == datetime(2026, 10, 22, 11, 15)
    assert next_run(validate({"kind": "weekly", "weekday": 0, "time": "08:00"}), NOW) == datetime(2026, 10, 26, 8, 0)
    assert next_run(validate({"kind": "weekly", "weekday": 3, "time": "10:00"}), NOW) == datetime(2026, 10, 29, 10, 0)
    assert next_run(validate({"kind": "interval", "everyMinutes": 30}), NOW) == datetime(2026, 10, 22, 11, 0)
    last = datetime(2026, 10, 22, 10, 10)
    assert next_run(validate({"kind": "interval", "everyMinutes": 30}), NOW, last) == datetime(2026, 10, 22, 10, 40)
    once = validate({"kind": "once", "at": "2026-10-23T07:45"})
    assert next_run(once, NOW) == datetime(2026, 10, 23, 7, 45)
    assert next_run(once, NOW, last_run=NOW) is None
    assert next_run(validate({"kind": "once", "at": "2026-10-01T07:45"}), NOW) is None


def test_validate_and_describe():
    for bad in [{"kind": "hourly"}, {"kind": "daily", "time": "25:00"}, {"kind": "weekly", "time": "09:00"},
                {"kind": "interval", "everyMinutes": 1}, {"kind": "once", "at": "tomorrow"}]:
        with pytest.raises(ScheduleError):
            validate(bad)
    assert describe(validate({"kind": "weekly", "weekday": 0, "time": "08:00"})) == "每周一 08:00"
    assert describe(validate({"kind": "interval", "everyMinutes": 120})) == "每 2 小时"
