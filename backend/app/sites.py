"""Creations (Manus' 创作 / webdev hosting): websites, games and apps published from a task.

deploy_publish copies a static site directory (with index.html) out of the sandbox into versioned storage
(data/sites/<id>/v<n>/), so the site stays online after the sandbox is reclaimed. Publishing the same
directory from the same task again adds a version; any version can be made current.

Isolation: a published site runs its own scripts, so it must not share an origin with OpenManus (it could
call the API). Each site gets its own host, <slug>.<sites domain> (with localhost, browsers resolve
*.localhost to this machine), and a path fallback /sites/<slug>/ served with a CSP sandbox.
"""

from __future__ import annotations

import json
import mimetypes
import shlex
import re
import secrets
import shutil
import time
from pathlib import Path
from urllib.parse import urlparse

from . import config

KINDS = ("website", "game", "app")
MAX_FILES, MAX_BYTES = 800, 150 * 1024 * 1024
SKIP_DIRS = ("node_modules/", ".git/", "__pycache__/", ".venv/")


class SiteError(ValueError):
    pass


def sites_domain() -> str:
    """Host suffix for site subdomains, e.g. localhost:8000 (MANUS_SITES_DOMAIN overrides)."""
    if config.SITES_DOMAIN:
        return config.SITES_DOMAIN
    return urlparse(config.PUBLIC_BASE_URL).netloc or "localhost:8000"


def _slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:30].strip("-")
    return s


class Sites:
    def __init__(self):
        self.root = config.DATA_DIR / "sites"
        self.path = config.DATA_DIR / "sites.json"
        self.items: dict[str, dict] = {}
        if self.path.exists():
            try:
                self.items = {s["id"]: s for s in json.loads(self.path.read_text())}
            except (ValueError, KeyError):
                self.items = {}

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(list(self.items.values()), ensure_ascii=False, indent=1))

    def url(self, s: dict) -> str:
        scheme = urlparse(config.PUBLIC_BASE_URL).scheme or "http"
        return f"{scheme}://{s['slug']}.{sites_domain()}/"

    def view(self, s: dict) -> dict:
        return {**s, "url": self.url(s), "pathUrl": f"{config.PUBLIC_BASE_URL}/sites/{s['slug']}/",
                "thumbUrl": f"/api/sites/{s['id']}/thumb" if (self.root / s["id"] / "thumb.jpg").exists() else ""}

    def list(self) -> list[dict]:
        return [self.view(s) for s in sorted(self.items.values(), key=lambda s: -s["updatedAt"])]

    def by_slug(self, slug: str) -> dict | None:
        return next((s for s in self.items.values() if s["slug"] == slug), None)

    def _unique_slug(self, title: str) -> str:
        base = _slugify(title) or "site"
        for _ in range(20):
            slug = f"{base}-{secrets.token_hex(2)}"
            if not self.by_slug(slug):
                return slug
        raise SiteError("could not allocate a site address")

    async def publish(self, sandbox, session_id: str, path: str, title: str, kind: str = "website",
                      description: str = "") -> dict:
        if kind not in KINDS:
            kind = "website"
        src = path.rstrip("/") or "."
        if src.endswith(".html"):
            src = src.rsplit("/", 1)[0] if "/" in src else "."
        # the canonical absolute folder, as the sandbox's file listing will spell it
        r = await sandbox.call("/shell/exec", {"id": "publish", "timeout": 10,
                                               "command": f"cd {shlex.quote(src)} && echo \"@@$(pwd -P)@@\""})
        m = re.search(r"@@(/.*?)@@", r.get("output", ""))
        if not m:
            raise SiteError(f"folder not found: {path}")
        src = m.group(1)
        listing = await sandbox.call("/file/find_by_name", {"path": src, "glob": "*"})
        files = [f for f in listing["files"] if not any(f"/{d}" in f[len(src):] + "/" for d in SKIP_DIRS)]
        if f"{src}/index.html" not in files:
            raise SiteError(f"{src} has no index.html; build the site first (e.g. npm run build) and publish the output folder")
        if len(files) > MAX_FILES:
            raise SiteError(f"too many files ({len(files)} > {MAX_FILES}); publish the built output folder only")
        site = next((s for s in self.items.values() if s["sessionId"] == session_id and s["sourcePath"] == src), None)
        if not site:
            site = {"id": secrets.token_hex(5), "slug": self._unique_slug(title), "sessionId": session_id, "sourcePath": src,
                    "createdAt": time.time(), "versions": [], "current": 0}
        n = max((v["n"] for v in site["versions"]), default=0) + 1
        dest = self.root / site["id"] / f"v{n}"
        total = 0
        try:
            for f in files:
                r = await sandbox.http.get("/file/download", params={"path": f})
                if r.status_code != 200:
                    continue
                total += len(r.content)
                if total > MAX_BYTES:
                    raise SiteError("site is larger than 150MB")
                out = dest / f[len(src) + 1:]
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_bytes(r.content)
        except Exception:
            shutil.rmtree(dest, ignore_errors=True)
            raise
        site.update(title=title.strip()[:60] or "未命名站点", kind=kind, description=description.strip()[:300],
                    updatedAt=time.time(), current=n)
        site["versions"] = site["versions"] + [{"n": n, "at": time.time(), "files": len(files), "bytes": total}]
        self.items[site["id"]] = site
        self.save()
        try:  # cover image: the published index rendered in the sandbox
            shot = await sandbox.call("/web/screenshot", {"url": f"{src}/index.html"})
            import base64
            (self.root / site["id"] / "thumb.jpg").write_bytes(base64.b64decode(shot["image"]))
        except Exception:  # noqa: BLE001 — a site without a cover is still published
            pass
        return self.view(site)

    def update(self, sid: str, body: dict) -> dict:
        s = self.items[sid]
        if "title" in body and str(body["title"]).strip():
            s["title"] = str(body["title"]).strip()[:60]
        if body.get("kind") in KINDS:
            s["kind"] = body["kind"]
        if "current" in body:
            n = int(body["current"])
            if not any(v["n"] == n for v in s["versions"]):
                raise SiteError("no such version")
            s["current"] = n
        s["updatedAt"] = time.time()
        self.save()
        return self.view(s)

    def delete(self, sid: str) -> None:
        self.items.pop(sid, None)
        shutil.rmtree(self.root / sid, ignore_errors=True)
        self.save()

    def file(self, s: dict, rel: str) -> Path | None:
        """The file for a request path in the current version (SPA fallback to index.html)."""
        base = (self.root / s["id"] / f"v{s['current']}").resolve()
        rel = rel.lstrip("/") or "index.html"
        p = (base / rel).resolve()
        if not str(p).startswith(str(base)):
            return None
        if p.is_dir():
            p = p / "index.html"
        if p.is_file():
            return p
        if "." not in rel.rsplit("/", 1)[-1]:  # client-side routes
            idx = base / "index.html"
            return idx if idx.is_file() else None
        return None


def content_type(p: Path) -> str:
    return mimetypes.guess_type(p.name)[0] or "application/octet-stream"


store: Sites | None = None
