"""Mail Manus: email a task to OpenManus.

A poller reads new messages from an IMAP mailbox (MANUS_MAIL_IMAP_HOST / _USER / _PASSWORD). Each becomes a
task: subject and body are the request, attachments go to the sandbox. When the task finishes, the result
(and its files' links) is emailed back if SMTP is configured (MANUS_MAIL_SMTP_HOST, same account). In
multi-user mode only mail from a member's registered email address is accepted, and the task is theirs.
"""

from __future__ import annotations

import asyncio
import email
import imaplib
import logging
import os
import smtplib
from email.header import decode_header, make_header
from email.message import EmailMessage
from email.utils import parseaddr

from . import config

log = logging.getLogger("manus.mail")
CFG = {k: os.environ.get(f"MANUS_MAIL_{k}", "") for k in ("IMAP_HOST", "USER", "PASSWORD", "SMTP_HOST", "ADDRESS")}


def enabled() -> bool:
    return bool(CFG["IMAP_HOST"] and CFG["USER"] and CFG["PASSWORD"])


def _text(v: str | None) -> str:
    return str(make_header(decode_header(v or "")))


def parse(raw: bytes) -> dict:
    """{sender, subject, body, attachments: [(filename, bytes)]} of one email."""
    m = email.message_from_bytes(raw)
    body, files = "", []
    for part in m.walk():
        if part.is_multipart():
            continue
        name = part.get_filename()
        if name:
            files.append((_text(name), part.get_payload(decode=True) or b""))
        elif part.get_content_type() == "text/plain" and not body:
            body = (part.get_payload(decode=True) or b"").decode(part.get_content_charset() or "utf-8", "replace")
    return {"sender": parseaddr(m.get("From", ""))[1].lower(), "subject": _text(m.get("Subject")), "body": body.strip()[:20000],
            "attachments": files[:10], "messageId": m.get("Message-ID", "")}


def fetch_unseen() -> list[bytes]:
    with imaplib.IMAP4_SSL(CFG["IMAP_HOST"]) as box:
        box.login(CFG["USER"], CFG["PASSWORD"])
        box.select("INBOX")
        _, data = box.search(None, "UNSEEN")
        out = []
        for num in data[0].split()[:20]:
            _, msg = box.fetch(num, "(RFC822)")  # marks it seen
            out.append(msg[0][1])
        return out


def send(to: str, subject: str, text: str, reply_to_id: str = "") -> None:
    if not CFG["SMTP_HOST"]:
        return
    m = EmailMessage()
    m["From"], m["To"], m["Subject"] = CFG["ADDRESS"] or CFG["USER"], to, subject
    if reply_to_id:
        m["In-Reply-To"] = m["References"] = reply_to_id
    m.set_content(text)
    with smtplib.SMTP_SSL(CFG["SMTP_HOST"]) as s:
        s.login(CFG["USER"], CFG["PASSWORD"])
        s.send_message(m)


class MailManus:
    def __init__(self, store):
        self.store = store
        self.task: asyncio.Task | None = None

    def owner_for(self, sender: str) -> tuple[bool, str | None]:
        from . import auth
        if not auth.store or not auth.store.enabled:
            return True, None
        u = next((x for x in auth.store.items.values() if (x.get("email") or "").lower() == sender), None)
        return bool(u), (u["id"] if u else None)

    async def handle(self, msg: dict) -> str | None:
        ok, owner = self.owner_for(msg["sender"])
        if not ok:
            log.info("mail from unknown sender %s ignored", msg["sender"])
            return None
        s = self.store.create()
        s.owner, s.title = owner, msg["subject"][:60] or "邮件任务"
        s.persist()
        paths = []
        if msg["attachments"]:
            from .sandbox import manager
            sb = await manager.get(s.sandbox_id)
            for name, data in msg["attachments"]:
                r = await sb.http.post("/file/upload", files={"file": (name, data)}, data={"dir": f"{sb.workdir}/upload"})
                if r.status_code < 400:
                    paths.append(r.json()["path"])
        await s.user_message(f"{msg['subject']}\n\n{msg['body']}".strip(), paths,
                             event={"source": "mail", "text": f"<trigger_event source=\"email\" from=\"{msg['sender']}\">\nThis request "
                                    "arrived by email. Deliver the result as usual; it is emailed back to the sender.\n</trigger_event>"})
        asyncio.create_task(self._reply_when_done(s, msg))
        return s.session_id

    async def _reply_when_done(self, s, msg: dict) -> None:
        while s.task and not s.task.done():
            await asyncio.sleep(5)
        result = next((e["content"] for e in reversed(s.events) if e["type"] == "chat" and e["sender"] == "assistant"), "（没有生成回复）")
        files = "\n".join(f"- {f['filename']}: {config.PUBLIC_BASE_URL}{s.file_url(f['path'])}" for f in s.files.values() if "deliverable" in f["kinds"])
        text = f"{result}\n\n{('文件：\n' + files + '\n\n') if files else ''}查看完整过程：{config.PUBLIC_BASE_URL}/#{s.session_id}"
        try:
            await asyncio.to_thread(send, msg["sender"], f"Re: {msg['subject']}", text, msg.get("messageId", ""))
        except Exception:  # noqa: BLE001
            log.exception("mail reply failed")

    async def loop(self, every: float = 60) -> None:
        while True:
            try:
                for raw in await asyncio.to_thread(fetch_unseen):
                    await self.handle(parse(raw))
            except Exception:  # noqa: BLE001
                log.exception("mail poll failed")
            await asyncio.sleep(every)

    def start(self) -> None:
        if enabled():
            self.task = asyncio.create_task(self.loop())


poller: MailManus | None = None
