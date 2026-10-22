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

    async def __call__(self, messages, effort, on_delta=None, text_id="text"):
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
                return msg(tool("shell_exec", id=f"sub-{item}", command=f"echo researching {item}"))
            return msg(tool("idle", result=f"Findings for {item}: ok"))
        step = self.script.pop(0)
        return step(messages) if callable(step) else step


async def fake_plan(request, context=""):
    return {"goal": "test goal", "title": "Test task", "steps": ["Explore", "Build", "Deliver"]}


async def fake_search(query, date_range="all", limit=10):
    return [{"title": "Example", "url": "https://example.com", "snippet": "snippet"}]


async def fake_suggest(request, reply):
    return ["深入分析第一点", "做成网站"]


@pytest.fixture
def store(monkeypatch):
    monkeypatch.setattr(llm, "plan", fake_plan)
    monkeypatch.setattr(llm, "suggest", fake_suggest)
    monkeypatch.setattr(agent_mod, "search_web", fake_search)
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
