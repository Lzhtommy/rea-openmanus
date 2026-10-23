"""Sandbox lifecycle (one sandbox per session) and the HTTP client the agent uses to act."""

from __future__ import annotations

import asyncio
import logging
import os
import socket
import sys
import time
from collections.abc import Callable
from pathlib import Path

import httpx

from . import config

log = logging.getLogger("manus.sandbox")


class SandboxError(Exception):
    pass


class Sandbox:
    """Client for one running sandbox server."""

    def __init__(self, session_id: str, base_url: str, workdir: str, mode: str):
        self.session_id = session_id
        self.base_url = base_url
        self.workdir = workdir
        self.mode = mode
        self.info: dict = {}  # /health payload: vnc availability, screen size
        self.last_used = time.monotonic()
        self.viewers = 0  # live-screen (VNC) connections: a watched sandbox is never reclaimed
        self.http = httpx.AsyncClient(base_url=base_url, timeout=httpx.Timeout(660, connect=10))

    @property
    def vnc(self) -> bool:
        return bool(self.info.get("vnc"))

    @property
    def ws_url(self) -> str:
        return self.base_url.replace("http://", "ws://", 1)

    def touch(self) -> None:
        self.last_used = time.monotonic()

    async def call(self, path: str, payload: dict | None = None) -> dict:
        self.touch()
        try:
            r = await self.http.post(path, json=payload or {})
        except httpx.HTTPError as e:
            raise SandboxError(f"sandbox unreachable: {e}") from e
        if r.status_code >= 400:
            try:
                detail = r.json().get("detail", r.text)
            except ValueError:
                detail = r.text
            raise SandboxError(str(detail))
        return r.json()

    async def wait_ready(self, timeout: float = 60) -> None:
        deadline = asyncio.get_event_loop().time() + timeout
        while True:
            try:
                r = await self.http.get("/health", timeout=3)
                if r.status_code == 200:
                    self.info = r.json()
                    return
            except httpx.HTTPError:
                pass
            if asyncio.get_event_loop().time() > deadline:
                raise SandboxError("sandbox did not become ready")
            await asyncio.sleep(0.5)

    async def close(self):
        await self.http.aclose()


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


async def _run(*cmd: str) -> str:
    p = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    out, err = await p.communicate()
    if p.returncode != 0:
        raise SandboxError(f"{' '.join(cmd[:3])}... failed: {err.decode().strip()}")
    return out.decode().strip()


class SandboxManager:
    def __init__(self):
        self.sandboxes: dict[str, Sandbox] = {}
        self.local_procs: dict[str, asyncio.subprocess.Process] = {}
        self.locks: dict[str, asyncio.Lock] = {}
        self.busy: Callable[[str], bool] = lambda sid: False  # set by the app: is the task using it?
        self.on_stopped: Callable[[str], None] = lambda sid: None
        self.started_at = time.monotonic()
        self.reaper: asyncio.Task | None = None
        # per-sandbox overrides (cloud computers): {"memory": "8g", "cpus": "4", "idle_minutes": 0 = never stop}
        self.specs: dict[str, dict] = {}

    async def get(self, session_id: str) -> Sandbox:
        lock = self.locks.setdefault(session_id, asyncio.Lock())
        async with lock:
            sb = self.sandboxes.get(session_id)
            if sb:
                sb.touch()
                return sb
            sb = await (self._start_docker(session_id) if config.SANDBOX_MODE == "docker"
                        else self._start_local(session_id))
            self.sandboxes[session_id] = sb
            return sb

    async def _start_docker(self, sid: str) -> Sandbox:
        name = f"manus-sbx-{sid}"
        existing = await _run("docker", "ps", "-a", "--filter", f"name=^{name}$", "--format", "{{.State}}")
        if existing:
            if existing != "running":
                await _run("docker", "start", name)
        else:
            await _run("docker", "run", "-d", "--name", name,
                       "--label", "manus.sandbox=1",
                       "-p", "127.0.0.1::8080",
                       "--memory", self.specs.get(sid, {}).get("memory") or os.environ.get("MANUS_SANDBOX_MEMORY", "4g"),
                       "--cpus", self.specs.get(sid, {}).get("cpus") or os.environ.get("MANUS_SANDBOX_CPUS", "2"),
                       "--shm-size", "1g",
                       "-e", f"TZ={config.SANDBOX_TZ}",
                       config.SANDBOX_IMAGE)
        port_line = await _run("docker", "port", name, "8080/tcp")
        port = port_line.splitlines()[0].rsplit(":", 1)[1]
        sb = Sandbox(sid, f"http://127.0.0.1:{port}", "/home/ubuntu", "docker")
        await sb.wait_ready()
        log.info("docker sandbox %s ready on %s", name, port)
        return sb

    async def _start_local(self, sid: str) -> Sandbox:
        ws = (config.WORKSPACES_DIR / sid).resolve()
        ws.mkdir(parents=True, exist_ok=True)
        port = _free_port()
        env = {**os.environ, "SANDBOX_WORKSPACE": str(ws), "SANDBOX_PORT": str(port), "SANDBOX_HOST": "127.0.0.1"}
        sandbox_python = config.SANDBOX_DIR / ".venv" / "bin" / "python"
        python = str(sandbox_python) if sandbox_python.exists() else sys.executable
        proc = await asyncio.create_subprocess_exec(
            python, str(config.SANDBOX_DIR / "server.py"), cwd=str(ws), env=env,
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
        self.local_procs[sid] = proc
        sb = Sandbox(sid, f"http://127.0.0.1:{port}", str(ws), "local")
        await sb.wait_ready()
        log.warning("LOCAL sandbox for %s at %s — commands run on the host, dev use only", sid, ws)
        return sb

    # ---------------------------------------------------------- idle reclaim ---
    async def reap(self, idle_seconds: float | None = None) -> list[str]:
        """Stop sandboxes nobody used for a while (container stopped, not removed; files stay)."""
        idle = (config.SANDBOX_IDLE_MINUTES * 60) if idle_seconds is None else idle_seconds
        if idle <= 0:
            return []
        now, stopped = time.monotonic(), []
        for sid, sb in list(self.sandboxes.items()):
            own = self.specs.get(sid, {}).get("idle_minutes")
            limit = idle if own is None or idle_seconds is not None else own * 60
            if limit <= 0 or now - sb.last_used < limit or sb.viewers or self.busy(sid):
                continue
            async with self.locks.setdefault(sid, asyncio.Lock()):
                if self.sandboxes.get(sid) is not sb:
                    continue
                await self.stop(sid)
                stopped.append(sid)
        # containers left running by an earlier backend process, once they have been idle as long
        if config.SANDBOX_MODE == "docker" and now - self.started_at >= idle:
            try:
                running = (await _run("docker", "ps", "--filter", "label=manus.sandbox=1", "--format", "{{.Names}}")).split()
            except SandboxError:
                running = []
            for name in running:
                sid = name.removeprefix("manus-sbx-")
                if sid not in self.sandboxes and sid not in self.specs and not self.busy(sid):  # computers keep running
                    await self.stop(sid)
                    stopped.append(sid)
        return stopped

    async def stop(self, sid: str) -> None:
        sb = self.sandboxes.pop(sid, None)
        if sb:
            try:
                await sb.close()
            except Exception:  # never let a broken client keep a sandbox running
                pass
        if config.SANDBOX_MODE == "docker":
            try:
                await _run("docker", "stop", "-t", "3", f"manus-sbx-{sid}")
            except SandboxError as e:
                log.warning("stop %s: %s", sid, e)
        proc = self.local_procs.pop(sid, None)
        if proc and proc.returncode is None:
            proc.terminate()
        log.info("sandbox %s stopped (idle)", sid)
        self.on_stopped(sid)

    async def reap_loop(self, every: float = 60) -> None:
        while True:
            await asyncio.sleep(every)
            try:
                await self.reap()
            except Exception:
                log.exception("sandbox reaper failed")

    async def destroy(self, sid: str) -> None:
        sb = self.sandboxes.pop(sid, None)
        if sb:
            await sb.close()
        if config.SANDBOX_MODE == "docker":
            try:
                await _run("docker", "rm", "-f", f"manus-sbx-{sid}")
            except SandboxError:
                pass
        proc = self.local_procs.pop(sid, None)
        if proc and proc.returncode is None:
            proc.terminate()

    async def shutdown(self) -> None:
        for sid in list(self.local_procs):
            proc = self.local_procs.pop(sid)
            if proc.returncode is None:
                proc.terminate()
        for sb in self.sandboxes.values():
            await sb.close()
        self.sandboxes.clear()


manager = SandboxManager()
