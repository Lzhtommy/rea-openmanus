"""Developer API (开发者): API keys, the /api/v1 task API, and incoming integration events (Feishu)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from .. import apikeys, auth, feishu_bot, config, session as session_mod
from .common import owned_session, visible

router = APIRouter()


@router.get("/api/keys")
async def list_keys():
    return [apikeys.ApiKeys.public(k) for k in apikeys.store.items.values() if auth.visible(k)]


@router.post("/api/keys")
async def create_key(body: dict | None = None):
    k, key = apikeys.store.create(str((body or {}).get("name") or ""), auth.owner())
    return {**k, "key": key}


@router.delete("/api/keys/{kid}")
async def delete_key(kid: str):
    visible(apikeys.store.items.get(kid))
    apikeys.store.delete(kid)
    return {"ok": True}


def _api_user(request: Request) -> None:
    """/api/v1 calls authenticate with `Authorization: Bearer om_...` and run as the key's owner."""
    key = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
    k = apikeys.store.check(key) if key else None
    if not k:
        raise HTTPException(401, "invalid API key")
    auth.current.set(auth.store.items.get(k["owner"]) if k.get("owner") else None)


def _task_view(s) -> dict:
    result = next((e["content"] for e in reversed(s.events) if e["type"] == "chat" and e["sender"] == "assistant"), None)
    files = [{"name": f["filename"], "url": f"{config.PUBLIC_BASE_URL}{s.file_url(f['path'])}"} for f in s.files.values()
             if "deliverable" in f["kinds"]]
    return {"id": s.session_id, "title": s.title, "status": s.status, "url": f"{config.PUBLIC_BASE_URL}/#{s.session_id}",
            "result": result, "files": files, "usage": s.usage}


@router.post("/api/v1/tasks")
async def api_create_task(body: dict, request: Request):
    """Start a task: {"prompt": "...", "mode": "max|standard|lite"} -> {id, url, status}."""
    _api_user(request)
    prompt = str(body.get("prompt") or "").strip()
    if not prompt:
        raise HTTPException(400, "prompt is required")
    s = session_mod.store.create()
    s.owner = auth.owner()
    s.select_model({"mode": body["mode"]} if body.get("mode") else None)
    s.persist()
    await s.user_message(prompt, [])
    return _task_view(s)


@router.get("/api/v1/tasks/{sid}")
async def api_get_task(sid: str, request: Request):
    _api_user(request)
    return _task_view(owned_session(sid))


@router.post("/api/v1/tasks/{sid}/messages")
async def api_task_message(sid: str, body: dict, request: Request):
    """A follow-up or a reply to a question the task asked."""
    _api_user(request)
    s = owned_session(sid)
    await s.user_message(str(body.get("content") or ""), [])
    return _task_view(s)


@router.post("/api/integrations/feishu/events")
async def feishu_events(body: dict):
    """Feishu event subscription: url verification, and messages to the bot become tasks."""
    if body.get("encrypt"):
        raise HTTPException(400, "turn off event encryption for this app (or leave the Encrypt Key empty)")
    return await feishu_bot.handle(body, session_mod.store)
