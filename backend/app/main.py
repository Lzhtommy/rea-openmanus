"""App entry point: startup and shutdown of the stores and background loops, the middleware
(sign-in gate, published-site hosts, UI caching), the routers in routes/, and the built web UI."""

from __future__ import annotations

import asyncio
import contextlib
import json
import re
import logging

from fastapi import FastAPI, Request
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles

from . import agents, apikeys, auth, computers, mail, config, connectors, devices, recordings, media, personal, phone, sites, projects, skills, triggers as triggers_mod, providers, scheduler as scheduler_mod, session as session_mod
from .sandbox import manager
from .routes import ROUTERS
from .routes.common import proxy_port, serve_site

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    auth.store = auth.Users()
    apikeys.store = apikeys.ApiKeys()
    session_mod.store = session_mod.SessionStore()
    projects.store = projects.Projects()
    personal.store = personal.Personal()
    skills.store = skills.Skills()
    sites.store = sites.Sites()
    computers.store = computers.Computers()
    devices.store = devices.Devices()
    recordings.store = recordings.Recordings()
    agents.store = agents.Agents()
    asyncio.create_task(computers.store.resume())
    scheduler_mod.scheduler = scheduler_mod.Scheduler(session_mod.store)
    scheduler_mod.scheduler.start()
    triggers_mod.triggers = triggers_mod.Triggers(session_mod.store)
    triggers_mod.triggers.start()
    mail.poller = mail.MailManus(session_mod.store)
    mail.poller.start()
    def users(sbid: str) -> list:  # sessions acting in this sandbox (a computer can serve many)
        return [s for s in session_mod.store.sessions.values() if s.sandbox_id == sbid]

    def busy(sbid: str) -> bool:
        return any((s.task and not s.task.done()) or s.pending_confirms or s.status in ("running", "waiting") for s in users(sbid))

    def stopped(sbid: str) -> None:
        for s in users(sbid):
            asyncio.create_task(s.emit({"type": "sandboxUpdate", "sandboxId": sbid, "status": "stopped", "vnc": False}))

    manager.busy, manager.on_stopped = busy, stopped
    manager.reaper = asyncio.create_task(manager.reap_loop())
    connectors.manager = connectors.Connectors()
    connectors_started = asyncio.create_task(connectors.manager.start_all())
    asyncio.create_task(session_mod.store.resume_interrupted(connectors_started))
    yield
    await scheduler_mod.scheduler.stop()
    await triggers_mod.triggers.stop()
    await connectors.manager.stop_all()
    for s in session_mod.store.sessions.values():
        if s.task and not s.task.done():
            s.task.cancel()
    await manager.shutdown()

app = FastAPI(title="Manus-like agent platform", lifespan=lifespan)

# Paths that work without signing in: sign-in itself, public share replays, incoming webhooks (secret URL),
# the device connector (device token) and its downloads.
OPEN_PATHS = ("/api/integrations/", "/api/v1/", "/api/auth/", "/api/share/", "/api/hooks/", "/api/devices/connect", "/api/devices/agent.py", "/api/devices/server.py",
              "/api/config")

@app.middleware("http")
async def auth_gate(request: Request, call_next):
    """Multi-user mode: every API call runs as the signed-in user (auth.current), or gets 401."""
    if not request.url.path.startswith("/api/") or not auth.store or not auth.store.enabled:
        return await call_next(request)
    user = auth.store.from_token(request.cookies.get(auth.COOKIE))
    if not user and not request.url.path.startswith(OPEN_PATHS):
        return Response(json.dumps({"detail": "请先登录"}), status_code=401, media_type="application/json")
    token = auth.current.set(user)
    try:
        return await call_next(request)
    finally:
        auth.current.reset(token)

for router in ROUTERS:
    app.include_router(router)

@app.middleware("http")
async def site_hosts(request: Request, call_next):
    """<slug>.<sites domain> serves that published site (its own origin, so storage and scripts work)."""
    host, domain = request.headers.get("host", ""), sites.sites_domain()
    if host.endswith("." + domain) and sites.store:
        slug = host[: -len(domain) - 1]
        if m := re.fullmatch(r"pc-([0-9a-f]+)-(\d+)", slug):  # an opened port of a cloud computer
            c = computers.store.items.get(m.group(1)) if computers.store else None
            if not c or int(m.group(2)) not in {p["port"] for p in c["ports"]}:
                return Response("Port not opened", status_code=404, media_type="text/plain")
            sb = await manager.get(computers.sandbox_id(c["id"]))
            return await proxy_port(sb, int(m.group(2)), request)
        if request.method not in ("GET", "HEAD"):
            return Response("Method not allowed", status_code=405)
        return serve_site(slug, request.url.path, sandboxed=False)
    return await call_next(request)

@app.get("/api/config")
async def get_config():
    return {"model": providers.default_model(), "defaultMode": config.DEFAULT_MODE, "sandbox": config.SANDBOX_MODE, "planner": config.PLANNER_ENABLED,
            "search": "tavily" if config.TAVILY_API_KEY else "duckduckgo", "mail": mail.CFG["ADDRESS"] or (mail.CFG["USER"] if mail.enabled() else ""),
            "phone": phone.CFG["NUMBER"] if phone.enabled() else "", "media": media.capabilities()}

@app.middleware("http")
async def no_cache_static(request: Request, call_next):
    """Make browsers revalidate the UI (index.html is unhashed; hashed bundles just revalidate cheaply)."""
    response = await call_next(request)
    if not request.url.path.startswith(("/api/", "/preview/")):
        response.headers["Cache-Control"] = "no-cache"
    return response

if config.STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(config.STATIC_DIR), html=True), name="static")
else:
    @app.get("/", include_in_schema=False)
    async def ui_not_built():
        return Response("The web UI is not built yet: run `npm install && npm run build` in frontend/.",
                        status_code=503, media_type="text/plain; charset=utf-8")
