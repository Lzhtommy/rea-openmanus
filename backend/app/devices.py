"""Connected devices (Manus' 连接您的设备 / 本地计算机): the user's own computers as places tasks run.

The device connector (device/openmanus_device.py) runs the action server on the user's machine and keeps an
outbound WebSocket to /api/devices/connect. DeviceTransport is an httpx transport that sends each request
over that socket and waits for the answer, so a device sandbox (`dev-<id>`) is an ordinary Sandbox to the
agent. Device tokens are shown once and stored hashed.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import itertools
import json
import secrets
import time

import httpx

from . import config, storage

TIMEOUT = 660


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def sandbox_id(did: str) -> str:
    return f"dev-{did}"


class Live:
    """One connected device: its socket and the requests waiting for an answer."""

    def __init__(self, ws, hello: dict):
        self.ws = ws
        self.hello = hello
        self.pending: dict[str, asyncio.Future] = {}
        self.ids = itertools.count()
        self.send_lock = asyncio.Lock()

    async def request(self, method: str, path: str, headers: dict, body: bytes, timeout: float) -> dict:
        rid = f"r{next(self.ids)}"
        fut = asyncio.get_running_loop().create_future()
        self.pending[rid] = fut
        try:
            async with self.send_lock:
                await self.ws.send_text(json.dumps({"type": "request", "id": rid, "method": method, "path": path,
                                                    "headers": headers, "body": base64.b64encode(body).decode()}))
            return await asyncio.wait_for(fut, timeout)
        finally:
            self.pending.pop(rid, None)

    def resolve(self, msg: dict) -> None:
        if (fut := self.pending.get(msg.get("id"))) and not fut.done():
            fut.set_result(msg)

    def fail_all(self, why: str) -> None:
        for fut in self.pending.values():
            if not fut.done():
                fut.set_exception(httpx.ConnectError(why))


class DeviceTransport(httpx.AsyncBaseTransport):
    def __init__(self, did: str):
        self.did = did

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        live = store.live.get(self.did) if store else None
        if not live:
            raise httpx.ConnectError("the device is offline: start the OpenManus connector on it")
        body = await request.aread()
        path = request.url.raw_path.decode()
        headers = {k: v for k, v in request.headers.items() if k.lower() not in ("host", "content-length")}
        timeout = (request.extensions.get("timeout") or {}).get("read") or TIMEOUT
        msg = await live.request(request.method, path, headers, body, timeout)
        return httpx.Response(msg["status"], headers=msg.get("headers") or {}, content=base64.b64decode(msg.get("body") or ""))


class Devices:
    def __init__(self):
        self.path = config.DATA_DIR / "devices.json"
        self.items: dict[str, dict] = {}
        if self.path.exists():
            try:
                self.items = {d["id"]: d for d in json.loads(self.path.read_text())}
            except (ValueError, KeyError):
                self.items = {}
        self.live: dict[str, Live] = {}

    def save(self) -> None:
        storage.write_json(self.path, list(self.items.values()), private=True)

    def view(self, d: dict) -> dict:
        live = self.live.get(d["id"])
        out = {k: v for k, v in d.items() if k != "tokenHash"}
        out.update(online=bool(live), **({k: live.hello.get(k) for k in ("os", "workdir", "myBrowser")} if live else {}))
        return out

    def list(self) -> list[dict]:
        return [self.view(d) for d in sorted(self.items.values(), key=lambda d: -d["createdAt"])]

    def create(self, name: str) -> tuple[dict, str]:
        token = secrets.token_urlsafe(24)
        d = {"id": secrets.token_hex(4), "name": (name or "我的电脑").strip()[:40], "tokenHash": _hash(token),
             "createdAt": time.time(), "lastSeen": None, "autoApprove": False, "os": "", "workdir": "", "myBrowser": False}
        self.items[d["id"]] = d
        self.save()
        return self.view(d), token

    def by_token(self, token: str) -> dict | None:
        h = _hash(token or "")
        return next((d for d in self.items.values() if secrets.compare_digest(d["tokenHash"], h)), None)

    def update(self, did: str, body: dict) -> dict:
        d = self.items[did]
        if str(body.get("name") or "").strip():
            d["name"] = str(body["name"]).strip()[:40]
        if "autoApprove" in body:
            d["autoApprove"] = bool(body["autoApprove"])
        self.save()
        return self.view(d)

    def delete(self, did: str) -> None:
        self.items.pop(did, None)
        self.save()

    # ---- connections
    def attach(self, did: str, ws, hello: dict) -> Live:
        if old := self.live.get(did):
            old.fail_all("replaced by a new connection")
        live = Live(ws, hello)
        self.live[did] = live
        d = self.items[did]
        d.update(lastSeen=time.time(), os=str(hello.get("os", ""))[:80], workdir=str(hello.get("workdir", ""))[:300],
                 myBrowser=bool(hello.get("myBrowser")))
        if not d.get("renamed") and hello.get("name") and d["name"] == "我的电脑":
            d["name"] = str(hello["name"])[:40]
        self.save()
        return live

    def detach(self, did: str, live: Live) -> None:
        if self.live.get(did) is live:
            self.live.pop(did, None)
            live.fail_all("the device disconnected")
            if did in self.items:
                self.items[did]["lastSeen"] = time.time()
                self.save()


store: Devices | None = None
