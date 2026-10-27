"""Triggers & advanced automation."""

from __future__ import annotations

import asyncio
import contextlib
import json

from fastapi import APIRouter, HTTPException, Request

from .. import auth, llm, triggers as triggers_mod, scheduler as scheduler_mod, session as session_mod

router = APIRouter()


def _trigger(tid: str) -> dict:
    t = triggers_mod.triggers.items.get(tid)
    if not t or not auth.visible(t):
        raise HTTPException(404, "trigger not found")
    return t


@router.get("/api/triggers")
async def list_triggers():
    return [t for t in triggers_mod.triggers.list() if auth.visible(t)]


@router.post("/api/triggers")
async def create_trigger(body: dict):
    try:
        return triggers_mod.triggers.create(body, owner=auth.owner())
    except (triggers_mod.TriggerError, ValueError) as e:
        raise HTTPException(400, str(e))


@router.patch("/api/triggers/{tid}")
async def update_trigger(tid: str, body: dict):
    _trigger(tid)
    try:
        return triggers_mod.triggers.update(tid, body)
    except (triggers_mod.TriggerError, ValueError) as e:
        raise HTTPException(400, str(e))


@router.delete("/api/triggers/{tid}")
async def delete_trigger(tid: str):
    _trigger(tid)
    await triggers_mod.triggers.delete(tid)
    return {"ok": True}


@router.post("/api/triggers/{tid}/check")
async def check_trigger(tid: str):
    """Check a condition trigger now (in the background); the result appears in its check history."""
    t = _trigger(tid)
    if t["kind"] != "condition":
        raise HTTPException(400, "only condition triggers are checked")
    if tid in triggers_mod.triggers.checking:
        raise HTTPException(409, "正在检查中")
    asyncio.create_task(triggers_mod.triggers.check(tid))
    await asyncio.sleep(0)
    return triggers_mod.triggers.view(t)


@router.post("/api/triggers/{tid}/fire")
async def fire_trigger(tid: str):
    """Run the action now, as a test (webhook: with a sample payload)."""
    t = _trigger(tid)
    ctx = ("<trigger_event source=\"manual\">\nStarted manually by the user to test this trigger; no real event "
           "payload.\n</trigger_event>")
    return {"sessionId": await triggers_mod.triggers.fire(t["id"], ctx)}


@router.post("/api/hooks/{token}")
async def webhook(token: str, request: Request):
    """Incoming webhook: the secret token identifies the trigger; the body is passed to the task as context."""
    t = triggers_mod.triggers.by_token(token)
    if not t or not t["enabled"]:
        raise HTTPException(404, "unknown or disabled hook")
    body = await request.body()
    if len(body) > 256 * 1024:
        raise HTTPException(413, "payload too large")
    ctype = request.headers.get("content-type", "")
    text = body.decode("utf-8", "replace")
    if "json" in ctype:
        with contextlib.suppress(ValueError):
            text = json.dumps(json.loads(text), ensure_ascii=False, indent=1)
    try:
        sid = await triggers_mod.triggers.webhook(t, text, ctype)
    except triggers_mod.TriggerError as e:
        raise HTTPException(429, str(e))
    return {"ok": True, "sessionId": sid}


@router.post("/api/automations/parse")
async def parse_automation(body: dict):
    """高级自动化: a description in the user's own words -> a proposed schedule / trigger (the client confirms)."""
    text = str(body.get("text") or "").strip()
    if len(text) < 4:
        raise HTTPException(400, "请描述你希望 OpenManus 何时做什么")
    from datetime import datetime
    r = await llm.parse_automation(text, datetime.now().strftime("%Y-%m-%d %H:%M (%A)"))
    if not r:
        raise HTTPException(502, "解析失败，请换个说法再试")
    return r


@router.get("/api/automations/activity")
async def automation_activity():
    """动态: every automated run (schedules and triggers) and condition checks, newest first."""
    names = {**{s["id"]: ("schedule", s["title"]) for s in scheduler_mod.scheduler.items.values()},
             **{t["id"]: (t["kind"], t["title"]) for t in triggers_mod.triggers.items.values()}}
    items = []
    for s in session_mod.store.sessions.values():
        src = s.schedule_id or s.trigger_id
        if not src or not auth.visible({"owner": s.owner}):
            continue
        kind, title = names.get(src, ("schedule" if s.schedule_id else "trigger", "（已删除的自动化）"))
        files = [{"filename": f["filename"], "url": s.file_url(f["path"])} for f in s.files.values() if "deliverable" in f["kinds"]]
        items.append({"type": "run", "at": s.created_at, "sessionId": s.session_id, "title": s.title, "status": s.status,
                      "source": {"id": src, "kind": kind, "title": title}, "files": files[:4]})
    for t in triggers_mod.triggers.items.values():
        if not auth.visible(t):
            continue
        for c in t.get("checks", []):
            if not c.get("sessionId"):
                items.append({"type": "check", "at": c["at"], "met": c["met"], "summary": c["summary"],
                              "source": {"id": t["id"], "kind": "condition", "title": t["title"]}})
    return sorted(items, key=lambda x: -x["at"])[:200]
