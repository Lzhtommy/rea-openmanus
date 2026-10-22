"""Tool (action space) definitions.

Names use capability prefixes (shell_, file_, browser_, ...) as Manus does, so tool
availability can be constrained per agent role by prefix without ever changing the
tool list — the list is sorted and identical for every agent so the prompt cache prefix
(tools -> system) is shared by the main agent and all sub-agents.
"""

from __future__ import annotations

import re


# Every tool takes an optional user-facing one-liner, shown as the step title in the UI
# (Manus' `toolUsed.brief`, e.g. "检索全球无人机市场规模资料").
BRIEF = {"type": "string", "description": "Short description of this action for the user, in the user's language"}


def _t(name: str, description: str, props: dict, required: list[str] | None = None) -> dict:
    return {
        "name": name,
        "description": description,
        "input_schema": {"type": "object", "properties": {**props, "brief": BRIEF}, "required": required or []},
        "eager_input_streaming": True,
    }


S = {"type": "string"}
I = {"type": "integer"}
B = {"type": "boolean"}
N = {"type": "number"}
ATTACH = {"type": "array", "items": S, "description": "Absolute sandbox paths of files to attach"}

_TOOLS = [
    # ---- messaging
    _t("message_notify_user",
       "Send a message to the user without waiting for a reply. Use for acknowledgements, "
       "progress updates, and delivering final results (attach deliverable files). Set "
       "kind='result' on the final delivery.",
       {"text": S, "attachments": ATTACH, "kind": {"type": "string", "enum": ["progress", "result"]}},
       ["text"]),
    _t("message_ask_user",
       "Ask the user a question and wait for the reply. Use only when user input is "
       "required. Set suggest_user_takeover='browser' when the user must operate the browser "
       "(login, CAPTCHA).",
       {"text": S, "attachments": ATTACH,
        "suggest_user_takeover": {"type": "string", "enum": ["none", "browser"]}}, ["text"]),
    # ---- planning
    _t("plan_update",
       "Replace the task plan with the given steps. Use it to mark progress (status) and to "
       "revise steps. Returns the full current plan.",
       {"steps": {"type": "array", "items": {
           "type": "object",
           "properties": {"title": S, "status": {"type": "string",
                                                 "enum": ["pending", "running", "completed", "skipped"]}},
           "required": ["title", "status"]}}},
       ["steps"]),
    # ---- files
    _t("file_read", "Read a text file. Optionally a line range (0-based start, exclusive end).",
       {"file": S, "start_line": I, "end_line": I}, ["file"]),
    _t("file_write", "Write (or append to) a text file. Creates parent directories.",
       {"file": S, "content": S, "append": B, "leading_newline": B, "trailing_newline": B},
       ["file", "content"]),
    _t("file_str_replace", "Replace one unique occurrence of old_str with new_str in a file.",
       {"file": S, "old_str": S, "new_str": S}, ["file", "old_str", "new_str"]),
    _t("file_find_in_content", "Search a file's lines with a regular expression.",
       {"file": S, "regex": S}, ["file", "regex"]),
    _t("file_find_by_name", "Find files under a directory by glob pattern on the file name.",
       {"path": S, "glob": S}, ["path", "glob"]),
    # ---- shell
    _t("shell_exec",
       "Run a bash command in shell session `id` (default \"default\"; use a new id for a concurrent session). "
       "Waits up to `timeout` seconds (default 30); longer commands keep running in the "
       "background — check them with shell_wait / shell_view.",
       {"id": S, "command": S, "exec_dir": S, "timeout": N}, ["command"]),
    _t("shell_view", "View the current output of a shell session.", {"id": S}),
    _t("shell_wait", "Wait up to `seconds` for the running process in a shell session, then view it.",
       {"id": S, "seconds": N}),
    _t("shell_write_to_process", "Write input to the running process in a shell session.",
       {"id": S, "input": S, "press_enter": B}, ["input"]),
    _t("shell_kill_process", "Kill the running process in a shell session.", {"id": S}),
    # ---- browser
    _t("browser_navigate", "Open a URL in the browser.", {"url": S}, ["url"]),
    _t("browser_view", "Observe the current page (elements, text, screenshot).", {}),
    _t("browser_click", "Click an element by index (preferred) or by viewport coordinates.",
       {"index": I, "coordinate_x": N, "coordinate_y": N}),
    _t("browser_input", "Type text into an element by index (or coordinates), optionally press Enter.",
       {"index": I, "coordinate_x": N, "coordinate_y": N, "text": S, "press_enter": B},
       ["text", "press_enter"]),
    _t("browser_move_mouse", "Move the mouse to viewport coordinates (hover).",
       {"coordinate_x": N, "coordinate_y": N}, ["coordinate_x", "coordinate_y"]),
    _t("browser_press_key", "Press a key or combination, e.g. Enter, Escape, Control+a.",
       {"key": S}, ["key"]),
    _t("browser_select_option", "Choose option number `option` (0-based) of a <select> element.",
       {"index": I, "option": I}, ["index", "option"]),
    _t("browser_scroll_down", "Scroll down one screen, or to the bottom with to_end.", {"to_end": B}),
    _t("browser_scroll_up", "Scroll up one screen, or to the top with to_end.", {"to_end": B}),
    _t("browser_console_exec", "Evaluate a JavaScript expression in the page and return the result.",
       {"javascript": S}, ["javascript"]),
    _t("browser_console_view", "View recent browser console messages.", {}),
    _t("browser_restart", "Restart the browser (clears state) and open a URL.", {"url": S}, ["url"]),
    # ---- information
    _t("info_search_web",
       "Search the web. Returns titles, URLs, and snippets. Open pages with the browser to "
       "read full content.",
       {"query": S, "date_range": {"type": "string",
                                   "enum": ["all", "past_day", "past_week", "past_month", "past_year"]}},
       ["query"]),
    _t("info_extract_webpage",
       "Fetch a web page in a separate headless tab and return its readable text, without "
       "touching the interactive browser. Read-only: call it for several URLs in one turn to "
       "read sources in parallel. Use browser_* instead when the page needs interaction.",
       {"url": S}, ["url"]),
    # ---- deploy
    _t("deploy_expose_port",
       "Expose a service listening on a sandbox port and return a public preview URL.",
       {"port": I}, ["port"]),
    # ---- multi-agent (Wide Research)
    _t("agent_map_reduce",
       "Run many independent, similar sub-tasks in parallel, each handled by a fully capable "
       "sub-agent sharing this sandbox, then return all results. Use for N items of the same "
       "kind (e.g. research each of 20 companies).",
       {"instruction": {"type": "string", "description": "What to do for every item"},
        "items": {"type": "array", "items": S, "description": "One entry per sub-task"},
        "output_file_pattern": {"type": "string",
                                "description": "Optional per-item output path, may contain {index}"}},
       ["instruction", "items"]),
    # ---- automation
    _t("schedule_create",
       "Create a scheduled task that runs `prompt` as a new task automatically (e.g. a daily news digest). "
       "kind: once (needs `at`, ISO datetime in the user's local time), interval (needs every_minutes >= 5), "
       "daily (needs `time` HH:MM), weekly (needs `weekday` 0=Monday..6=Sunday and `time`). Use when the user "
       "asks for something to happen repeatedly or later.",
       {"title": S, "prompt": {"type": "string", "description": "Full, self-contained instruction for each run"},
        "kind": {"type": "string", "enum": ["once", "interval", "daily", "weekly"]},
        "at": S, "every_minutes": I, "time": S, "weekday": I},
       ["title", "prompt", "kind"]),
    # ---- control
    _t("idle",
       "Enter standby: the task is complete (or the user asked to stop). Sub-agents must "
       "pass their final findings in `result`.",
       {"result": S}),
]

TOOLS: list[dict] = sorted(_TOOLS, key=lambda t: t["name"])
TOOL_NAMES = {t["name"] for t in TOOLS}
REQUIRED = {t["name"]: t["input_schema"]["required"] for t in TOOLS}


# Role-based masking by prefix (the tool list itself never changes).
ROLE_DENY = {
    "main": (),
    "subagent": ("message_", "agent_", "schedule_"),
}


# Actions with effects outside the sandbox (or that destroy a lot inside it) wait for the user's
# approval before running, like Manus' need_confirm / confirm_* flow. Shell commands are matched
# against patterns because the shell can do anything.
_RISKY_SHELL = [
    (r"\bgit\s+push\b", "推送代码到远程仓库"),
    (r"\b(npm|pnpm|yarn)\s+publish\b|\btwine\s+upload\b|\bdocker\s+push\b|\bgh\s+(release|repo|pr)\s+create\b", "发布到公共平台"),
    (r"\bcurl\b[^|;&]*(\s-X\s*(POST|PUT|PATCH|DELETE)\b|\s(-d|--data\S*|-F|--form)\s)|\bwget\b[^|;&]*--post", "向外部服务发送数据"),
    (r"\b(ssh|scp|rsync|sftp)\s+\S*@", "连接远程服务器"),
    (r"\b(sendmail|mailx?|mutt)\b", "发送邮件"),
    (r"\brm\s+-[a-zA-Z]*r[a-zA-Z]*f?\s+(/|~|\$HOME|/home/ubuntu)(\s|$)|\bmkfs\b|\bdd\s+if=.*\bof=/dev/", "删除大量文件或磁盘数据"),
]


def needs_confirm(name: str, args: dict) -> str | None:
    """Why this call needs the user's approval, or None."""
    if name == "deploy_expose_port":
        return "生成可公开访问的预览链接"
    if name in ("shell_exec", "shell_write_to_process"):
        text = args.get("command") or args.get("input") or ""
        for pattern, reason in _RISKY_SHELL:
            if re.search(pattern, text):
                return reason
    return None


# Read-only tools without shared state. When every call in a turn is one of these they
# run concurrently (Manus fires several webpage_extract / search calls at once).
PARALLEL_SAFE = {"info_search_web", "info_extract_webpage", "file_read", "file_find_in_content",
                 "file_find_by_name"}


def is_allowed(role: str, name: str) -> bool:
    return not any(name.startswith(p) for p in ROLE_DENY[role])


# Map our tool names onto the UI tool categories observed in Manus' frontend
# (toolUsed.tool ∈ terminal | browser | text_editor | search | map_reduce | ...).
def ui_category(name: str) -> str:
    if name.startswith("shell_"):
        return "terminal"
    if name.startswith("browser_"):
        return "browser"
    if name.startswith("file_"):
        return "text_editor"
    if name == "info_search_web":
        return "search"
    if name == "info_extract_webpage":
        return "webpage_extract"
    if name == "agent_map_reduce":
        return "map_reduce"
    if name.startswith("deploy_"):
        return "deploy"
    if name.startswith("schedule_"):
        return "schedule"
    return name


ACTION_LABEL = {
    "terminal": "Executing command",
    "browser": "Browsing",
    "text_editor": "Editing file",
    "search": "Searching",
    "webpage_extract": "Reading webpage",
    "map_reduce": "Running parallel sub-agents",
    "deploy": "Deploying",
}


def describe(name: str, args: dict) -> tuple[str, str]:
    """(action, param) pair for the step row, mirroring toolUsed.message in Manus."""
    cat = ui_category(name)
    if name == "file_read":
        return "Reading file", args.get("file", "")
    if name in ("file_write", "file_str_replace"):
        return "Editing file", args.get("file", "")
    if name.startswith("file_find"):
        return "Searching files", args.get("regex") or args.get("glob", "")
    if name == "shell_exec":
        return "Executing command", args.get("command", "")
    if name.startswith("shell_"):
        return "Checking terminal", args.get("id", "default")
    if name in ("browser_navigate", "browser_restart"):
        return "Browsing", args.get("url", "")
    if name == "browser_input":
        return "Typing", args.get("text", "")
    if name == "browser_click":
        return "Clicking", f"element {args.get('index')}" if args.get("index") is not None else "coordinates"
    if name == "browser_console_exec":
        return "Running JavaScript", args.get("javascript", "")[:120]
    if name == "info_search_web":
        return "Searching", args.get("query", "")
    if name == "info_extract_webpage":
        return "Reading webpage", args.get("url", "")
    if name == "agent_map_reduce":
        return "Running parallel sub-agents", f"{len(args.get('items', []))} items"
    if name == "deploy_expose_port":
        return "Exposing port", str(args.get("port", ""))
    if name == "schedule_create":
        return "Creating scheduled task", args.get("title", "")
    return ACTION_LABEL.get(cat, name), ""
