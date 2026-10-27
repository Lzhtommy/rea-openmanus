"""Schedules (自动化)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from .. import auth, scheduler as scheduler_mod

router = APIRouter()


def _sched(sid: str) -> dict:
    s = scheduler_mod.scheduler.items.get(sid)
    if not s or not auth.visible(s):
        raise HTTPException(404, "schedule not found")
    return s


@router.get("/api/schedules")
async def list_schedules():
    return [x for x in scheduler_mod.scheduler.list() if auth.visible(x)]


@router.post("/api/schedules")
async def create_schedule(body: dict):
    try:
        return scheduler_mod.scheduler.create(body.get("title", ""), body.get("prompt", ""), body.get("schedule") or {}, owner=auth.owner())
    except scheduler_mod.ScheduleError as e:
        raise HTTPException(400, str(e))


@router.patch("/api/schedules/{sid}")
async def update_schedule(sid: str, body: dict):
    _sched(sid)
    try:
        return scheduler_mod.scheduler.update(sid, body)
    except scheduler_mod.ScheduleError as e:
        raise HTTPException(400, str(e))


@router.delete("/api/schedules/{sid}")
async def delete_schedule(sid: str):
    _sched(sid)
    scheduler_mod.scheduler.delete(sid)
    return {"ok": True}


@router.post("/api/schedules/{sid}/run")
async def run_schedule(sid: str):
    _sched(sid)
    return {"sessionId": await scheduler_mod.scheduler.run(sid)}
