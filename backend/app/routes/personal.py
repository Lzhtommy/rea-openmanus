"""Personalization (个性化)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from .. import auth, llm, personal

router = APIRouter()


@router.get("/api/personalization")
async def get_personal():
    return personal.of(auth.owner()).view()


@router.put("/api/personalization")
async def put_personal(body: dict):
    return personal.of(auth.owner()).update(body)


@router.post("/api/personalization/import")
async def import_memory(body: dict):
    """Another assistant's memory export -> a proposed profile and knowledge items (saved by the client)."""
    text = str(body.get("text") or "").strip()
    if len(text) < 10:
        raise HTTPException(400, "请粘贴从其他 AI 导出的记忆内容")
    r = await llm.import_memory(text)
    if not r:
        raise HTTPException(502, "解析失败，请稍后重试")
    return r


@router.post("/api/knowledge")
async def add_knowledge(body: dict):
    try:
        return personal.of(auth.owner()).add(body.get("title", ""), body.get("content", ""), source=body.get("source") or "user")
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.patch("/api/knowledge/{kid}")
async def edit_knowledge(kid: str, body: dict):
    if kid not in personal.of(auth.owner()).knowledge:
        raise HTTPException(404, "knowledge not found")
    return personal.of(auth.owner()).edit(kid, body)


@router.delete("/api/knowledge/{kid}")
async def delete_knowledge(kid: str):
    personal.of(auth.owner()).remove(kid)
    return {"ok": True}
