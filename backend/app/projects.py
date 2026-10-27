"""Projects (Manus' 项目): group tasks under shared instructions and files.

Every task started in a project gets the project's instructions and a copy of its files in the sandbox
(~/project/), so recurring work ("our brand guide", "this codebase's conventions") need not be repeated.
"""

from __future__ import annotations

import re
import time
import uuid
from pathlib import Path

from . import config, storage


def _safe(name: str) -> str:
    name = Path(name).name.strip()
    return re.sub(r"[\x00-\x1f/\\]", "_", name)[:120] or "file"


class Projects:
    def __init__(self):
        self.root = config.DATA_DIR / "projects"
        self.path = config.DATA_DIR / "projects.json"
        self.items: dict[str, dict] = {p["id"]: p for p in storage.load_items(self.path)}

    def save(self) -> None:
        storage.save_items(self.path, self.items.values())

    def files_dir(self, pid: str) -> Path:
        d = self.root / pid / "files"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def view(self, p: dict) -> dict:
        files = [{"name": f.name, "size": f.stat().st_size, "updatedAt": f.stat().st_mtime,
                  "url": f"/api/projects/{p['id']}/files/{f.name}"} for f in sorted(self.files_dir(p["id"]).iterdir()) if f.is_file()]
        return {**p, "files": files}

    def list(self) -> list[dict]:
        return [self.view(p) for p in sorted(self.items.values(), key=lambda p: -p["createdAt"])]

    def create(self, name: str, instructions: str = "") -> dict:
        if not name.strip():
            raise ValueError("请填写项目名称")
        p = {"id": uuid.uuid4().hex[:10], "name": name.strip()[:60], "instructions": instructions.strip(), "createdAt": time.time()}
        self.items[p["id"]] = p
        self.save()
        return self.view(p)

    def update(self, pid: str, body: dict) -> dict:
        p = self.items[pid]
        if "name" in body and str(body["name"]).strip():
            p["name"] = str(body["name"]).strip()[:60]
        if "instructions" in body:
            p["instructions"] = str(body["instructions"]).strip()
        self.save()
        return self.view(p)

    def delete(self, pid: str) -> None:
        import shutil
        self.items.pop(pid, None)
        shutil.rmtree(self.root / pid, ignore_errors=True)
        self.save()

    def add_file(self, pid: str, filename: str, data: bytes) -> dict:
        if len(data) > 50 * 1024 * 1024:
            raise ValueError("文件超过 50MB")
        (self.files_dir(pid) / _safe(filename)).write_bytes(data)
        return self.view(self.items[pid])

    def file_path(self, pid: str, name: str) -> Path | None:
        f = self.files_dir(pid) / _safe(name)
        return f if f.is_file() else None

    def remove_file(self, pid: str, name: str) -> None:
        if f := self.file_path(pid, name):
            f.unlink()

    async def install(self, pid: str, sandbox) -> list[str]:
        """Copy the project's files into the sandbox (~/project/); returns their sandbox paths."""
        paths = []
        for f in sorted(self.files_dir(pid).iterdir()):
            if f.is_file():
                r = await sandbox.http.post("/file/upload", files={"file": (f.name, f.read_bytes())},
                                            data={"dir": f"{sandbox.workdir}/project"})
                if r.status_code < 400:
                    paths.append(r.json()["path"])
        return paths

    def note(self, pid: str, paths: list[str]) -> str:
        p = self.items.get(pid)
        if not p:
            return ""
        files = "\n".join(f"- {x}" for x in paths) or "(none)"
        instr = f"Project instructions (follow them for this task):\n{p['instructions']}\n" if p["instructions"] else ""
        return f"<project name=\"{p['name']}\">\n{instr}Project files (copied into the sandbox):\n{files}\n</project>"


store: Projects | None = None
