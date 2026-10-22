"""Sandbox API server — runs INSIDE the sandbox (Docker container or local dev dir).

The agent backend never executes anything itself; every action (shell, file, browser,
port proxy) is an HTTP call to this server. This mirrors Manus' design where the
LLM orchestrator lives outside and a per-task VM exposes an action API.
"""

from __future__ import annotations

import asyncio
import base64
import fnmatch
import os
import re
import signal
import time
from pathlib import Path

import httpx
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

WORKSPACE = Path(os.environ.get("SANDBOX_WORKSPACE", "/home/ubuntu")).resolve()
WORKSPACE.mkdir(parents=True, exist_ok=True)
SHELL_MAX_BUFFER = 200_000

app = FastAPI(title="manus-sandbox")


def resolve(path: str) -> Path:
    """Resolve a path the agent gave us. Relative paths are relative to the workspace."""
    p = Path(path).expanduser()
    if not p.is_absolute():
        p = WORKSPACE / p
    return p.resolve()


# ---------------------------------------------------------------- shell ---

class ShellSession:
    def __init__(self, sid: str):
        self.id = sid
        self.proc: asyncio.subprocess.Process | None = None
        self.output = ""
        self.command = ""
        self.reader: asyncio.Task | None = None

    @property
    def running(self) -> bool:
        return self.proc is not None and self.proc.returncode is None

    def append(self, text: str) -> None:
        self.output += text
        if len(self.output) > SHELL_MAX_BUFFER:
            self.output = "...[earlier output dropped]...\n" + self.output[-SHELL_MAX_BUFFER:]

    async def start(self, command: str, cwd: Path) -> None:
        self.command = command
        self.output = f"{cwd}$ {command}\n"
        self.proc = await asyncio.create_subprocess_exec(
            "bash", "-lc", command,
            cwd=str(cwd),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            start_new_session=True,
            env={**os.environ, "TERM": "dumb", "PAGER": "cat", "GIT_PAGER": "cat"},
        )
        self.reader = asyncio.create_task(self._read())

    async def _read(self) -> None:
        assert self.proc and self.proc.stdout
        while True:
            chunk = await self.proc.stdout.read(4096)
            if not chunk:
                break
            self.append(chunk.decode(errors="replace"))
        rc = await self.proc.wait()
        self.append(f"\n[process exited with code {rc}]\n")

    async def wait(self, seconds: float) -> None:
        if self.reader:
            try:
                await asyncio.wait_for(asyncio.shield(self.reader), timeout=seconds)
            except asyncio.TimeoutError:
                pass

    def kill(self) -> None:
        if self.running:
            try:
                os.killpg(self.proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass

    def view(self) -> dict:
        return {
            "id": self.id,
            "command": self.command,
            "running": self.running,
            "returncode": None if self.proc is None else self.proc.returncode,
            "output": self.output,
        }


shells: dict[str, ShellSession] = {}


class ShellExec(BaseModel):
    id: str
    command: str
    exec_dir: str | None = None
    timeout: float = 30


@app.post("/shell/exec")
async def shell_exec(req: ShellExec):
    s = shells.get(req.id)
    if s and s.running:
        raise HTTPException(409, f"shell '{req.id}' is busy running `{s.command}`; "
                                 "use shell_wait/shell_view, shell_kill_process, or another shell id")
    s = shells[req.id] = ShellSession(req.id)
    cwd = resolve(req.exec_dir) if req.exec_dir else WORKSPACE
    if not cwd.is_dir():
        raise HTTPException(400, f"exec_dir does not exist: {cwd}")
    await s.start(req.command, cwd)
    await s.wait(req.timeout)
    return s.view()


class ShellRef(BaseModel):
    id: str
    seconds: float = 10
    input: str = ""
    press_enter: bool = True


def _shell(sid: str) -> ShellSession:
    if sid not in shells:
        raise HTTPException(404, f"no shell session '{sid}'")
    return shells[sid]


@app.post("/shell/view")
async def shell_view(req: ShellRef):
    return _shell(req.id).view()


@app.post("/shell/wait")
async def shell_wait(req: ShellRef):
    s = _shell(req.id)
    await s.wait(min(req.seconds, 600))
    return s.view()


@app.post("/shell/write")
async def shell_write(req: ShellRef):
    s = _shell(req.id)
    if not s.running or not s.proc.stdin:
        raise HTTPException(409, "no running process in this shell")
    data = req.input + ("\n" if req.press_enter else "")
    s.append(data)
    s.proc.stdin.write(data.encode())
    await s.proc.stdin.drain()
    await s.wait(2)
    return s.view()


@app.post("/shell/kill")
async def shell_kill(req: ShellRef):
    s = _shell(req.id)
    s.kill()
    await s.wait(2)
    return s.view()


# ----------------------------------------------------------------- file ---

class FileReq(BaseModel):
    file: str
    content: str = ""
    append: bool = False
    leading_newline: bool = False
    trailing_newline: bool = False
    start_line: int | None = None
    end_line: int | None = None
    old_str: str = ""
    new_str: str = ""
    regex: str = ""


@app.post("/file/read")
async def file_read(req: FileReq):
    p = resolve(req.file)
    if not p.is_file():
        raise HTTPException(404, f"file not found: {p}")
    text = p.read_text(errors="replace")
    lines = text.splitlines(keepends=True)
    s = req.start_line or 0
    e = req.end_line if req.end_line is not None else len(lines)
    return {"file": str(p), "content": "".join(lines[s:e]), "total_lines": len(lines)}


@app.post("/file/write")
async def file_write(req: FileReq):
    p = resolve(req.file)
    p.parent.mkdir(parents=True, exist_ok=True)
    content = ("\n" if req.leading_newline else "") + req.content + ("\n" if req.trailing_newline else "")
    with open(p, "a" if req.append else "w") as f:
        f.write(content)
    return {"file": str(p), "bytes": p.stat().st_size}


@app.post("/file/str_replace")
async def file_str_replace(req: FileReq):
    p = resolve(req.file)
    if not p.is_file():
        raise HTTPException(404, f"file not found: {p}")
    text = p.read_text()
    n = text.count(req.old_str)
    if n == 0:
        raise HTTPException(400, "old_str not found in file")
    if n > 1:
        raise HTTPException(400, f"old_str matches {n} times; make it unique")
    p.write_text(text.replace(req.old_str, req.new_str, 1))
    return {"file": str(p), "replaced": 1}


@app.post("/file/find_in_content")
async def file_find_in_content(req: FileReq):
    p = resolve(req.file)
    if not p.is_file():
        raise HTTPException(404, f"file not found: {p}")
    try:
        rx = re.compile(req.regex)
    except re.error as e:
        raise HTTPException(400, f"bad regex: {e}")
    matches = [{"line": i + 1, "text": line.rstrip("\n")}
               for i, line in enumerate(p.read_text(errors="replace").splitlines()) if rx.search(line)]
    return {"file": str(p), "matches": matches[:500], "total": len(matches)}


class FindReq(BaseModel):
    path: str
    glob: str


@app.post("/file/find_by_name")
async def file_find_by_name(req: FindReq):
    root = resolve(req.path)
    if not root.is_dir():
        raise HTTPException(404, f"directory not found: {root}")
    found = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in {"node_modules", ".git", "__pycache__", ".venv"}]
        for name in filenames:
            if fnmatch.fnmatch(name, req.glob):
                found.append(str(Path(dirpath) / name))
                if len(found) >= 1000:
                    return {"files": found, "truncated": True}
    return {"files": found, "truncated": False}


@app.get("/file/download")
async def file_download(path: str):
    p = resolve(path)
    if not p.is_file():
        raise HTTPException(404, f"file not found: {p}")
    return FileResponse(p, filename=p.name)


@app.post("/file/upload")
async def file_upload(file: UploadFile = File(...), dir: str = Form("upload")):
    d = resolve(dir)
    d.mkdir(parents=True, exist_ok=True)
    dest = d / Path(file.filename or "file").name
    dest.write_bytes(await file.read())
    return {"path": str(dest), "bytes": dest.stat().st_size}


# -------------------------------------------------------------- browser ---

# Marks interactive elements in the viewport with data-manus-index and returns a
# compact textual list — the same trick browser-use (which Manus uses) relies on so
# the model can say "click element 12" instead of guessing coordinates.
INDEX_JS = r"""
() => {
  document.querySelectorAll('[data-manus-index]').forEach(e => e.removeAttribute('data-manus-index'));
  const sel = 'a,button,input,textarea,select,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[onclick],[contenteditable=true]';
  const out = [];
  let i = 0;
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    if (r.width < 2 || r.height < 2 || st.visibility === 'hidden' || st.display === 'none') continue;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    el.setAttribute('data-manus-index', String(i));
    let label = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    const tag = el.tagName.toLowerCase();
    const typ = el.getAttribute('type');
    out.push(`[${i}]<${tag}${typ ? ' type=' + typ : ''}>${label}</${tag}>`);
    i++;
  }
  return out;
}
"""

TEXT_JS = r"""
() => {
  const sy = scrollY, h = document.documentElement.scrollHeight;
  return {
    text: (document.body ? document.body.innerText : '').replace(/\n{3,}/g, '\n\n'),
    pixels_above: Math.round(sy),
    pixels_below: Math.max(0, Math.round(h - sy - innerHeight)),
  };
}
"""


class Browser:
    def __init__(self):
        self.pw = None
        self.browser = None
        self.page = None
        self.console: list[str] = []
        self.lock = asyncio.Lock()  # serializes actions on the shared, user-visible page
        self.launch_lock = asyncio.Lock()

    async def launch(self):
        try:
            from playwright.async_api import async_playwright
        except ImportError:
            raise HTTPException(501, "playwright not installed in this sandbox")
        if not self.pw:
            self.pw = await async_playwright().start()
        if not self.browser or not self.browser.is_connected():
            self.browser = await self.pw.chromium.launch(
                headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
        return self.browser

    async def ensure(self):
        if self.page and not self.page.is_closed():
            return self.page
        async with self.launch_lock:
            await self.launch()
        ctx = await self.browser.new_context(viewport={"width": 1280, "height": 800}, locale="en-US")
        self.page = await ctx.new_page()
        self.page.on("console", lambda m: self.console.append(f"[{m.type}] {m.text}"[:500]))
        return self.page

    async def restart(self):
        try:
            if self.browser:
                await self.browser.close()
        except Exception:
            pass
        self.browser = self.page = None
        self.console.clear()

    async def snapshot(self, max_text: int = 12000) -> dict:
        page = self.page
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=5000)
        except Exception:
            pass
        elements = await page.evaluate(INDEX_JS)
        info = await page.evaluate(TEXT_JS)
        shot = await page.screenshot(type="jpeg", quality=60)
        text = info["text"]
        if len(text) > max_text:
            text = text[:max_text] + f"\n...[page text truncated, {len(info['text'])} chars total; scroll or use browser_console_exec to read more]"
        return {
            "url": page.url,
            "title": await page.title(),
            "elements": elements,
            "text": text,
            "pixels_above": info["pixels_above"],
            "pixels_below": info["pixels_below"],
            "screenshot": base64.b64encode(shot).decode(),
        }


browser = Browser()


class BrowserReq(BaseModel):
    url: str = ""
    index: int | None = None
    coordinate_x: float | None = None
    coordinate_y: float | None = None
    text: str = ""
    press_enter: bool = False
    key: str = ""
    option: int = 0
    javascript: str = ""
    to_end: bool = False


async def _locate(page, req: BrowserReq):
    if req.index is not None:
        loc = page.locator(f'[data-manus-index="{req.index}"]')
        if await loc.count() == 0:
            raise HTTPException(400, f"element index {req.index} not found; call browser_view to refresh indexes")
        return loc.first
    return None


@app.post("/browser/{action}")
async def browser_action(action: str, req: BrowserReq):
    async with browser.lock:
        if action == "restart":
            await browser.restart()
            page = await browser.ensure()
            if req.url:
                await page.goto(req.url, timeout=45000, wait_until="domcontentloaded")
            return await browser.snapshot()
        page = await browser.ensure()
        try:
            if action == "navigate":
                await page.goto(req.url, timeout=45000, wait_until="domcontentloaded")
            elif action == "view":
                pass
            elif action == "click":
                loc = await _locate(page, req)
                if loc:
                    await loc.click(timeout=8000)
                elif req.coordinate_x is not None:
                    await page.mouse.click(req.coordinate_x, req.coordinate_y or 0)
                else:
                    raise HTTPException(400, "provide index or coordinates")
                await page.wait_for_timeout(800)
            elif action == "input":
                loc = await _locate(page, req)
                if loc:
                    await loc.fill(req.text, timeout=8000)
                    if req.press_enter:
                        await loc.press("Enter")
                elif req.coordinate_x is not None:
                    await page.mouse.click(req.coordinate_x, req.coordinate_y or 0)
                    await page.keyboard.type(req.text)
                    if req.press_enter:
                        await page.keyboard.press("Enter")
                else:
                    raise HTTPException(400, "provide index or coordinates")
                await page.wait_for_timeout(800)
            elif action == "move_mouse":
                await page.mouse.move(req.coordinate_x or 0, req.coordinate_y or 0)
            elif action == "press_key":
                await page.keyboard.press(req.key)
                await page.wait_for_timeout(500)
            elif action == "select_option":
                loc = await _locate(page, req)
                if not loc:
                    raise HTTPException(400, "index required")
                await loc.select_option(index=req.option)
            elif action in ("scroll_down", "scroll_up"):
                sign = 1 if action == "scroll_down" else -1
                if req.to_end:
                    await page.evaluate(f"window.scrollTo(0, {sign} > 0 ? document.documentElement.scrollHeight : 0)")
                else:
                    await page.evaluate(f"window.scrollBy(0, {sign} * window.innerHeight * 0.85)")
                await page.wait_for_timeout(400)
            elif action == "console_exec":
                result = await page.evaluate(req.javascript)
                snap = await browser.snapshot()
                snap["console_result"] = repr(result)[:20000]
                return snap
            elif action == "console_view":
                return {"url": page.url, "console": browser.console[-200:]}
            else:
                raise HTTPException(404, f"unknown browser action {action}")
        except HTTPException:
            raise
        except Exception as e:  # surface playwright errors to the model verbatim
            raise HTTPException(400, f"{type(e).__name__}: {e}")
        return await browser.snapshot()


# ------------------------------------------------------------ web extract ---
# Read-only page fetch in a throwaway context (Manus' `webpage_extract`): does not touch
# the shared browser page, so several extracts can run concurrently.

class ExtractReq(BaseModel):
    url: str
    max_chars: int = 30000


@app.post("/web/extract")
async def web_extract(req: ExtractReq):
    async with browser.launch_lock:
        b = await browser.launch()
    ctx = await b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US")
    try:
        page = await ctx.new_page()
        try:
            await page.goto(req.url, timeout=45000, wait_until="domcontentloaded")
            await page.wait_for_timeout(500)
            info = await page.evaluate(TEXT_JS)
            title = await page.title()
        except Exception as e:
            raise HTTPException(400, f"{type(e).__name__}: {e}")
        text = info["text"].strip()
        return {"url": page.url, "title": title, "text": text[:req.max_chars],
                "truncated": len(text) > req.max_chars, "total_chars": len(text)}
    finally:
        await ctx.close()


# ---------------------------------------------------------------- proxy ---
# Lets the backend expose a service the agent started on an internal port
# (deploy_expose_port) without publishing every container port.

proxy_client = httpx.AsyncClient(timeout=60)


@app.api_route("/proxy/{port}/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"])
async def proxy(port: int, path: str, request: Request):
    url = f"http://127.0.0.1:{port}/{path}"
    if request.url.query:
        url += "?" + request.url.query
    headers = {k: v for k, v in request.headers.items() if k.lower() not in {"host", "content-length"}}
    try:
        r = await proxy_client.request(request.method, url, headers=headers, content=await request.body())
    except httpx.HTTPError as e:
        raise HTTPException(502, f"nothing reachable on port {port}: {e}")
    drop = {"content-encoding", "transfer-encoding", "connection", "content-length"}
    return Response(r.content, status_code=r.status_code,
                    headers={k: v for k, v in r.headers.items() if k.lower() not in drop})


@app.get("/health")
async def health():
    return {"ok": True, "workspace": str(WORKSPACE), "time": time.time()}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=os.environ.get("SANDBOX_HOST", "0.0.0.0"), port=int(os.environ.get("SANDBOX_PORT", "8080")))
