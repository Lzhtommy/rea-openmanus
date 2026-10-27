"""Creations (创作: published sites)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from .. import auth, sites
from .common import serve_site

router = APIRouter()


def _site(sid: str) -> dict:
    s = sites.store.items.get(sid)
    if not s or not auth.visible(s):
        raise HTTPException(404, "site not found")
    return s


@router.get("/api/sites")
async def list_sites():
    return [x for x in sites.store.list() if auth.visible(x)]


@router.patch("/api/sites/{sid}")
async def update_site(sid: str, body: dict):
    _site(sid)
    try:
        return sites.store.update(sid, body)
    except sites.SiteError as e:
        raise HTTPException(400, str(e))


@router.delete("/api/sites/{sid}")
async def delete_site(sid: str):
    _site(sid)
    sites.store.delete(sid)
    return {"ok": True}


@router.get("/api/sites/{sid}/thumb")
async def site_thumb(sid: str):
    p = sites.store.root / _site(sid)["id"] / "thumb.jpg"
    if not p.is_file():
        raise HTTPException(404)
    return FileResponse(p, media_type="image/jpeg")


@router.get("/sites/{slug}/{path:path}")
async def site_by_path(slug: str, path: str):
    return serve_site(slug, path, sandboxed=True)
