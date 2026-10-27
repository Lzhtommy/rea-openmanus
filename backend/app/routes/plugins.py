"""Plugins (插件 catalog)."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException

from .. import connectors, plugins
from .common import org_admin

router = APIRouter()


def _installed_plugins() -> dict[str, dict]:
    return {c["plugin"]: c for c in connectors.manager.list() if c.get("plugin")}


@router.get("/api/plugins")
async def list_plugins():
    return plugins.catalog(_installed_plugins())


@router.post("/api/plugins/{pid}/install")
async def install_plugin(pid: str, body: dict):
    """Render the catalog entry with the user's values and save it as a connector (re-install updates it)."""
    org_admin()
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
