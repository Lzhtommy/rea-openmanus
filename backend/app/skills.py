"""Skills: instruction packages the agent reads on demand (Manus ships them in the sandbox
as skills/<name>/SKILL.md and the agent opens the relevant one before starting work).

Only the catalog (name + description) goes into the context; the body is read with file_read
when needed, so adding skills costs almost nothing per task.
"""

from __future__ import annotations

from dataclasses import dataclass

from . import config
from .sandbox import Sandbox


@dataclass
class Skill:
    name: str
    description: str
    text: str


def _load() -> list[Skill]:
    items = []
    for p in sorted(config.SKILLS_DIR.glob("*/SKILL.md")):
        text = p.read_text()
        meta = {}
        if text.startswith("---\n"):
            head = text[4:].split("\n---\n", 1)[0]
            meta = dict(line.split(":", 1) for line in head.splitlines() if ":" in line)
        items.append(Skill(meta.get("name", p.parent.name).strip(), meta.get("description", "").strip(), text))
    return items


SKILLS = _load()


async def install(sandbox: Sandbox) -> None:
    for s in SKILLS:
        await sandbox.call("/file/write", {"file": f"{sandbox.workdir}/skills/{s.name}/SKILL.md", "content": s.text})


def catalog(sandbox: Sandbox) -> str:
    rows = "\n".join(f"- {s.name} ({sandbox.workdir}/skills/{s.name}/SKILL.md): {s.description}" for s in SKILLS)
    return (f"<skills>\nRead a skill's SKILL.md with file_read before starting work it applies to.\n{rows}\n</skills>"
            if SKILLS else "")
