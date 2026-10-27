"""Skills: instruction packages the agent reads on demand (Manus ships them in the sandbox
as skills/<name>/SKILL.md and the agent opens the relevant one before starting work).

Only the catalog (name + description) goes into the context; the body is read with file_read
when needed, so adding skills costs almost nothing per task.

Three sources, as on Manus' skills page: official (shipped in backend/skills), personal (written or
uploaded by the user, or created by the agent in a task) and third-party (imported from GitHub). A skill
is a directory with SKILL.md (front matter: name, description, optional title and categories) and any
supporting files; the whole directory is copied into the sandbox. Only enabled skills are installed and
listed to the agent; the user can also pin skills to a single message.
"""

from __future__ import annotations

import io
import json
import logging
import re
import shutil
import time
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

import httpx

from . import config, storage
from .sandbox import Sandbox

log = logging.getLogger("manus.skills")

CATEGORIES = ["编程", "数据", "自动化", "商业", "设计", "媒体", "内容", "应用"]
MAX_FILES, MAX_BYTES = 200, 10 * 1024 * 1024
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")

# Third-party skills offered on the explore tab; fetched from GitHub only when the user adds one.
CATALOG = [
    {"name": "frontend-design", "title": "前端设计", "author": "anthropics", "categories": ["设计", "编程"],
     "description": "做出有辨识度、达到生产质量的网页界面，避免千篇一律的 AI 审美：排版、配色、动效和布局的完整方法。",
     "url": "https://github.com/anthropics/skills/tree/main/skills/frontend-design"},
    {"name": "webapp-testing", "title": "Web 应用测试", "author": "anthropics", "categories": ["编程"],
     "description": "用 Playwright 驱动本地 Web 应用做端到端测试：启动服务、检查界面、截图和读取浏览器日志。",
     "url": "https://github.com/anthropics/skills/tree/main/skills/webapp-testing"},
    {"name": "mcp-builder", "title": "MCP 服务器构建", "author": "anthropics", "categories": ["编程", "自动化"],
     "description": "设计并实现高质量的 MCP 服务器，让大模型通过精心设计的工具调用外部服务（Python 或 TypeScript）。",
     "url": "https://github.com/anthropics/skills/tree/main/skills/mcp-builder"},
    {"name": "algorithmic-art", "title": "算法艺术", "author": "anthropics", "categories": ["设计", "媒体"],
     "description": "用 p5.js 创作生成式艺术：带随机种子的流场、粒子系统和交互参数探索。",
     "url": "https://github.com/anthropics/skills/tree/main/skills/algorithmic-art"},
    {"name": "theme-factory", "title": "主题工厂", "author": "anthropics", "categories": ["设计", "内容"],
     "description": "为幻灯片、文档、报告和网页套用成套的配色与字体主题，也可以即时生成新主题。",
     "url": "https://github.com/anthropics/skills/tree/main/skills/theme-factory"},
    {"name": "doc-coauthoring", "title": "文档协作撰写", "author": "anthropics", "categories": ["内容"],
     "description": "按结构化流程与用户共同撰写方案、技术规格、决策文档：收集背景、逐节迭代、读者视角检验。",
     "url": "https://github.com/anthropics/skills/tree/main/skills/doc-coauthoring"},
    {"name": "internal-comms", "title": "内部沟通", "author": "anthropics", "categories": ["商业", "内容"],
     "description": "按公司惯用格式撰写各类内部沟通材料：状态报告、领导层更新、周报、事故报告和 FAQ。",
     "url": "https://github.com/anthropics/skills/tree/main/skills/internal-comms"},
    {"name": "slack-gif-creator", "title": "动图制作", "author": "anthropics", "categories": ["媒体"],
     "description": "制作适合聊天软件使用的小尺寸动图，内置尺寸、帧率和文件大小的校验。",
     "url": "https://github.com/anthropics/skills/tree/main/skills/slack-gif-creator"},
]


class SkillError(ValueError):
    pass


@dataclass
class Skill:
    name: str
    description: str
    path: Path  # directory holding SKILL.md
    source: str  # official | personal | github
    title: str = ""
    categories: list[str] = field(default_factory=list)
    author: str = ""
    summary: str = ""  # what the user reads on the card; `description` is the agent's trigger

    @property
    def text(self) -> str:
        return (self.path / "SKILL.md").read_text()


def parse_front(text: str) -> tuple[dict, str]:
    """(front matter, body) of a SKILL.md."""
    if not text.startswith("---"):
        return {}, text
    head, sep, body = text[3:].lstrip("\r\n").partition("\n---")
    if not sep:
        return {}, text
    meta = {}
    for line in head.splitlines():
        k, colon, v = line.partition(":")
        if colon and k.strip() and not k.startswith((" ", "\t")):
            meta[k.strip()] = v.strip().strip('"').strip("'")
    return meta, body.lstrip("-").lstrip("\r\n")


def render_front(meta: dict, body: str) -> str:
    lines = [f"{k}: {json.dumps(v, ensure_ascii=False) if any(c in v for c in ':#') else v}" for k, v in meta.items() if v]
    return "---\n" + "\n".join(lines) + "\n---\n\n" + body.lstrip()


def _cats(v: str) -> list[str]:
    return [c.strip() for c in re.split(r"[,，、]", v or "") if c.strip() in CATEGORIES]


def _slug(s: str) -> str:
    s = re.sub(r"[^a-z0-9-]+", "-", s.lower()).strip("-")[:64]
    return s or f"skill-{int(time.time())}"


class Skills:
    def __init__(self):
        self.root = config.DATA_DIR / "skills"
        self.state_path = config.DATA_DIR / "skills.json"
        self.state: dict[str, dict] = storage.load_doc(self.state_path) or {}  # name -> {enabled, uses, source, repo, createdAt}
        self.items: dict[str, Skill] = {}
        self.reload()

    def save(self) -> None:
        storage.save_doc(self.state_path, self.state)

    def _load_dir(self, d: Path, source: str) -> Skill | None:
        f = d / "SKILL.md"
        if not f.is_file():
            return None
        meta, _ = parse_front(f.read_text())
        name = meta.get("name") or d.name
        return Skill(name, meta.get("description", ""), d, source, meta.get("title", ""), _cats(meta.get("categories", "")),
                     meta.get("author", "") or ("OpenManus" if source == "official" else ""), meta.get("summary", ""))

    def reload(self) -> None:
        self.items = {}
        for d in sorted(config.SKILLS_DIR.glob("*/")):
            if s := self._load_dir(d, "official"):
                self.items[s.name] = s
        self.root.mkdir(parents=True, exist_ok=True)
        for d in sorted(self.root.glob("*/")):
            st = self.state.get(d.name, {})
            if (s := self._load_dir(d, st.get("source", "personal"))) and s.name not in self.items:
                s.name = d.name  # the directory name is the identity of a user skill
                self.items[s.name] = s

    def enabled(self, name: str) -> bool:
        return self.state.get(name, {}).get("enabled", True)

    def view(self, s: Skill, full: bool = False) -> dict:
        st = self.state.get(s.name, {})
        v = {"name": s.name, "title": s.title or s.name, "description": s.description, "summary": s.summary or s.description, "categories": s.categories,
             "author": s.author or ("我" if s.source == "personal" else ""), "source": s.source, "enabled": self.enabled(s.name),
             "uses": st.get("uses", 0), "repo": st.get("repo"), "createdAt": st.get("createdAt"), "editable": s.source == "personal"}
        if full:
            v["content"] = s.text
            v["files"] = sorted(str(p.relative_to(s.path)) for p in s.path.rglob("*") if p.is_file())
        return v

    def list(self) -> dict:
        return {"skills": [self.view(s) for s in self.items.values()],
                "catalog": [{**c, "installed": c["name"] in self.items} for c in CATALOG],
                "categories": CATEGORIES}

    def get(self, name: str) -> Skill:
        if name not in self.items:
            raise KeyError(name)
        return self.items[name]

    # ---- state
    def set_enabled(self, name: str, on: bool) -> dict:
        self.get(name)
        self.state.setdefault(name, {})["enabled"] = on
        self.save()
        return self.view(self.items[name])

    def used(self, name: str) -> None:
        if name in self.items:
            st = self.state.setdefault(name, {})
            st["uses"] = st.get("uses", 0) + 1
            self.save()

    # ---- create / edit / delete
    def _write(self, name: str, files: dict[str, bytes], source: str, repo: str | None = None) -> Skill:
        if name in self.items and self.items[name].source == "official":
            raise SkillError(f"「{name}」与官方技能重名，请换一个名称")
        if "SKILL.md" not in files:
            raise SkillError("缺少 SKILL.md")
        if len(files) > MAX_FILES or sum(len(b) for b in files.values()) > MAX_BYTES:
            raise SkillError("技能文件过多或过大（上限 200 个文件、10MB）")
        meta, body = parse_front(files["SKILL.md"].decode("utf-8", "replace"))
        if not meta.get("description"):
            raise SkillError("SKILL.md 开头需要包含 name 和 description（YAML front matter）")
        meta["name"] = name
        files["SKILL.md"] = render_front(meta, body).encode()
        d = self.root / name
        tmp = self.root / f".{name}.tmp"
        shutil.rmtree(tmp, ignore_errors=True)
        for rel, data in files.items():
            p = (tmp / rel).resolve()
            if not str(p).startswith(str(tmp.resolve()) + "/"):
                raise SkillError(f"非法路径：{rel}")
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(data)
        shutil.rmtree(d, ignore_errors=True)
        tmp.rename(d)
        prev = self.state.get(name, {})
        self.state[name] = {**prev, "source": source, "enabled": prev.get("enabled", True),
                            "createdAt": prev.get("createdAt") or time.time(), **({"repo": repo} if repo else {})}
        self.save()
        self.reload()
        return self.items[name]

    def create(self, body: dict) -> dict:
        name = _slug(str(body.get("name") or body.get("title") or ""))
        if name in self.items and not body.get("overwrite"):
            raise SkillError(f"已存在名为「{name}」的技能")
        meta = {"name": name, "description": str(body.get("description") or "").strip().replace("\n", " "),
                "title": str(body.get("title") or "").strip(), "summary": str(body.get("summary") or "").strip().replace("\n", " "),
                "categories": "、".join(c for c in body.get("categories") or [] if c in CATEGORIES)}
        text = render_front(meta, str(body.get("body") or "").strip() or f"# {meta['title'] or name}\n")
        return self.view(self._write(name, {"SKILL.md": text.encode()}, "personal"), full=True)

    def update(self, name: str, content: str) -> dict:
        s = self.get(name)
        if s.source != "personal":
            raise SkillError("只能编辑个人技能")
        files = {str(p.relative_to(s.path)): p.read_bytes() for p in s.path.rglob("*") if p.is_file()}
        files["SKILL.md"] = content.encode()
        return self.view(self._write(name, files, "personal"), full=True)

    def delete(self, name: str) -> None:
        s = self.get(name)
        if s.source == "official":
            raise SkillError("官方技能不能删除，可以停用")
        shutil.rmtree(s.path, ignore_errors=True)
        self.state.pop(name, None)
        self.save()
        self.reload()

    # ---- import
    def from_files(self, files: dict[str, bytes], source: str, repo: str | None = None, name: str = "",
                   extra: dict | None = None) -> dict:
        """files keyed by path relative to the skill directory (SKILL.md at the top); `extra` fills display
        fields (title, summary, categories, author) the SKILL.md does not set."""
        meta, body = parse_front(files.get("SKILL.md", b"").decode("utf-8", "replace"))
        if extra and meta:
            meta = {**{k: v for k, v in extra.items() if v}, **{k: v for k, v in meta.items() if v}}
            files = {**files, "SKILL.md": render_front(meta, body).encode()}
        return self.view(self._write(_slug(name or meta.get("name", "")), files, source, repo), full=True)

    def from_upload(self, filename: str, data: bytes) -> dict:
        if filename.lower().endswith(".zip"):
            try:
                z = zipfile.ZipFile(io.BytesIO(data))
            except zipfile.BadZipFile:
                raise SkillError("无法读取 zip 文件")
            entries = [i for i in z.infolist() if not i.is_dir() and "__MACOSX" not in i.filename]
            tops = [i.filename for i in entries if i.filename.rsplit("/", 1)[-1] == "SKILL.md"]
            if not tops:
                raise SkillError("zip 中没有 SKILL.md")
            base = min(tops, key=len).rsplit("SKILL.md", 1)[0]  # the shallowest SKILL.md is the skill root
            if len(entries) > MAX_FILES or sum(i.file_size for i in entries) > MAX_BYTES:
                raise SkillError("技能文件过多或过大（上限 200 个文件、10MB）")
            files = {i.filename[len(base):]: z.read(i) for i in entries if i.filename.startswith(base)}
            return self.from_files(files, "personal", name=base.strip("/").rsplit("/", 1)[-1])
        if filename.lower().endswith(".md"):
            text = data.decode("utf-8", "replace")
            meta, body = parse_front(text)
            if not meta.get("description"):  # a plain markdown file: derive the front matter
                first = next((l.strip("# ").strip() for l in text.splitlines() if l.strip()), "")
                stem = filename.rsplit("/", 1)[-1][:-3]
                meta = {"name": _slug(stem if stem.upper() != "SKILL" else first), "description": first[:200]}
                text = render_front(meta, text)
            return self.from_files({"SKILL.md": text.encode()}, "personal")
        raise SkillError("请上传 SKILL.md 或包含 SKILL.md 的 .zip")

    async def from_github(self, url: str) -> dict:
        """https://github.com/<owner>/<repo>[/tree/<ref>/<path>] -> the skill in that directory."""
        m = re.match(r"^https?://github\.com/([\w.-]+)/([\w.-]+?)(?:\.git)?(?:/(?:tree|blob)/([^/]+)(?:/(.*?))?)?/?$", url.strip())
        if not m:
            raise SkillError("请填写 GitHub 仓库或目录地址，例如 https://github.com/owner/repo/tree/main/skills/xxx")
        owner, repo, ref, path = m.group(1), m.group(2), m.group(3), (m.group(4) or "").removesuffix("/SKILL.md")
        async with httpx.AsyncClient(timeout=30, follow_redirects=True, headers={"Accept": "application/vnd.github+json"}) as c:
            if not ref:
                r = await c.get(f"https://api.github.com/repos/{owner}/{repo}")
                if r.status_code != 200:
                    raise SkillError(f"找不到仓库 {owner}/{repo}")
                ref = r.json()["default_branch"]
            r = await c.get(f"https://api.github.com/repos/{owner}/{repo}/git/trees/{ref}?recursive=1")
            if r.status_code != 200:
                raise SkillError(f"读取仓库失败（HTTP {r.status_code}）")
            prefix = f"{path}/" if path else ""
            blobs = [t for t in r.json().get("tree", []) if t["type"] == "blob" and t["path"].startswith(prefix)]
            if not any(t["path"] == f"{prefix}SKILL.md" for t in blobs):
                raise SkillError("该目录下没有 SKILL.md")
            if len(blobs) > MAX_FILES or sum(t.get("size", 0) for t in blobs) > MAX_BYTES:
                raise SkillError("技能文件过多或过大（上限 200 个文件、10MB）")
            files = {}
            for t in blobs:
                rr = await c.get(f"https://raw.githubusercontent.com/{owner}/{repo}/{ref}/{t['path']}")
                if rr.status_code != 200:
                    raise SkillError(f"下载 {t['path']} 失败")
                files[t["path"][len(prefix):]] = rr.content
        name = path.rsplit("/", 1)[-1] if path else repo
        listed = next((c for c in CATALOG if c["url"].rstrip("/") == url.strip().rstrip("/")), {})
        extra = {"author": listed.get("author") or owner, "title": listed.get("title", ""), "summary": listed.get("description", ""),
                 "categories": "、".join(listed.get("categories", []))}
        return self.from_files(files, "github", repo=f"https://github.com/{owner}/{repo}/tree/{ref}/{path}".rstrip("/"),
                               name=name, extra=extra)

    async def from_sandbox(self, sandbox: Sandbox, skill_md: str) -> dict:
        """A skill the agent wrote in a task: the directory holding the given SKILL.md."""
        d = skill_md.rsplit("/", 1)[0]
        listing = await sandbox.call("/file/find_by_name", {"path": d, "glob": "*"})
        files = {}
        for p in listing["files"][:MAX_FILES + 1]:
            r = await sandbox.http.get("/file/download", params={"path": p})
            if r.status_code == 200:
                files[p[len(d) + 1:]] = r.content
        if "SKILL.md" not in files:
            raise SkillError("找不到 SKILL.md")
        return self.from_files(files, "personal", name=d.rsplit("/", 1)[-1])

    # ---- sandbox
    async def install(self, sandbox: Sandbox, extra: set[str] = frozenset()) -> None:
        """Copy enabled skills (and `extra`, skills picked for one message even if disabled) into the sandbox."""
        for s in self.items.values():
            if not self.enabled(s.name) and s.name not in extra:
                continue
            for p in s.path.rglob("*"):
                if p.is_file():
                    rel = p.relative_to(s.path)
                    await sandbox.http.post("/file/upload", files={"file": (rel.name, p.read_bytes())},
                                            data={"dir": f"{sandbox.skills_dir}/{s.name}/{rel.parent}".rstrip("/.")})

    def catalog(self, sandbox: Sandbox) -> str:
        rows = "\n".join(f"- {s.name} ({sandbox.skills_dir}/{s.name}/SKILL.md): {s.description}"
                         for s in self.items.values() if self.enabled(s.name))
        return (f"<skills>\nRead a skill's SKILL.md with file_read before starting work it applies to.\n{rows}\n</skills>"
                if rows else "")


store: Skills | None = None
