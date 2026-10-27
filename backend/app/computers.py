"""Cloud computers (Manus' 电脑): persistent machines the user creates, sizes and keeps.

A computer is a sandbox (container manus-sbx-pc-<id>) that is not tied to one task: it keeps its files and
installed software across tasks, is never reclaimed while idle unless the user asks for auto-stop, and can
run any number of tasks (sessions bound to it). Templates are a starting setup run once after creation.
Ports the user opens get stable, isolated URLs (pc-<id>-<port>.<sites domain>).
"""

from __future__ import annotations

import asyncio
import json
import logging
import secrets
import time

from . import config, storage
from .sandbox import SandboxError, manager

log = logging.getLogger("manus.computers")

TEMPLATES = [
    {"id": "automation", "name": "运行自动化", "description": "让报告、网站检查和机器人全天候持续运行。", "os": "Linux", "tags": ["服务器"],
     "cpus": 2, "memory": 4, "autoStop": 0, "setup": ""},
    {"id": "hosting", "name": "构建并托管应用", "description": "构建你的网站或应用，并为其提供一个始终在线的空间。", "os": "Linux", "tags": ["服务器"],
     "cpus": 2, "memory": 4, "autoStop": 0, "setup": "", "ports": [3000]},
    {"id": "blender", "name": "创建并渲染 3D", "description": "使用 Blender 在 CPU 上创建 3D 模型并渲染场景。", "os": "Linux", "tags": ["Blender"],
     "cpus": 4, "memory": 8, "autoStop": 60,
     "setup": "sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq blender >/dev/null && blender --version | head -1"},
    {"id": "gameserver", "name": "托管游戏服务器", "description": "为朋友提供一个共享世界，即使你离开也能保持在线。", "os": "Linux", "tags": ["服务器"],
     "cpus": 2, "memory": 6, "autoStop": 0,
     "setup": "sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq openjdk-21-jre-headless >/dev/null && java -version 2>&1 | head -1"},
    {"id": "data", "name": "数据处理工作站", "description": "装好 pandas、Jupyter 等常用库，适合长期的数据分析项目。", "os": "Linux", "tags": ["Python"],
     "cpus": 4, "memory": 8, "autoStop": 120,
     "setup": "pip install -q --break-system-packages pandas numpy matplotlib jupyterlab openpyxl 2>/dev/null || pip install -q pandas numpy matplotlib jupyterlab openpyxl; python3 -c 'import pandas; print(\"pandas\", pandas.__version__)'"},
    {"id": "custom", "name": "自定义", "description": "选择性能和内存，从一台干净的 Linux 开始。", "os": "Linux", "tags": ["自定义"],
     "cpus": 2, "memory": 4, "autoStop": 0, "setup": ""},
]
UNAVAILABLE = [
    {"id": "macos", "name": "构建 iOS 和 Mac 应用", "description": "在云端 Mac 上开发、测试和构建你的应用。", "os": "macOS", "tags": ["Xcode"]},
    {"id": "windows", "name": "使用 Windows 应用", "description": "从任意设备访问所需的 Windows 软件。", "os": "Windows", "tags": []},
]
BY_TEMPLATE = {t["id"]: t for t in TEMPLATES}
CPU_CHOICES, MEMORY_CHOICES = (1, 2, 4, 8), (2, 4, 8, 16)


class ComputerError(ValueError):
    pass


def sandbox_id(cid: str) -> str:
    return f"pc-{cid}"


class Computers:
    def __init__(self):
        self.path = config.DATA_DIR / "computers.json"
        self.items: dict[str, dict] = {}
        if self.path.exists():
            try:
                self.items = {c["id"]: c for c in json.loads(self.path.read_text())}
            except (ValueError, KeyError):
                self.items = {}
        self.tasks: dict[str, asyncio.Task] = {}
        for c in self.items.values():
            self._register(c)
            if c["status"] in ("starting", "setting_up"):
                c["status"] = "stopped"  # the backend restarted mid-way

    def save(self) -> None:
        storage.write_json(self.path, list(self.items.values()))

    def _register(self, c: dict) -> None:
        manager.specs[sandbox_id(c["id"])] = {"memory": f"{c['memory']}g", "cpus": str(c["cpus"]),
                                               "idle_minutes": c["autoStop"]}

    def view(self, c: dict) -> dict:
        running = sandbox_id(c["id"]) in manager.sandboxes
        status = c["status"] if c["status"] in ("setting_up", "starting", "error") else ("running" if running else "stopped")
        from .sites import sites_domain
        scheme = "https" if config.PUBLIC_BASE_URL.startswith("https") else "http"
        return {**c, "status": status, "ports": [{**p, "url": f"{scheme}://pc-{c['id']}-{p['port']}.{sites_domain()}/"} for p in c["ports"]]}

    def list(self) -> list[dict]:
        return [self.view(c) for c in sorted(self.items.values(), key=lambda c: -c["createdAt"])]

    def catalog(self) -> dict:
        return {"templates": TEMPLATES, "unavailable": UNAVAILABLE, "cpus": CPU_CHOICES, "memory": MEMORY_CHOICES}

    def create(self, body: dict) -> dict:
        t = BY_TEMPLATE.get(body.get("template") or "custom")
        if not t:
            raise ComputerError("unknown template")
        cpus = int(body.get("cpus") or t["cpus"])
        memory = int(body.get("memory") or t["memory"])
        if cpus not in CPU_CHOICES or memory not in MEMORY_CHOICES:
            raise ComputerError("unsupported size")
        c = {"id": secrets.token_hex(4), "name": (str(body.get("name") or "").strip() or t["name"])[:40], "template": t["id"],
             "cpus": cpus, "memory": memory, "autoStop": int(body.get("autoStop", t["autoStop"]) or 0),
             "ports": [{"port": p, "label": ""} for p in t.get("ports", [])], "status": "starting", "setupLog": "", "power": "on",
             "createdAt": time.time()}
        self.items[c["id"]] = c
        self._register(c)
        self.save()
        self.tasks[c["id"]] = asyncio.create_task(self._provision(c, t["setup"]))
        return self.view(c)

    async def _provision(self, c: dict, setup: str) -> None:
        try:
            sb = await manager.get(sandbox_id(c["id"]))
            if setup:
                c["status"] = "setting_up"
                self.save()
                r = await sb.call("/shell/exec", {"id": "setup", "command": setup, "timeout": 1500})
                c["setupLog"] = (r.get("output") or "")[-2000:]
                if r.get("returncode") not in (0, None):
                    raise SandboxError(f"setup exited with {r.get('returncode')}")
            c["status"] = "ready"
        except Exception as e:  # noqa: BLE001 — shown on the computer card
            log.exception("computer %s provisioning failed", c["id"])
            c["status"], c["setupLog"] = "error", (c.get("setupLog", "") + f"\n{e}")[-2000:]
        self.save()

    def update(self, cid: str, body: dict) -> dict:
        c = self.items[cid]
        if str(body.get("name") or "").strip():
            c["name"] = str(body["name"]).strip()[:40]
        if "autoStop" in body:
            c["autoStop"] = max(0, int(body["autoStop"] or 0))
        if "ports" in body:
            ports = []
            for p in body["ports"][:10]:
                n = int(p.get("port") or 0)
                if not 1 <= n <= 65535 or n == 8080:  # 8080 is the sandbox's own action API
                    raise ComputerError(f"invalid port {n}")
                ports.append({"port": n, "label": str(p.get("label") or "")[:30]})
            c["ports"] = ports
        self._register(c)
        self.save()
        return self.view(c)

    async def resume(self) -> None:
        """After a backend restart, reattach computers that were on (their containers kept running)."""
        for c in list(self.items.values()):
            if c.get("power", "on") == "on" and c["status"] != "error":
                try:
                    await manager.get(sandbox_id(c["id"]))
                except Exception:  # noqa: BLE001
                    log.exception("computer %s did not come back", c["id"])

    async def start(self, cid: str) -> dict:
        c = self.items[cid]
        if c["status"] == "error":
            c["status"] = "ready"
        c["power"] = "on"
        await manager.get(sandbox_id(cid))
        self.save()
        return self.view(c)

    async def stop(self, cid: str) -> dict:
        self.items[cid]["power"] = "off"
        self.save()
        if sandbox_id(cid) in manager.sandboxes:
            await manager.stop(sandbox_id(cid))
        return self.view(self.items[cid])

    async def delete(self, cid: str) -> None:
        if t := self.tasks.pop(cid, None):
            t.cancel()
        self.items.pop(cid, None)
        manager.specs.pop(sandbox_id(cid), None)
        self.save()
        await manager.destroy(sandbox_id(cid))

    async def exec(self, cid: str, command: str) -> dict:
        """A command from the computer page's console (separate shell from the agent's)."""
        sb = await manager.get(sandbox_id(cid))
        return await sb.call("/shell/exec", {"id": "console", "command": command, "timeout": 60})


store: Computers | None = None
