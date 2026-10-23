"""The agent's phone number (Manus' 电话): send texts and place calls via Twilio's REST API.

Configured with MANUS_TWILIO_ACCOUNT_SID / MANUS_TWILIO_AUTH_TOKEN / MANUS_TWILIO_NUMBER. Every text or call
needs the user's approval. A call speaks the given message (TwiML <Say>), in the message's language.
"""

from __future__ import annotations

import os
from xml.sax.saxutils import escape

import httpx

CFG = {k: os.environ.get(f"MANUS_TWILIO_{k}", "") for k in ("ACCOUNT_SID", "AUTH_TOKEN", "NUMBER")}


def enabled() -> bool:
    return all(CFG.values())


async def _post(path: str, data: dict) -> dict:
    if not enabled():
        raise RuntimeError("no phone number configured (MANUS_TWILIO_ACCOUNT_SID / AUTH_TOKEN / NUMBER)")
    async with httpx.AsyncClient(timeout=30, auth=(CFG["ACCOUNT_SID"], CFG["AUTH_TOKEN"])) as c:
        r = await c.post(f"https://api.twilio.com/2010-04-01/Accounts/{CFG['ACCOUNT_SID']}/{path}.json",
                         data={"From": CFG["NUMBER"], **data})
    j = r.json()
    if r.status_code >= 400:
        raise RuntimeError(j.get("message") or f"HTTP {r.status_code}")
    return j


async def sms(to: str, text: str) -> str:
    return (await _post("Messages", {"To": to, "Body": text}))["sid"]


async def call(to: str, message: str) -> str:
    lang = "zh-CN" if any("一" <= ch <= "鿿" for ch in message) else "en-US"
    twiml = f'<Response><Say language="{lang}">{escape(message)}</Say></Response>'
    return (await _post("Calls", {"To": to, "Twiml": twiml}))["sid"]
