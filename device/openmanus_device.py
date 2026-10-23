#!/usr/bin/env python3
"""OpenManus device connector: lets OpenManus work on this computer (Manus' "连接新计算机" / Computer Use).

It starts the same action server the cloud sandboxes run (shell, files, browser) on 127.0.0.1, then opens an
outbound WebSocket to OpenManus and relays the server's HTTP calls through it, so nothing on this machine
listens on the network. OpenManus asks you before every command or file change it makes here unless you
trust the device in its settings.

    pip install fastapi "uvicorn[standard]" httpx python-multipart websockets playwright
    python -m playwright install chromium          # not needed with --my-browser
    python openmanus_device.py --server http://<openmanus>:8000 --token <token from the 电脑 page>

--my-browser http://127.0.0.1:9222 uses your own Chrome instead of a separate one, so the agent can work
with your logins. Start Chrome with --remote-debugging-port=9222 (a dedicated profile is recommended).
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import platform
import socket
import subprocess
import sys
import urllib.request
from pathlib import Path


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def server_script(base: str, here: Path) -> Path:
    """The action server: next to this file (repo checkout), else downloaded from OpenManus."""
    for p in (here / "server.py", here.parent / "sandbox" / "server.py"):
        if p.is_file():
            return p
    dest = Path.home() / ".openmanus" / "server.py"
    dest.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(f"{base}/api/devices/server.py", timeout=30) as r:
        dest.write_bytes(r.read())
    return dest


async def relay(args) -> None:
    import httpx
    import websockets

    base = args.server.rstrip("/")
    workspace = Path(args.workspace).expanduser().resolve()
    workspace.mkdir(parents=True, exist_ok=True)
    port = free_port()
    env = {**os.environ, "SANDBOX_WORKSPACE": str(workspace), "SANDBOX_PORT": str(port), "SANDBOX_HOST": "127.0.0.1"}
    if args.my_browser:
        env["BROWSER_CDP_URL"] = args.my_browser
    proc = subprocess.Popen([sys.executable, str(server_script(base, Path(__file__).resolve().parent))], env=env, cwd=str(workspace),
                            stdout=subprocess.DEVNULL if not args.verbose else None, stderr=subprocess.STDOUT if not args.verbose else None)
    local = httpx.AsyncClient(base_url=f"http://127.0.0.1:{port}", timeout=httpx.Timeout(660, connect=5))
    for _ in range(60):
        try:
            if (await local.get("/health")).status_code == 200:
                break
        except httpx.HTTPError:
            await asyncio.sleep(0.5)
    else:
        proc.terminate()
        sys.exit("the local action server did not start; check the dependencies listed at the top of this file")
    print(f"[openmanus] action server ready, workspace {workspace}" + (f", using your Chrome at {args.my_browser}" if args.my_browser else ""))

    ws_url = base.replace("http://", "ws://", 1).replace("https://", "wss://", 1) + f"/api/devices/connect?token={args.token}"
    hello = {"type": "hello", "name": args.name or platform.node(), "os": f"{platform.system()} {platform.release()}",
             "workdir": str(workspace), "myBrowser": bool(args.my_browser)}

    async def handle(ws, msg: dict) -> None:
        try:
            r = await local.request(msg["method"], msg["path"], headers=msg.get("headers") or {},
                                    content=base64.b64decode(msg.get("body") or ""))
            out = {"type": "response", "id": msg["id"], "status": r.status_code,
                   "headers": {k: v for k, v in r.headers.items() if k.lower() not in ("content-length", "transfer-encoding")},
                   "body": base64.b64encode(r.content).decode()}
        except Exception as e:  # noqa: BLE001 — reported to OpenManus as a gateway error
            out = {"type": "response", "id": msg["id"], "status": 502, "headers": {}, "body": base64.b64encode(str(e).encode()).decode()}
        await ws.send(json.dumps(out))

    delay = 1
    try:
        while True:
            try:
                async with websockets.connect(ws_url, max_size=None, ping_interval=20) as ws:
                    await ws.send(json.dumps(hello))
                    print(f"[openmanus] connected to {base} as \"{hello['name']}\"")
                    delay = 1
                    async for raw in ws:
                        msg = json.loads(raw)
                        if msg.get("type") == "request":
                            asyncio.create_task(handle(ws, msg))
                        elif msg.get("type") == "error":
                            print(f"[openmanus] {msg.get('message')}")
                            return
            except (OSError, websockets.exceptions.WebSocketException) as e:
                print(f"[openmanus] connection lost ({e}); retrying in {delay}s")
                await asyncio.sleep(delay)
                delay = min(delay * 2, 30)
    finally:
        proc.terminate()


def main() -> None:
    ap = argparse.ArgumentParser(description="Connect this computer to OpenManus")
    ap.add_argument("--server", required=True, help="OpenManus address, e.g. http://localhost:8000")
    ap.add_argument("--token", required=True, help="device token from the 电脑 page")
    ap.add_argument("--workspace", default="~/OpenManus", help="folder the agent works in (default ~/OpenManus)")
    ap.add_argument("--my-browser", default="", metavar="CDP_URL", help="use your own Chrome, e.g. http://127.0.0.1:9222")
    ap.add_argument("--name", default="", help="name shown in OpenManus (default: this computer's hostname)")
    ap.add_argument("--verbose", action="store_true")
    try:
        asyncio.run(relay(ap.parse_args()))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
