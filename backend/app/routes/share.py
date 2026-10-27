"""Share (read-only replay)."""

from __future__ import annotations

import json
import secrets
import time

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from .. import config, session as session_mod
from .common import owned_session
from .live import shot
from .sessions import download

router = APIRouter()


def _shared(token: str) -> session_mod.Session:
    for s in session_mod.store.sessions.values():
        if s.share and secrets.compare_digest(s.share["token"], token):
            return s
    raise HTTPException(404, "share link not found or revoked")


@router.post("/api/sessions/{sid}/share")
async def create_share(sid: str):
    s = owned_session(sid)
    if not s.share:
        s.share = {"token": secrets.token_urlsafe(16), "createdAt": time.time()}
        s.persist()
    return {"token": s.share["token"], "url": f"{config.PUBLIC_BASE_URL}/#share/{s.share['token']}"}


@router.delete("/api/sessions/{sid}/share")
async def revoke_share(sid: str):
    s = owned_session(sid)
    s.share = None
    s.persist()
    return {"ok": True}


@router.get("/api/share/{token}")
async def get_share(token: str):
    """The task as a replay: events with file/screenshot URLs scoped to this share link."""
    s = _shared(token)
    events = [e for e in s.events if e["type"] not in ("explanation",)]
    body = json.dumps({"title": s.title, "status": s.status, "plan": s.plan, "createdAt": s.created_at,
                       "model": s.model_selection, "events": events}, ensure_ascii=False)
    body = body.replace(f"/api/sessions/{s.session_id}/", f"/api/share/{token}/")
    return Response(body, media_type="application/json")


@router.get("/api/share/{token}/shots/{name}")
async def share_shot(token: str, name: str):
    return await shot(_shared(token).session_id, name)


@router.get("/api/share/{token}/files")
async def share_file(token: str, path: str):
    s = _shared(token)
    if path not in s.files and not any(path == a.get("path") for e in s.events if e["type"] == "chat"
                                       for a in e.get("attachments") or []):
        raise HTTPException(404, "file not part of this task")
    return await download(s.session_id, path)
