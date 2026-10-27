"""Devices (连接您的设备)."""

from __future__ import annotations

import asyncio
import contextlib

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse

from .. import auth, config, devices, session as session_mod
from ..sandbox import manager

router = APIRouter()


def _device(did: str) -> dict:
    d = devices.store.items.get(did)
    if not d or not auth.visible(d):
        raise HTTPException(404, "device not found")
    return d


@router.get("/api/devices")
async def list_devices():
    return {"devices": [d for d in devices.store.list() if auth.visible(d)],
            "tasks": {did: [s.session_id for s in session_mod.store.sessions.values() if s.device_id == did] for did in devices.store.items}}


@router.post("/api/devices")
async def create_device(body: dict | None = None):
    """Pair a new computer: the token is returned once, with the command to run on that machine."""
    d, token = devices.store.create(str((body or {}).get("name") or ""))
    devices.store.items[d["id"]]["owner"] = d["owner"] = auth.owner()
    devices.store.save()
    return {"device": d, "token": token, "server": config.PUBLIC_BASE_URL}


@router.patch("/api/devices/{did}")
async def update_device(did: str, body: dict):
    _device(did)
    if "name" in body:
        devices.store.items[did]["renamed"] = True
    return devices.store.update(did, body)


@router.delete("/api/devices/{did}")
async def delete_device(did: str):
    _device(did)
    for s in session_mod.store.sessions.values():
        if s.device_id == did:
            await s.stop()
    if live := devices.store.live.get(did):
        with contextlib.suppress(Exception):
            await live.ws.close(code=4001)
    await manager.destroy(devices.sandbox_id(did))
    devices.store.delete(did)
    return {"ok": True}


@router.get("/api/devices/{name}.py")
async def device_scripts(name: str):
    """The connector and the action server it runs, for machines without a checkout of this repo."""
    files = {"agent": config.ROOT / "device" / "openmanus_device.py", "server": config.SANDBOX_DIR / "server.py"}
    if name not in files:
        raise HTTPException(404)
    return FileResponse(files[name], media_type="text/x-python", headers={"Content-Disposition": f'attachment; filename="{files[name].name}"'})


@router.websocket("/api/devices/connect")
async def device_connect(websocket: WebSocket, token: str = ""):
    """The connector's tunnel: it says hello, then answers the HTTP requests we send it."""
    d = devices.store.by_token(token)
    await websocket.accept()
    if not d:
        await websocket.send_json({"type": "error", "message": "unknown device token: create the device again on the 电脑 page"})
        await websocket.close(code=4003)
        return
    try:
        hello = await asyncio.wait_for(websocket.receive_json(), 15)
    except (asyncio.TimeoutError, WebSocketDisconnect, ValueError):
        await websocket.close(code=4000)
        return
    live = devices.store.attach(d["id"], websocket, hello)
    stale = manager.sandboxes.get(devices.sandbox_id(d["id"]))  # workdir may have changed: re-attach lazily
    if stale and stale.workdir != hello.get("workdir"):
        await manager.stop(devices.sandbox_id(d["id"]))
    try:
        while True:
            msg = await websocket.receive_json()
            if msg.get("type") == "response":
                live.resolve(msg)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        devices.store.detach(d["id"], live)
