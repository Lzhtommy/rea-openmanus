"""Accounts and sign-in (Manus' 账户): password accounts and Feishu SSO, with per-user data.

Until the first account exists the app runs in single-user mode, as before. The first account created is
an admin and inherits everything created so far; admins add members. A signed cookie (HMAC over user id
and expiry, key in data/secret.key) identifies the user; `current` holds the user for the request, and
`owner()` is what stores record on new items and filter by. MANUS_AUTH=off keeps single-user mode.
Feishu: OAuth 2.0 authorization code flow when MANUS_FEISHU_APP_ID / MANUS_FEISHU_APP_SECRET are set.
"""

from __future__ import annotations

import base64
import contextvars
import hashlib
import hmac
import json
import os
import secrets
import time

import httpx

from . import config, storage

COOKIE = "om_session"
TTL = 30 * 24 * 3600
current: contextvars.ContextVar[dict | None] = contextvars.ContextVar("current_user", default=None)


class AuthError(ValueError):
    pass


def _hash(password: str, salt: bytes | None = None) -> str:
    salt = salt or os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 200_000)
    return f"pbkdf2${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"


def _check(password: str, stored: str) -> bool:
    try:
        _, salt, _ = stored.split("$")
    except ValueError:
        return False
    return hmac.compare_digest(_hash(password, base64.b64decode(salt)), stored)


class Users:
    def __init__(self):
        self.path = config.DATA_DIR / "users.json"
        self.items: dict[str, dict] = {}
        if self.path.exists():
            try:
                self.items = {u["id"]: u for u in json.loads(self.path.read_text())}
            except (ValueError, KeyError):
                self.items = {}
        key = config.DATA_DIR / "secret.key"
        if not key.exists():
            storage.write_bytes(key, secrets.token_bytes(32), private=True)
        self.secret = key.read_bytes()

    @property
    def enabled(self) -> bool:
        return bool(self.items) and os.environ.get("MANUS_AUTH", "on") != "off"

    def save(self) -> None:
        storage.write_json(self.path, list(self.items.values()), private=True)

    @staticmethod
    def public(u: dict) -> dict:
        return {k: u.get(k) for k in ("id", "username", "name", "role", "avatar", "createdAt", "feishu")} | {"feishu": bool(u.get("feishuOpenId"))}

    def create(self, username: str, password: str, name: str = "", role: str = "member", **extra) -> dict:
        username = username.strip().lower()
        if not extra.get("feishuOpenId"):
            if not username or len(username) > 40 or not username.replace("_", "").replace("-", "").replace(".", "").isalnum():
                raise AuthError("用户名只能包含字母、数字和 . _ -")
            if len(password) < 8:
                raise AuthError("密码至少 8 位")
        if any(u["username"] == username for u in self.items.values()):
            raise AuthError("用户名已存在")
        u = {"id": secrets.token_hex(5), "username": username, "name": (name or username).strip()[:40], "role": role,
             "password": _hash(password) if password else "", "createdAt": time.time(), **extra}
        self.items[u["id"]] = u
        self.save()
        return u

    def verify(self, username: str, password: str) -> dict | None:
        u = next((x for x in self.items.values() if x["username"] == username.strip().lower()), None)
        return u if u and u.get("password") and _check(password, u["password"]) else None

    def set_password(self, uid: str, password: str) -> None:
        if len(password) < 8:
            raise AuthError("密码至少 8 位")
        self.items[uid]["password"] = _hash(password)
        self.save()

    def delete(self, uid: str) -> None:
        self.items.pop(uid, None)
        self.save()

    # ---- session cookie
    def token(self, uid: str) -> str:
        body = f"{uid}.{int(time.time()) + TTL}"
        sig = hmac.new(self.secret, body.encode(), hashlib.sha256).hexdigest()[:32]
        return f"{body}.{sig}"

    def from_token(self, token: str | None) -> dict | None:
        try:
            uid, exp, sig = (token or "").split(".")
        except ValueError:
            return None
        good = hmac.new(self.secret, f"{uid}.{exp}".encode(), hashlib.sha256).hexdigest()[:32]
        if not hmac.compare_digest(sig, good) or int(exp) < time.time():
            return None
        return self.items.get(uid)

    # ---- Feishu SSO
    @staticmethod
    def feishu_enabled() -> bool:
        return bool(config.FEISHU_APP_ID and config.FEISHU_APP_SECRET)

    @staticmethod
    def feishu_authorize_url(state: str, redirect_uri: str) -> str:
        from urllib.parse import urlencode
        return "https://accounts.feishu.cn/open-apis/authen/v1/authorize?" + urlencode(
            {"client_id": config.FEISHU_APP_ID, "redirect_uri": redirect_uri, "state": state, "response_type": "code"})

    async def feishu_login(self, code: str, redirect_uri: str) -> dict:
        async with httpx.AsyncClient(timeout=20) as c:
            r = await c.post("https://open.feishu.cn/open-apis/authen/v2/oauth/token", json={
                "grant_type": "authorization_code", "client_id": config.FEISHU_APP_ID, "client_secret": config.FEISHU_APP_SECRET,
                "code": code, "redirect_uri": redirect_uri})
            tok = r.json()
            if not tok.get("access_token"):
                raise AuthError(f"飞书登录失败：{tok.get('error_description') or tok.get('msg') or r.status_code}")
            info = (await c.get("https://open.feishu.cn/open-apis/authen/v1/user_info",
                                headers={"Authorization": f"Bearer {tok['access_token']}"})).json().get("data") or {}
        open_id = info.get("open_id")
        if not open_id:
            raise AuthError("飞书没有返回用户信息")
        u = next((x for x in self.items.values() if x.get("feishuOpenId") == open_id), None)
        if not u:
            if not config.FEISHU_AUTO_SIGNUP:
                raise AuthError("这个飞书账号还没有加入 OpenManus，请联系管理员")
            base = (info.get("en_name") or info.get("email", "").split("@")[0] or "feishu").lower().replace(" ", ".")
            username = base if not any(x["username"] == base for x in self.items.values()) else f"{base}.{open_id[-4:]}"
            u = self.create(username, "", info.get("name") or username, "admin" if not self.items else "member",
                            feishuOpenId=open_id, avatar=info.get("avatar_url", ""), email=info.get("email", ""))
        return u


def owner() -> str | None:
    """The signed-in user's id (None in single-user mode): stored on new items, used to filter lists."""
    u = current.get()
    return u["id"] if u else None


def visible(item: dict | None) -> bool:
    """Whether the current user may see an item (everything, in single-user mode)."""
    if item is None:
        return False
    u = current.get()
    return u is None or item.get("owner") == u["id"]


store: Users | None = None
