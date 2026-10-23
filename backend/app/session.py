"""Sessions: event log (UI protocol), LLM history, plan, inbox, and the running agent task.

Event envelope mirrors what Manus' web client consumes over its socket:
  {"type": "event", "sessionId": ..., "event": {"type": "chat"|"toolUsed"|"planUpdate"|
   "statusUpdate"|"liveStatus"|"explanation"|"title"|"sandboxUpdate", "id": ..., "seq": n,
   "timestamp": ms, ...}}
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import mimetypes
import logging
import time
from pathlib import Path

from . import config, connectors, llm, personal, projects, providers, skills
from .agent import Agent, AgentHost, now_ms, render_plan, short_id
from .sandbox import manager

log = logging.getLogger("manus.session")


class Session(AgentHost):
    def __init__(self, sid: str, title: str = "New task", created_at: float | None = None):
        self.session_id = sid
        self.title = title
        self.created_at = created_at or time.time()
        self.status = "idle"  # idle | running | waiting | stopped | error
        self.events: list[dict] = []
        self.messages: list[dict] = []
        self.plan: list[dict] = []
        self.inbox: list[str] = []
        self.pending_reply: asyncio.Future | None = None
        self.pending_confirms: dict[str, asyncio.Future] = {}
        self.mr_controls: dict[str, asyncio.Queue] = {}  # running map-reduce batches -> control queue
        self.map_reduce_cache: dict[str, str] = {}
        self.approved: set[str] = set()
        self.files: dict[str, dict] = {}  # sandbox path -> stored copy (survives the sandbox)
        self.schedule_id: str | None = None  # set when a scheduled task started this session
        self.trigger_id: str | None = None  # set when a trigger (webhook / condition) started this session
        self.project_id: str | None = None  # project this task belongs to (instructions + files)
        self.project_announced = False
        self.share: dict | None = None  # {token, createdAt}: public read-only replay link
        self.connectors_note = ""  # last connector summary told to the agent (re-sent when it changes)
        self.skills_note = ""  # last skills catalog told to the agent (re-sent when skills are added or disabled)
        self.picked_skills: set[str] = set()  # skills the user pinned to a message (installed even if disabled)
        self.personal_note = ""  # last profile / instructions / knowledge told to the agent (re-sent when it changes)
        self.model_selection: dict = {}  # {mode, provider?, model?} chosen in the UI (Manus' mode selector)
        self.task: asyncio.Task | None = None
        self.subscribers: set[asyncio.Queue] = set()
        self.dir = config.SESSIONS_DIR / sid
        self.dir.mkdir(parents=True, exist_ok=True)
        (self.dir / "shots").mkdir(exist_ok=True)
        (self.dir / "files").mkdir(exist_ok=True)
        self.env_announced = False

    # ------------------------------------------------------- persistence ---

    def meta(self) -> dict:
        return {"id": self.session_id, "title": self.title, "createdAt": self.created_at,
                "status": self.status, "plan": self.plan, "scheduleId": self.schedule_id, "triggerId": self.trigger_id,
                "model": self.model_selection, "shared": bool(self.share), "projectId": self.project_id}

    def persist(self) -> None:
        (self.dir / "meta.json").write_text(json.dumps({**self.meta(), "envAnnounced": self.env_announced,
                                                        "files": self.files, "share": self.share,
                                                        "mrCache": self.map_reduce_cache,
                                                        "projectAnnounced": self.project_announced,
                                                        "personalNote": self.personal_note, "skillsNote": self.skills_note}, ensure_ascii=False))
        (self.dir / "messages.json").write_text(json.dumps(self.messages, ensure_ascii=False))

    @classmethod
    def load(cls, d: Path) -> "Session":
        meta = json.loads((d / "meta.json").read_text())
        s = cls(meta["id"], meta.get("title", "Task"), meta.get("createdAt"))
        s.plan = meta.get("plan", [])
        s.env_announced = meta.get("envAnnounced", False)
        s.files = meta.get("files", {})
        s.schedule_id = meta.get("scheduleId")
        s.trigger_id = meta.get("triggerId")
        s.model_selection = meta.get("model") or {}
        s.share = meta.get("share")
        s.project_id = meta.get("projectId")
        s.project_announced = meta.get("projectAnnounced", False)
        s.map_reduce_cache = meta.get("mrCache", {})
        s.personal_note = meta.get("personalNote", "")
        s.skills_note = meta.get("skillsNote", "")
        s.status = meta.get("status", "idle")
        if s.status in ("running", "waiting"):
            s.status = "stopped"  # process restarted mid-run
        if (d / "messages.json").exists():
            s.messages = json.loads((d / "messages.json").read_text())
        if (d / "events.jsonl").exists():
            s.events = [json.loads(l) for l in (d / "events.jsonl").read_text().splitlines() if l.strip()]
        return s

    # ------------------------------------------------------------ events ---

    async def emit(self, event: dict) -> None:
        event = {**event, "id": event.get("id") or short_id(), "timestamp": now_ms(), "seq": len(self.events)}
        if event["type"] in ("liveStatus", "chatDelta"):  # ephemeral: broadcast, don't log
            self._broadcast(event)
            return
        if event["type"] == "statusUpdate":
            self.status = {"running": "running", "waiting": "waiting", "stopped": "stopped",
                           "error": "error", "idle": "idle"}.get(event.get("agentStatus"), self.status)
        self.events.append(event)
        with open(self.dir / "events.jsonl", "a") as f:
            f.write(json.dumps(event, ensure_ascii=False) + "\n")
        self._broadcast(event)

    def _broadcast(self, event: dict) -> None:
        msg = {"type": "event", "sessionId": self.session_id, "event": event}
        for q in list(self.subscribers):
            q.put_nowait(msg)

    def replay_after(self, seq: int) -> list[dict]:
        return [{"type": "event", "sessionId": self.session_id, "event": e} for e in self.events if e["seq"] > seq]

    # ------------------------------------------------------ host hooks ---

    def drain_inbox(self) -> list[str]:
        msgs, self.inbox = self.inbox, []
        return msgs

    async def ask_user(self, text: str, attachments: list[dict], takeover: str, stream_id: str = "") -> str:
        await self.emit({"type": "chat", "sender": "assistant", "messageType": "ask", "content": text,
                         "attachments": attachments, "takeover": takeover, "streamId": stream_id})
        await self.emit({"type": "statusUpdate", "agentStatus": "waiting", "description": "Waiting for your reply"})
        self.pending_reply = asyncio.get_event_loop().create_future()
        try:
            reply = await self.pending_reply
        finally:
            self.pending_reply = None
        await self.emit({"type": "statusUpdate", "agentStatus": "running"})
        return reply

    async def confirm(self, action_id: str) -> bool:
        fut = asyncio.get_event_loop().create_future()
        self.pending_confirms[action_id] = fut
        await self.emit({"type": "statusUpdate", "agentStatus": "waiting", "description": "等待你确认操作"})
        try:
            return await fut
        finally:
            self.pending_confirms.pop(action_id, None)
            if not self.pending_confirms:
                await self.emit({"type": "statusUpdate", "agentStatus": "running"})

    def map_reduce_controls(self, action_id: str) -> asyncio.Queue:
        self.mr_controls[action_id] = asyncio.Queue()
        return self.mr_controls[action_id]

    def map_reduce_done(self, action_id: str) -> None:
        self.mr_controls.pop(action_id, None)
        self.persist()

    def control_map_reduce(self, action_id: str, op: str, index: int | None = None) -> bool:
        q = self.mr_controls.get(action_id)
        if not q or op not in ("retry", "cancel", "force_continue"):
            return False
        q.put_nowait((op, index))
        return True

    def resolve_confirm(self, action_id: str, approved: bool) -> bool:
        fut = self.pending_confirms.get(action_id)
        if not fut or fut.done():
            return False
        fut.set_result(approved)
        return True

    # ------------------------------------------------------- file store ---
    # Copies of deliverables, files the agent wrote, and uploads, kept outside the sandbox (Manus
    # syncs sandbox files to object storage) so they outlive the container and feed the library.

    MAX_KEEP = 50 * 1024 * 1024

    async def keep_file(self, path: str, kind: str) -> None:
        from .sandbox import SandboxError
        sb = manager.sandboxes.get(self.session_id)
        if not sb:
            return
        if not path.startswith("/"):
            path = f"{sb.workdir}/{path}"
        try:
            r = await sb.http.get("/file/download", params={"path": path})
        except Exception as e:  # never fail a tool call because a copy could not be kept
            log.warning("keep_file %s: %s", path, e)
            return
        if r.status_code != 200 or len(r.content) > self.MAX_KEEP:
            return
        name = path.rsplit("/", 1)[-1]
        stored = hashlib.sha1(path.encode()).hexdigest()[:16] + (("." + name.rsplit(".", 1)[-1]) if "." in name else "")
        (self.dir / "files" / stored).write_bytes(r.content)
        prev = self.files.get(path, {})
        kinds = sorted(set(prev.get("kinds", [])) | {kind})
        self.files[path] = {"path": path, "filename": name, "size": len(r.content), "stored": stored, "kinds": kinds,
                            "mime": r.headers.get("content-type") or mimetypes.guess_type(name)[0] or "application/octet-stream",
                            "createdAt": prev.get("createdAt") or time.time(), "updatedAt": time.time()}
        self.persist()

    def create_schedule(self, a: dict) -> dict:
        from .scheduler import scheduler
        spec = {"kind": a.get("kind"), "at": a.get("at"), "everyMinutes": a.get("every_minutes"),
                "time": a.get("time"), "weekday": a.get("weekday")}
        return scheduler.create(a.get("title", ""), a.get("prompt", ""), spec, source=self.session_id)

    def create_trigger(self, a: dict) -> dict:
        from .triggers import triggers
        return triggers.create({"kind": a.get("kind"), "title": a.get("title"), "prompt": a.get("prompt"),
                                "condition": a.get("condition"), "everyMinutes": a.get("every_minutes") or 60},
                               source=self.session_id)

    def propose_knowledge(self, title: str, content: str) -> dict:
        return personal.store.add(title, content, source="agent", session_id=self.session_id, pending=True)

    def skill_used(self, name: str) -> None:
        if skills.store:
            skills.store.used(name)

    def stored_file(self, path: str) -> tuple[Path, dict] | None:
        meta = self.files.get(path)
        p = self.dir / "files" / meta["stored"] if meta else None
        return (p, meta) if p and p.is_file() else None

    def save_shot(self, b64: str) -> str:
        name = f"{short_id()}.jpg"
        (self.dir / "shots" / name).write_bytes(base64.b64decode(b64))
        return f"/api/sessions/{self.session_id}/shots/{name}"

    def file_url(self, path: str) -> str:
        from urllib.parse import quote
        return f"/api/sessions/{self.session_id}/files?path={quote(path)}"

    def preview_url(self, port: int) -> str:
        return f"{config.PUBLIC_BASE_URL}/preview/{self.session_id}/{port}/"

    # ------------------------------------------------------------- control ---

    def select_model(self, selection: dict | None) -> None:
        """Remember the mode/model for this task's next runs; invalid selections are ignored."""
        if not selection:
            return
        try:
            providers.resolve(selection)
        except ValueError:
            return
        self.model_selection = {k: selection[k] for k in ("mode", "provider", "model") if selection.get(k)}
        self.persist()

    async def user_message(self, text: str, attachments: list[str], selected_skills: list[str] | None = None,
                           event: dict | None = None) -> None:
        """event: {source, text} when an automation sent this message; shown apart from the request."""
        picked = [n for n in selected_skills or [] if n in skills.store.items]
        await self.emit({"type": "chat", "sender": "user", "messageType": "text", "content": text,
                         "attachments": [{"path": p, "filename": p.rsplit("/", 1)[-1], "url": self.file_url(p)}
                                         for p in attachments], **({"skills": picked} if picked else {}),
                         **({"triggerEvent": event} if event else {})})
        full = text + (f"\n\n{event['text']}" if event else "")
        full += ("\n\nAttached files (in the sandbox):\n" + "\n".join(attachments)) if attachments else ""
        if picked:  # Manus' extData.capabilities.enabledSkills: the user pinned skills to this request
            self.picked_skills |= set(picked)
            full += ("\n\n<selected_skills>\nThe user chose these skills for this request. Read each SKILL.md with "
                     "file_read before starting and follow it:\n" + "\n".join(f"- skills/{n}/SKILL.md" for n in picked)
                     + "\n</selected_skills>")
        if self.pending_confirms:
            # Typing instead of approving means "no": decline the held actions and pass the message on.
            for aid in list(self.pending_confirms):
                self.resolve_confirm(aid, False)
            self.inbox.append(full)
        elif self.pending_reply and not self.pending_reply.done():
            self.pending_reply.set_result(full)
        elif self.task and not self.task.done():
            self.inbox.append(full)
        else:
            self.task = asyncio.create_task(self._run(full))

    async def stop(self) -> None:
        self.inbox.clear()
        if self.task and not self.task.done():
            self.task.cancel()
            try:
                await self.task
            except (asyncio.CancelledError, Exception):
                pass
        await self.emit({"type": "statusUpdate", "agentStatus": "stopped", "description": "Stopped by user"})
        self.persist()

    async def _run(self, text: str) -> None:
        try:
            await self.emit({"type": "statusUpdate", "agentStatus": "running"})
            sandbox = await manager.get(self.session_id)
            await self.emit({"type": "sandboxUpdate", "sandboxId": self.session_id, "status": "running",
                             "mode": sandbox.mode, "vnc": sandbox.vnc, "screen": sandbox.info.get("screen")})
            await skills.store.install(sandbox, self.picked_skills)
            profile = providers.resolve(self.model_selection)
            agent = Agent(self, sandbox, self.messages, profile=profile)
            agent.repair_history()
            first_turn = not self.messages
            agent._append_user_blocks([{"type": "text", "text": text}])

            system_notes = []
            if not self.env_announced:
                system_notes.append(
                    f"<environment>\nSandbox OS: Linux ({sandbox.mode} sandbox)\nWorking directory: {sandbox.workdir}\n"
                    f"User uploads: {sandbox.workdir}/upload\nCurrent date: {time.strftime('%Y-%m-%d %H:%M')} "
                    f"({config.UTC_LABEL}, the user's local time; schedules use it too)\n</environment>")
                self.env_announced = True
            if self.project_id and projects.store and self.project_id in projects.store.items and not self.project_announced:
                paths = await projects.store.install(self.project_id, sandbox)
                system_notes.append(projects.store.note(self.project_id, paths))
                self.project_announced = True
            if (catalog := skills.store.catalog(sandbox)) != self.skills_note:
                system_notes.append(catalog or "<skills>\nNo skills are enabled now.\n</skills>")
                self.skills_note = catalog
            if personal.store and (note := personal.store.note()) != self.personal_note:
                system_notes.append(note or "<user_profile>\nThe user cleared their profile, instructions and knowledge; "
                                    "disregard what was said about them earlier.\n</user_profile>")
                self.personal_note = note
            if connectors.manager and (summary := connectors.manager.summary()) != self.connectors_note:
                system_notes.append(summary or "<connectors>\nNo MCP servers are connected now.\n</connectors>")
                self.connectors_note = summary
            if profile.planner:
                await self.emit({"type": "liveStatus", "text": "Planning"})
                context = "" if first_turn else "Current plan:\n" + render_plan(self.plan)
                p = await llm.plan(text, context, profile)
                if p and p.get("steps"):
                    if first_turn and p.get("title"):
                        self.title = p["title"]
                        await self.emit({"type": "title", "title": self.title})
                    self.plan[:] = [{"id": f"step-{short_id()}", "title": t, "status": "pending",
                                     "startedAt": None, "endAt": None} for t in p["steps"]]
                    await self.emit({"type": "planUpdate", "tasks": self.plan})
                    system_notes.append(
                        f"<plan source=\"planner\">\nGoal: {p.get('goal', '')}\n{render_plan(self.plan)}\n</plan>\n"
                        "Mark steps running/completed with plan_update as you work.")
            if system_notes:
                # Mid-conversation system message: operator-level context without touching the
                # cached system prompt. It follows the user turn and precedes the assistant turn.
                self.messages.append({"role": "system", "content": "\n\n".join(system_notes)})
            self.persist()

            await agent.run()
            if self.status not in ("error",):
                await self.emit({"type": "statusUpdate", "agentStatus": "idle", "description": "Task completed"})
                await self._suggest(text)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.exception("session %s crashed", self.session_id)
            await self.emit({"type": "statusUpdate", "agentStatus": "error", "description": f"{type(e).__name__}: {e}"})
        finally:
            self.persist()
            # A message that arrived after the agent's last turn starts a new run.
            if self.inbox and self.status != "stopped":
                pending = "\n\n".join(self.drain_inbox())
                self.task = asyncio.create_task(self._run(pending))


    async def _suggest(self, request: str) -> None:
        """Offer follow-up requests as a `suggestion` step, like Manus does after delivery."""
        if not config.SUGGESTIONS_ENABLED:
            return
        reply = next((e["content"] for e in reversed(self.events)
                      if e["type"] == "chat" and e["sender"] == "assistant"), "")
        items = await llm.suggest(request, reply, providers.resolve(self.model_selection)) if reply else []
        if items:
            action_id = f"suggest-{short_id()}"
            await self.emit({"type": "toolUsed", "tool": "suggestion", "name": "suggestion", "id": action_id,
                             "actionId": action_id, "status": "success", "noRender": True,
                             "message": {"action": "suggestion", "param": ""},
                             "detail": {"suggestion": {"commands": [
                                 {"content": c, "commandType": "followup_requirement"} for c in items]}}})


class SessionStore:
    def __init__(self):
        self.sessions: dict[str, Session] = {}
        config.SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
        for d in config.SESSIONS_DIR.iterdir():
            if (d / "meta.json").exists():
                try:
                    s = Session.load(d)
                    self.sessions[s.session_id] = s
                except Exception:
                    log.exception("failed to load session %s", d.name)

    def create(self) -> Session:
        s = Session(short_id())
        s.persist()
        self.sessions[s.session_id] = s
        return s

    def get(self, sid: str) -> Session | None:
        return self.sessions.get(sid)

    def list(self) -> list[dict]:
        return sorted((s.meta() for s in self.sessions.values()), key=lambda m: -m["createdAt"])

    async def delete(self, sid: str) -> None:
        s = self.sessions.pop(sid, None)
        if s:
            await s.stop()
            await manager.destroy(sid)
            import shutil
            shutil.rmtree(s.dir, ignore_errors=True)


store: SessionStore | None = None
