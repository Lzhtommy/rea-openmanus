"""Anthropic-block history <-> OpenAI chat-completions conversion for the LiteLLM gateway."""

import os

os.environ.setdefault("MANUS_LLM_API_KEY", "test")

import asyncio  # noqa: E402

from openai.types.chat import ChatCompletion, ChatCompletionChunk  # noqa: E402

from app import llm  # noqa: E402


def test_history_to_chat():
    img = {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": "QUJD"}}
    history = [
        {"role": "user", "content": "do it"},
        {"role": "system", "content": "<plan>1. x</plan>"},
        {"role": "assistant", "content": [
            {"type": "thinking", "thinking": "hmm", "signature": "sig"},
            {"type": "text", "text": "looking"},
            {"type": "tool_use", "id": "t1", "name": "browser_view", "input": {}},
            {"type": "tool_use", "id": "t2", "name": "file_read", "input": {"file": "a"}}]},
        {"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": "t1", "content": [{"type": "text", "text": "page"}, img]},
            {"type": "tool_result", "tool_use_id": "t2", "content": "nope", "is_error": True},
            {"type": "text", "text": "<new_user_message>hi</new_user_message>"}]},
    ]
    chat = llm._to_chat(history)
    assert [m["role"] for m in chat] == ["user", "assistant", "tool", "tool", "user"]
    assert "<system_event>" in chat[0]["content"][1]["text"]  # system note folded into the user turn
    a = chat[1]
    assert a["content"] == "looking" and [c["id"] for c in a["tool_calls"]] == ["t1", "t2"]
    assert a["thinking_blocks"] == [{"type": "thinking", "thinking": "hmm", "signature": "sig"}]
    assert chat[2] == {"role": "tool", "tool_call_id": "t1", "content": "page"}
    assert chat[3]["content"] == "ERROR: nope"
    tail = chat[4]["content"]
    assert tail[0]["image_url"]["url"] == "data:image/jpeg;base64,QUJD" and tail[1]["type"] == "text"

    llm._cache_tail(chat)
    assert chat[-1]["content"][-1]["cache_control"] == {"type": "ephemeral"}


def test_reply_from_chat():
    resp = ChatCompletion.model_validate({
        "id": "c", "object": "chat.completion", "created": 0, "model": "m",
        "choices": [{"index": 0, "finish_reason": "stop", "message": {
            "role": "assistant", "content": "ok",
            "thinking_blocks": [{"type": "thinking", "thinking": "think", "signature": "s"}],
            "reasoning_content": "think",
            "tool_calls": [{"id": "x", "type": "function", "function": {"name": "idle", "arguments": "{\"result\": 1}"}},
                           {"id": "y", "type": "function", "function": {"name": "idle", "arguments": "{bad"}}]}}]})
    r = llm._reply(resp)
    assert r.stop_reason == "tool_use"
    assert [b.type for b in r.content] == ["thinking", "text", "tool_use", "tool_use"]
    assert r.content[0].signature == "s" and r.content[2].input == {"result": 1}
    assert "_unparsed_arguments" in r.content[3].input
    # round trip: what the agent stores replays as the same assistant message
    stored = {"role": "assistant", "content": [b.model_dump(mode="json", exclude_none=True) for b in r.content]}
    back = llm._to_chat([stored])[0]
    assert back["thinking_blocks"][0]["signature"] == "s" and len(back["tool_calls"]) == 2


def test_stream_accumulate():
    def chunk(delta, finish=None):
        return ChatCompletionChunk.model_validate({"id": "c", "object": "chat.completion.chunk", "created": 0, "model": "m",
                                                   "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]})
    args = '{"text": "你好，世界", "kind": "result"}'
    parts = [chunk({"role": "assistant", "thinking_blocks": [{"type": "thinking", "thinking": "hm"}]}),
             chunk({"thinking_blocks": [{"type": "thinking", "thinking": "m", "signature": "sig"}]}),
             chunk({"tool_calls": [{"index": 0, "id": "call_1", "type": "function",
                                    "function": {"name": "message_notify_user", "arguments": ""}}]})]
    parts += [chunk({"tool_calls": [{"index": 0, "function": {"arguments": args[i:i + 3]}}]}) for i in range(0, len(args), 3)]
    parts.append(chunk({}, "tool_calls"))

    async def gen():
        for c in parts:
            yield c

    seen = []
    r = asyncio.run(llm._accumulate(gen(), lambda sid, t: seen.append((sid, t)), "txt"))
    assert r.stop_reason == "tool_use"
    assert r.content[0].thinking == "hmm" and r.content[0].signature == "sig"
    assert r.content[1].input == {"text": "你好，世界", "kind": "result"}
    assert seen[-1] == ("call_1", "你好，世界") and len(seen) > 1 and all(s == "call_1" for s, _ in seen)
