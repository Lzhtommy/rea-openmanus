"""The agent loop: analyze events -> select tool -> execute in sandbox -> observe -> repeat.

Context-engineering choices (from Manus' published lessons):
- append-only history; nothing already sent is ever edited (KV/prompt cache + preserved thinking)
- static tools+system prefix shared by all agents; role restrictions are enforced by
  rejecting masked tool prefixes, never by changing the tool list
- large observations are written to sandbox files and replaced by an excerpt + path
- errors stay in context as is_error tool results
- the plan is recited back on every plan_update so the goal stays in recent context
- a turn made only of read-only calls (search, page extract, file reads) runs them concurrently
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Awaitable, Callable

from . import config, llm
from .prompts import SUBAGENT_BRIEF
from .sandbox import Sandbox, SandboxError
from .search import search_web
from .tools import PARALLEL_SAFE, REQUIRED, TOOL_NAMES, describe, is_allowed, needs_confirm, ui_category

log = logging.getLogger("manus.agent")

Emit = Callable[[dict], Awaitable[None]]


def now_ms() -> int:
    return int(time.time() * 1000)


def short_id() -> str:
    return uuid.uuid4().hex[:12]


@dataclass
class ToolOutcome:
    content: str | list
    detail: dict = field(default_factory=dict)
    is_error: bool = False
    stop: bool = False  # idle


class AgentHost:
    """What an agent needs from its owner (a Session for the main agent)."""

    session_id: str
    plan: list[dict]
    approved: set[str] = set()  # actions the user already approved (Session keeps its own)

    async def emit(self, event: dict) -> None: ...
    async def ask_user(self, text: str, attachments: list[str], takeover: str, stream_id: str = "") -> str: ...
    def drain_inbox(self) -> list[str]: return []
    async def confirm(self, action_id: str) -> bool: return True
    def save_shot(self, b64: str) -> str: return ""
    def file_url(self, path: str) -> str: return path
    async def keep_file(self, path: str, kind: str) -> None: ...
    def create_schedule(self, args: dict) -> dict: raise NotImplementedError
    def preview_url(self, port: int) -> str: return ""
    def persist(self) -> None: ...


class Agent:
    def __init__(self, host: AgentHost, sandbox: Sandbox, messages: list[dict], role: str = "main",
                 effort: str = config.EFFORT, on_progress: Callable[[str], None] | None = None):
        self.host = host
        self.sandbox = sandbox
        self.messages = messages
        self.role = role
        self.effort = effort
        self.on_progress = on_progress
        self.result: str | None = None  # sub-agent deliverable
        self.plan_step_id: str | None = None
        self.opened = False  # first user-facing message of a run is the "opening" delivery
        self._delta_at: dict[str, float] = {}

    # ------------------------------------------------------------ loop ---

    async def run(self) -> None:
        self.repair_history()
        for _ in range(config.MAX_ITERATIONS):
            self._inject_inbox()
            if self.role == "main":
                await self.host.emit({"type": "liveStatus", "text": "Thinking"})
            text_id = f"txt-{short_id()}"
            try:
                resp = await llm.agent_step(self.messages, self.effort, on_delta=self._on_delta if self.role == "main" else None,
                                            text_id=text_id)
            except llm.BadRequestError as e:
                await self._error(f"LLM request rejected: {e.message}")
                return
            except llm.APIError as e:
                await self._error(f"LLM API error: {e}")
                return

            if resp.stop_reason == "refusal":
                await self._error("The model declined to continue this request.")
                return

            tool_uses = [b for b in resp.content if b.type == "tool_use"]

            if resp.stop_reason == "max_tokens":
                # Never run truncated tool input. Drop the partial turn and ask for smaller steps.
                self._append_user_blocks([{"type": "text", "text":
                    "<system-reminder>Your previous response hit the output limit and was discarded. "
                    "Use smaller steps (e.g. write long files in several appends).</system-reminder>"}])
                continue

            self.messages.append({"role": "assistant",
                                  "content": [b.model_dump(mode="json", exclude_none=True) for b in resp.content]})
            await self._emit_thoughts(resp)

            if not tool_uses:
                # Plain-text answer: surface it and stop (it is the final reply).
                text = "".join(b.text for b in resp.content if b.type == "text").strip()
                if text and self.role == "main":
                    await self.host.emit({"type": "chat", "sender": "assistant", "messageType": "text", "content": text,
                                          "attachments": [], "deliveryKind": "result", "streamId": text_id})
                if self.role == "subagent":
                    self.result = text
                self.host.persist()
                return

            calls = [(tu.id, tu.name, tu.input if isinstance(tu.input, dict) else {}) for tu in tool_uses]
            if len(calls) > 1 and all(name in PARALLEL_SAFE for _, name, _ in calls):
                outcomes = await asyncio.gather(*(self._run_tool(*c) for c in calls))
            else:
                outcomes = [await self._run_tool(*c) for c in calls]
            results, stop = [], False
            for (tool_id, _, _), outcome in zip(calls, outcomes):
                results.append({"type": "tool_result", "tool_use_id": tool_id,
                                "content": outcome.content, **({"is_error": True} if outcome.is_error else {})})
                stop = stop or outcome.stop
            self.messages.append({"role": "user", "content": results})
            self.host.persist()
            if stop:
                return
        await self._error(f"Stopped after {config.MAX_ITERATIONS} iterations.")

    def _on_delta(self, stream_id: str, text: str) -> None:
        """Forward streamed user-facing text as ephemeral chatDelta events (throttled)."""
        now = time.monotonic()
        if now - self._delta_at.get(stream_id, 0) < 0.06:
            return
        self._delta_at[stream_id] = now
        asyncio.get_running_loop().create_task(self.host.emit({"type": "chatDelta", "streamId": stream_id, "content": text}))

    def repair_history(self) -> None:
        """After a cancel/crash, close any tool_use left without results."""
        if not self.messages or self.messages[-1]["role"] != "assistant":
            return
        dangling = [b for b in self.messages[-1]["content"] if b.get("type") == "tool_use"]
        if dangling:
            self.messages.append({"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": b["id"], "is_error": True,
                 "content": "Interrupted: the user stopped the task before this action completed."}
                for b in dangling]})

    def _append_user_blocks(self, blocks: list[dict]) -> None:
        last = self.messages[-1] if self.messages else None
        if last and last["role"] == "user":
            if isinstance(last["content"], str):
                last["content"] = [{"type": "text", "text": last["content"]}]
            last["content"].extend(blocks)
        else:
            self.messages.append({"role": "user", "content": blocks})

    def _inject_inbox(self) -> None:
        msgs = self.host.drain_inbox() if self.role == "main" else []
        if msgs:
            self._append_user_blocks([{"type": "text", "text": f"<new_user_message>\n{m}\n</new_user_message>\n"
                                       "Acknowledge this new message with message_notify_user right away, "
                                       "then adapt the plan as needed."} for m in msgs])

    async def _emit_thoughts(self, resp) -> None:
        if self.role != "main":
            return
        for b in resp.content:
            if b.type == "thinking" and getattr(b, "thinking", ""):
                await self.host.emit({"type": "explanation", "content": b.thinking})
            elif b.type == "text" and b.text.strip() and any(x.type == "tool_use" for x in resp.content):
                await self.host.emit({"type": "explanation", "content": b.text})

    async def _error(self, msg: str) -> None:
        log.error("[%s] %s", self.host.session_id, msg)
        if self.role == "main":
            await self.host.emit({"type": "statusUpdate", "agentStatus": "error", "description": msg})
        else:
            self.result = f"ERROR: {msg}"

    # ----------------------------------------------------------- tools ---

    async def _run_tool(self, tool_id: str, name: str, args: dict) -> ToolOutcome:
        action_id = tool_id
        brief = str(args.pop("brief", "") or "")[:160]
        cat = ui_category(name)
        act, param = describe(name, args)
        silent = name in ("message_notify_user", "message_ask_user", "plan_update", "idle") or self.role != "main"
        if self.on_progress:
            self.on_progress(f"{act} {param}".strip()[:160])
        base = {"type": "toolUsed", "tool": cat, "name": name, "actionId": action_id, "brief": brief,
                "planStepId": self.plan_step_id, "message": {"action": act, "param": param}, "args": _brief_args(args)}
        if not silent:
            await self.host.emit({**base, "id": action_id, "status": "start"})

        if name not in TOOL_NAMES:
            outcome = ToolOutcome(f"Unknown tool '{name}'.", is_error=True)
        elif not is_allowed(self.role, name):
            outcome = ToolOutcome(f"Tool '{name}' is not available to you in this role.", is_error=True)
        elif missing := [p for p in REQUIRED[name] if p not in args]:
            outcome = ToolOutcome(f"Missing required parameter(s): {', '.join(missing)}.", is_error=True)
        elif not await self._approved(name, args, base, silent):
            outcome = ToolOutcome("The user declined this action, so it was not executed. Do not retry it; "
                                  "continue another way or ask the user what they want.", is_error=True,
                                  detail={"error": "用户拒绝了该操作"})
        else:
            try:
                outcome = await self._dispatch(name, args, action_id, base)
            except SandboxError as e:
                outcome = ToolOutcome(f"Error: {e}", detail={"error": str(e)}, is_error=True)
            except Exception as e:  # keep the loop alive; the model sees the error
                log.exception("tool %s crashed", name)
                outcome = ToolOutcome(f"Error: {type(e).__name__}: {e}", is_error=True)

        outcome.content = await self._compress(tool_id, outcome.content)
        if not silent:
            await self.host.emit({**base, "id": action_id, "status": "error" if outcome.is_error else "success",
                                  "detail": outcome.detail})
        return outcome

    async def _approved(self, name: str, args: dict, base: dict, silent: bool) -> bool:
        """Hold actions with outside effects until the user approves them in the UI."""
        reason = needs_confirm(name, args) if config.CONFIRM_ENABLED else None
        if not reason:
            return True
        key = f"{name}:{args.get('port') or args.get('command') or args.get('input')}"
        if key in self.host.approved:  # same action already approved in this session
            return True
        await self.host.emit({**base, "id": base["actionId"], "status": "need_confirm",
                              "confirm": {"reason": reason, "command": args.get("command") or args.get("input") or "",
                                          "port": args.get("port")}})
        approved = await self.host.confirm(base["actionId"])
        if approved:
            self.host.approved.add(key)
        if not silent and approved:
            await self.host.emit({**base, "id": base["actionId"], "status": "start"})
        return approved

    async def _compress(self, tool_id: str, content):
        """Restorable compression: keep an excerpt in context, full text in the sandbox."""
        if isinstance(content, list):
            return [({**b, "text": await self._compress(tool_id, b["text"])} if b.get("type") == "text" else b)
                    for b in content]
        if len(content) <= config.OBSERVATION_LIMIT:
            return content
        path = f"{self.sandbox.workdir}/.manus/observations/{tool_id}.txt"
        try:
            await self.sandbox.call("/file/write", {"file": path, "content": content})
        except SandboxError:
            path = None
        head, tail = content[:config.OBSERVATION_LIMIT * 2 // 3], content[-config.OBSERVATION_LIMIT // 3:]
        note = (f"full output ({len(content)} chars) saved to {path}; read it with file_read or "
                "file_find_in_content for details" if path else f"output truncated, {len(content)} chars total")
        return f"{head}\n\n...[{note}]...\n\n{tail}"

    async def _dispatch(self, name: str, a: dict, action_id: str, base: dict) -> ToolOutcome:
        sb, host = self.sandbox, self.host

        # ---- messages
        if name in ("message_notify_user", "message_ask_user"):
            for p in a.get("attachments") or []:
                await host.keep_file(p, "deliverable")
        if name == "message_notify_user":
            kind = a.get("kind") or ("progress" if self.opened else "opening")
            self.opened = True
            await host.emit({"type": "chat", "sender": "assistant", "messageType": "text", "content": a["text"],
                             "attachments": self._attachments(a.get("attachments")), "deliveryKind": kind,
                             "streamId": action_id})
            return ToolOutcome("Message delivered to the user.")
        if name == "message_ask_user":
            reply = await host.ask_user(a["text"], self._attachments(a.get("attachments")),
                                        a.get("suggest_user_takeover", "none"), stream_id=action_id)
            return ToolOutcome(f"User replied: {reply}")

        # ---- plan
        if name == "plan_update":
            steps, old = a["steps"], {s["title"]: s for s in host.plan}
            plan = []
            for i, s in enumerate(steps):
                prev = old.get(s["title"], {})
                item = {"id": prev.get("id") or f"step-{short_id()}", "title": s["title"], "status": s["status"],
                        "startedAt": prev.get("startedAt"), "endAt": prev.get("endAt")}
                if s["status"] == "running" and not item["startedAt"]:
                    item["startedAt"] = now_ms()
                if s["status"] in ("completed", "skipped") and not item["endAt"]:
                    item["endAt"] = now_ms()
                plan.append(item)
            host.plan[:] = plan
            running = next((p for p in plan if p["status"] == "running"), None)
            self.plan_step_id = running["id"] if running else None
            await host.emit({"type": "planUpdate", "tasks": plan})
            return ToolOutcome("Plan updated. Current plan:\n" + render_plan(plan))

        # ---- files
        if name == "file_read":
            r = await sb.call("/file/read", a)
            return ToolOutcome(f"{r['file']} ({r['total_lines']} lines):\n{r['content']}",
                               {"textEditor": {"path": r["file"], "content": r["content"][:50000], "op": "read"}})
        if name == "file_write":
            r = await sb.call("/file/write", a)
            await host.keep_file(r["file"], "edited")
            return ToolOutcome(f"{'Appended to' if a.get('append') else 'Wrote'} {r['file']} ({r['bytes']} bytes).",
                               {"textEditor": {"path": r["file"], "content": a["content"][:50000],
                                               "op": "append" if a.get("append") else "write"}})
        if name == "file_str_replace":
            r = await sb.call("/file/str_replace", a)
            await host.keep_file(r["file"], "edited")
            return ToolOutcome(f"Replaced text in {r['file']}.",
                               {"textEditor": {"path": r["file"], "op": "edit",
                                               "content": f"- {a['old_str']}\n+ {a['new_str']}"[:50000]}})
        if name == "file_find_in_content":
            r = await sb.call("/file/find_in_content", a)
            lines = "\n".join(f"{m['line']}: {m['text']}" for m in r["matches"])
            return ToolOutcome(f"{r['total']} matching lines in {r['file']}:\n{lines}",
                               {"textEditor": {"path": r["file"], "content": lines, "op": "search"}})
        if name == "file_find_by_name":
            r = await sb.call("/file/find_by_name", a)
            listing = "\n".join(r["files"]) or "(no files found)"
            return ToolOutcome(listing + ("\n...[truncated]" if r["truncated"] else ""),
                               {"textEditor": {"path": a["path"], "content": listing, "op": "search"}})

        # ---- shell
        if name.startswith("shell_"):
            route = {"shell_exec": "exec", "shell_view": "view", "shell_wait": "wait",
                     "shell_write_to_process": "write", "shell_kill_process": "kill"}[name]
            r = await sb.call(f"/shell/{route}", {"id": "default", **a})  # models often omit the session id
            state = "still running (use shell_wait / shell_view)" if r["running"] else f"exit code {r['returncode']}"
            out = r["output"]
            return ToolOutcome(f"[shell {r['id']}: {state}]\n{out}",
                               {"terminal": {"id": r["id"], "command": r["command"], "output": out[-20000:],
                                             "running": r["running"]}})

        # ---- browser
        if name.startswith("browser_"):
            r = await sb.call(f"/browser/{name.removeprefix('browser_')}", a)
            if name == "browser_console_view":
                text = "\n".join(r["console"]) or "(no console messages)"
                return ToolOutcome(text, {"browser": {"url": r["url"], "console": text}})
            shot_url = host.save_shot(r["screenshot"]) if self.role == "main" else ""
            text = (f"URL: {r['url']}\nTitle: {r['title']}\n"
                    + (f"Console result: {r['console_result']}\n" if "console_result" in r else "")
                    + f"Interactive elements in viewport:\n" + ("\n".join(r["elements"]) or "(none)")
                    + f"\n\nPage text ({r['pixels_above']}px above, {r['pixels_below']}px below viewport):\n{r['text']}")
            content: str | list = text
            if config.BROWSER_VISION:
                content = [{"type": "text", "text": text},
                           {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                                        "data": r["screenshot"]}}]
            return ToolOutcome(content, {"browser": {"url": r["url"], "title": r["title"], "screenshot": shot_url}})

        # ---- search
        if name == "info_search_web":
            results = await search_web(a["query"], a.get("date_range", "all"))
            text = "\n\n".join(f"[{i + 1}] {x['title']}\n{x['url']}\n{x['snippet']}" for i, x in enumerate(results))
            return ToolOutcome(text or "No results.", {"search": {"query": a["query"], "results": results}})
        if name == "info_extract_webpage":
            r = await sb.call("/web/extract", {"url": a["url"]})
            note = f"\n...[truncated, {r['total_chars']} chars total; use the browser to read further]" if r["truncated"] else ""
            return ToolOutcome(f"URL: {r['url']}\nTitle: {r['title']}\n\n{r['text']}{note}",
                               {"webpageExtract": {"url": r["url"], "title": r["title"],
                                                   "markdown": r["text"][:20000], "truncated": r["truncated"]}})

        # ---- deploy
        if name == "deploy_expose_port":
            url = host.preview_url(int(a["port"]))
            return ToolOutcome(f"Port {a['port']} exposed to the user at {url} . That URL is reachable by the user, not "
                               f"from inside the sandbox: to check the page yourself, open http://localhost:{a['port']}/ "
                               f"in the browser. Use relative asset paths so it works under the preview path.",
                               {"deploy": {"port": a["port"], "url": url}})

        # ---- automation
        if name == "schedule_create":
            from .scheduler import ScheduleError
            try:
                s = host.create_schedule(a)
            except ScheduleError as e:
                return ToolOutcome(f"Could not create the schedule: {e}", is_error=True, detail={"error": str(e)})
            nxt = time.strftime("%Y-%m-%d %H:%M", time.localtime(s["nextRunAt"])) if s.get("nextRunAt") else "none"
            return ToolOutcome(f"Scheduled task \"{s['title']}\" created ({s['description']}); next run: {nxt}. "
                               "Each run starts a new task with the prompt. The user can manage it under 自动化.",
                               {"schedule": s})

        # ---- wide research
        if name == "agent_map_reduce":
            return await self._map_reduce(a, base)

        # ---- control
        if name == "idle":
            if self.role == "subagent":
                self.result = a.get("result") or "(sub-agent returned no result)"
            return ToolOutcome("Entered standby.", stop=True)

        return ToolOutcome(f"Tool {name} is not implemented.", is_error=True)

    def _attachments(self, paths: list[str] | None) -> list[dict]:
        return [{"path": p, "filename": p.rsplit("/", 1)[-1], "url": self.host.file_url(p)} for p in (paths or [])]

    async def _map_reduce(self, a: dict, base: dict) -> ToolOutcome:
        items = a["items"][:config.WIDE_RESEARCH_MAX_TASKS]
        details = [{"index": i, "item": it, "status": "pending", "progress": "", "result": None}
                   for i, it in enumerate(items)]
        sem = asyncio.Semaphore(config.WIDE_RESEARCH_CONCURRENCY)
        last_emit = [0.0]

        async def push(force: bool = False):
            t = time.time()
            if force or t - last_emit[0] > 1.0:
                last_emit[0] = t
                await self.host.emit({**base, "id": base["actionId"], "status": "running",
                                      "detail": {"mapReduce": {"taskStatus": "running", "taskDetails": details}}})

        async def worker(d: dict):
            async with sem:
                d["status"] = "running"
                await push(True)
                hint = ""
                if a.get("output_file_pattern"):
                    hint = f"; write your output to {a['output_file_pattern'].replace('{index}', str(d['index']))}"
                brief = SUBAGENT_BRIEF.format(instruction=a["instruction"], item=d["item"], output_hint=hint)

                def progress(text: str, d=d):
                    d["progress"] = text
                    asyncio.get_event_loop().create_task(push())

                sub = Agent(self.host, self.sandbox, [{"role": "user", "content": brief}], role="subagent",
                            effort=config.SUBAGENT_EFFORT, on_progress=progress)
                try:
                    await sub.run()
                    d["result"] = sub.result or "(no result)"
                    d["status"] = "failed" if d["result"].startswith("ERROR:") else "completed"
                except Exception as e:  # one failed item must not sink the batch
                    d["result"], d["status"] = f"ERROR: {e}", "failed"
                await push(True)

        await asyncio.gather(*(worker(d) for d in details))
        summary = "\n\n".join(f"### Item {d['index'] + 1}: {d['item']}\nStatus: {d['status']}\n{d['result']}"
                              for d in details)
        return ToolOutcome(summary, {"mapReduce": {"taskStatus": "completed", "taskDetails": details}})


def render_plan(plan: list[dict]) -> str:
    mark = {"completed": "[x]", "running": "[>]", "skipped": "[-]", "pending": "[ ]"}
    return "\n".join(f"{i + 1}. {mark.get(p['status'], '[ ]')} {p['title']}" for i, p in enumerate(plan))


def _brief_args(args: dict) -> dict:
    out = {}
    for k, v in args.items():
        s = v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)
        out[k] = s if len(s) <= 2000 else s[:2000] + "…"
    return out
