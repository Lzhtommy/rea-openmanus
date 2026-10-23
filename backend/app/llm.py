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

from . import config, providers
from .providers import Profile
from .prompts import IMPORT_PROMPT, IMPORT_SCHEMA, PLANNER_PROMPT, PLANNER_SCHEMA, SUGGEST_PROMPT, SUGGEST_SCHEMA, SYSTEM_PROMPT
from .tools import TOOLS

log = logging.getLogger("manus.llm")

APIError = openai.OpenAIError  # any LLM failure, including a missing key
BadRequestError = openai.BadRequestError

_clients: dict[tuple[str, str], openai.AsyncOpenAI] = {}


def client(p: Profile | None = None) -> openai.AsyncOpenAI:
    """One client per (endpoint, key): the gateway and every Flex provider."""
    p = p or providers.resolve(None)
    if not p.base_url:
        raise openai.OpenAIError("MANUS_LLM_BASE_URL is not set" if p.provider == "litellm" else f"{p.provider}: base URL is not set")
    if not p.api_key:
        raise openai.OpenAIError("MANUS_LLM_API_KEY is not set" if p.provider == "litellm" else f"{p.provider}: API key is not set")
    key = (p.base_url, p.api_key)
    if key not in _clients:
        _clients[key] = openai.AsyncOpenAI(api_key=p.api_key, base_url=p.base_url, max_retries=4, timeout=600)
    return _clients[key]


async def list_models(base_url: str, api_key: str) -> list[str]:
    """Model ids an endpoint offers (also serves as the connection test for Flex providers)."""
    c = openai.AsyncOpenAI(api_key=api_key, base_url=base_url, max_retries=1, timeout=20)
    try:
        return sorted(m.id for m in (await c.models.list()).data)
    finally:
        await c.close()


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


def _to_chat(messages: list[dict], replay_thinking: bool = True) -> list[dict]:
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
            if signed and replay_thinking:
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


def _system(text: str, p: Profile) -> dict:
    if not _caching(p):
        return {"role": "system", "content": text}
    return {"role": "system", "content": [{"type": "text", "text": text, "cache_control": {"type": "ephemeral"}}]}


def _caching(p: Profile) -> bool:
    return config.PROMPT_CACHE and p.supports("cache_control")


CHAT_TOOLS = [{"type": "function", "function": {"name": t["name"], "description": t["description"],
                                                "parameters": t["input_schema"]}} for t in TOOLS]


def _common(p: Profile, effort: str | None) -> dict:
    """Model and provider-specific extras: gateway-only params never reach strict APIs."""
    kw: dict[str, Any] = {"model": p.model}
    if p.supports("drop_params"):
        kw["extra_body"] = {"drop_params": True}
    if effort and config.REASONING and p.supports("reasoning"):
        kw["reasoning_effort"] = effort
    return kw


async def agent_step(messages: list[dict], effort: str, on_delta: Delta | None = None,
                     text_id: str = "text", profile: Profile | None = None) -> Reply:
    """One agent-loop iteration: the model selects the next tool call(s).

    With on_delta, the reply is streamed and user-facing text is reported as it arrives
    (stream id = the message tool call's id, or text_id for a plain-text answer).
    """
    p = profile or providers.resolve(None)
    chat = [_system(SYSTEM_PROMPT, p)] + _to_chat(messages, replay_thinking=p.supports("thinking_blocks"))
    if _caching(p):
        _cache_tail(chat)
    kw = dict(messages=chat, tools=CHAT_TOOLS, tool_choice="auto", max_tokens=config.MAX_TOKENS, **_common(p, effort))
    if on_delta is None:
        return _reply(await client(p).chat.completions.create(**kw))
    stream = await client(p).chat.completions.create(**kw, stream=True)
    return await _accumulate(stream, on_delta, text_id)


_no_json_schema: set[tuple[str, str]] = set()  # (provider, model) that reject json_schema output (e.g. DeepSeek)


async def _structured(name: str, system: str, schema: dict, content: str, profile: Profile | None = None) -> dict | None:
    """A small side call with JSON output; None on any failure.

    Uses response_format json_schema where supported, else json_object with the schema in the prompt.
    """
    p = profile or providers.resolve(None)
    ident = (p.provider, p.model)
    prompt = system + "\nReply with a single JSON object only, matching this JSON schema:\n" + json.dumps(schema)
    messages = [_system(prompt, p), {"role": "user", "content": content}]
    try:
        try:
            fmt = ({"type": "json_object"} if ident in _no_json_schema
                   else {"type": "json_schema", "json_schema": {"name": name, "schema": schema, "strict": True}})
            resp = await client(p).chat.completions.create(
                messages=messages, response_format=fmt, max_tokens=4000, **_common(p, None))  # no reasoning: forced-tool JSON conflicts with thinking
        except openai.BadRequestError as e:
            if ident in _no_json_schema:
                raise
            # json_schema unsupported, or emulated by the gateway with a forced tool call that some models
            # reject (e.g. "tool_choice is incompatible with thinking"): fall back to plain JSON mode
            log.info("%s/%s rejected json_schema (%s)", *ident, str(e)[:120])
            _no_json_schema.add(ident)
            log.info("%s/%s rejects json_schema output; using json_object", *ident)
            resp = await client(p).chat.completions.create(
                messages=messages, response_format={"type": "json_object"}, max_tokens=4000, **_common(p, None))  # no reasoning: forced-tool JSON conflicts with thinking
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


async def plan(request: str, context: str = "", profile: Profile | None = None) -> dict | None:
    """Planner module: a separate call that turns the request into a step list."""
    content = (f"<previous_context>\n{context}\n</previous_context>\n\n" if context else "") + \
              f"<user_request>\n{request}\n</user_request>"
    return await _structured("planner", PLANNER_PROMPT, PLANNER_SCHEMA, content, profile)


async def suggest(request: str, reply: str, profile: Profile | None = None) -> list[str]:
    """Follow-up requests offered after a task finishes."""
    r = await _structured("suggest", SUGGEST_PROMPT, SUGGEST_SCHEMA,
                          f"<user_request>\n{request}\n</user_request>\n\n<agent_reply>\n{reply[:6000]}\n</agent_reply>", profile)
    return [x for x in (r or {}).get("suggestions", []) if isinstance(x, str) and x.strip()][:3]


async def import_memory(text: str, profile: Profile | None = None) -> dict | None:
    """Profile + knowledge items extracted from another assistant's memory export."""
    return await _structured("import_memory", IMPORT_PROMPT, IMPORT_SCHEMA,
                             f"<memory_export>\n{text[:30000]}\n</memory_export>", profile)
