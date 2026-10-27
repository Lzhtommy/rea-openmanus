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
import re
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

from . import agents, apikeys, auth, computers, feishu_bot, mail, config, connectors, devices, recordings, llm, media, personal, plugins, sites, projects, skills, triggers as triggers_mod, providers, scheduler as scheduler_mod, session as session_mod, storage
from .sandbox import manager

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    auth.store = auth.Users()
    apikeys.store = apikeys.ApiKeys()
    session_mod.store = session_mod.SessionStore()
    projects.store = projects.Projects()
    personal.store = personal.Personal()
    skills.store = skills.Skills()
    sites.store = sites.Sites()
    computers.store = computers.Computers()
    devices.store = devices.Devices()
    recordings.store = recordings.Recordings()
    agents.store = agents.Agents()
    asyncio.create_task(computers.store.resume())
    scheduler_mod.scheduler = scheduler_mod.Scheduler(session_mod.store)
    scheduler_mod.scheduler.start()
    triggers_mod.triggers = triggers_mod.Triggers(session_mod.store)
    triggers_mod.triggers.start()
    mail.poller = mail.MailManus(session_mod.store)
    mail.poller.start()
    def users(sbid: str) -> list:  # sessions acting in this sandbox (a computer can serve many)
        return [s for s in session_mod.store.sessions.values() if s.sandbox_id == sbid]

    def busy(sbid: str) -> bool:
        return any((s.task and not s.task.done()) or s.pending_confirms or s.status in ("running", "waiting") for s in users(sbid))

    def stopped(sbid: str) -> None:
        for s in users(sbid):
            asyncio.create_task(s.emit({"type": "sandboxUpdate", "sandboxId": sbid, "status": "stopped", "vnc": False}))

    manager.busy, manager.on_stopped = busy, stopped
    manager.reaper = asyncio.create_task(manager.reap_loop())
    connectors.manager = connectors.Connectors()
    asyncio.create_task(connectors.manager.start_all())
    yield
    await scheduler_mod.scheduler.stop()
    await triggers_mod.triggers.stop()
    await connectors.manager.stop_all()
    for s in session_mod.store.sessions.values():
        if s.task and not s.task.done():
            s.task.cancel()
    await manager.shutdown()


app = FastAPI(title="Manus-like agent platform", lifespan=lifespan)

# Paths that work without signing in: sign-in itself, public share replays, incoming webhooks (secret URL),
# the device connector (device token) and its downloads.
OPEN_PATHS = ("/api/integrations/", "/api/v1/", "/api/auth/", "/api/share/", "/api/hooks/", "/api/devices/connect", "/api/devices/agent.py", "/api/devices/server.py",
              "/api/config")


@app.middleware("http")
async def auth_gate(request: Request, call_next):
    """Multi-user mode: every API call runs as the signed-in user (auth.current), or gets 401."""
    if not request.url.path.startswith("/api/") or not auth.store or not auth.store.enabled:
        return await call_next(request)
    user = auth.store.from_token(request.cookies.get(auth.COOKIE))
    if not user and not request.url.path.startswith(OPEN_PATHS):
        return Response(json.dumps({"detail": "请先登录"}), status_code=401, media_type="application/json")
    token = auth.current.set(user)
    try:
        return await call_next(request)
    finally:
        auth.current.reset(token)


def _ws_user(websocket: WebSocket) -> tuple[bool, dict | None]:
    """(allowed, user) for a WebSocket: signed in, or single-user mode."""
    if not auth.store or not auth.store.enabled:
        return True, None
    user = auth.store.from_token(websocket.cookies.get(auth.COOKIE))
    return bool(user), user


# ------------------------------------------------------------- accounts (账户) ---

def _sign_in(resp: Response, user: dict) -> Response:
    resp.set_cookie(auth.COOKIE, auth.store.token(user["id"]), max_age=auth.TTL, httponly=True, samesite="lax",
                    secure=config.PUBLIC_BASE_URL.startswith("https"))
    return resp


def _json(data) -> Response:
    return Response(json.dumps(data, ensure_ascii=False), media_type="application/json")


@app.get("/api/auth/me")
async def auth_me(request: Request):
    user = auth.store.from_token(request.cookies.get(auth.COOKIE)) if auth.store.enabled else None
    return {"enabled": auth.store.enabled, "setup": not auth.store.items, "feishu": auth.store.feishu_enabled(),
            "user": auth.Users.public(user) if user else None}


@app.post("/api/auth/setup")
async def auth_setup(body: dict):
    """Create the first (admin) account; everything created so far becomes theirs."""
    if auth.store.items:
        raise HTTPException(409, "已经设置过管理员")
    try:
        u = auth.store.create(str(body.get("username") or ""), str(body.get("password") or ""), str(body.get("name") or ""), "admin")
    except auth.AuthError as e:
        raise HTTPException(400, str(e))
    _adopt_existing(u["id"])
    return _sign_in(_json({"user": auth.Users.public(u)}), u)


@app.post("/api/auth/login")
async def auth_login(body: dict):
    u = auth.store.verify(str(body.get("username") or ""), str(body.get("password") or ""))
    if not u:
        await asyncio.sleep(0.5)
        raise HTTPException(401, "用户名或密码不正确")
    return _sign_in(_json({"user": auth.Users.public(u)}), u)


@app.post("/api/auth/logout")
async def auth_logout():
    resp = _json({"ok": True})
    resp.delete_cookie(auth.COOKIE)
    return resp


@app.post("/api/auth/password")
async def auth_password(body: dict, request: Request):
    u = auth.store.from_token(request.cookies.get(auth.COOKIE))
    if not u or (u.get("password") and not auth.store.verify(u["username"], str(body.get("old") or ""))):
        raise HTTPException(400, "原密码不正确")
    try:
        auth.store.set_password(u["id"], str(body.get("new") or ""))
    except auth.AuthError as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


def _feishu_redirect() -> str:
    return f"{config.PUBLIC_BASE_URL}/api/auth/feishu/callback"


@app.get("/api/auth/feishu/login")
async def feishu_login():
    from fastapi.responses import RedirectResponse
    if not auth.store.feishu_enabled():
        raise HTTPException(404, "飞书登录未配置")
    state = secrets.token_urlsafe(16)
    resp = RedirectResponse(auth.Users.feishu_authorize_url(state, _feishu_redirect()))
    resp.set_cookie("om_oauth_state", state, max_age=600, httponly=True, samesite="lax")
    return resp


@app.get("/api/auth/feishu/callback")
async def feishu_callback(request: Request, code: str = "", state: str = ""):
    from fastapi.responses import RedirectResponse
    if not state or not secrets.compare_digest(state, request.cookies.get("om_oauth_state") or ""):
        raise HTTPException(400, "登录状态已失效，请重试")
    try:
        u = await auth.store.feishu_login(code, _feishu_redirect())
    except (auth.AuthError, httpx.HTTPError) as e:
        return Response(f"<p>{e}</p><p><a href='/'>返回</a></p>", media_type="text/html", status_code=400)
    if len(auth.store.items) == 1:
        _adopt_existing(u["id"])
    return _sign_in(RedirectResponse("/"), u)


def _admin() -> dict:
    u = auth.current.get()
    if not u or u.get("role") != "admin":
        raise HTTPException(403, "需要管理员权限")
    return u


def _org_admin() -> None:
    """Organization-wide settings: anyone in single-user mode, only admins once sign-in is on."""
    if auth.store and auth.store.enabled:
        _admin()


@app.get("/api/users")
async def list_users():
    _admin()
    return [auth.Users.public(u) for u in sorted(auth.store.items.values(), key=lambda u: u["createdAt"])]


@app.post("/api/users")
async def create_user(body: dict):
    _admin()
    try:
        u = auth.store.create(str(body.get("username") or ""), str(body.get("password") or ""), str(body.get("name") or ""),
                              "admin" if body.get("role") == "admin" else "member")
    except auth.AuthError as e:
        raise HTTPException(400, str(e))
    return auth.Users.public(u)


@app.patch("/api/users/{uid}")
async def update_user(uid: str, body: dict):
    me = _admin()
    if uid not in auth.store.items:
        raise HTTPException(404, "user not found")
    u = auth.store.items[uid]
    if body.get("role") in ("admin", "member") and uid != me["id"]:
        u["role"] = body["role"]
    if body.get("name"):
        u["name"] = str(body["name"]).strip()[:40]
    try:
        if body.get("password"):
            auth.store.set_password(uid, str(body["password"]))
    except auth.AuthError as e:
        raise HTTPException(400, str(e))
    auth.store.save()
    return auth.Users.public(u)


@app.delete("/api/users/{uid}")
async def delete_user(uid: str):
    me = _admin()
    if uid == me["id"]:
        raise HTTPException(400, "不能删除自己")
    auth.store.delete(uid)
    return {"ok": True}


def _adopt_existing(uid: str) -> None:
    """Switching to multi-user: the first admin owns everything made in single-user mode."""
    for s in session_mod.store.sessions.values():
        if not s.owner:
            s.owner = uid
            s.persist()
    for store, attr in ((projects.store, "items"), (scheduler_mod.scheduler, "items"), (triggers_mod.triggers, "items"),
                        (sites.store, "items"), (computers.store, "items"), (devices.store, "items"),
                        (agents.store, "agents"), (agents.store, "teams")):
        for item in getattr(store, attr).values():
            item.setdefault("owner", None)
            item["owner"] = item["owner"] or uid
        store.save()
    legacy, mine = config.DATA_DIR / "personal.json", config.DATA_DIR / f"personal-{uid}.json"
    if (d := storage.load_doc(legacy)) is not None and storage.load_doc(mine) is None:
        storage.save_doc(mine, d)


def _session(sid: str):
    s = session_mod.store.get(sid)
    if not s or not auth.visible({"owner": s.owner}):
        raise HTTPException(404, "session not found")
    return s


@app.get("/api/sessions")
async def list_sessions():
    return [m for m in session_mod.store.list() if auth.visible(m)]


@app.post("/api/sessions")
async def create_session(body: dict | None = None):
    s = session_mod.store.create()
    s.owner = auth.owner()
    cid, did = (body or {}).get("computerId"), (body or {}).get("deviceId")
    if cid and computers.store and cid in computers.store.items and auth.visible(computers.store.items[cid]):
        s.computer_id = cid
        s.persist()
    elif did and devices.store and did in devices.store.items and auth.visible(devices.store.items[did]):
        s.device_id = did
        s.persist()
    aid, tid = (body or {}).get("agentId"), (body or {}).get("teamId")
    if tid and tid in agents.store.teams and auth.visible(agents.store.teams[tid]):
        t = agents.store.teams[tid]
        s.team_id, s.agent_id = tid, t.get("lead") or None
    elif aid and aid in agents.store.agents and auth.visible(agents.store.agents[aid]):
        s.agent_id = aid
    if s.agent_id:  # the role's default mode and skills
        a = agents.store.agents[s.agent_id]
        if a.get("mode"):
            s.model_selection = {"mode": a["mode"]}
        s.picked_skills |= {n for n in a.get("skills", []) if n in skills.store.items}
    if s.agent_id or s.team_id:
        s.persist()
    pid = (body or {}).get("projectId")
    if pid and projects.store and pid in projects.store.items and auth.visible(projects.store.items[pid]):
        s.project_id = pid
        s.persist()
    return s.meta()


@app.get("/api/sessions/{sid}")
async def get_session(sid: str):
    s = _session(sid)
    return {**s.meta(), "events": s.events}


@app.delete("/api/sessions/{sid}")
async def delete_session(sid: str):
    _session(sid)
    await session_mod.store.delete(sid)
    return {"ok": True}


@app.post("/api/sessions/{sid}/upload")
async def upload(sid: str, file: UploadFile = File(...)):
    sb = await manager.get(_session(sid).sandbox_id)
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
    sb = manager.sandboxes.get(s.sandbox_id)
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
    sb = await manager.get(s.sandbox_id)  # nothing stored: start the sandbox and try there
    r = await sb.http.get("/file/download", params={"path": path})
    if r.status_code >= 400:
        raise HTTPException(r.status_code, "file not found")
    return Response(r.content, media_type=r.headers.get("content-type", "application/octet-stream"),
                    headers={"Content-Disposition": _disposition(name)})


# ------------------------------------------------------------- projects (项目) ---

def _project(pid: str) -> dict:
    if pid not in projects.store.items or not auth.visible(projects.store.items[pid]):
        raise HTTPException(404, "project not found")
    return projects.store.items[pid]


@app.get("/api/projects")
async def list_projects():
    return [p for p in projects.store.list() if auth.visible(p)]


@app.post("/api/projects")
async def create_project(body: dict):
    try:
        p = projects.store.create(body.get("name", ""), body.get("instructions", ""))
        projects.store.items[p["id"]]["owner"] = auth.owner()
        projects.store.save()
        return {**p, "owner": auth.owner()}
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.patch("/api/projects/{pid}")
async def update_project(pid: str, body: dict):
    _project(pid)
    return projects.store.update(pid, body)


@app.delete("/api/projects/{pid}")
async def delete_project(pid: str):
    _project(pid)
    projects.store.delete(pid)
    for s in session_mod.store.sessions.values():  # tasks stay, just leave the project
        if s.project_id == pid:
            s.project_id = None
            s.persist()
    return {"ok": True}


@app.post("/api/projects/{pid}/files")
async def upload_project_file(pid: str, file: UploadFile = File(...)):
    _project(pid)
    try:
        return projects.store.add_file(pid, file.filename or "file", await file.read())
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/projects/{pid}/files/{name}")
async def project_file(pid: str, name: str):
    _project(pid)
    f = projects.store.file_path(pid, name)
    if not f:
        raise HTTPException(404, "file not found")
    return FileResponse(f, headers={"Content-Disposition": _disposition(f.name)})


@app.delete("/api/projects/{pid}/files/{name}")
async def delete_project_file(pid: str, name: str):
    _project(pid)
    projects.store.remove_file(pid, name)
    return projects.store.view(projects.store.items[pid])


# ------------------------------------------------------------- skills (技能) ---

def _skill_call(fn, *a):
    try:
        return fn(*a)
    except KeyError:
        raise HTTPException(404, "skill not found")
    except skills.SkillError as e:
        raise HTTPException(400, str(e))


@app.get("/api/skills")
async def list_skills():
    return skills.store.list()


@app.get("/api/skills/{name}")
async def get_skill(name: str):
    return _skill_call(lambda: skills.store.view(skills.store.get(name), full=True))


@app.post("/api/skills")
async def create_skill(body: dict):
    return _skill_call(skills.store.create, body)


@app.put("/api/skills/{name}")
async def update_skill(name: str, body: dict):
    return _skill_call(skills.store.update, name, str(body.get("content") or ""))


@app.patch("/api/skills/{name}")
async def toggle_skill(name: str, body: dict):
    return _skill_call(skills.store.set_enabled, name, bool(body.get("enabled")))


@app.delete("/api/skills/{name}")
async def delete_skill(name: str):
    _skill_call(skills.store.delete, name)
    return {"ok": True}


@app.post("/api/skills/upload")
async def upload_skill(file: UploadFile = File(...)):
    return _skill_call(skills.store.from_upload, file.filename or "", await file.read())


@app.post("/api/skills/import")
async def import_skill(body: dict):
    try:
        return await skills.store.from_github(str(body.get("url") or ""))
    except skills.SkillError as e:
        raise HTTPException(400, str(e))
    except httpx.HTTPError as e:
        raise HTTPException(502, f"无法访问 GitHub：{e}")


@app.post("/api/skills/from-session")
async def skill_from_session(body: dict):
    """Add a skill the agent wrote during a task (the directory of the given SKILL.md in its sandbox)."""
    s = _session(str(body.get("sessionId")))
    path = str(body.get("path") or "")
    if not path.endswith("/SKILL.md"):
        raise HTTPException(400, "请选择 SKILL.md 文件")
    try:
        return await skills.store.from_sandbox(await manager.get(s.sandbox_id), path)
    except skills.SkillError as e:
        raise HTTPException(400, str(e))


# ------------------------------------------------------------- agents & teams ---

def _visible(item):
    if not auth.visible(item):
        raise HTTPException(404, "not found")
    return item


def _own(item: dict, store) -> dict:
    """Record the current user on a just-created item and save."""
    item["owner"] = auth.owner()
    store.save()
    return item


def _agent_call(fn, *a):
    try:
        return fn(*a)
    except KeyError:
        raise HTTPException(404, "not found")
    except agents.AgentError as e:
        raise HTTPException(400, str(e))


@app.get("/api/agents")
async def list_agents():
    v = agents.store.view()
    return {"agents": [a for a in v["agents"] if auth.visible(a)], "teams": [t for t in v["teams"] if auth.visible(t)]}


@app.post("/api/agents")
async def create_agent(body: dict):
    return _own(_agent_call(agents.store.create_agent, body), agents.store)


@app.patch("/api/agents/{aid}")
async def update_agent(aid: str, body: dict):
    _visible(agents.store.agents.get(aid))
    return _agent_call(agents.store.update_agent, aid, body)


@app.delete("/api/agents/{aid}")
async def delete_agent(aid: str):
    _visible(agents.store.agents.get(aid))
    agents.store.delete_agent(aid)
    return {"ok": True}


@app.post("/api/teams")
async def create_team(body: dict):
    return _own(_agent_call(agents.store.create_team, body), agents.store)


@app.patch("/api/teams/{tid}")
async def update_team(tid: str, body: dict):
    _visible(agents.store.teams.get(tid))
    return _agent_call(agents.store.update_team, tid, body)


@app.delete("/api/teams/{tid}")
async def delete_team(tid: str):
    _visible(agents.store.teams.get(tid))
    agents.store.delete_team(tid)
    return {"ok": True}


# ------------------------------------------------------------- skill recorder (技能录制器) ---

def _recording(rid: str) -> dict:
    r = recordings.store.items.get(rid)
    if not r or not auth.visible(r):
        raise HTTPException(404, "recording not found")
    return r


@app.post("/api/recordings")
async def start_recording(body: dict):
    """Start recording in a cloud browser ("cloud") or the user's own browser on a device ("dev:<id>")."""
    from .sandbox import SandboxError
    target = str(body.get("target") or "cloud")
    if target.startswith("dev:") and not auth.visible(devices.store.items.get(target[4:])):
        raise HTTPException(404, "device not found")
    try:
        return await recordings.store.start(target, str(body.get("url") or "").strip(), auth.owner())
    except SandboxError as e:
        raise HTTPException(400, str(e))


@app.get("/api/recordings/{rid}/events")
async def recording_events(rid: str):
    _recording(rid)
    try:
        return await recordings.store.events(rid)
    except (recordings.RecordingError, httpx.HTTPError) as e:
        raise HTTPException(400, str(e))


@app.post("/api/recordings/{rid}/stop")
async def stop_recording(rid: str, body: dict | None = None):
    _recording(rid)
    try:
        return await recordings.store.stop(rid, str((body or {}).get("notes") or ""))
    except recordings.RecordingError as e:
        raise HTTPException(400, str(e))


@app.delete("/api/recordings/{rid}")
async def cancel_recording(rid: str):
    _recording(rid)
    await recordings.store.cancel(rid)
    return {"ok": True}


@app.websocket("/api/recordings/{rid}/vnc")
async def recording_vnc(websocket: WebSocket, rid: str):
    allowed, user = _ws_user(websocket)
    r = recordings.store.items.get(rid)
    if not allowed or (r and user and r.get("owner") != user["id"]):
        r = None
    await _relay_vnc(websocket, manager.sandboxes.get(recordings.store.sandbox_id(r)) if r else None)


# ------------------------------------------------------------- personalization (个性化) ---

@app.get("/api/personalization")
async def get_personal():
    return personal.of(auth.owner()).view()


@app.put("/api/personalization")
async def put_personal(body: dict):
    return personal.of(auth.owner()).update(body)


@app.post("/api/personalization/import")
async def import_memory(body: dict):
    """Another assistant's memory export -> a proposed profile and knowledge items (saved by the client)."""
    text = str(body.get("text") or "").strip()
    if len(text) < 10:
        raise HTTPException(400, "请粘贴从其他 AI 导出的记忆内容")
    r = await llm.import_memory(text)
    if not r:
        raise HTTPException(502, "解析失败，请稍后重试")
    return r


@app.post("/api/knowledge")
async def add_knowledge(body: dict):
    try:
        return personal.of(auth.owner()).add(body.get("title", ""), body.get("content", ""), source=body.get("source") or "user")
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.patch("/api/knowledge/{kid}")
async def edit_knowledge(kid: str, body: dict):
    if kid not in personal.of(auth.owner()).knowledge:
        raise HTTPException(404, "knowledge not found")
    return personal.of(auth.owner()).edit(kid, body)


@app.delete("/api/knowledge/{kid}")
async def delete_knowledge(kid: str):
    personal.of(auth.owner()).remove(kid)
    return {"ok": True}


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
    _, base, key = providers.default_endpoint()
    if not _gateway_models and base and key:
        try:
            _gateway_models = await llm.list_models(base, key)
        except Exception:
            _gateway_models = []
    mm = providers.mode_models()
    return {"default": config.DEFAULT_MODE,
            "modes": [{**m, "model": mm.get(m["id"], "")} for m in providers.MODES],
            "gatewayModels": _gateway_models, "gatewayLabel": providers.default_label(),
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
    _org_admin()  # the stored key is sent to baseUrl when probing
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
    _org_admin()
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
    _org_admin()  # stdio connectors run their command on this host
    try:
        return await connectors.manager.upsert(body)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.patch("/api/connectors/{cid}")
async def update_connector(cid: str, body: dict):
    _org_admin()
    if cid not in connectors.manager.items:
        raise HTTPException(404, "connector not found")
    try:
        return await connectors.manager.upsert({**connectors.manager.items[cid], **body}, cid)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.delete("/api/connectors/{cid}")
async def delete_connector(cid: str):
    _org_admin()
    await connectors.manager.delete(cid)
    return {"ok": True}


@app.post("/api/connectors/{cid}/restart")
async def restart_connector(cid: str):
    _org_admin()
    if cid not in connectors.manager.items:
        raise HTTPException(404, "connector not found")
    await connectors.manager.restart(cid)
    return connectors.manager.public(connectors.manager.items[cid])


# ------------------------------------------------------------- plugins (插件 catalog) ---

def _installed_plugins() -> dict[str, dict]:
    return {c["plugin"]: c for c in connectors.manager.list() if c.get("plugin")}


@app.get("/api/plugins")
async def list_plugins():
    return plugins.catalog(_installed_plugins())


@app.post("/api/plugins/{pid}/install")
async def install_plugin(pid: str, body: dict):
    """Render the catalog entry with the user's values and save it as a connector (re-install updates it)."""
    _org_admin()
    try:
        cfg = plugins.build(pid, body.get("values") or {})
    except plugins.PluginError as e:
        raise HTTPException(400, str(e))
    prev = _installed_plugins().get(pid)
    try:
        c = await connectors.manager.upsert(cfg, prev["id"] if prev else None)
    except ValueError as e:
        raise HTTPException(400, str(e))
    lv = connectors.manager.live.get(c["id"])
    for _ in range(90):  # report the connection result, not just "saved"
        if not lv or lv.status not in ("connecting", "disconnected"):
            break
        await asyncio.sleep(0.5)
    return connectors.manager.public(connectors.manager.items[c["id"]])


# ------------------------------------------------------------- schedules (自动化) ---

def _sched(sid: str) -> dict:
    s = scheduler_mod.scheduler.items.get(sid)
    if not s or not auth.visible(s):
        raise HTTPException(404, "schedule not found")
    return s


@app.get("/api/schedules")
async def list_schedules():
    return [x for x in scheduler_mod.scheduler.list() if auth.visible(x)]


@app.post("/api/schedules")
async def create_schedule(body: dict):
    try:
        return scheduler_mod.scheduler.create(body.get("title", ""), body.get("prompt", ""), body.get("schedule") or {}, owner=auth.owner())
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


# ------------------------------------------------------------- triggers & advanced automation ---

def _trigger(tid: str) -> dict:
    t = triggers_mod.triggers.items.get(tid)
    if not t or not auth.visible(t):
        raise HTTPException(404, "trigger not found")
    return t


@app.get("/api/triggers")
async def list_triggers():
    return [t for t in triggers_mod.triggers.list() if auth.visible(t)]


@app.post("/api/triggers")
async def create_trigger(body: dict):
    try:
        return triggers_mod.triggers.create(body, owner=auth.owner())
    except (triggers_mod.TriggerError, ValueError) as e:
        raise HTTPException(400, str(e))


@app.patch("/api/triggers/{tid}")
async def update_trigger(tid: str, body: dict):
    _trigger(tid)
    try:
        return triggers_mod.triggers.update(tid, body)
    except (triggers_mod.TriggerError, ValueError) as e:
        raise HTTPException(400, str(e))


@app.delete("/api/triggers/{tid}")
async def delete_trigger(tid: str):
    _trigger(tid)
    await triggers_mod.triggers.delete(tid)
    return {"ok": True}


@app.post("/api/triggers/{tid}/check")
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


@app.post("/api/triggers/{tid}/fire")
async def fire_trigger(tid: str):
    """Run the action now, as a test (webhook: with a sample payload)."""
    t = _trigger(tid)
    ctx = ("<trigger_event source=\"manual\">\nStarted manually by the user to test this trigger; no real event "
           "payload.\n</trigger_event>")
    return {"sessionId": await triggers_mod.triggers.fire(t["id"], ctx)}


@app.post("/api/hooks/{token}")
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


@app.post("/api/automations/parse")
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


@app.get("/api/automations/activity")
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


# ------------------------------------------------------------- cloud computers (电脑) ---

def _computer(cid: str) -> dict:
    c = computers.store.items.get(cid)
    if not c or not auth.visible(c):
        raise HTTPException(404, "computer not found")
    return c


@app.get("/api/computers")
async def list_computers():
    return {"computers": [c for c in computers.store.list() if auth.visible(c)], **computers.store.catalog(),
            "tasks": {cid: [s.session_id for s in session_mod.store.sessions.values() if s.computer_id == cid]
                      for cid in computers.store.items}}


@app.post("/api/computers")
async def create_computer(body: dict):
    try:
        c = computers.store.create(body)
        computers.store.items[c["id"]]["owner"] = auth.owner()
        computers.store.save()
        return {**c, "owner": auth.owner()}
    except computers.ComputerError as e:
        raise HTTPException(400, str(e))


@app.patch("/api/computers/{cid}")
async def update_computer(cid: str, body: dict):
    _computer(cid)
    try:
        return computers.store.update(cid, body)
    except (computers.ComputerError, ValueError) as e:
        raise HTTPException(400, str(e))


@app.post("/api/computers/{cid}/start")
async def start_computer(cid: str):
    _computer(cid)
    return await computers.store.start(cid)


@app.post("/api/computers/{cid}/stop")
async def stop_computer(cid: str):
    _computer(cid)
    if any(s.computer_id == cid and s.task and not s.task.done() for s in session_mod.store.sessions.values()):
        raise HTTPException(409, "这台电脑上还有任务在运行")
    return await computers.store.stop(cid)


@app.delete("/api/computers/{cid}")
async def delete_computer(cid: str):
    _computer(cid)
    for s in session_mod.store.sessions.values():  # tasks stay; they lose the machine
        if s.computer_id == cid:
            await s.stop()
            s.computer_id = None
            s.persist()
    await computers.store.delete(cid)
    return {"ok": True}


@app.post("/api/computers/{cid}/exec")
async def computer_exec(cid: str, body: dict):
    _computer(cid)
    from .sandbox import SandboxError
    try:
        return await computers.store.exec(cid, str(body.get("command") or ""))
    except SandboxError as e:
        raise HTTPException(400, str(e))


@app.websocket("/api/computers/{cid}/vnc")
async def computer_vnc(websocket: WebSocket, cid: str):
    """The computer's desktop, like a task's live screen."""
    allowed, user = _ws_user(websocket)
    c = computers.store.items.get(cid)
    sb = manager.sandboxes.get(computers.sandbox_id(cid)) if c and allowed and (not user or c.get("owner") == user["id"]) else None
    await _relay_vnc(websocket, sb)


async def _proxy_port(sb, port: int, request: Request) -> Response:
    url = f"/proxy/{port}{request.url.path}" + (f"?{request.url.query}" if request.url.query else "")
    headers = {k: v for k, v in request.headers.items() if k.lower() not in {"host", "content-length"}}
    r = await sb.http.request(request.method, url, headers=headers, content=await request.body())
    drop = {"content-encoding", "transfer-encoding", "connection", "content-length"}
    return Response(r.content, status_code=r.status_code, headers={k: v for k, v in r.headers.items() if k.lower() not in drop})


# ------------------------------------------------------------- devices (连接您的设备) ---

def _device(did: str) -> dict:
    d = devices.store.items.get(did)
    if not d or not auth.visible(d):
        raise HTTPException(404, "device not found")
    return d


@app.get("/api/devices")
async def list_devices():
    return {"devices": [d for d in devices.store.list() if auth.visible(d)],
            "tasks": {did: [s.session_id for s in session_mod.store.sessions.values() if s.device_id == did] for did in devices.store.items}}


@app.post("/api/devices")
async def create_device(body: dict | None = None):
    """Pair a new computer: the token is returned once, with the command to run on that machine."""
    d, token = devices.store.create(str((body or {}).get("name") or ""))
    devices.store.items[d["id"]]["owner"] = d["owner"] = auth.owner()
    devices.store.save()
    return {"device": d, "token": token, "server": config.PUBLIC_BASE_URL}


@app.patch("/api/devices/{did}")
async def update_device(did: str, body: dict):
    _device(did)
    if "name" in body:
        devices.store.items[did]["renamed"] = True
    return devices.store.update(did, body)


@app.delete("/api/devices/{did}")
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


@app.get("/api/devices/{name}.py")
async def device_scripts(name: str):
    """The connector and the action server it runs, for machines without a checkout of this repo."""
    files = {"agent": config.ROOT / "device" / "openmanus_device.py", "server": config.SANDBOX_DIR / "server.py"}
    if name not in files:
        raise HTTPException(404)
    return FileResponse(files[name], media_type="text/x-python", headers={"Content-Disposition": f'attachment; filename="{files[name].name}"'})


@app.websocket("/api/devices/connect")
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


# ------------------------------------------------------------- creations (创作: published sites) ---

def _site(sid: str) -> dict:
    s = sites.store.items.get(sid)
    if not s or not auth.visible(s):
        raise HTTPException(404, "site not found")
    return s


@app.get("/api/sites")
async def list_sites():
    return [x for x in sites.store.list() if auth.visible(x)]


@app.patch("/api/sites/{sid}")
async def update_site(sid: str, body: dict):
    _site(sid)
    try:
        return sites.store.update(sid, body)
    except sites.SiteError as e:
        raise HTTPException(400, str(e))


@app.delete("/api/sites/{sid}")
async def delete_site(sid: str):
    _site(sid)
    sites.store.delete(sid)
    return {"ok": True}


@app.get("/api/sites/{sid}/thumb")
async def site_thumb(sid: str):
    p = sites.store.root / _site(sid)["id"] / "thumb.jpg"
    if not p.is_file():
        raise HTTPException(404)
    return FileResponse(p, media_type="image/jpeg")


def _serve_site(slug: str, path: str, sandboxed: bool) -> Response:
    s = sites.store.by_slug(slug)
    f = sites.store.file(s, path) if s else None
    if not f:
        return Response("Not found", status_code=404, media_type="text/plain")
    headers = {"Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff"}
    if sandboxed:  # path form shares OpenManus' origin: run it as an opaque origin
        headers["Content-Security-Policy"] = "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads"
    return FileResponse(f, media_type=sites.content_type(f), headers=headers)


@app.get("/sites/{slug}/{path:path}")
async def site_by_path(slug: str, path: str):
    return _serve_site(slug, path, sandboxed=True)


@app.middleware("http")
async def site_hosts(request: Request, call_next):
    """<slug>.<sites domain> serves that published site (its own origin, so storage and scripts work)."""
    host, domain = request.headers.get("host", ""), sites.sites_domain()
    if host.endswith("." + domain) and sites.store:
        slug = host[: -len(domain) - 1]
        if m := re.fullmatch(r"pc-([0-9a-f]+)-(\d+)", slug):  # an opened port of a cloud computer
            c = computers.store.items.get(m.group(1)) if computers.store else None
            if not c or int(m.group(2)) not in {p["port"] for p in c["ports"]}:
                return Response("Port not opened", status_code=404, media_type="text/plain")
            sb = await manager.get(computers.sandbox_id(c["id"]))
            return await _proxy_port(sb, int(m.group(2)), request)
        if request.method not in ("GET", "HEAD"):
            return Response("Method not allowed", status_code=405)
        return _serve_site(slug, request.url.path, sandboxed=False)
    return await call_next(request)


@app.get("/api/usage")
async def usage():
    """用量: model calls, tokens, tool calls and active time, overall, per day, per model and per task."""
    from datetime import datetime
    keys = ("activeMs", "llmCalls", "input", "output", "cached", "toolCalls")
    total, days, models, tasks = dict.fromkeys(keys, 0), {}, {}, []
    for s in session_mod.store.sessions.values():
        if not auth.visible({"owner": s.owner}):
            continue
        u = s.usage
        day = datetime.fromtimestamp(s.created_at).strftime("%Y-%m-%d")
        d = days.setdefault(day, dict.fromkeys(keys, 0) | {"tasks": 0})
        d["tasks"] += 1
        for k in keys:
            total[k] += u.get(k, 0)
            d[k] += u.get(k, 0)
        for name, m in (u.get("models") or {}).items():
            mm = models.setdefault(name, {"calls": 0, "input": 0, "output": 0})
            for k in mm:
                mm[k] += m.get(k, 0)
        if u.get("llmCalls"):
            tasks.append({"id": s.session_id, "title": s.title, "createdAt": s.created_at, **{k: u.get(k, 0) for k in keys}})
    return {"total": {**total, "tasks": sum(d["tasks"] for d in days.values())},
            "days": [{"day": k, **v} for k, v in sorted(days.items(), reverse=True)][:30],
            "models": [{"model": k, **v} for k, v in sorted(models.items(), key=lambda x: -x[1]["calls"])],
            "tasks": sorted(tasks, key=lambda t: -(t["input"] + t["output"]))[:20]}


# ------------------------------------------------------------- data management (数据管理) ---

@app.get("/api/data/export")
async def export_data():
    """Everything of the current user's as a zip: tasks (history, events, kept files), projects, settings."""
    import io
    import zipfile
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for s in session_mod.store.sessions.values():
            if not auth.visible({"owner": s.owner}):
                continue
            for f in s.dir.rglob("*"):
                if f.is_file() and f.suffix != ".tmp":
                    z.write(f, f"tasks/{s.session_id}/{f.relative_to(s.dir)}")
        owned = lambda items: [x for x in items if auth.visible(x)]  # noqa: E731
        z.writestr("projects.json", json.dumps(owned(projects.store.items.values()), ensure_ascii=False, indent=1))
        z.writestr("schedules.json", json.dumps(owned(scheduler_mod.scheduler.items.values()), ensure_ascii=False, indent=1))
        z.writestr("triggers.json", json.dumps(owned(triggers_mod.triggers.items.values()), ensure_ascii=False, indent=1))
        z.writestr("agents.json", json.dumps(await list_agents(), ensure_ascii=False, indent=1))
        z.writestr("personalization.json", json.dumps(personal.of(auth.owner()).view(), ensure_ascii=False, indent=1))
    name = f"openmanus-export-{time.strftime('%Y%m%d-%H%M')}.zip"
    return Response(buf.getvalue(), media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{name}"'})


@app.delete("/api/data/tasks")
async def delete_all_tasks():
    ids = [s.session_id for s in session_mod.store.sessions.values() if auth.visible({"owner": s.owner})]
    for sid in ids:
        await session_mod.store.delete(sid)
    return {"deleted": len(ids)}


# ------------------------------------------------------------- developer API (开发者) ---

@app.get("/api/keys")
async def list_keys():
    return [apikeys.ApiKeys.public(k) for k in apikeys.store.items.values() if auth.visible(k)]


@app.post("/api/keys")
async def create_key(body: dict | None = None):
    k, key = apikeys.store.create(str((body or {}).get("name") or ""), auth.owner())
    return {**k, "key": key}


@app.delete("/api/keys/{kid}")
async def delete_key(kid: str):
    _visible(apikeys.store.items.get(kid))
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


@app.post("/api/v1/tasks")
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


@app.get("/api/v1/tasks/{sid}")
async def api_get_task(sid: str, request: Request):
    _api_user(request)
    return _task_view(_session(sid))


@app.post("/api/v1/tasks/{sid}/messages")
async def api_task_message(sid: str, body: dict, request: Request):
    """A follow-up or a reply to a question the task asked."""
    _api_user(request)
    s = _session(sid)
    await s.user_message(str(body.get("content") or ""), [])
    return _task_view(s)


@app.post("/api/integrations/feishu/events")
async def feishu_events(body: dict):
    """Feishu event subscription: url verification, and messages to the bot become tasks."""
    if body.get("encrypt"):
        raise HTTPException(400, "turn off event encryption for this app (or leave the Encrypt Key empty)")
    return await feishu_bot.handle(body, session_mod.store)


@app.get("/api/library")
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


@app.get("/api/sessions/{sid}/shots/{name}")
async def shot(sid: str, name: str):
    p = (_session(sid).dir / "shots" / name).resolve()
    if p.parent.name != "shots" or not p.is_file():
        raise HTTPException(404)
    return FileResponse(p, media_type="image/jpeg")


@app.api_route("/preview/{sid}/{port}/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"])
async def preview(sid: str, port: int, path: str, request: Request):
    """Expose a port inside the sandbox (deploy_expose_port) through the sandbox proxy."""
    sb = await manager.get(_session(sid).sandbox_id)
    url = f"/proxy/{port}/{path}" + (f"?{request.url.query}" if request.url.query else "")
    headers = {k: v for k, v in request.headers.items() if k.lower() not in {"host", "content-length"}}
    r = await sb.http.request(request.method, url, headers=headers, content=await request.body())
    drop = {"content-encoding", "transfer-encoding", "connection", "content-length"}
    return Response(r.content, status_code=r.status_code,
                    headers={k: v for k, v in r.headers.items() if k.lower() not in drop})


@app.websocket("/ws")
async def ws(websocket: WebSocket):
    allowed, user = _ws_user(websocket)
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


@app.websocket("/api/sessions/{sid}/vnc")
async def vnc(websocket: WebSocket, sid: str):
    """Relay the sandbox's live screen (VNC over WebSocket) to the web client, like Manus' vncUrl."""
    allowed, user = _ws_user(websocket)
    s = session_mod.store.get(sid)
    if not allowed or (s and user and s.owner != user["id"]):
        s = None
    await _relay_vnc(websocket, manager.sandboxes.get(s.sandbox_id) if s else None)


async def _relay_vnc(websocket: WebSocket, sb) -> None:
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


@app.get("/api/config")
async def get_config():
    return {"model": providers.default_model(), "defaultMode": config.DEFAULT_MODE, "sandbox": config.SANDBOX_MODE, "planner": config.PLANNER_ENABLED,
            "search": "tavily" if config.TAVILY_API_KEY else "duckduckgo", "mail": mail.CFG["ADDRESS"] or (mail.CFG["USER"] if mail.enabled() else ""), "media": media.capabilities()}


@app.middleware("http")
async def no_cache_static(request: Request, call_next):
    """Make browsers revalidate the UI (index.html is unhashed; hashed bundles just revalidate cheaply)."""
    response = await call_next(request)
    if not request.url.path.startswith(("/api/", "/preview/")):
        response.headers["Cache-Control"] = "no-cache"
    return response


if config.STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(config.STATIC_DIR), html=True), name="static")
else:
    @app.get("/", include_in_schema=False)
    async def ui_not_built():
        return Response("The web UI is not built yet: run `npm install && npm run build` in frontend/.",
                        status_code=503, media_type="text/plain; charset=utf-8")
