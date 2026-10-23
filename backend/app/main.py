"""HTTP + WebSocket API.

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
import contextlib
import json
import logging
import secrets
import time

import httpx
from urllib.parse import quote

from fastapi import FastAPI, File, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from websockets.asyncio.client import connect as ws_connect
from websockets.exceptions import WebSocketException

from . import config, connectors, llm, providers, scheduler as scheduler_mod, session as session_mod
from .sandbox import manager

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    session_mod.store = session_mod.SessionStore()
    scheduler_mod.scheduler = scheduler_mod.Scheduler(session_mod.store)
    scheduler_mod.scheduler.start()
    connectors.manager = connectors.Connectors()
    asyncio.create_task(connectors.manager.start_all())
    yield
    await scheduler_mod.scheduler.stop()
    await connectors.manager.stop_all()
    for s in session_mod.store.sessions.values():
        if s.task and not s.task.done():
            s.task.cancel()
    await manager.shutdown()


app = FastAPI(title="Manus-like agent platform", lifespan=lifespan)


def _session(sid: str):
    s = session_mod.store.get(sid)
    if not s:
        raise HTTPException(404, "session not found")
    return s


@app.get("/api/sessions")
async def list_sessions():
    return session_mod.store.list()


@app.post("/api/sessions")
async def create_session():
    return session_mod.store.create().meta()


@app.get("/api/sessions/{sid}")
async def get_session(sid: str):
    s = _session(sid)
    return {**s.meta(), "events": s.events}


@app.delete("/api/sessions/{sid}")
async def delete_session(sid: str):
    await session_mod.store.delete(sid)
    return {"ok": True}


@app.post("/api/sessions/{sid}/upload")
async def upload(sid: str, file: UploadFile = File(...)):
    sb = await manager.get(_session(sid).session_id)
    r = await sb.http.post("/file/upload", files={"file": (file.filename, await file.read())},
                           data={"dir": f"{sb.workdir}/upload"})
    if r.status_code >= 400:
        raise HTTPException(r.status_code, r.text)
    info = r.json()
    await _session(sid).keep_file(info["path"], "upload")
    return info


def _disposition(name: str) -> str:
    # Headers are latin-1: send an ASCII fallback plus the RFC 5987 UTF-8 name for non-ASCII files.
    fallback = name.encode("ascii", "replace").decode().replace("?", "_").replace('"', "_")
    return f"inline; filename=\"{fallback}\"; filename*=UTF-8''{quote(name)}"


@app.get("/api/sessions/{sid}/files")
async def download(sid: str, path: str):
    """Live from the running sandbox when possible, else the stored copy (the sandbox may be gone)."""
    s = _session(sid)
    name = path.rsplit("/", 1)[-1]
    sb = manager.sandboxes.get(sid)
    if sb:
        try:
            r = await sb.http.get("/file/download", params={"path": path})
        except httpx.HTTPError:  # container gone: fall back to the stored copy
            r, sb = None, None
        if r is not None and r.status_code < 400:
            return Response(r.content, media_type=r.headers.get("content-type", "application/octet-stream"),
                            headers={"Content-Disposition": _disposition(name)})
    if kept := s.stored_file(path):
        p, meta = kept
        return FileResponse(p, media_type=meta.get("mime"), headers={"Content-Disposition": _disposition(name)})
    if sb:
        raise HTTPException(404, "file not found")
    sb = await manager.get(sid)  # nothing stored: start the sandbox and try there
    r = await sb.http.get("/file/download", params={"path": path})
    if r.status_code >= 400:
        raise HTTPException(r.status_code, "file not found")
    return Response(r.content, media_type=r.headers.get("content-type", "application/octet-stream"),
                    headers={"Content-Disposition": _disposition(name)})


# ------------------------------------------------------------- share (read-only replay) ---

def _shared(token: str) -> session_mod.Session:
    for s in session_mod.store.sessions.values():
        if s.share and secrets.compare_digest(s.share["token"], token):
            return s
    raise HTTPException(404, "share link not found or revoked")


@app.post("/api/sessions/{sid}/share")
async def create_share(sid: str):
    s = _session(sid)
    if not s.share:
        s.share = {"token": secrets.token_urlsafe(16), "createdAt": time.time()}
        s.persist()
    return {"token": s.share["token"], "url": f"{config.PUBLIC_BASE_URL}/#share/{s.share['token']}"}


@app.delete("/api/sessions/{sid}/share")
async def revoke_share(sid: str):
    s = _session(sid)
    s.share = None
    s.persist()
    return {"ok": True}


@app.get("/api/share/{token}")
async def get_share(token: str):
    """The task as a replay: events with file/screenshot URLs scoped to this share link."""
    s = _shared(token)
    events = [e for e in s.events if e["type"] not in ("explanation",)]
    body = json.dumps({"title": s.title, "status": s.status, "plan": s.plan, "createdAt": s.created_at,
                       "model": s.model_selection, "events": events}, ensure_ascii=False)
    body = body.replace(f"/api/sessions/{s.session_id}/", f"/api/share/{token}/")
    return Response(body, media_type="application/json")


@app.get("/api/share/{token}/shots/{name}")
async def share_shot(token: str, name: str):
    return await shot(_shared(token).session_id, name)


@app.get("/api/share/{token}/files")
async def share_file(token: str, path: str):
    s = _shared(token)
    if path not in s.files and not any(path == a.get("path") for e in s.events if e["type"] == "chat"
                                       for a in e.get("attachments") or []):
        raise HTTPException(404, "file not part of this task")
    return await download(s.session_id, path)


# ------------------------------------------------------------- models (modes + Flex) ---

_gateway_models: list[str] = []


@app.get("/api/models")
async def models():
    """Modes over the gateway and the Flex providers (keys never leave the server)."""
    global _gateway_models
    if not _gateway_models and config.LLM_BASE_URL and config.LLM_API_KEY:
        try:
            _gateway_models = await llm.list_models(config.LLM_BASE_URL, config.LLM_API_KEY)
        except Exception:
            _gateway_models = []
    mm = providers.mode_models()
    return {"default": config.DEFAULT_MODE,
            "modes": [{**m, "model": mm.get(m["id"], "")} for m in providers.MODES],
            "gatewayModels": _gateway_models,
            "providers": providers.store.catalog()}


async def _probe(base: str, key: str, model: str) -> list[str]:
    """Connection test: list models, or (when the endpoint has no /models) a one-token completion."""
    import openai

    def why(e: Exception) -> str:  # the provider's own message, not the raw response dump
        body = getattr(e, "body", None)
        err = body.get("error", body) if isinstance(body, dict) else None
        return str(err.get("message") if isinstance(err, dict) else getattr(e, "message", e))[:200]
    try:
        return await llm.list_models(base, key)
    except openai.AuthenticationError as e:
        raise HTTPException(400, f"API 密钥无效：{why(e)}")
    except (openai.NotFoundError, openai.BadRequestError):
        if not model:
            raise HTTPException(400, "该提供商不支持列出模型，请填写模型名称后再连接")
    except openai.OpenAIError as e:
        raise HTTPException(400, f"连接失败：{why(e)}")
    try:
        c = openai.AsyncOpenAI(api_key=key, base_url=base, max_retries=0, timeout=30)
        await c.chat.completions.create(model=model, messages=[{"role": "user", "content": "ping"}], max_tokens=1)
        await c.close()
        return [model]
    except openai.OpenAIError as e:
        raise HTTPException(400, f"连接失败：{why(e)}")


@app.put("/api/providers/{pid}")
async def set_provider(pid: str, body: dict):
    if pid not in providers.CATALOG or pid == "litellm":
        raise HTTPException(404, "unknown provider")
    base = (body.get("baseUrl") or providers.store.public(pid)["baseUrl"]).strip()
    key = (body.get("apiKey") or providers.store.credentials(pid)[1]).strip()
    if not base or not key:
        raise HTTPException(400, "请填写 API 密钥" + ("和 Base URL" if not base else ""))
    found = await _probe(base, key, (body.get("model") or "").strip())
    model = (body.get("model") or "").strip() or providers.store.public(pid)["model"]
    if found and model not in found:
        model = found[0] if not model else model
    info = providers.store.set(pid, key, base, model)
    return {**info, "models": found}


@app.delete("/api/providers/{pid}")
async def delete_provider(pid: str):
    providers.store.delete(pid)
    return {"ok": True}


@app.get("/api/providers/{pid}/models")
async def provider_models(pid: str):
    if pid not in providers.CATALOG:
        raise HTTPException(404, "unknown provider")
    base, key = providers.store.credentials(pid)
    if not key:
        raise HTTPException(400, "provider not configured")
    try:
        return await llm.list_models(base, key)
    except Exception as e:
        raise HTTPException(400, f"无法获取模型列表：{e}")


# ------------------------------------------------------------- connectors (MCP) ---

@app.get("/api/connectors")
async def list_connectors():
    return connectors.manager.list()


@app.post("/api/connectors")
async def create_connector(body: dict):
    try:
        return await connectors.manager.upsert(body)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.patch("/api/connectors/{cid}")
async def update_connector(cid: str, body: dict):
    if cid not in connectors.manager.items:
        raise HTTPException(404, "connector not found")
    try:
        return await connectors.manager.upsert({**connectors.manager.items[cid], **body}, cid)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.delete("/api/connectors/{cid}")
async def delete_connector(cid: str):
    await connectors.manager.delete(cid)
    return {"ok": True}


@app.post("/api/connectors/{cid}/restart")
async def restart_connector(cid: str):
    if cid not in connectors.manager.items:
        raise HTTPException(404, "connector not found")
    await connectors.manager.restart(cid)
    return connectors.manager.public(connectors.manager.items[cid])


# ------------------------------------------------------------- schedules (自动化) ---

def _sched(sid: str) -> dict:
    s = scheduler_mod.scheduler.items.get(sid)
    if not s:
        raise HTTPException(404, "schedule not found")
    return s


@app.get("/api/schedules")
async def list_schedules():
    return scheduler_mod.scheduler.list()


@app.post("/api/schedules")
async def create_schedule(body: dict):
    try:
        return scheduler_mod.scheduler.create(body.get("title", ""), body.get("prompt", ""), body.get("schedule") or {})
    except scheduler_mod.ScheduleError as e:
        raise HTTPException(400, str(e))


@app.patch("/api/schedules/{sid}")
async def update_schedule(sid: str, body: dict):
    _sched(sid)
    try:
        return scheduler_mod.scheduler.update(sid, body)
    except scheduler_mod.ScheduleError as e:
        raise HTTPException(400, str(e))


@app.delete("/api/schedules/{sid}")
async def delete_schedule(sid: str):
    _sched(sid)
    scheduler_mod.scheduler.delete(sid)
    return {"ok": True}


@app.post("/api/schedules/{sid}/run")
async def run_schedule(sid: str):
    _sched(sid)
    return {"sessionId": await scheduler_mod.scheduler.run(sid)}


@app.get("/api/library")
async def library():
    """Every kept file across tasks, newest first (Manus' 资料库)."""
    items = []
    for s in session_mod.store.sessions.values():
        for f in s.files.values():
            items.append({**{k: f[k] for k in ("path", "filename", "size", "kinds", "mime", "createdAt", "updatedAt")},
                          "sessionId": s.session_id, "sessionTitle": s.title, "url": s.file_url(f["path"])})
    return sorted(items, key=lambda x: -x["updatedAt"])


@app.get("/api/sessions/{sid}/shots/{name}")
async def shot(sid: str, name: str):
    p = (_session(sid).dir / "shots" / name).resolve()
    if p.parent.name != "shots" or not p.is_file():
        raise HTTPException(404)
    return FileResponse(p, media_type="image/jpeg")


@app.api_route("/preview/{sid}/{port}/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"])
async def preview(sid: str, port: int, path: str, request: Request):
    """Expose a port inside the sandbox (deploy_expose_port) through the sandbox proxy."""
    sb = await manager.get(_session(sid).session_id)
    url = f"/proxy/{port}/{path}" + (f"?{request.url.query}" if request.url.query else "")
    headers = {k: v for k, v in request.headers.items() if k.lower() not in {"host", "content-length"}}
    r = await sb.http.request(request.method, url, headers=headers, content=await request.body())
    drop = {"content-encoding", "transfer-encoding", "connection", "content-length"}
    return Response(r.content, status_code=r.status_code,
                    headers={k: v for k, v in r.headers.items() if k.lower() not in drop})


@app.websocket("/ws")
async def ws(websocket: WebSocket):
    await websocket.accept()
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
            if not s:
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
                    await s.user_message(text, msg.get("attachments") or [])
            elif kind == "stop_session":
                await s.stop()
            elif kind == "map_reduce_control":
                idx = msg.get("index")
                s.control_map_reduce(str(msg.get("actionId")), str(msg.get("op")), int(idx) if idx is not None else None)
            elif kind == "confirm_action":
                s.resolve_confirm(str(msg.get("actionId")), bool(msg.get("approved")))
    except WebSocketDisconnect:
        pass
    finally:
        send_task.cancel()
        for s in joined.values():
            s.subscribers.discard(queue)


@app.websocket("/api/sessions/{sid}/vnc")
async def vnc(websocket: WebSocket, sid: str):
    """Relay the sandbox's live screen (VNC over WebSocket) to the web client, like Manus' vncUrl."""
    s = session_mod.store.get(sid)
    sb = manager.sandboxes.get(sid) if s else None
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
        await upstream.close()
        with contextlib.suppress(RuntimeError):
            await websocket.close()


@app.get("/api/config")
async def get_config():
    return {"model": config.MODEL, "defaultMode": config.DEFAULT_MODE, "sandbox": config.SANDBOX_MODE, "planner": config.PLANNER_ENABLED,
            "search": "tavily" if config.TAVILY_API_KEY else "duckduckgo"}


@app.middleware("http")
async def no_cache_static(request: Request, call_next):
    """The UI is plain files without build hashes: make browsers revalidate them."""
    response = await call_next(request)
    if not request.url.path.startswith(("/api/", "/preview/")):
        response.headers["Cache-Control"] = "no-cache"
    return response


app.mount("/", StaticFiles(directory=str(config.STATIC_DIR), html=True), name="static")
