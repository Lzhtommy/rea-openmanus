"""Cloud computers (电脑)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, WebSocket

from .. import auth, computers, session as session_mod
from ..sandbox import manager
from .common import ws_user, relay_vnc

router = APIRouter()


def _computer(cid: str) -> dict:
    c = computers.store.items.get(cid)
    if not c or not auth.visible(c):
        raise HTTPException(404, "computer not found")
    return c


@router.get("/api/computers")
async def list_computers():
    return {"computers": [c for c in computers.store.list() if auth.visible(c)], **computers.store.catalog(),
            "tasks": {cid: [s.session_id for s in session_mod.store.sessions.values() if s.computer_id == cid]
                      for cid in computers.store.items}}


@router.post("/api/computers")
async def create_computer(body: dict):
    try:
        c = computers.store.create(body)
        computers.store.items[c["id"]]["owner"] = auth.owner()
        computers.store.save()
        return {**c, "owner": auth.owner()}
    except computers.ComputerError as e:
        raise HTTPException(400, str(e))


@router.patch("/api/computers/{cid}")
async def update_computer(cid: str, body: dict):
    _computer(cid)
    try:
        return computers.store.update(cid, body)
    except (computers.ComputerError, ValueError) as e:
        raise HTTPException(400, str(e))


@router.post("/api/computers/{cid}/start")
async def start_computer(cid: str):
    _computer(cid)
    return await computers.store.start(cid)


@router.post("/api/computers/{cid}/stop")
async def stop_computer(cid: str):
    _computer(cid)
    if any(s.computer_id == cid and s.task and not s.task.done() for s in session_mod.store.sessions.values()):
        raise HTTPException(409, "这台电脑上还有任务在运行")
    return await computers.store.stop(cid)


@router.delete("/api/computers/{cid}")
async def delete_computer(cid: str):
    _computer(cid)
    for s in session_mod.store.sessions.values():  # tasks stay; they lose the machine
        if s.computer_id == cid:
            await s.stop()
            s.computer_id = None
            s.persist()
    await computers.store.delete(cid)
    return {"ok": True}


@router.post("/api/computers/{cid}/exec")
async def computer_exec(cid: str, body: dict):
    _computer(cid)
    from ..sandbox import SandboxError
    try:
        return await computers.store.exec(cid, str(body.get("command") or ""))
    except SandboxError as e:
        raise HTTPException(400, str(e))


@router.websocket("/api/computers/{cid}/vnc")
async def computer_vnc(websocket: WebSocket, cid: str):
    """The computer's desktop, like a task's live screen."""
    allowed, user = ws_user(websocket)
    c = computers.store.items.get(cid)
    sb = manager.sandboxes.get(computers.sandbox_id(cid)) if c and allowed and (not user or c.get("owner") == user["id"]) else None
    await relay_vnc(websocket, sb)
