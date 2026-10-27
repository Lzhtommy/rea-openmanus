"""Tasks (任务): create, list, delete, upload and download files."""

from __future__ import annotations

import httpx

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response

from .. import agents, auth, computers, devices, projects, skills, session as session_mod
from ..sandbox import manager
from .common import owned_session, disposition

router = APIRouter()


@router.get("/api/sessions")
async def list_sessions():
    return [m for m in session_mod.store.list() if auth.visible(m)]


@router.post("/api/sessions")
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


@router.get("/api/sessions/{sid}")
async def get_session(sid: str):
    s = owned_session(sid)
    return {**s.meta(), "events": s.events}


@router.delete("/api/sessions/{sid}")
async def delete_session(sid: str):
    owned_session(sid)
    await session_mod.store.delete(sid)
    return {"ok": True}


@router.post("/api/sessions/{sid}/upload")
async def upload(sid: str, file: UploadFile = File(...)):
    sb = await manager.get(owned_session(sid).sandbox_id)
    r = await sb.http.post("/file/upload", files={"file": (file.filename, await file.read())},
                           data={"dir": f"{sb.workdir}/upload"})
    if r.status_code >= 400:
        raise HTTPException(r.status_code, r.text)
    info = r.json()
    await owned_session(sid).keep_file(info["path"], "upload")
    return info


@router.get("/api/sessions/{sid}/files")
async def download(sid: str, path: str):
    """Live from the running sandbox when possible, else the stored copy (the sandbox may be gone)."""
    s = owned_session(sid)
    name = path.rsplit("/", 1)[-1]
    sb = manager.sandboxes.get(s.sandbox_id)
    if sb:
        try:
            r = await sb.http.get("/file/download", params={"path": path})
        except httpx.HTTPError:  # container gone: fall back to the stored copy
            r, sb = None, None
        if r is not None and r.status_code < 400:
            return Response(r.content, media_type=r.headers.get("content-type", "application/octet-stream"),
                            headers={"Content-Disposition": disposition(name)})
    if kept := s.stored_file(path):
        p, meta = kept
        return FileResponse(p, media_type=meta.get("mime"), headers={"Content-Disposition": disposition(name)})
    if sb:
        raise HTTPException(404, "file not found")
    sb = await manager.get(s.sandbox_id)  # nothing stored: start the sandbox and try there
    r = await sb.http.get("/file/download", params={"path": path})
    if r.status_code >= 400:
        raise HTTPException(r.status_code, "file not found")
    return Response(r.content, media_type=r.headers.get("content-type", "application/octet-stream"),
                    headers={"Content-Disposition": disposition(name)})
