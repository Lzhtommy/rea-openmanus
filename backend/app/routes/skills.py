"""Skills (技能)."""

from __future__ import annotations

import httpx

from fastapi import APIRouter, File, HTTPException, UploadFile

from .. import skills
from ..sandbox import manager
from .common import owned_session

router = APIRouter()


def _skill_call(fn, *a):
    try:
        return fn(*a)
    except KeyError:
        raise HTTPException(404, "skill not found")
    except skills.SkillError as e:
        raise HTTPException(400, str(e))


@router.get("/api/skills")
async def list_skills():
    return skills.store.list()


@router.get("/api/skills/{name}")
async def get_skill(name: str):
    return _skill_call(lambda: skills.store.view(skills.store.get(name), full=True))


@router.post("/api/skills")
async def create_skill(body: dict):
    return _skill_call(skills.store.create, body)


@router.put("/api/skills/{name}")
async def update_skill(name: str, body: dict):
    return _skill_call(skills.store.update, name, str(body.get("content") or ""))


@router.patch("/api/skills/{name}")
async def toggle_skill(name: str, body: dict):
    return _skill_call(skills.store.set_enabled, name, bool(body.get("enabled")))


@router.delete("/api/skills/{name}")
async def delete_skill(name: str):
    _skill_call(skills.store.delete, name)
    return {"ok": True}


@router.post("/api/skills/upload")
async def upload_skill(file: UploadFile = File(...)):
    return _skill_call(skills.store.from_upload, file.filename or "", await file.read())


@router.post("/api/skills/import")
async def import_skill(body: dict):
    try:
        return await skills.store.from_github(str(body.get("url") or ""))
    except skills.SkillError as e:
        raise HTTPException(400, str(e))
    except httpx.HTTPError as e:
        raise HTTPException(502, f"无法访问 GitHub：{e}")


@router.post("/api/skills/from-session")
async def skill_from_session(body: dict):
    """Add a skill the agent wrote during a task (the directory of the given SKILL.md in its sandbox)."""
    s = owned_session(str(body.get("sessionId")))
    path = str(body.get("path") or "")
    if not path.endswith("/SKILL.md"):
        raise HTTPException(400, "请选择 SKILL.md 文件")
    try:
        return await skills.store.from_sandbox(await manager.get(s.sandbox_id), path)
    except skills.SkillError as e:
        raise HTTPException(400, str(e))
