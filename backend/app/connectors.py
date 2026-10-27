"""MCP connectors (Manus' connectors.v1 / 插件) with on-demand tool discovery.

Each connector is an MCP server reached over stdio (a local command), Streamable HTTP or SSE. Its tools
are NOT added to the model's tool list: the agent calls mcp_search_tools to find what it needs (with
full input schemas) and mcp_call_tool to run it, like Manus' `manus-tools` search. The static tool list
keeps the prompt-cache prefix intact no matter how many connectors are configured.

Config lives in data/manus.db (0600: it can hold tokens). stdio servers run on the orchestrator
host, not in a sandbox — only add commands you trust.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import uuid
from contextlib import AsyncExitStack

from . import config, storage

log = logging.getLogger("manus.connectors")

TRANSPORTS = ("stdio", "http", "sse")


_URL_SECRET = re.compile(r"((?:api[_-]?key|key|token|ak|secret|[a-z]+ApiKey)=)[^&#]+", re.I)


def mask_url(url: str) -> str:
    """Keys passed in a query string (e.g. ?key=...) are secrets too."""
    return _URL_SECRET.sub(r"\1••••", url or "")


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")[:24] or "server"


class Live:
    """One connected MCP server: a task holds the session open until stop()."""

    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.session = None
        self.tools: list = []
        self.status = "disconnected"  # connecting | connected | error | disconnected
        self.error = ""
        self._stop = asyncio.Event()
        self._ready = asyncio.Event()
        self.task = asyncio.create_task(self._run())

    async def _open(self, stack: AsyncExitStack):
        c = self.cfg
        if c["transport"] == "stdio":
            from mcp import StdioServerParameters
            from mcp.client.stdio import stdio_client
            params = StdioServerParameters(command=c["command"], args=c.get("args") or [],
                                           env={**os.environ, **(c.get("env") or {})})
            return await stack.enter_async_context(stdio_client(params))
        if c["transport"] == "sse":
            from mcp.client.sse import sse_client
            return await stack.enter_async_context(sse_client(c["url"], headers=c.get("headers") or None))
        import httpx2
        from mcp.client.streamable_http import streamable_http_client
        http = await stack.enter_async_context(httpx2.AsyncClient(headers=c.get("headers") or {}, timeout=60))
        return await stack.enter_async_context(streamable_http_client(c["url"], http_client=http))

    async def _run(self):
        from mcp import ClientSession
        from mcp.types import PaginatedRequestParams
        self.status = "connecting"
        try:
            async with AsyncExitStack() as stack:
                read, write = await asyncio.wait_for(self._open(stack), 60)
                session = await stack.enter_async_context(ClientSession(read, write))
                await asyncio.wait_for(session.initialize(), 60)
                tools, cursor = [], None
                while True:
                    page = await session.list_tools(params=PaginatedRequestParams(cursor=cursor) if cursor else None)
                    tools += page.tools
                    cursor = getattr(page, "next_cursor", None)
                    if not cursor:
                        break
                self.session, self.tools, self.status, self.error = session, tools, "connected", ""
                self._ready.set()
                await self._stop.wait()
        except Exception as e:  # noqa: BLE001 — any failure is shown on the connector card
            while isinstance(e, BaseExceptionGroup) and e.exceptions:  # anyio task groups wrap the real cause
                e = e.exceptions[0]
            self.error = f"{type(e).__name__}: {e}"[:300]
            self.status = "error"
            log.warning("connector %s: %s", self.cfg.get("name"), self.error)
        finally:
            self.session = None
            if self.status == "connected":
                self.status = "disconnected"
            self._ready.set()

    async def ready(self, timeout: float = 60) -> None:
        try:
            await asyncio.wait_for(self._ready.wait(), timeout)
        except asyncio.TimeoutError:
            self.status, self.error = "error", "timed out connecting"

    async def stop(self) -> None:
        self._stop.set()
        try:
            await asyncio.wait_for(self.task, 10)
        except (asyncio.TimeoutError, Exception):
            self.task.cancel()


class Connectors:
    def __init__(self):
        self.path = config.DATA_DIR / "connectors.json"
        self.items: dict[str, dict] = {c["id"]: c for c in storage.load_items(self.path)}
        self.live: dict[str, Live] = {}

    def save(self) -> None:
        storage.save_items(self.path, self.items.values())

    # ---- config
    def validate(self, body: dict, prev: dict | None = None) -> dict:
        t = body.get("transport") or (prev or {}).get("transport")
        if t not in TRANSPORTS:
            raise ValueError("transport must be stdio, http or sse")
        name = (body.get("name") or (prev or {}).get("name") or "").strip()
        if not name:
            raise ValueError("请填写名称")
        c = {"id": (prev or {}).get("id") or uuid.uuid4().hex[:10], "name": name, "transport": t,
             "description": (body.get("description") or "").strip(), "enabled": bool(body.get("enabled", True)),
             "autoApprove": bool(body.get("autoApprove", False)),
             "plugin": body.get("plugin") or (prev or {}).get("plugin")}  # catalog entry it was installed from
        if t == "stdio":
            if not (body.get("command") or "").strip():
                raise ValueError("请填写启动命令")
            c["command"], c["args"] = body["command"].strip(), [str(a) for a in body.get("args") or []]
            c["env"] = {str(k): str(v) for k, v in (body.get("env") or {}).items()}
        else:
            if not str(body.get("url") or "").startswith(("http://", "https://")):
                raise ValueError("请填写 http(s) 地址")
            c["url"], c["headers"] = body["url"].strip(), {str(k): str(v) for k, v in (body.get("headers") or {}).items()}
        base = slug(c["plugin"] or name)
        if base == "server":  # names without ASCII letters (e.g. 中文) need a distinct prefix
            base = f"mcp_{c['id'][:6]}"
        taken = {x["slug"] for x in self.items.values() if x["id"] != c["id"]}
        c["slug"] = base if base not in taken else f"{base}_{c['id'][:4]}"
        return c

    def public(self, c: dict) -> dict:
        lv = self.live.get(c["id"])
        secret = lambda d: {k: "••••" for k in d}  # noqa: E731 — env values / headers can be tokens
        out = {k: v for k, v in c.items() if k not in ("env", "headers")}
        if c.get("url"):
            out["url"] = mask_url(c["url"])
        out.update(env=secret(c.get("env") or {}), headers=secret(c.get("headers") or {}),
                   status=lv.status if lv else ("disconnected" if c["enabled"] else "disabled"), error=lv.error if lv else "",
                   tools=[{"name": t.name, "description": (t.description or "")[:200],
                           "readOnly": bool(t.annotations and t.annotations.read_only_hint)} for t in (lv.tools if lv else [])])
        return out

    def list(self) -> list[dict]:
        return [self.public(c) for c in self.items.values()]

    async def upsert(self, body: dict, cid: str | None = None) -> dict:
        prev = self.items.get(cid) if cid else None
        if prev:  # keep stored secrets unless replaced
            body = {**body, "env": body.get("env") if body.get("env") and "••••" not in body["env"].values() else prev.get("env"),
                    "headers": body.get("headers") if body.get("headers") and "••••" not in body["headers"].values() else prev.get("headers"),
                    "url": prev.get("url") if "••••" in str(body.get("url") or "") else body.get("url")}
        c = self.validate(body, prev)
        self.items[c["id"]] = c
        self.save()
        await self.restart(c["id"])
        return self.public(c)

    async def delete(self, cid: str) -> None:
        if lv := self.live.pop(cid, None):
            await lv.stop()
        self.items.pop(cid, None)
        self.save()

    # ---- lifecycle
    async def restart(self, cid: str) -> None:
        if lv := self.live.pop(cid, None):
            await lv.stop()
        c = self.items.get(cid)
        if c and c["enabled"]:
            lv = Live(c)
            self.live[cid] = lv
            await lv.ready()

    async def start_all(self) -> None:
        await asyncio.gather(*(self.restart(cid) for cid in list(self.items)), return_exceptions=True)

    async def stop_all(self) -> None:
        await asyncio.gather(*(lv.stop() for lv in self.live.values()), return_exceptions=True)
        self.live.clear()

    # ---- what the agent sees
    def catalog(self) -> list[tuple[dict, object]]:
        return [(lv.cfg, t) for lv in self.live.values() if lv.status == "connected" for t in lv.tools]

    def summary(self) -> str:
        rows = [f"- {lv.cfg['name']} ({len(lv.tools)} tools){': ' + lv.cfg['description'] if lv.cfg.get('description') else ''}"
                for lv in self.live.values() if lv.status == "connected"]
        return ("<connectors>\nConnected MCP servers. Find their tools with mcp_search_tools, run them with mcp_call_tool.\n"
                + "\n".join(rows) + "\n</connectors>") if rows else ""

    def search(self, query: str, limit: int = 8) -> list[dict]:
        words = [w for w in re.split(r"\W+", query.lower()) if w]
        scored = []
        for cfg, t in self.catalog():
            hay = f"{cfg['name']} {cfg.get('description', '')} {t.name} {t.title or ''} {t.description or ''}".lower()
            score = sum(hay.count(w) + (3 if w in t.name.lower() else 0) for w in words) if words else 1
            if score:
                scored.append((score, cfg, t))
        if not scored and len(self.catalog()) <= 40:  # e.g. a Chinese query vs English tool names: show everything
            scored = [(1, cfg, t) for cfg, t in self.catalog()]
        scored.sort(key=lambda x: -x[0])
        return [{"tool": f"{cfg['slug']}.{t.name}", "server": cfg["name"], "description": t.description or "",
                 "input_schema": t.input_schema, "read_only": bool(t.annotations and t.annotations.read_only_hint)}
                for _, cfg, t in scored[:limit]]

    def find(self, qualified: str) -> tuple[Live, object] | None:
        server, _, name = qualified.partition(".")
        for lv in self.live.values():
            if lv.cfg["slug"] == server and lv.status == "connected":
                for t in lv.tools:
                    if t.name == name:
                        return lv, t
        return None

    async def call(self, qualified: str, arguments: dict) -> tuple[str, bool]:
        found = self.find(qualified)
        if not found:
            return f"Unknown MCP tool '{qualified}'. Use mcp_search_tools to find available tools.", True
        lv, t = found
        try:
            r = await asyncio.wait_for(lv.session.call_tool(t.name, arguments or {}), 300)
        except Exception as e:  # noqa: BLE001
            return f"MCP call failed: {type(e).__name__}: {e}", True
        parts = []
        for block in getattr(r, "content", None) or []:
            parts.append(getattr(block, "text", None) or f"[{getattr(block, 'type', 'content')} omitted]")
        if not parts and getattr(r, "structured_content", None) is not None:
            parts.append(json.dumps(r.structured_content, ensure_ascii=False))
        return "\n".join(parts) or "(no output)", bool(getattr(r, "is_error", False))

    def needs_confirm(self, qualified: str) -> str | None:
        """Tools not marked read-only may change things outside: ask, unless the connector is trusted."""
        found = self.find(qualified)
        if not found:
            return None
        lv, t = found
        if lv.cfg.get("autoApprove") or (t.annotations and t.annotations.read_only_hint):
            return None
        return f"调用 {lv.cfg['name']} 的 {t.name}"


manager: Connectors | None = None
