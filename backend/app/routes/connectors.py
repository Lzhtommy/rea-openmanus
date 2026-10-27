"""Connectors (MCP)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from .. import connectors
from .common import org_admin

router = APIRouter()


@router.get("/api/connectors")
async def list_connectors():
    return connectors.manager.list()


@router.post("/api/connectors")
async def create_connector(body: dict):
    org_admin()  # stdio connectors run their command on this host
    try:
        return await connectors.manager.upsert(body)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.patch("/api/connectors/{cid}")
async def update_connector(cid: str, body: dict):
    org_admin()
    if cid not in connectors.manager.items:
        raise HTTPException(404, "connector not found")
    try:
        return await connectors.manager.upsert({**connectors.manager.items[cid], **body}, cid)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.delete("/api/connectors/{cid}")
async def delete_connector(cid: str):
    org_admin()
    await connectors.manager.delete(cid)
    return {"ok": True}


@router.post("/api/connectors/{cid}/restart")
async def restart_connector(cid: str):
    org_admin()
    if cid not in connectors.manager.items:
        raise HTTPException(404, "connector not found")
    await connectors.manager.restart(cid)
    return connectors.manager.public(connectors.manager.items[cid])
