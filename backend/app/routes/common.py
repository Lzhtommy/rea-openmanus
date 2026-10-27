"""Helpers the route modules share: who is asking, ownership checks, file downloads, VNC and port relays."""

from __future__ import annotations

import asyncio
import contextlib

import httpx
from urllib.parse import quote

from fastapi import HTTPException, Request, WebSocket
from fastapi.responses import FileResponse, Response
from websockets.asyncio.client import connect as ws_connect
from websockets.exceptions import WebSocketException

from .. import auth, sites, session as session_mod


def ws_user(websocket: WebSocket) -> tuple[bool, dict | None]:
    """(allowed, user) for a WebSocket: signed in, or single-user mode."""
    if not auth.store or not auth.store.enabled:
        return True, None
    user = auth.store.from_token(websocket.cookies.get(auth.COOKIE))
    return bool(user), user


def owned_session(sid: str):
    s = session_mod.store.get(sid)
    if not s or not auth.visible({"owner": s.owner}):
        raise HTTPException(404, "session not found")
    return s


def disposition(name: str) -> str:
    # Headers are latin-1: send an ASCII fallback plus the RFC 5987 UTF-8 name for non-ASCII files.
    fallback = name.encode("ascii", "replace").decode().replace("?", "_").replace('"', "_")
    return f"inline; filename=\"{fallback}\"; filename*=UTF-8''{quote(name)}"


def admin() -> dict:
    u = auth.current.get()
    if not u or u.get("role") != "admin":
        raise HTTPException(403, "需要管理员权限")
    return u


def org_admin() -> None:
    """Organization-wide settings: anyone in single-user mode, only admins once sign-in is on."""
    if auth.store and auth.store.enabled:
        admin()


def visible(item):
    if not auth.visible(item):
        raise HTTPException(404, "not found")
    return item


def own(item: dict, store) -> dict:
    """Record the current user on a just-created item and save."""
    item["owner"] = auth.owner()
    store.save()
    return item


async def relay_vnc(websocket: WebSocket, sb) -> None:
    if sb and not sb.vnc:  # x11vnc may come up after the first health check: look again
        with contextlib.suppress(httpx.HTTPError, ValueError):
            sb.info = (await sb.http.get("/health", timeout=3)).json()
    if not sb or not sb.vnc:
        await websocket.close(code=1008)
        return
    wanted = websocket.scope.get("subprotocols", [])
    try:
        upstream = await ws_connect(f"{sb.ws_url}/vnc", subprotocols=["binary"] if "binary" in wanted else None,
                                    max_size=None, open_timeout=10)
    except (OSError, WebSocketException):
        await websocket.close(code=1011)
        return
    await websocket.accept(subprotocol="binary" if "binary" in wanted else None)
    sb.viewers += 1

    async def up():
        while True:
            msg = await websocket.receive()
            if msg["type"] == "websocket.disconnect":
                return
            await upstream.send(msg.get("bytes") or (msg.get("text") or "").encode())

    async def down():
        async for data in upstream:
            await websocket.send_bytes(data if isinstance(data, bytes) else data.encode())

    tasks = [asyncio.create_task(up()), asyncio.create_task(down())]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for t in tasks:
            t.cancel()
        sb.viewers -= 1
        sb.touch()
        await upstream.close()
        with contextlib.suppress(RuntimeError):
            await websocket.close()


async def proxy_port(sb, port: int, request: Request) -> Response:
    url = f"/proxy/{port}{request.url.path}" + (f"?{request.url.query}" if request.url.query else "")
    headers = {k: v for k, v in request.headers.items() if k.lower() not in {"host", "content-length"}}
    r = await sb.http.request(request.method, url, headers=headers, content=await request.body())
    drop = {"content-encoding", "transfer-encoding", "connection", "content-length"}
    return Response(r.content, status_code=r.status_code, headers={k: v for k, v in r.headers.items() if k.lower() not in drop})


def serve_site(slug: str, path: str, sandboxed: bool) -> Response:
    s = sites.store.by_slug(slug)
    f = sites.store.file(s, path) if s else None
    if not f:
        return Response("Not found", status_code=404, media_type="text/plain")
    headers = {"Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff"}
    if sandboxed:  # path form shares OpenManus' origin: run it as an opaque origin
        headers["Content-Security-Policy"] = "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads"
    return FileResponse(f, media_type=sites.content_type(f), headers=headers)
