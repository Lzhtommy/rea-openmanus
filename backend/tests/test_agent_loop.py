"""End-to-end agent loop test with a scripted model (no API key needed).

Runs a real local sandbox server and exercises every tool family, the planner hook,
ask_user, map-reduce sub-agents, observation compression, parallel read-only calls,
skills, follow-up suggestions, and stop/repair.

    MANUS_SANDBOX=local uv run python -m pytest tests -q
"""

import asyncio
import itertools
import os
import tempfile

os.environ.setdefault("MANUS_SANDBOX", "local")
os.environ["MANUS_DATA_DIR"] = tempfile.mkdtemp(prefix="manus-test-")
os.environ.setdefault("MANUS_LLM_API_KEY", "test")

import pytest  # noqa: E402

from app import config, llm, session as session_mod  # noqa: E402
from app import agent as agent_mod  # noqa: E402
from app.sandbox import manager  # noqa: E402

_ids = itertools.count()


def tool(name, **inp):
    return {"type": "tool_use", "id": f"toolu_{next(_ids)}", "name": name, "input": inp}


def msg(*blocks, stop="tool_use"):
    return llm.Reply.model_validate({"content": list(blocks), "stop_reason": stop})


def thinking(text):
    return {"type": "thinking", "thinking": text, "signature": "sig"}


class ScriptedModel:
    """Main-agent turns come from `script`; sub-agents get a generic 2-turn script."""

    def __init__(self, script):
        self.script = list(script)
        self.calls = []
        self.profiles = []

    async def __call__(self, messages, effort, on_delta=None, text_id="text", profile=None):
        self.profiles.append(profile)
        self.calls.append([m["role"] for m in messages])
        reply = await self._next(messages)
        if on_delta and reply is not None:  # simulate streaming of user-facing text
            for b in reply.content:
                if b.type == "tool_use" and b.name == "message_notify_user":
                    text = b.input["text"]
                    for n in range(1, len(text) + 1):
                        on_delta(b.id, text[:n])
                        await asyncio.sleep(0.07)
        return reply

    async def _next(self, messages):
        first = messages[0]["content"]
        if isinstance(first, str) and "sub-agent" in first:
            item = first.split("Your item: ")[1].split("\n")[0]
            if len(messages) == 1:
                cmd = f"sleep 20; echo {item}" if item.startswith("slow") else f"echo researching {item}"
                return msg(tool("shell_exec", id=f"sub-{item}-{next(_ids)}", command=cmd, timeout=25))
            return msg(tool("idle", result=f"Findings for {item}: ok"))
        step = self.script.pop(0)
        return step(messages) if callable(step) else step


async def fake_plan(request, context="", profile=None):
    return {"goal": "test goal", "title": "Test task", "steps": ["Explore", "Build", "Deliver"]}


async def fake_search(query, date_range="all", limit=10):
    return [{"title": "Example", "url": "https://example.com", "snippet": "snippet"}]


async def fake_suggest(request, reply, profile=None):
    return ["深入分析第一点", "做成网站"]


@pytest.fixture
def store(monkeypatch):
    monkeypatch.setattr(llm, "plan", fake_plan)
    monkeypatch.setattr(llm, "suggest", fake_suggest)
    monkeypatch.setattr(agent_mod, "search_web", fake_search)
    from app import skills
    skills.store = skills.Skills()
    session_mod.store = session_mod.SessionStore()
    yield session_mod.store


async def wait_status(s, statuses, timeout=60):
    for _ in range(timeout * 10):
        if s.status in statuses and (not s.task or s.task.done() or s.status == "waiting"):
            return
        await asyncio.sleep(0.1)
    raise AssertionError(f"status stuck at {s.status}")


def assert_valid_history(messages):
    """tool_use blocks are always answered by tool_result in the next user message."""
    for i, m in enumerate(messages):
        if m["role"] == "assistant":
            ids = {b["id"] for b in m["content"] if b.get("type") == "tool_use"}
            if ids:
                nxt = messages[i + 1]
                assert nxt["role"] == "user"
                got = {b["tool_use_id"] for b in nxt["content"] if b.get("type") == "tool_result"}
                assert ids <= got, (ids, got)
        if m["role"] == "system":
            assert i > 0 and messages[i - 1]["role"] == "user"


@pytest.mark.asyncio
async def test_full_task(store, monkeypatch):
    big = "x" * (config.OBSERVATION_LIMIT + 5000)
    model = ScriptedModel([
        msg(thinking("plan first"), tool("message_notify_user", text="收到，开始处理")),
        msg(tool("plan_update", steps=[{"title": "Explore", "status": "running"},
                                       {"title": "Build", "status": "pending"},
                                       {"title": "Deliver", "status": "pending"}])),
        msg(tool("shell_exec", command="echo hello && python3 -c 'print(6*7)'")),
        msg(tool("file_write", file="out/report.md", content="# Report\n\nhello\n")),
        msg(tool("file_read", file="out/report.md"), tool("file_find_by_name", path=".", glob="*.md")),
        msg(tool("shell_exec", id="big", command=f"python3 -c \"print('{big[:10]}' * {len(big) // 10})\"")),
        msg(tool("file_read", file="does/not/exist.txt")),  # error stays in context
        msg(tool("info_search_web", query="example")),
        msg(tool("info_extract_webpage", url="data:text/html,<title>A</title><h1>alpha page</h1>"),
            tool("info_extract_webpage", url="data:text/html,<title>B</title><h1>beta page</h1>"),
            tool("file_read", file="skills/deep-research/SKILL.md")),
        msg(tool("browser_navigate", url="https://example.com")),
        msg(tool("browser_click", index=0)),
        msg(tool("shell_exec", id="srv", command="echo '<h1>hi</h1>' > index.html && python3 -m http.server 18431",
                 timeout=1)),
        msg(tool("deploy_expose_port", port=18431)),
        msg(tool("agent_map_reduce", instruction="research", items=["alpha", "beta", "gamma"])),
        msg(tool("not_a_tool")),
        msg(tool("message_notify_user", text="完成", attachments=["out/report.md"], kind="result")),
        msg(tool("idle")),
    ])
    monkeypatch.setattr(llm, "agent_step", model)
    monkeypatch.setattr(config, "BROWSER_VISION", True)
    monkeypatch.setattr(config, "CONFIRM_ENABLED", False)  # covered by test_confirmation

    s = store.create()
    await s.user_message("请做一个测试任务", [])
    await wait_status(s, {"idle", "error"}, timeout=120)
    assert s.status == "idle", [e for e in s.events if e["type"] == "statusUpdate"]

    types = [e["type"] for e in s.events]
    assert types[0] == "chat" and "planUpdate" in types and "title" in types
    tools_used = {e["name"] for e in s.events if e["type"] == "toolUsed"}
    assert {"shell_exec", "file_write", "file_read", "info_search_web", "browser_navigate",
            "deploy_expose_port", "agent_map_reduce"} <= tools_used

    by_name = lambda n: [e for e in s.events if e["type"] == "toolUsed" and e.get("name") == n and e["status"] != "start"]
    assert "42" in by_name("shell_exec")[0]["detail"]["terminal"]["output"]
    assert by_name("browser_navigate")[0]["detail"]["browser"]["screenshot"].startswith("/api/sessions/")
    mr = by_name("agent_map_reduce")[-1]["detail"]["mapReduce"]
    assert mr["taskStatus"] == "completed" and all(t["status"] == "completed" for t in mr["taskDetails"])
    assert s.plan[0]["status"] == "running" and s.plan[0]["startedAt"]

    # restorable compression: huge output replaced by excerpt + path, full text in sandbox
    flat = [b for m in s.messages if m["role"] == "user" and isinstance(m["content"], list) for b in m["content"]]
    results = {b["tool_use_id"]: b for b in flat if b.get("type") == "tool_result"}
    big_result = next(r for r in results.values() if isinstance(r["content"], str) and "saved to" in r["content"])
    assert len(big_result["content"]) < config.OBSERVATION_LIMIT + 500
    assert any(r.get("is_error") for r in results.values())  # missing file + unknown tool
    # browser observation carries the screenshot image block for the model
    assert any(isinstance(r["content"], list) and r["content"][1]["type"] == "image" for r in results.values())

    # system note (env + planner + knowledge) sits right after the first user turn
    assert s.messages[1]["role"] == "system" and "<plan" in s.messages[1]["content"]
    assert_valid_history(s.messages)
    final = [e for e in s.events if e["type"] == "chat" and e["sender"] == "assistant"][-1]
    assert final["attachments"][0]["url"].startswith(f"/api/sessions/{s.session_id}/files")

    # deliveryKind: first message opens the run, the attached delivery is the result
    kinds = [e["deliveryKind"] for e in s.events if e["type"] == "chat" and e["sender"] == "assistant"]
    assert kinds[0] == "opening" and kinds[-1] == "result"

    # a turn of read-only calls runs concurrently: all three start before any finishes
    batch = [e for e in s.events if e["type"] == "toolUsed"
             and e.get("name") in ("info_extract_webpage", "file_read") and e["actionId"] in
             {b["id"] for b in s.messages[next(i for i, m in enumerate(s.messages) if m["role"] == "assistant"
              and sum(x.get("name") == "info_extract_webpage" for x in m["content"]) == 2)]["content"]
              if b.get("type") == "tool_use"}]
    assert [e["status"] for e in batch][:3] == ["start"] * 3
    pages = [e["detail"]["webpageExtract"] for e in batch if e["status"] == "success" and "webpageExtract" in e["detail"]]
    assert sorted(p["title"] for p in pages) == ["A", "B"] and "alpha page" in pages[0]["markdown"] + pages[1]["markdown"]

    # skills are installed in the sandbox and listed in the first system note
    assert "deep-research" in s.messages[1]["content"] and "<skills>" in s.messages[1]["content"]
    skill_read = [e for e in batch if e.get("name") == "file_read" and e["status"] == "success"]
    assert "Deep research" in skill_read[0]["detail"]["textEditor"]["content"]

    assert any(e["type"] == "sandboxUpdate" and e["status"] == "running" for e in s.events)
    sug = [e for e in s.events if e["type"] == "toolUsed" and e["tool"] == "suggestion"]
    assert sug and sug[-1]["detail"]["suggestion"]["commands"][0]["commandType"] == "followup_requirement"
    assert s.events.index(sug[-1]) > max(i for i, e in enumerate(s.events) if e["type"] == "statusUpdate")

    # preview proxy reaches the service started inside the sandbox
    sb = await manager.get(s.session_id)
    r = await sb.http.get("/proxy/18431/index.html")
    assert "<h1>hi</h1>" in r.text
    await sb.call("/shell/kill", {"id": "srv"})

    # files the agent wrote / delivered are kept outside the sandbox and outlive it
    from app import main
    kept = [f for f in s.files.values() if f["filename"] == "report.md"]
    assert kept and set(kept[0]["kinds"]) == {"edited", "deliverable"}
    await manager.destroy(s.session_id)
    r = await main.download(s.session_id, kept[0]["path"])
    assert r.status_code == 200 and "# Report" in open(r.path).read()
    lib = await main.library()
    assert any(x["sessionId"] == s.session_id and x["filename"] == "report.md" for x in lib)


@pytest.mark.asyncio
async def test_ask_user_and_follow_up(store, monkeypatch):
    model = ScriptedModel([
        msg(tool("message_ask_user", text="Which color?")),
        lambda m: msg(tool("message_notify_user", text=f"ok {m[-1]['content'][0]['content']}")),
        msg(tool("idle")),
        # follow-up turn after idle: new user text is appended to the idle tool_result message
        lambda m: msg(tool("message_notify_user", text="second turn")) if m[-1]["role"] in ("user", "system") else None,
        msg({"type": "text", "text": "plain final answer"}, stop="end_turn"),
    ])
    monkeypatch.setattr(llm, "agent_step", model)
    s = store.create()
    await s.user_message("hi", [])
    await wait_status(s, {"waiting"})
    await s.user_message("blue", [])
    await wait_status(s, {"idle"})
    notes = [e["content"] for e in s.events if e["type"] == "chat" and e["sender"] == "assistant"]
    assert notes[0] == "Which color?" and "User replied: blue" in notes[1]

    await s.user_message("again", [])
    await wait_status(s, {"idle"})
    notes = [e["content"] for e in s.events if e["type"] == "chat" and e["sender"] == "assistant"]
    assert notes[-2:] == ["second turn", "plain final answer"]
    assert_valid_history(s.messages)


@pytest.mark.asyncio
async def test_stop_repairs_history(store, monkeypatch):
    model = ScriptedModel([
        msg(tool("shell_exec", id="slow", command="sleep 30", timeout=20)),
        msg(tool("message_notify_user", text="resumed")),
        msg(tool("idle")),
    ])
    monkeypatch.setattr(llm, "agent_step", model)
    s = store.create()
    await s.user_message("run slow", [])
    for _ in range(100):
        if any(e["type"] == "toolUsed" for e in s.events):
            break
        await asyncio.sleep(0.1)
    await asyncio.sleep(0.5)
    await s.stop()
    assert s.status == "stopped"
    await s.user_message("continue", [])
    await wait_status(s, {"idle"})
    dangling = [b for m in s.messages if m["role"] == "user" and isinstance(m["content"], list)
                for b in m["content"] if b.get("type") == "tool_result" and "Interrupted" in str(b.get("content"))]
    assert dangling
    assert_valid_history(s.messages)
    sb = await manager.get(s.session_id)
    await sb.call("/shell/kill", {"id": "slow"})


@pytest.mark.asyncio
async def test_confirmation(store, monkeypatch):
    """Outward-facing actions wait for approval; declining returns an error to the model."""
    model = ScriptedModel([
        msg(tool("deploy_expose_port", port=18432)),
        msg(tool("shell_exec", command="git push origin main")),
        lambda m: msg(tool("message_notify_user", text=str(m[-1]["content"][0].get("is_error")))),
        msg(tool("idle")),
    ])
    monkeypatch.setattr(llm, "agent_step", model)
    s = store.create()
    await s.user_message("deploy and push", [])

    async def held(name):
        for _ in range(100):
            ev = next((e for e in s.events if e["type"] == "toolUsed" and e.get("name") == name
                       and e["status"] == "need_confirm"), None)
            if ev and s.pending_confirms:
                return ev
            await asyncio.sleep(0.1)
        raise AssertionError(f"{name} was not held for confirmation")

    dep = await held("deploy_expose_port")
    assert s.status == "waiting" and dep["confirm"]["reason"]
    assert s.resolve_confirm(dep["actionId"], True)
    push = await held("shell_exec")
    assert "git push" in push["confirm"]["command"]
    assert s.resolve_confirm(push["actionId"], False)
    await wait_status(s, {"idle"})

    done = {e["name"]: e["status"] for e in s.events if e["type"] == "toolUsed" and e["status"] in ("success", "error")
            and e["tool"] != "suggestion"}
    assert done == {"deploy_expose_port": "success", "shell_exec": "error"}
    notes = [e["content"] for e in s.events if e["type"] == "chat" and e["sender"] == "assistant"]
    assert notes[-1] == "True"  # the declined push reached the model as an error
    assert_valid_history(s.messages)


@pytest.mark.asyncio
async def test_streaming_deltas(store, monkeypatch):
    """User-facing text streams as ephemeral chatDelta events keyed to the final chat's streamId."""
    model = ScriptedModel([msg(tool("message_notify_user", text="流式输出测试")), msg(tool("idle"))])
    monkeypatch.setattr(llm, "agent_step", model)
    s = store.create()
    q: asyncio.Queue = asyncio.Queue()
    s.subscribers.add(q)
    await s.user_message("stream please", [])
    await wait_status(s, {"idle"})
    seen = []
    while not q.empty():
        seen.append(q.get_nowait()["event"])
    deltas = [e for e in seen if e["type"] == "chatDelta"]
    chat = next(e for e in s.events if e["type"] == "chat" and e["sender"] == "assistant")
    assert deltas and all(d["streamId"] == chat["streamId"] for d in deltas)
    assert all(chat["content"].startswith(d["content"]) for d in deltas) and len(deltas) >= 3
    assert not any(e["type"] == "chatDelta" for e in s.events)  # ephemeral, never persisted


@pytest.mark.asyncio
async def test_schedule_tool_and_tick(store, monkeypatch):
    """The agent can create a schedule from chat; a due schedule starts a new tagged session."""
    from app import scheduler as scheduler_mod
    scheduler_mod.scheduler = scheduler_mod.Scheduler(store)
    model = ScriptedModel([
        msg(tool("schedule_create", title="每日新闻", prompt="总结今天的科技新闻", kind="daily", time="08:00")),
        msg(tool("schedule_create", title="bad", prompt="x", kind="daily", time="8点")),
        msg(tool("idle")),
        msg(tool("message_notify_user", text="scheduled run done")),
        msg(tool("idle")),
    ])
    monkeypatch.setattr(llm, "agent_step", model)
    s = store.create()
    await s.user_message("每天早上 8 点帮我总结科技新闻", [])
    await wait_status(s, {"idle"})
    items = scheduler_mod.scheduler.list()
    assert len(items) == 1 and items[0]["description"] == "每天 08:00" and items[0]["nextRunAt"]
    results = [b for m in s.messages if m["role"] == "user" and isinstance(m["content"], list)
               for b in m["content"] if b.get("type") == "tool_result"]
    assert "created" in results[0]["content"] and results[1].get("is_error")

    sched = items[0]
    started = await scheduler_mod.scheduler.tick(now=sched["nextRunAt"] + 1)
    assert len(started) == 1
    run = store.get(started[0])
    assert run.schedule_id == sched["id"] and run.meta()["scheduleId"] == sched["id"]
    await wait_status(run, {"idle"})
    assert run.events[0]["content"] == "总结今天的科技新闻"
    after = scheduler_mod.scheduler.items[sched["id"]]
    assert after["runs"] == [run.session_id] and after["nextRunAt"] > sched["nextRunAt"]


@pytest.mark.asyncio
async def test_model_selection(store, monkeypatch):
    """A task's mode/model selection is remembered and drives every model call of that task."""
    from app import providers
    model = ScriptedModel([msg(tool("idle")), msg(tool("idle"))])
    monkeypatch.setattr(llm, "agent_step", model)
    monkeypatch.setattr(config, "MODEL_LITE", "lite-model")
    s = store.create()
    s.select_model({"mode": "lite"})
    s.select_model({"mode": "flex", "provider": "nope"})  # invalid: ignored
    await s.user_message("hi", [])
    await wait_status(s, {"idle"})
    p = model.profiles[0]
    assert p.model == "lite-model" and p.effort == "low" and not p.planner and p.provider == "litellm"
    assert store.get(s.session_id).meta()["model"] == {"mode": "lite"}
    providers.store.set("deepseek", "sk-test-key-123456", "", "deepseek-chat")
    s.select_model({"mode": "flex", "provider": "deepseek", "model": "deepseek-reasoner"})
    await s.user_message("again", [])
    await wait_status(s, {"idle"})
    p = model.profiles[-1]
    assert (p.provider, p.model, p.base_url) == ("deepseek", "deepseek-reasoner", "https://api.deepseek.com/v1")
    providers.store.delete("deepseek")


@pytest.mark.asyncio
async def test_mcp_connector(store, monkeypatch, tmp_path):
    """Agent discovers MCP tools by search, calls a read-only one directly and a writing one after approval."""
    import sys
    from app import connectors
    notes = tmp_path / "notes.txt"
    connectors.manager = connectors.Connectors()
    monkeypatch.setattr(connectors.manager, "path", tmp_path / "connectors.json")
    info = await connectors.manager.upsert({"name": "Demo Notes", "transport": "stdio", "command": sys.executable,
                                            "args": [os.path.join(os.path.dirname(__file__), "mcp_demo_server.py")],
                                            "env": {"DEMO_NOTES": str(notes)}})
    assert info["status"] == "connected", info
    assert {t["name"] for t in info["tools"]} == {"add_numbers", "save_note"}
    assert info["env"] == {"DEMO_NOTES": "••••"}  # secrets never leave the server
    model = ScriptedModel([
        msg(tool("mcp_search_tools", query="add numbers")),
        msg(tool("mcp_call_tool", tool="demo_notes.add_numbers", arguments={"a": 2, "b": 3})),
        msg(tool("mcp_call_tool", tool="demo_notes.save_note", arguments={"text": "hello mcp"})),
        msg(tool("idle")),
    ])
    monkeypatch.setattr(llm, "agent_step", model)
    s = store.create()
    await s.user_message("use the notes tools", [])
    for _ in range(200):
        if s.pending_confirms:
            break
        await asyncio.sleep(0.1)
    held = next(e for e in s.events if e["type"] == "toolUsed" and e["status"] == "need_confirm")
    assert "save_note" in held["confirm"]["reason"] and "hello mcp" in held["confirm"]["command"]
    s.resolve_confirm(held["actionId"], True)
    await wait_status(s, {"idle"})
    results = [b["content"] for m in s.messages if m["role"] == "user" and isinstance(m["content"], list)
               for b in m["content"] if b.get("type") == "tool_result"]
    assert "demo_notes.add_numbers" in results[0] and '"input_schema"' in results[0]
    assert results[1].strip() == "5.0"
    assert "hello mcp" in notes.read_text()
    assert any("<connectors>" in m["content"] for m in s.messages if m["role"] == "system")
    ev = [e for e in s.events if e["type"] == "toolUsed" and e["status"] == "success" and e["tool"] == "mcp"]
    assert ev and ev[0]["detail"]["mcp"]["action"] == "search"
    await connectors.manager.stop_all()
    connectors.manager = None


@pytest.mark.asyncio
async def test_share_link(store):
    """A share link exposes the task read-only, with file access scoped to that task, until revoked."""
    import json as _json
    from fastapi import HTTPException
    from app import main
    s = store.create()
    sb = await manager.get(s.session_id)
    path = f"{sb.workdir}/report.md"
    await sb.call("/file/write", {"file": path, "content": "# shared"})
    await s.keep_file(path, "deliverable")
    await s.emit({"type": "chat", "sender": "assistant", "messageType": "text", "content": "done",
                  "attachments": [{"path": path, "filename": "report.md", "url": s.file_url(path)}]})
    token = (await main.create_share(s.session_id))["token"]
    assert (await main.create_share(s.session_id))["token"] == token  # idempotent
    body = _json.loads((await main.get_share(token)).body)
    url = body["events"][-1]["attachments"][0]["url"]
    assert url.startswith(f"/api/share/{token}/files") and "/api/sessions/" not in _json.dumps(body)
    assert (await main.share_file(token, path)).status_code == 200
    with pytest.raises(HTTPException):
        await main.share_file(token, "/etc/passwd")
    await main.revoke_share(s.session_id)
    with pytest.raises(HTTPException):
        await main.get_share(token)


@pytest.mark.asyncio
async def test_map_reduce_controls(store, monkeypatch):
    """Wide Research: cancel / retry one item, force-continue the batch, and resume finished items later."""
    model = ScriptedModel([
        msg(tool("agent_map_reduce", instruction="research", items=["alpha", "slow1", "slow2"])),
        lambda m: msg(tool("message_notify_user", text=m[-1]["content"][0]["content"][:120])),
        msg(tool("agent_map_reduce", instruction="research", items=["alpha", "beta"])),
        msg(tool("idle")),
    ])
    monkeypatch.setattr(config, "WIDE_RESEARCH_CONCURRENCY", 3)
    monkeypatch.setattr(llm, "agent_step", model)
    s = store.create()
    await s.user_message("research three things", [])

    def latest(aid=None):
        evs = [e for e in s.events if e["type"] == "toolUsed" and e.get("name") == "agent_map_reduce" and e.get("detail")
               and (aid is None or any(d["item"] == "slow1" for d in e["detail"]["mapReduce"]["taskDetails"]))]
        return evs[-1] if evs else None

    first = None

    async def until(cond, timeout=30):
        for _ in range(timeout * 10):
            if (e := latest(first)) and cond({d["item"]: d["status"] for d in e["detail"]["mapReduce"]["taskDetails"]}):
                return e
            await asyncio.sleep(0.1)
        e = latest(first)
        raise AssertionError({d["item"]: (d["status"], d["progress"]) for d in e["detail"]["mapReduce"]["taskDetails"]} if e else None)

    ev = await until(lambda st: st["alpha"] == "completed" and st["slow1"] == "running" and st["slow2"] == "running")
    aid = first = ev["actionId"]
    assert s.control_map_reduce(aid, "cancel", 1)
    await until(lambda st: st["slow1"] == "cancelled")
    assert s.control_map_reduce(aid, "retry", 1)
    await until(lambda st: st["slow1"] == "running")
    assert s.control_map_reduce(aid, "force_continue")
    ev = await until(lambda st: st["slow1"] == "cancelled" and st["slow2"] == "cancelled")
    for _ in range(100):
        if any(e["type"] == "chat" and e["sender"] == "assistant" for e in s.events):
            break
        await asyncio.sleep(0.1)
    note = next(e for e in s.events if e["type"] == "chat" and e["sender"] == "assistant")["content"]
    assert "continue with the results finished so far" in note
    assert not s.control_map_reduce(aid, "retry", 1)  # batch is over

    await wait_status(s, {"idle"}, timeout=60)  # second batch: alpha is reused, beta runs
    last = latest()["detail"]["mapReduce"]["taskDetails"]
    assert last[0]["progress"] == "复用之前的结果" and all(d["status"] == "completed" for d in last)


@pytest.mark.asyncio
async def test_project_context(store, monkeypatch, tmp_path):
    """A task in a project gets the project's instructions and a copy of its files in the sandbox."""
    from app import main, projects
    projects.store = projects.Projects()
    monkeypatch.setattr(projects.store, "root", tmp_path / "projects")
    monkeypatch.setattr(projects.store, "path", tmp_path / "projects.json")
    p = projects.store.create("品牌手册", "所有文案都使用正式的书面语。")
    projects.store.add_file(p["id"], "guide.md", "# 品牌色：深蓝".encode())
    model = ScriptedModel([msg(tool("file_read", file="project/guide.md")), msg(tool("idle"))])
    monkeypatch.setattr(llm, "agent_step", model)
    meta = await main.create_session({"projectId": p["id"]})
    s = store.get(meta["id"])
    assert meta["projectId"] == p["id"]
    await s.user_message("写一段介绍", [])
    await wait_status(s, {"idle"})
    note = next(m["content"] for m in s.messages if m["role"] == "system" and "<project" in m["content"])
    assert "正式的书面语" in note and "guide.md" in note
    read = next(e for e in s.events if e["type"] == "toolUsed" and e.get("name") == "file_read" and e["status"] == "success")
    assert "品牌色" in read["detail"]["textEditor"]["content"]


@pytest.mark.asyncio
async def test_idle_sandbox_reclaim(store, monkeypatch):
    """Idle sandboxes are stopped (busy ones never); the next message restarts them with files intact."""
    from app import main
    model = ScriptedModel([
        msg(tool("shell_exec", id="w", command="echo kept > keep.txt && sleep 2")),
        msg(tool("idle")),
        msg(tool("file_read", file="keep.txt")),
        msg(tool("idle")),
    ])
    monkeypatch.setattr(llm, "agent_step", model)
    s = store.create()
    manager.busy = lambda sid: bool((t := store.get(sid)) and t.task and not t.task.done())
    stops = []
    manager.on_stopped = stops.append
    await s.user_message("write a file", [])
    for _ in range(50):
        if s.session_id in manager.sandboxes:
            break
        await asyncio.sleep(0.1)
    assert s.session_id not in await manager.reap(idle_seconds=0.001)  # task still running: never reclaimed
    await wait_status(s, {"idle"})
    await asyncio.sleep(0.05)
    assert s.session_id in await manager.reap(idle_seconds=0.001)
    assert s.session_id not in manager.sandboxes and stops.count(s.session_id) == 1
    await s.user_message("read it back", [])
    await wait_status(s, {"idle"})
    read = [e for e in s.events if e["type"] == "toolUsed" and e.get("name") == "file_read" and e["status"] == "success"]
    assert "kept" in read[-1]["detail"]["textEditor"]["content"]
    manager.busy = lambda sid: False
    manager.on_stopped = lambda sid: None
    del main


def teardown_module():
    for proc in manager.local_procs.values():
        if proc.returncode is None:
            proc.terminate()


@pytest.mark.asyncio
async def test_download_non_ascii_filename(store):
    from app import main
    s = store.create()
    sb = await manager.get(s.session_id)
    await sb.call("/file/write", {"file": "无人机报告.md", "content": "# 报告"})
    r = await main.download(s.session_id, f"{sb.workdir}/无人机报告.md")
    disp = r.headers["content-disposition"]
    disp.encode("latin-1")  # must be a valid header value
    assert "filename*=UTF-8''%E6%97%A0%E4%BA%BA%E6%9C%BA%E6%8A%A5%E5%91%8A.md" in disp
    assert r.body.decode() == "# 报告"


@pytest.mark.asyncio
async def test_personalization(store, monkeypatch, tmp_path):
    """Profile, custom instructions and accepted knowledge reach the agent; agent proposals wait for the user."""
    from app import main, personal
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    personal.store = personal.Personal()
    personal.store.update({"profile": {"nickname": "小李", "occupation": "无人机工程师"}, "instructions": "回答尽量简洁"})
    personal.store.add("单位", "金额统一用亿元")
    model = ScriptedModel([msg(tool("knowledge_save", title="语言", content="报告默认使用中文")), msg(tool("idle")),
                           msg(tool("idle"))])
    monkeypatch.setattr(llm, "agent_step", model)
    s = store.create()
    await s.user_message("以后报告都用中文", [])
    await wait_status(s, {"idle"})
    note = next(m["content"] for m in s.messages if m["role"] == "system")
    assert "小李" in note and "回答尽量简洁" in note and "金额统一用亿元" in note
    proposed = next(k for k in personal.store.knowledge.values() if k["source"] == "agent")
    assert proposed["pending"] and "报告默认使用中文" not in personal.store.note()
    ev = next(e for e in s.events if e["type"] == "toolUsed" and e.get("name") == "knowledge_save" and e["status"] == "success")
    assert ev["detail"]["knowledge"]["id"] == proposed["id"]
    await main.edit_knowledge(proposed["id"], {"accept": True})
    # the next run re-sends the note because it changed; unchanged notes are not repeated
    await s.user_message("继续", [])
    await wait_status(s, {"idle"})
    notes = [m["content"] for m in s.messages if m["role"] == "system" and "<knowledge>" in m["content"]]
    assert len(notes) == 2 and "报告默认使用中文" in notes[-1]


@pytest.mark.asyncio
async def test_skills_library(store, monkeypatch, tmp_path):
    """Personal / uploaded skills, enable switch, usage counting, and skills pinned to one message."""
    import io
    import zipfile
    from app import skills
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    skills.store = st = skills.Skills()
    assert {"deep-research", "skill-creator"} <= set(st.items) and st.items["deep-research"].source == "official"
    st.create({"title": "周报撰写", "name": "weekly-report", "description": "MUST read before writing a weekly report.",
               "categories": ["内容", "不存在"], "body": "# 周报\n先写结论。"})
    v = st.view(st.get("weekly-report"), full=True)
    assert v["categories"] == ["内容"] and v["editable"] and "先写结论" in v["content"]
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("pack/my-tool/SKILL.md", "---\nname: my-tool\ndescription: Use for X.\n---\nRun scripts/go.sh")
        z.writestr("pack/my-tool/scripts/go.sh", "echo go")
    assert st.from_upload("my-tool.zip", buf.getvalue())["files"] == ["SKILL.md", "scripts/go.sh"]
    with pytest.raises(skills.SkillError):
        st.from_files({"SKILL.md": b"---\nname: x\ndescription: d\n---\n", "../evil": b"x"}, "personal")
    with pytest.raises(skills.SkillError):
        st.delete("deep-research")
    st.set_enabled("weekly-report", False)
    model = ScriptedModel([msg(tool("file_read", file="skills/weekly-report/SKILL.md")), msg(tool("idle"))])
    monkeypatch.setattr(llm, "agent_step", model)
    s = store.create()
    await s.user_message("写本周周报", [], ["weekly-report"])
    await wait_status(s, {"idle"})
    note = next(m["content"] for m in s.messages if m["role"] == "system")
    assert "my-tool" in note and "weekly-report" not in note  # disabled: not in the catalog...
    assert "<selected_skills>" in s.messages[0]["content"][0]["text"]  # ...but pinned to this message
    read = next(e for e in s.events if e.get("name") == "file_read" and e["status"] == "success")
    assert "先写结论" in read["detail"]["textEditor"]["content"]  # installed although disabled
    assert st.state["weekly-report"]["uses"] == 1
    assert next(e for e in s.events if e["type"] == "chat")["skills"] == ["weekly-report"]


@pytest.mark.asyncio
async def test_search_variants(store, monkeypatch):
    """Several queries in one call run together; image and scholar search return their own details."""
    async def imgs(q, limit=12):
        return [{"image": "https://x/a.jpg", "thumbnail": "https://x/t.jpg", "title": "A", "source": "https://x", "width": 800, "height": 600}]

    async def papers(q, year_from=None, limit=10):
        return [{"title": "Paper", "authors": ["Li"], "year": 2025, "venue": "ICRA", "citations": 3,
                 "url": "https://doi.org/1", "pdf": "", "abstract": "We study drones."}]
    seen = []

    async def web(q, date_range="all", limit=10):
        seen.append((q, limit))
        if q == "bad":
            raise RuntimeError("boom")
        return [{"title": q, "url": "https://same.example", "snippet": "s"}]
    monkeypatch.setattr(agent_mod, "search_web", web)
    monkeypatch.setattr(agent_mod, "search_images", imgs)
    monkeypatch.setattr(agent_mod, "search_scholar", papers)
    model = ScriptedModel([msg(tool("info_search_web", queries=["无人机", "drone", "bad"]), tool("info_search_image", query="drone"),
                               tool("info_search_scholar", query="drone", year_from=2020)),
                           msg(tool("info_search_web")), msg(tool("idle"))])
    monkeypatch.setattr(llm, "agent_step", model)
    s = store.create()
    await s.user_message("搜一下", [])
    await wait_status(s, {"idle"})
    done = {e["name"]: e for e in s.events if e["type"] == "toolUsed" and e["status"] == "success"}
    assert done["info_search_web"]["detail"]["search"]["queries"] == ["无人机", "drone", "bad"]
    assert {q for q, n in seen} == {"无人机", "drone", "bad"} and all(n == 6 for _, n in seen)
    result = next(b for m in s.messages if m["role"] == "user" for b in m["content"] if isinstance(b, dict)
                  and b.get("type") == "tool_result" and "## drone" in str(b.get("content")))
    assert "Search failed: boom" in result["content"] and not result.get("is_error")
    assert done["info_search_image"]["detail"]["searchImage"]["results"][0]["width"] == 800
    assert done["info_search_scholar"]["detail"]["searchScholar"]["results"][0]["venue"] == "ICRA"
    empty = [e for e in s.events if e.get("name") == "info_search_web" and e["status"] == "error"]
    assert empty  # no query at all is an error the model sees


@pytest.mark.asyncio
async def test_triggers(store, monkeypatch, tmp_path):
    """Webhook and condition triggers start tasks; the watcher is read-only and carries state between checks."""
    import json as _json
    from app import main, triggers as trig
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    trig.triggers = t = trig.Triggers(store)
    from app import scheduler as sched
    sched.scheduler = sched.Scheduler(store)
    prices = iter(["399", "399", "349"])
    seen_briefs, refusals = [], []

    async def model(messages, effort, on_delta=None, text_id="text", profile=None):
        first = messages[0]["content"]
        if isinstance(first, str) and "checking a condition" in first:
            seen_briefs.append(first)
            if len(messages) == 1:  # the watcher tries something outward-facing first: it must be refused
                return msg(tool("shell_exec", command="curl -X POST -d x https://example.com"))
            refusals.append(messages[-1]["content"])
            p = next(prices)
            met = "首次" not in first and "price 399" in first and p != "399"
            return msg(tool("idle", result=_json.dumps({"met": met, "summary": f"现价 {p}", "state": f"price {p}"})))
        return msg(tool("idle"))
    monkeypatch.setattr(llm, "agent_step", model)

    hook = t.create({"kind": "webhook", "title": "CI 失败", "prompt": "分析失败原因"})
    req = type("R", (), {"headers": {"content-type": "application/json"}})()
    async def body():
        return b'{"job": "build", "status": "failed"}'
    req.body = body
    r = await main.webhook(hook["url"].rsplit("/", 1)[1], req)
    s = store.get(r["sessionId"])
    await wait_status(s, {"idle"})
    assert s.trigger_id == hook["id"] and '"status": "failed"' in s.messages[0]["content"][0]["text"]
    with pytest.raises(main.HTTPException):  # rate limit: one event per 5 s
        await main.webhook(hook["url"].rsplit("/", 1)[1], req)

    cond = t.create({"kind": "condition", "title": "降价提醒", "prompt": "通知我降价了", "condition": "商品价格低于上次", "everyMinutes": 30})
    c1 = await t.check(cond["id"])
    assert not c1["met"] and t.items[cond["id"]]["state"] == "price 399"
    assert any("declined" in str(b.get("content")) for b in refusals[0]) and "curl" in c1["steps"][0]
    c2 = await t.check(cond["id"])
    assert not c2["met"] and "price 399" in seen_briefs[-1]
    c3 = await t.check(cond["id"])
    assert c3["met"] and c3["sessionId"]
    run = store.get(c3["sessionId"])
    await wait_status(run, {"idle"})
    assert "现价 349" in run.messages[0]["content"][0]["text"]
    activity = await main.automation_activity()
    assert {a["type"] for a in activity} == {"run", "check"}
    with pytest.raises(trig.TriggerError):
        t.create({"kind": "condition", "prompt": "x", "condition": "y", "everyMinutes": 1})
    await t.delete(cond["id"])
    assert cond["id"] not in t.items


def test_plugin_catalog_build():
    """Catalog entries render into connector configs; secrets stay out of args and visible URLs."""
    from app import connectors, plugins
    cat = plugins.catalog({})
    assert {"效率", "开发", "出行"} <= set(cat["categories"]) and all(p["connector"] is None for p in cat["plugins"])
    with pytest.raises(plugins.PluginError):
        plugins.build("lark", {"app_id": "cli_1"})
    lark = plugins.build("lark", {"app_id": "cli_1", "app_secret": "s3cret"})
    assert lark["command"] == "sh" and "s3cret" not in " ".join(lark["args"]) and lark["env"]["LARK_APP_SECRET"] == "s3cret"
    amap = plugins.build("amap", {"key": "abc123"})
    assert amap["url"].endswith("key=abc123") and connectors.mask_url(amap["url"]).endswith("key=••••")
    c7 = plugins.build("context7", {})
    assert c7["headers"] == {} and c7["plugin"] == "context7" and c7["autoApprove"]
    assert not plugins.build("stripe", {"key": "k"})["autoApprove"]  # can write: calls are confirmed
    gh = plugins.build("github", {"token": "t"})
    assert gh["headers"] == {"Authorization": "Bearer t"}


@pytest.mark.asyncio
async def test_slides_and_media(store, monkeypatch):
    """slides_export renders an HTML deck in the sandbox; media tools save generated files there."""
    import base64 as b64
    import io
    from PIL import Image
    from app import media
    buf = io.BytesIO()
    Image.new("RGB", (64, 36), "red").save(buf, "PNG")
    png = buf.getvalue()
    calls = []

    async def fake_image(prompt, refs=None, aspect_ratio="16:9"):
        calls.append((prompt, [m for _, m in refs or []], aspect_ratio))
        return png

    async def no_video(*a, **k):
        raise media.MediaError("video generation is not configured (MANUS_VIDEO_MODEL)")
    monkeypatch.setattr(media, "generate_image", fake_image)
    monkeypatch.setattr(media, "generate_video", no_video)
    deck = (config.SKILLS_DIR / "slides" / "template.html").read_text()
    model = ScriptedModel([
        msg(tool("file_write", file="deck/index.html", content=deck)),
        msg(tool("slides_export", file="deck/index.html", formats=["pdf", "pptx"])),
        msg(tool("media_generate_image", prompt="a drone", output_path="img/a.png", aspect_ratio="1:1")),
        msg(tool("media_generate_image", prompt="make it blue", output_path="img/b.png", reference_images=["img/a.png"])),
        msg(tool("media_generate_video", prompt="fly", output_path="v.mp4")),
        msg(tool("idle"))])
    monkeypatch.setattr(llm, "agent_step", model)
    s = store.create()
    await s.user_message("做个幻灯片", [])
    await wait_status(s, {"idle"}, timeout=120)
    done = {e["name"] + str(i): e for i, e in enumerate(s.events) if e["type"] == "toolUsed" and e["status"] in ("success", "error")}
    sl = next(e for e in done.values() if e["name"] == "slides_export")["detail"]["slides"]
    assert sl["count"] == 4 and sl["pdf"]["path"].endswith(".pdf") and sl["pptx"]["path"].endswith(".pptx")
    assert sl["slides"][0]["title"] == "标题写结论，而不是话题" and sl["slides"][0]["thumb"].startswith("/api/sessions/")
    imgs = [e for e in done.values() if e["name"] == "media_generate_image"]
    assert all(e["status"] == "success" for e in imgs) and imgs[0]["detail"]["media"]["kind"] == "image"
    assert calls[0][2] == "1:1" and calls[1][1] == ["image/png"]  # the reference was read from the sandbox
    vid = next(e for e in done.values() if e["name"] == "media_generate_video")
    assert vid["status"] == "error" and "not configured" in vid["detail"]["error"]
    sent = next(b for m in s.messages if m["role"] == "user" for b in m["content"] if isinstance(b, dict)
                and b.get("type") == "tool_result" and isinstance(b.get("content"), list))
    assert any(x.get("type") == "image" for x in sent["content"])  # the model sees a preview of its image
    assert {"index.pdf", "index.pptx", "a.png", "b.png"} <= {f["filename"] for f in s.files.values()}


@pytest.mark.asyncio
async def test_publish_site(store, monkeypatch, tmp_path):
    """deploy_publish copies a site out of the sandbox; it is served on its own host, versioned, and isolated."""
    import pathlib
    from app import main, sites
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "CONFIRM_ENABLED", False)
    sites.store = sites.Sites()
    model = ScriptedModel([
        msg(tool("file_write", file="game/index.html", content="<h1>v1</h1><script src='app.js'></script>"),
            ),
        msg(tool("file_write", file="game/app.js", content="console.log(1)")),
        msg(tool("file_write", file="game/node_modules/x.js", content="skip me")),
        msg(tool("deploy_publish", path="game", title="Snake Game", kind="game")),
        msg(tool("file_write", file="game/index.html", content="<h1>v2</h1>")),
        msg(tool("deploy_publish", path="game/index.html", title="Snake Game", kind="game")),
        msg(tool("deploy_publish", path="nothing-here", title="x")),
        msg(tool("idle"))])
    monkeypatch.setattr(llm, "agent_step", model)
    s = store.create()
    await s.user_message("做个游戏并发布", [])
    await wait_status(s, {"idle"}, timeout=90)
    pubs = [e for e in s.events if e.get("name") == "deploy_publish" and e["status"] in ("success", "error")]
    assert [e["status"] for e in pubs] == ["success", "success", "error"], [e.get("detail") for e in pubs]
    site = next(iter(sites.store.items.values()))
    assert len(sites.store.items) == 1 and site["current"] == 2 and site["kind"] == "game"
    assert site["slug"].startswith("snake-game-") and pubs[0]["detail"]["site"]["url"].startswith(f"http://{site['slug']}.")
    assert not (sites.store.root / site["id"] / "v1" / "node_modules").exists()
    page = main._serve_site(site["slug"], "", sandboxed=False)
    assert page.status_code == 200 and "content-security-policy" not in page.headers
    assert b"v2" in pathlib.Path(page.path).read_bytes()
    assert "sandbox" in main._serve_site(site["slug"], "app.js", sandboxed=True).headers["content-security-policy"]
    assert main._serve_site(site["slug"], "../../sites.json", sandboxed=False).status_code == 404
    assert pathlib.Path(main._serve_site(site["slug"], "some/route", sandboxed=False).path).name == "index.html"  # SPA
    sites.store.update(site["id"], {"current": 1})
    assert b"v1" in pathlib.Path(main._serve_site(site["slug"], "index.html", sandboxed=False).path).read_bytes()


@pytest.mark.asyncio
async def test_cloud_computer(store, monkeypatch, tmp_path):
    """Tasks on a computer share its sandbox; the idle reaper leaves it running unless auto-stop is set."""
    from app import computers, main
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    computers.store = computers.Computers()
    c = computers.store.create({"template": "custom", "name": "我的服务器", "cpus": 2, "memory": 4})
    await computers.store.tasks[c["id"]]
    assert computers.store.view(computers.store.items[c["id"]])["status"] == "running"
    model = ScriptedModel([msg(tool("file_write", file="notes.txt", content="from task 1")), msg(tool("idle")),
                           msg(tool("file_read", file="notes.txt")), msg(tool("idle"))])
    monkeypatch.setattr(llm, "agent_step", model)
    a = store.get((await main.create_session({"computerId": c["id"]}))["id"])
    await a.user_message("写个文件", [])
    await wait_status(a, {"idle"})
    b = store.get((await main.create_session({"computerId": c["id"]}))["id"])
    await b.user_message("读那个文件", [])
    await wait_status(b, {"idle"})
    read = next(e for e in b.events if e.get("name") == "file_read" and e["status"] == "success")
    assert "from task 1" in read["detail"]["textEditor"]["content"]
    assert "persistent cloud computer" in next(m["content"] for m in b.messages if m["role"] == "system")
    sbid = computers.sandbox_id(c["id"])
    assert sbid not in await manager.reap(idle_seconds=None) and sbid in manager.sandboxes  # never auto-stopped
    out = await computers.store.exec(c["id"], "echo hi from console")
    assert "hi from console" in out["output"]
    with pytest.raises(computers.ComputerError):
        computers.store.update(c["id"], {"ports": [{"port": 8080}]})
    assert computers.store.update(c["id"], {"ports": [{"port": 3000}]})["ports"][0]["url"].startswith(f"http://pc-{c['id']}-3000.")
    await main.delete_computer(c["id"])
    assert sbid not in manager.sandboxes and a.computer_id is None
