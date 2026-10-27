"""Personalization (Manus' 个性化): a profile, custom instructions, and knowledge.

The profile and custom instructions apply to every task. Knowledge entries are standing facts and
preferences ("reports in Chinese, numbers in 亿元", "my team uses Feishu") the user wrote, imported from
another assistant, or accepted after the agent proposed them with knowledge_save. Enabled entries are told
to the agent at the start of a task as a system note, never folded into the cached system prompt.
"""

from __future__ import annotations

import time
import uuid

from . import config, storage

PROFILE_FIELDS = {"nickname": 40, "occupation": 60, "about": 2000}
INSTRUCTIONS_MAX = 3000
KNOWLEDGE_MAX = 200


class Personal:
    def __init__(self, uid: str | None = None):
        self.path = config.DATA_DIR / (f"personal-{uid}.json" if uid else "personal.json")
        self.profile: dict[str, str] = {k: "" for k in PROFILE_FIELDS}
        self.instructions = ""
        self.knowledge: dict[str, dict] = {}
        if (d := storage.load_doc(self.path)) is not None:
            try:
                self.profile.update({k: str(v) for k, v in (d.get("profile") or {}).items() if k in PROFILE_FIELDS})
                self.instructions = str(d.get("instructions") or "")
                self.knowledge = {k["id"]: k for k in d.get("knowledge") or []}
            except (AttributeError, KeyError, TypeError):
                pass

    def save(self) -> None:
        storage.save_doc(self.path, {"profile": self.profile, "instructions": self.instructions,
                                     "knowledge": list(self.knowledge.values())})

    def view(self) -> dict:
        return {"profile": self.profile, "instructions": self.instructions,
                "knowledge": sorted(self.knowledge.values(), key=lambda k: -k["createdAt"])}

    def update(self, body: dict) -> dict:
        for k, limit in PROFILE_FIELDS.items():
            if k in (body.get("profile") or {}):
                self.profile[k] = str(body["profile"][k] or "").strip()[:limit]
        if "instructions" in body:
            self.instructions = str(body["instructions"] or "").strip()[:INSTRUCTIONS_MAX]
        self.save()
        return self.view()

    # ---- knowledge
    def add(self, title: str, content: str, source: str = "user", session_id: str | None = None,
            pending: bool = False) -> dict:
        """pending: proposed by the agent, applies only once the user accepts it."""
        title, content = str(title or "").strip()[:80], str(content or "").strip()[:2000]
        if not content:
            raise ValueError("知识内容不能为空")
        if len(self.knowledge) >= KNOWLEDGE_MAX:
            raise ValueError(f"最多保存 {KNOWLEDGE_MAX} 条知识")
        for k in self.knowledge.values():  # the same fact twice is one entry
            if k["content"] == content:
                return k
        k = {"id": uuid.uuid4().hex[:10], "title": title or content[:30], "content": content, "enabled": not pending,
             "pending": pending, "source": source, "sessionId": session_id, "createdAt": time.time()}
        self.knowledge[k["id"]] = k
        self.save()
        return k

    def edit(self, kid: str, body: dict) -> dict:
        k = self.knowledge[kid]
        if "title" in body:
            k["title"] = str(body["title"] or "").strip()[:80] or k["content"][:30]
        if "content" in body and str(body["content"] or "").strip():
            k["content"] = str(body["content"]).strip()[:2000]
        if "enabled" in body:
            k["enabled"] = bool(body["enabled"])
        if body.get("accept"):
            k["pending"], k["enabled"] = False, True
        self.save()
        return k

    def remove(self, kid: str) -> None:
        self.knowledge.pop(kid, None)
        self.save()

    # ---- what the agent is told
    def note(self) -> str:
        parts = []
        prof = [f"{label}: {self.profile[k]}" for k, label in
                (("nickname", "Name"), ("occupation", "Occupation"), ("about", "About")) if self.profile.get(k)]
        if prof:
            parts.append("<user_profile>\n" + "\n".join(prof) + "\n</user_profile>")
        if self.instructions:
            parts.append("<custom_instructions>\nThe user's standing instructions for every task (follow them unless "
                         f"the current request says otherwise):\n{self.instructions}\n</custom_instructions>")
        items = [k for k in self.knowledge.values() if k["enabled"] and not k.get("pending")]
        if items:
            rows = "\n".join(f"- [{k['id']}] {k['title']}: {k['content']}" for k in sorted(items, key=lambda k: k["createdAt"]))
            parts.append("<knowledge>\nFacts and preferences the user asked you to remember. Apply the relevant ones."
                         f"\n{rows}\n</knowledge>")
        return "\n\n".join(parts)


store: Personal | None = None  # single-user mode
_by_user: dict[str, Personal] = {}


def of(uid: str | None) -> Personal:
    """The profile, instructions and knowledge of one user (the shared one in single-user mode)."""
    if not uid:
        return store
    if uid not in _by_user:
        _by_user[uid] = Personal(uid)
    return _by_user[uid]
