"""Skill recorder (Manus' 技能录制器): demonstrate a workflow in a browser, get a reusable skill.

The user operates a browser while the action server's recorder logs what they do: in a dedicated cloud
sandbox (rec-<id>, shown live and interactive on the page) or in their own Chrome on a connected device.
On stop, the model turns the event log plus the user's notes into a SKILL.md draft the user reviews before
saving it as a personal skill.
"""

from __future__ import annotations

import secrets
import time

from . import llm
from .sandbox import manager


class RecordingError(ValueError):
    pass


class Recordings:
    def __init__(self):
        self.items: dict[str, dict] = {}

    def sandbox_id(self, r: dict) -> str:
        return r["target"].replace("dev:", "dev-", 1) if r["target"].startswith("dev:") else f"rec-{r['id']}"

    async def start(self, target: str, url: str, owner: str | None = None) -> dict:
        if url and "://" not in url:
            url = "https://" + url
        r = {"id": secrets.token_hex(4), "target": target or "cloud", "url": url, "startedAt": time.time(), "status": "recording", "owner": owner}
        self.items[r["id"]] = r
        sb = await manager.get(self.sandbox_id(r))
        r["vnc"] = sb.vnc
        await sb.call("/browser/record/start", {"url": url})
        return r

    async def events(self, rid: str) -> dict:
        r = self.items[rid]
        sb = manager.sandboxes.get(self.sandbox_id(r))
        if not sb:
            raise RecordingError("the recording browser is gone")
        resp = await sb.http.get("/browser/record/events")
        return resp.json()

    async def stop(self, rid: str, notes: str = "") -> dict:
        """Stop recording and draft a skill from what happened."""
        r = self.items[rid]
        sb = await manager.get(self.sandbox_id(r))
        log = (await sb.call("/browser/record/stop"))["events"]
        r["status"] = "stopped"
        if r["target"] == "cloud":
            await manager.destroy(self.sandbox_id(r))
        if not log:
            raise RecordingError("没有录到任何操作：请在浏览器里完成一遍流程再停止")
        steps = []
        for e in log:
            if e["type"] == "navigate":
                steps.append(f"- open {e['url']}")
            elif e["type"] == "click":
                steps.append(f"- click {e.get('target', '')}" + (f" (link to {e['href']})" if e.get("href") else "") + f"  [on {e.get('url', '')}]")
            elif e["type"] == "input":
                steps.append(f"- set {e.get('target', '')} = " + ("<secret: ask the user>" if e.get("secret") else repr(e.get("value", ""))))
            elif e["type"] in ("key", "submit"):
                steps.append(f"- {e['type']} {e.get('key', '')} {e.get('target', '')}".rstrip())
        draft = await llm.draft_recorded_skill("\n".join(steps[:400]), notes)
        if not draft:
            raise RecordingError("生成技能草稿失败，请重试")
        r["draft"] = draft
        return {"draft": draft, "events": len(log)}

    async def cancel(self, rid: str) -> None:
        r = self.items.pop(rid, None)
        if r and r["target"] == "cloud":
            await manager.destroy(self.sandbox_id(r))
        elif r:
            sb = manager.sandboxes.get(self.sandbox_id(r))
            if sb:
                await sb.call("/browser/record/stop")


store: Recordings | None = None
