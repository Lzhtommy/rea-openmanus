"""Feishu bot integration (Manus' 集成: use the agent from a chat app, like @Manus in Slack).

Point a Feishu app's event subscription at /api/integrations/feishu/events and subscribe to
im.message.receive_v1. A message to the bot (direct, or @ in a group) starts a task; when it finishes the
bot replies in the same chat with the result and the task link. Uses the app credentials of Feishu SSO
(MANUS_FEISHU_APP_ID / _SECRET); MANUS_FEISHU_VERIFICATION_TOKEN, when set, must match each event.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time

import httpx

from . import config

log = logging.getLogger("manus.feishu")
API = "https://open.feishu.cn/open-apis"
VERIFY = os.environ.get("MANUS_FEISHU_VERIFICATION_TOKEN", "")
_token: dict = {"value": "", "exp": 0}
_seen: set[str] = set()


async def tenant_token() -> str:
    if _token["value"] and _token["exp"] > time.time() + 60:
        return _token["value"]
    async with httpx.AsyncClient(timeout=20) as c:
        r = (await c.post(f"{API}/auth/v3/tenant_access_token/internal",
                          json={"app_id": config.FEISHU_APP_ID, "app_secret": config.FEISHU_APP_SECRET})).json()
    _token.update(value=r.get("tenant_access_token", ""), exp=time.time() + int(r.get("expire", 0)))
    return _token["value"]


async def reply(message_id: str, text: str) -> None:
    async with httpx.AsyncClient(timeout=20) as c:
        await c.post(f"{API}/im/v1/messages/{message_id}/reply", headers={"Authorization": f"Bearer {await tenant_token()}"},
                     json={"msg_type": "text", "content": json.dumps({"text": text}, ensure_ascii=False)})


async def handle(event: dict, store) -> dict:
    """One event callback body -> response (challenge echo, or ok after starting a task)."""
    if event.get("type") == "url_verification":
        if VERIFY and event.get("token") != VERIFY:
            return {"error": "bad token"}
        return {"challenge": event.get("challenge")}
    header = event.get("header") or {}
    if VERIFY and header.get("token") != VERIFY:
        return {"error": "bad token"}
    if header.get("event_type") != "im.message.receive_v1" or header.get("event_id") in _seen:
        return {"ok": True}
    _seen.add(header.get("event_id"))
    msg = (event.get("event") or {}).get("message") or {}
    sender = (((event.get("event") or {}).get("sender") or {}).get("sender_id") or {}).get("open_id", "")
    if msg.get("message_type") != "text":
        return {"ok": True}
    text = re.sub(r"@_user_\d+", "", json.loads(msg.get("content") or "{}").get("text", "")).strip()
    if not text:
        return {"ok": True}
    from . import auth
    owner = None
    if auth.store and auth.store.enabled:
        u = next((x for x in auth.store.items.values() if x.get("feishuOpenId") == sender), None)
        if not u:
            asyncio.create_task(reply(msg["message_id"], "请先用飞书登录一次 OpenManus，再在这里给我派任务。"))
            return {"ok": True}
        owner = u["id"]
    s = store.create()
    s.owner = owner
    s.persist()
    await s.user_message(text, [], event={"source": "feishu", "text": "<trigger_event source=\"feishu\">\nThis request came from a "
                                          "Feishu chat; the final reply is posted back there.\n</trigger_event>"})
    asyncio.create_task(_answer(s, msg["message_id"]))
    return {"ok": True, "sessionId": s.session_id}


async def _answer(s, message_id: str) -> None:
    while s.task and not s.task.done():
        await asyncio.sleep(3)
    result = next((e["content"] for e in reversed(s.events) if e["type"] == "chat" and e["sender"] == "assistant"), "（没有生成回复）")
    try:
        await reply(message_id, f"{result[:3500]}\n\n完整过程：{config.PUBLIC_BASE_URL}/#{s.session_id}")
    except Exception:  # noqa: BLE001
        log.exception("feishu reply failed")
