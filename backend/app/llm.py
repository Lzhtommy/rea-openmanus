"""LLM access through an OpenAI-compatible chat-completions gateway (LiteLLM proxy).

The agent keeps its history in Anthropic content-block form (text / thinking / tool_use /
tool_result / image) because that is what the loop reasons about. This module converts that
history to chat-completions messages on the way out and the reply back into blocks on the
way in, so nothing above this layer knows which wire format is in use.

LiteLLM specifics used here: `reasoning_effort` (mapped to Claude adaptive thinking),
`thinking_blocks` on assistant messages (Claude needs the signed thinking replayed during
tool use), and `cache_control` on content parts (Anthropic prompt caching).
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import AsyncIterator, Callable
from typing import Any

import openai
from pydantic import BaseModel

from . import config
from .prompts import PLANNER_PROMPT, PLANNER_SCHEMA, SUGGEST_PROMPT, SUGGEST_SCHEMA, SYSTEM_PROMPT
from .tools import TOOLS

log = logging.getLogger("manus.llm")

APIError = openai.OpenAIError  # any LLM failure, including a missing key
BadRequestError = openai.BadRequestError

_client: openai.AsyncOpenAI | None = None


def client() -> openai.AsyncOpenAI:
    global _client
    if _client is None:
        if not config.LLM_BASE_URL:
            raise openai.OpenAIError("MANUS_LLM_BASE_URL is not set")
        if not config.LLM_API_KEY:
            raise openai.OpenAIError("MANUS_LLM_API_KEY is not set")
        _client = openai.AsyncOpenAI(api_key=config.LLM_API_KEY, base_url=config.LLM_BASE_URL, max_retries=4,
                                     timeout=600)
    return _client


# ------------------------------------------------------------------ reply ---

class Block(BaseModel):
    """One content block of an assistant reply, in Anthropic shape."""
    type: str  # text | thinking | tool_use
    text: str | None = None
    thinking: str | None = None
    signature: str | None = None
    id: str | None = None
    name: str | None = None
    input: dict | None = None


class Reply(BaseModel):
    content: list[Block]
    stop_reason: str  # end_turn | tool_use | max_tokens | refusal


_STOP = {"stop": "end_turn", "tool_calls": "tool_use", "function_call": "tool_use", "length": "max_tokens",
         "content_filter": "refusal"}


def _blocks(thinking: list[dict], reasoning: str, content: str, calls: list[tuple[str, str, str]],
            finish: str | None) -> Reply:
    """Assemble a reply from its parts (shared by the streaming and non-streaming paths)."""
    blocks: list[Block] = []
    for t in thinking:
        if t.get("type", "thinking") == "thinking" and t.get("thinking"):
            blocks.append(Block(type="thinking", thinking=t["thinking"], signature=t.get("signature")))
    if not blocks and reasoning:
        blocks.append(Block(type="thinking", thinking=reasoning))
    if content:
        blocks.append(Block(type="text", text=content))
    for call_id, name, arguments in calls:
        try:
            args = json.loads(arguments or "{}")
        except json.JSONDecodeError:
            args = {"_unparsed_arguments": arguments}  # fails validation; the model sees why
        blocks.append(Block(type="tool_use", id=call_id, name=name,
                            input=args if isinstance(args, dict) else {"_unparsed_arguments": args}))
    stop = _STOP.get(finish or "stop", "end_turn")
    if calls and stop == "end_turn":
        stop = "tool_use"  # some providers report "stop" alongside tool calls
    return Reply(content=blocks, stop_reason=stop)


def _reply(resp) -> Reply:
    choice = resp.choices[0]
    msg = choice.message
    extra = msg.model_extra or {}
    calls = [(tc.id, tc.function.name, tc.function.arguments) for tc in msg.tool_calls or []]
    return _blocks(extra.get("thinking_blocks") or [], extra.get("reasoning_content") or "", msg.content or "",
                   calls, choice.finish_reason)


# ------------------------------------------------------------- streaming ---
# Text the user will see is streamed as it is generated (Manus' chatDelta): the final answer
# when the model replies in plain text, and the `text` argument of message_* tool calls, read
# out of the partial JSON arguments while they arrive.

STREAMED_TOOLS = {"message_notify_user", "message_ask_user"}
_TEXT_KEY = re.compile(r'"text"\s*:\s*"')
_ESCAPES = {"n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f"}

Delta = Callable[[str, str], None]  # (stream id, text so far)


def partial_text(arguments: str) -> str | None:
    """The (possibly unfinished) value of "text" in a partial JSON object, or None if not started."""
    m = _TEXT_KEY.search(arguments)
    if not m:
        return None
    s, out, i = arguments[m.end():], [], 0
    while i < len(s):
        c = s[i]
        if c == '"':
            break
        if c == "\\":
            if i + 1 >= len(s):
                break
            n = s[i + 1]
            if n == "u":
                if i + 6 > len(s):
                    break
                out.append(chr(int(s[i + 2:i + 6], 16)))
                i += 6
                continue
            out.append(_ESCAPES.get(n, n))
            i += 2
            continue
        out.append(c)
        i += 1
    return "".join(out).encode("utf-16", "surrogatepass").decode("utf-16", "replace")


async def _accumulate(chunks: AsyncIterator, on_delta: Delta | None, text_id: str) -> Reply:
    content, reasoning, finish = "", "", None
    thinking: list[dict] = []
    calls: dict[int, dict] = {}
    shown: dict[str, str] = {}

    def push(stream_id: str, text: str | None):
        if on_delta and text and shown.get(stream_id) != text:
            shown[stream_id] = text
            on_delta(stream_id, text)

    async for chunk in chunks:
        if not chunk.choices:
            continue
        choice = chunk.choices[0]
        finish = choice.finish_reason or finish
        d = choice.delta
        extra = d.model_extra or {}
        reasoning += extra.get("reasoning_content") or ""
        for tb in extra.get("thinking_blocks") or []:
            if not thinking or thinking[-1].get("signature"):
                thinking.append({"type": "thinking", "thinking": ""})
            thinking[-1]["thinking"] += tb.get("thinking") or ""
            if tb.get("signature"):
                thinking[-1]["signature"] = tb["signature"]
        if d.content:
            content += d.content
            push(text_id, content)
        for tc in d.tool_calls or []:
            c = calls.setdefault(tc.index, {"id": "", "name": "", "args": ""})
            c["id"] = tc.id or c["id"]
            if tc.function:
                c["name"] += tc.function.name or ""
                c["args"] += tc.function.arguments or ""
            if c["name"] in STREAMED_TOOLS and c["id"]:
                push(c["id"], partial_text(c["args"]))
    ordered = [(c["id"], c["name"], c["args"]) for _, c in sorted(calls.items())]
    return _blocks(thinking, reasoning, content, ordered, finish)


# --------------------------------------------------------------- request ---

def _image_part(block: dict) -> dict:
    src = block["source"]
    return {"type": "image_url", "image_url": {"url": f"data:{src['media_type']};base64,{src['data']}"}}


def _tool_result(block: dict) -> tuple[str, list[dict]]:
    """Tool messages carry text only; images go into a user message right after."""
    content = block.get("content", "")
    if isinstance(content, str):
        text, images = content, []
    else:
        text = "\n".join(b["text"] for b in content if b.get("type") == "text")
        images = [_image_part(b) for b in content if b.get("type") == "image"]
    if block.get("is_error"):
        text = f"ERROR: {text}"
    return text, images


def _to_chat(messages: list[dict]) -> list[dict]:
    out: list[dict] = []
    for m in messages:
        role, content = m["role"], m["content"]
        if role == "system":
            # Mid-conversation operator notes. Folded into the preceding user turn: providers
            # differ on mid-list system messages (Anthropic hoists them into the prefix).
            note = {"type": "text", "text": f"<system_event>\n{content}\n</system_event>"}
            if out and out[-1]["role"] == "user":
                prev = out[-1]
                if isinstance(prev["content"], str):
                    prev["content"] = [{"type": "text", "text": prev["content"]}]
                prev["content"].append(note)
            else:
                out.append({"role": "user", "content": [note]})
            continue
        if isinstance(content, str):
            out.append({"role": role, "content": content})
            continue
        if role == "assistant":
            text = "".join(b["text"] for b in content if b.get("type") == "text")
            msg: dict[str, Any] = {"role": "assistant", "content": text or None}
            calls = [{"id": b["id"], "type": "function",
                      "function": {"name": b["name"], "arguments": json.dumps(b.get("input") or {}, ensure_ascii=False)}}
                     for b in content if b.get("type") == "tool_use"]
            if calls:
                msg["tool_calls"] = calls
            signed = [{"type": "thinking", "thinking": b["thinking"], "signature": b["signature"]}
                      for b in content if b.get("type") == "thinking" and b.get("signature")]
            if signed:
                msg["thinking_blocks"] = signed
            out.append(msg)
            continue
        # user turn: tool results first (they must follow the assistant tool_calls), then the rest
        parts: list[dict] = []
        for b in content:
            if b.get("type") == "tool_result":
                text, images = _tool_result(b)
                out.append({"role": "tool", "tool_call_id": b["tool_use_id"], "content": text or "(empty)"})
                parts.extend(images)
            elif b.get("type") == "text":
                parts.append({"type": "text", "text": b["text"]})
            elif b.get("type") == "image":
                parts.append(_image_part(b))
        if parts:
            out.append({"role": "user", "content": parts})
    return out


def _cache_tail(chat: list[dict]) -> None:
    """Mark the end of the conversation as a cache breakpoint (Anthropic via LiteLLM)."""
    for m in reversed(chat):
        if m["role"] in ("user", "tool"):
            if isinstance(m["content"], str):
                m["content"] = [{"type": "text", "text": m["content"]}]
            last = next((p for p in reversed(m["content"]) if p.get("type") == "text"), None)
            if last is not None:
                last["cache_control"] = {"type": "ephemeral"}
            return


def _system(text: str) -> dict:
    part = {"type": "text", "text": text}
    if config.PROMPT_CACHE:
        part["cache_control"] = {"type": "ephemeral"}
    return {"role": "system", "content": [part]}


CHAT_TOOLS = [{"type": "function", "function": {"name": t["name"], "description": t["description"],
                                                "parameters": t["input_schema"]}} for t in TOOLS]


def _common(effort: str | None) -> dict:
    kw: dict[str, Any] = {"model": config.MODEL, "extra_body": {"drop_params": True}}
    if effort and config.REASONING:
        kw["reasoning_effort"] = effort
    return kw


async def agent_step(messages: list[dict], effort: str, on_delta: Delta | None = None,
                     text_id: str = "text") -> Reply:
    """One agent-loop iteration: the model selects the next tool call(s).

    With on_delta, the reply is streamed and user-facing text is reported as it arrives
    (stream id = the message tool call's id, or text_id for a plain-text answer).
    """
    chat = [_system(SYSTEM_PROMPT)] + _to_chat(messages)
    if config.PROMPT_CACHE:
        _cache_tail(chat)
    kw = dict(messages=chat, tools=CHAT_TOOLS, tool_choice="auto", max_tokens=config.MAX_TOKENS, **_common(effort))
    if on_delta is None:
        return _reply(await client().chat.completions.create(**kw))
    stream = await client().chat.completions.create(**kw, stream=True)
    return await _accumulate(stream, on_delta, text_id)


_json_schema_ok = True  # flips off once the gateway model rejects json_schema (e.g. DeepSeek)


async def _structured(name: str, system: str, schema: dict, content: str) -> dict | None:
    """A small side call with JSON output; None on any failure.

    Uses response_format json_schema where supported, else json_object with the schema in the prompt.
    """
    global _json_schema_ok
    prompt = system + "\nReply with a single JSON object only, matching this JSON schema:\n" + json.dumps(schema)
    messages = [_system(prompt), {"role": "user", "content": content}]
    try:
        try:
            fmt = ({"type": "json_schema", "json_schema": {"name": name, "schema": schema, "strict": True}}
                   if _json_schema_ok else {"type": "json_object"})
            resp = await client().chat.completions.create(
                messages=messages, response_format=fmt, max_tokens=4000, **_common("low"))
        except openai.BadRequestError as e:
            if not _json_schema_ok or "response_format" not in str(e):
                raise
            _json_schema_ok = False
            log.info("model rejects json_schema output; using json_object")
            resp = await client().chat.completions.create(
                messages=messages, response_format={"type": "json_object"}, max_tokens=4000, **_common("low"))
    except openai.OpenAIError as e:
        log.warning("%s failed: %s", name, e)
        return None
    text = (resp.choices[0].message.content or "").strip()
    if text.startswith("```"):
        text = text.strip("`").removeprefix("json").strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        log.warning("%s returned non-JSON: %r", name, text[:200])
        return None


async def plan(request: str, context: str = "") -> dict | None:
    """Planner module: a separate call that turns the request into a step list."""
    content = (f"<previous_context>\n{context}\n</previous_context>\n\n" if context else "") + \
              f"<user_request>\n{request}\n</user_request>"
    return await _structured("planner", PLANNER_PROMPT, PLANNER_SCHEMA, content)


async def suggest(request: str, reply: str) -> list[str]:
    """Follow-up requests offered after a task finishes."""
    r = await _structured("suggest", SUGGEST_PROMPT, SUGGEST_SCHEMA,
                          f"<user_request>\n{request}\n</user_request>\n\n<agent_reply>\n{reply[:6000]}\n</agent_reply>")
    return [x for x in (r or {}).get("suggestions", []) if isinstance(x, str) and x.strip()][:3]
