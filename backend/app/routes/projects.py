"""Projects (项目)."""

from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from .. import auth, projects, session as session_mod
from .common import disposition

router = APIRouter()


def _project(pid: str) -> dict:
    if pid not in projects.store.items or not auth.visible(projects.store.items[pid]):
        raise HTTPException(404, "project not found")
    return projects.store.items[pid]


@router.get("/api/projects")
async def list_projects():
    return [p for p in projects.store.list() if auth.visible(p)]


@router.post("/api/projects")
async def create_project(body: dict):
    try:
        p = projects.store.create(body.get("name", ""), body.get("instructions", ""))
        projects.store.items[p["id"]]["owner"] = auth.owner()
        projects.store.save()
        return {**p, "owner": auth.owner()}
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.patch("/api/projects/{pid}")
async def update_project(pid: str, body: dict):
    _project(pid)
    return projects.store.update(pid, body)


@router.delete("/api/projects/{pid}")
async def delete_project(pid: str):
    _project(pid)
    projects.store.delete(pid)
    for s in session_mod.store.sessions.values():  # tasks stay, just leave the project
        if s.project_id == pid:
            s.project_id = None
            s.persist()
    return {"ok": True}


@router.post("/api/projects/{pid}/files")
async def upload_project_file(pid: str, file: UploadFile = File(...)):
    _project(pid)
    try:
        return projects.store.add_file(pid, file.filename or "file", await file.read())
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/api/projects/{pid}/files/{name}")
async def project_file(pid: str, name: str):
    _project(pid)
    f = projects.store.file_path(pid, name)
    if not f:
        raise HTTPException(404, "file not found")
    return FileResponse(f, headers={"Content-Disposition": disposition(f.name)})


@router.delete("/api/projects/{pid}/files/{name}")
async def delete_project_file(pid: str, name: str):
    _project(pid)
    projects.store.remove_file(pid, name)
    return projects.store.view(projects.store.items[pid])
