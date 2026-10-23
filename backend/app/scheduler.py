"""Scheduled tasks (Manus' ScheduledTask / 自动化): run a prompt as a new task at set times.

Frequencies: once (at a datetime), interval (every N minutes), daily (HH:MM), weekly (weekday + HH:MM),
all in the server's local time. A background loop checks due schedules and starts each run as a
fresh session tagged with the schedule id. Schedules live in data/schedules.json.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from datetime import datetime, timedelta

from . import config

log = logging.getLogger("manus.scheduler")

KINDS = ("once", "interval", "daily", "weekly")
WEEKDAYS = "一二三四五六日"


class ScheduleError(ValueError):
    pass


def _hm(value: str) -> tuple[int, int]:
    try:
        h, m = (int(x) for x in str(value).split(":"))
    except ValueError:
        raise ScheduleError(f"time must be HH:MM, got {value!r}")
    if not (0 <= h < 24 and 0 <= m < 60):
        raise ScheduleError(f"time out of range: {value!r}")
    return h, m


def validate(s: dict) -> dict:
    """Normalize a schedule spec {kind, at?, everyMinutes?, time?, weekday?}; raises ScheduleError."""
    kind = s.get("kind")
    if kind not in KINDS:
        raise ScheduleError(f"kind must be one of {', '.join(KINDS)}")
    out = {"kind": kind}
    if kind == "once":
        try:
            out["at"] = datetime.fromisoformat(str(s.get("at"))).replace(second=0, microsecond=0).isoformat(timespec="minutes")
        except ValueError:
            raise ScheduleError("once needs `at` as an ISO datetime, e.g. 2026-10-23T09:00")
    elif kind == "interval":
        minutes = int(s.get("everyMinutes") or 0)
        if minutes < 5:
            raise ScheduleError("interval needs everyMinutes >= 5")
        out["everyMinutes"] = minutes
    else:
        _hm(s.get("time", ""))
        out["time"] = s["time"]
        if kind == "weekly":
            wd = int(s.get("weekday", -1))
            if not 0 <= wd <= 6:
                raise ScheduleError("weekly needs weekday 0 (Monday) .. 6 (Sunday)")
            out["weekday"] = wd
    return out


def next_run(spec: dict, after: datetime, last_run: datetime | None = None) -> datetime | None:
    """The first run time strictly after `after` (None when a one-off already ran or is in the past)."""
    kind = spec["kind"]
    if kind == "once":
        at = datetime.fromisoformat(spec["at"])
        return at if at > after and last_run is None else None
    if kind == "interval":
        step = timedelta(minutes=spec["everyMinutes"])
        return max((last_run + step) if last_run else after + step, after + timedelta(seconds=1))
    h, m = _hm(spec["time"])
    cand = after.replace(hour=h, minute=m, second=0, microsecond=0)
    if kind == "daily":
        return cand if cand > after else cand + timedelta(days=1)
    cand += timedelta(days=(spec["weekday"] - cand.weekday()) % 7)
    return cand if cand > after else cand + timedelta(days=7)


def describe(spec: dict) -> str:
    kind = spec["kind"]
    if kind == "once":
        return f"仅一次 · {spec['at'].replace('T', ' ')}"
    if kind == "interval":
        n = spec["everyMinutes"]
        return f"每 {n // 60} 小时" if n % 60 == 0 else f"每 {n} 分钟"
    if kind == "daily":
        return f"每天 {spec['time']}"
    return f"每周{WEEKDAYS[spec['weekday']]} {spec['time']}"


class Scheduler:
    def __init__(self, store):
        self.store = store  # session store: runs become new sessions
        self.path = config.DATA_DIR / "schedules.json"
        self.items: dict[str, dict] = {}
        if self.path.exists():
            try:
                self.items = {s["id"]: s for s in json.loads(self.path.read_text())}
            except (ValueError, KeyError):
                log.exception("unreadable %s", self.path)
        self.task: asyncio.Task | None = None

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(list(self.items.values()), ensure_ascii=False, indent=1))

    def view(self, s: dict) -> dict:
        return {**s, "description": describe(s["schedule"])}

    def list(self) -> list[dict]:
        return [self.view(s) for s in sorted(self.items.values(), key=lambda s: -s["createdAt"])]

    def _plan(self, s: dict, now: datetime | None = None) -> None:
        last = datetime.fromtimestamp(s["lastRunAt"]) if s.get("lastRunAt") else None
        nxt = next_run(s["schedule"], now or datetime.now(), last) if s["enabled"] else None
        s["nextRunAt"] = nxt.timestamp() if nxt else None

    def create(self, title: str, prompt: str, schedule: dict, source: str = "user", owner: str | None = None) -> dict:
        if not str(prompt).strip():
            raise ScheduleError("prompt is required")
        s = {"id": uuid.uuid4().hex[:12], "title": (title or prompt)[:60].strip(), "prompt": prompt.strip(),
             "schedule": validate(schedule), "enabled": True, "createdAt": time.time(), "source": source,
             "lastRunAt": None, "nextRunAt": None, "runs": [], "owner": owner}
        self._plan(s)
        self.items[s["id"]] = s
        self.save()
        return self.view(s)

    def update(self, sid: str, patch: dict) -> dict:
        s = self.items[sid]
        if "title" in patch:
            s["title"] = str(patch["title"])[:60]
        if "prompt" in patch:
            s["prompt"] = str(patch["prompt"]).strip()
        if "schedule" in patch:
            s["schedule"] = validate(patch["schedule"])
        if "enabled" in patch:
            s["enabled"] = bool(patch["enabled"])
        self._plan(s)
        self.save()
        return self.view(s)

    def delete(self, sid: str) -> None:
        self.items.pop(sid, None)
        self.save()

    async def run(self, sid: str, now: float | None = None) -> str:
        """Start one run now as a new session; returns its id."""
        s = self.items[sid]
        session = self.store.create()
        session.title = f"{s['title']} · {datetime.now():%m-%d %H:%M}"
        session.schedule_id = sid
        session.owner = s.get("owner")
        session.persist()
        s["lastRunAt"] = now or time.time()
        s["runs"] = ([session.session_id] + s["runs"])[:50]
        self._plan(s, datetime.fromtimestamp(s["lastRunAt"]))
        self.save()
        await session.user_message(s["prompt"], [])
        log.info("schedule %s started session %s", sid, session.session_id)
        return session.session_id

    async def tick(self, now: float | None = None) -> list[str]:
        now = now or time.time()
        started = []
        for s in list(self.items.values()):
            if s["enabled"] and s.get("nextRunAt") and s["nextRunAt"] <= now:
                try:
                    started.append(await self.run(s["id"], now))
                except Exception:
                    log.exception("schedule %s failed to start", s["id"])
                if s["schedule"]["kind"] == "once":
                    s["enabled"] = False
                    self._plan(s, datetime.fromtimestamp(now))
                    self.save()
        return started

    async def loop(self, every: float = 15) -> None:
        while True:
            try:
                await self.tick()
            except Exception:
                log.exception("scheduler tick failed")
            await asyncio.sleep(every)

    def start(self) -> None:
        self.task = asyncio.create_task(self.loop())

    async def stop(self) -> None:
        if self.task:
            self.task.cancel()


scheduler: Scheduler | None = None
