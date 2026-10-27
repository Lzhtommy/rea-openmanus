"""Skill recorder (技能录制器)."""

from __future__ import annotations

import httpx

from fastapi import APIRouter, HTTPException, WebSocket

from .. import auth, devices, recordings
from ..sandbox import manager
from .common import ws_user, relay_vnc

router = APIRouter()


def _recording(rid: str) -> dict:
    r = recordings.store.items.get(rid)
    if not r or not auth.visible(r):
        raise HTTPException(404, "recording not found")
    return r


@router.post("/api/recordings")
async def start_recording(body: dict):
    """Start recording in a cloud browser ("cloud") or the user's own browser on a device ("dev:<id>")."""
    from ..sandbox import SandboxError
    target = str(body.get("target") or "cloud")
    if target.startswith("dev:") and not auth.visible(devices.store.items.get(target[4:])):
        raise HTTPException(404, "device not found")
    try:
        return await recordings.store.start(target, str(body.get("url") or "").strip(), auth.owner())
    except SandboxError as e:
        raise HTTPException(400, str(e))


@router.get("/api/recordings/{rid}/events")
async def recording_events(rid: str):
    _recording(rid)
    try:
        return await recordings.store.events(rid)
    except (recordings.RecordingError, httpx.HTTPError) as e:
        raise HTTPException(400, str(e))


@router.post("/api/recordings/{rid}/stop")
async def stop_recording(rid: str, body: dict | None = None):
    _recording(rid)
    try:
        return await recordings.store.stop(rid, str((body or {}).get("notes") or ""))
    except recordings.RecordingError as e:
        raise HTTPException(400, str(e))


@router.delete("/api/recordings/{rid}")
async def cancel_recording(rid: str):
    _recording(rid)
    await recordings.store.cancel(rid)
    return {"ok": True}


@router.websocket("/api/recordings/{rid}/vnc")
async def recording_vnc(websocket: WebSocket, rid: str):
    allowed, user = ws_user(websocket)
    r = recordings.store.items.get(rid)
    if not allowed or (r and user and r.get("owner") != user["id"]):
        r = None
    await relay_vnc(websocket, manager.sandboxes.get(recordings.store.sandbox_id(r)) if r else None)
