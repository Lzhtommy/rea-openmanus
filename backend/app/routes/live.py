"""The live task: the /ws event stream, the sandbox screen (VNC), screenshots, port previews, and the file library.

WebSocket /ws speaks the same shape of protocol as Manus' web client:
  client -> server: {"type": "join_session", "sessionId", "lastSeq"}
                    {"type": "leave_session", "sessionId"}
                    {"type": "user_message", "sessionId", "content", "attachments": [paths]}
                    {"type": "stop_session", "sessionId"}
  server -> client: {"type": "event", "sessionId", "event": {...}}
                    {"type": "session", "session": meta}
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response

from .. import auth, session as session_mod
from ..sandbox import manager
from .common import ws_user, owned_session, relay_vnc

router = APIRouter()


@router.get("/api/library")
async def library():
    """Every kept file across tasks, newest first (Manus' 资料库)."""
    items = []
    for s in session_mod.store.sessions.values():
        if not auth.visible({"owner": s.owner}):
            continue
        for f in s.files.values():
            items.append({**{k: f[k] for k in ("path", "filename", "size", "kinds", "mime", "createdAt", "updatedAt")},
                          "sessionId": s.session_id, "sessionTitle": s.title, "url": s.file_url(f["path"])})
    return sorted(items, key=lambda x: -x["updatedAt"])


@router.get("/api/sessions/{sid}/shots/{name}")
async def shot(sid: str, name: str):
    p = (owned_session(sid).dir / "shots" / name).resolve()
    if p.parent.name != "shots" or not p.is_file():
        raise HTTPException(404)
    return FileResponse(p, media_type="image/jpeg")


@router.api_route("/preview/{sid}/{port}/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"])
async def preview(sid: str, port: int, path: str, request: Request):
    """Expose a port inside the sandbox (deploy_expose_port) through the sandbox proxy."""
    sb = await manager.get(owned_session(sid).sandbox_id)
    url = f"/proxy/{port}/{path}" + (f"?{request.url.query}" if request.url.query else "")
    headers = {k: v for k, v in request.headers.items() if k.lower() not in {"host", "content-length"}}
    r = await sb.http.request(request.method, url, headers=headers, content=await request.body())
    drop = {"content-encoding", "transfer-encoding", "connection", "content-length"}
    return Response(r.content, status_code=r.status_code,
                    headers={k: v for k, v in r.headers.items() if k.lower() not in drop})


@router.websocket("/ws")
async def ws(websocket: WebSocket):
    allowed, user = ws_user(websocket)
    await websocket.accept()
    if not allowed:
        await websocket.close(code=4401)
        return
    auth.current.set(user)
    queue: asyncio.Queue = asyncio.Queue()
    joined: dict[str, session_mod.Session] = {}

    async def sender():
        while True:
            await websocket.send_json(await queue.get())

    send_task = asyncio.create_task(sender())
    try:
        while True:
            msg = await websocket.receive_json()
            kind, sid = msg.get("type"), msg.get("sessionId")
            s = session_mod.store.get(sid) if sid else None
            if not s or not auth.visible({"owner": s.owner}):
                await websocket.send_json({"type": "error", "message": f"unknown session {sid}"})
                continue
            if kind == "join_session":
                s.subscribers.add(queue)
                joined[sid] = s
                for m in s.replay_after(int(msg.get("lastSeq", -1))):
                    queue.put_nowait(m)
                queue.put_nowait({"type": "session", "session": s.meta()})
            elif kind == "leave_session":
                s.subscribers.discard(queue)
                joined.pop(sid, None)
            elif kind == "user_message":
                text = (msg.get("content") or "").strip()
                s.select_model(msg.get("model"))
                if text:
                    await s.user_message(text, msg.get("attachments") or [], msg.get("skills") or [],
                                         queue=msg.get("deliveryMode") == "queue", confirm_plan=bool(msg.get("confirmPlan")))
            elif kind == "stop_session":
                await s.stop()
            elif kind == "map_reduce_control":
                idx = msg.get("index")
                s.control_map_reduce(str(msg.get("actionId")), str(msg.get("op")), int(idx) if idx is not None else None)
            elif kind == "confirm_plan":
                s.resolve_plan(bool(msg.get("approved")), msg.get("steps"))
            elif kind == "confirm_action":
                s.resolve_confirm(str(msg.get("actionId")), bool(msg.get("approved")))
    except WebSocketDisconnect:
        pass
    finally:
        send_task.cancel()
        for s in joined.values():
            s.subscribers.discard(queue)


@router.websocket("/api/sessions/{sid}/vnc")
async def vnc(websocket: WebSocket, sid: str):
    """Relay the sandbox's live screen (VNC over WebSocket) to the web client, like Manus' vncUrl."""
    allowed, user = ws_user(websocket)
    s = session_mod.store.get(sid)
    if not allowed or (s and user and s.owner != user["id"]):
        s = None
    await relay_vnc(websocket, manager.sandboxes.get(s.sandbox_id) if s else None)
