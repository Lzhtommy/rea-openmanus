"""Accounts (账户)."""

from __future__ import annotations

import asyncio
import json
import secrets

import httpx

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

from .. import agents, auth, computers, config, devices, sites, projects, triggers as triggers_mod, scheduler as scheduler_mod, session as session_mod, storage
from .common import admin

router = APIRouter()


def _sign_in(resp: Response, user: dict) -> Response:
    resp.set_cookie(auth.COOKIE, auth.store.token(user["id"]), max_age=auth.TTL, httponly=True, samesite="lax",
                    secure=config.PUBLIC_BASE_URL.startswith("https"))
    return resp


def _json(data) -> Response:
    return Response(json.dumps(data, ensure_ascii=False), media_type="application/json")


@router.get("/api/auth/me")
async def auth_me(request: Request):
    user = auth.store.from_token(request.cookies.get(auth.COOKIE)) if auth.store.enabled else None
    return {"enabled": auth.store.enabled, "setup": not auth.store.items, "feishu": auth.store.feishu_enabled(),
            "user": auth.Users.public(user) if user else None}


@router.post("/api/auth/setup")
async def auth_setup(body: dict):
    """Create the first (admin) account; everything created so far becomes theirs."""
    if auth.store.items:
        raise HTTPException(409, "已经设置过管理员")
    try:
        u = auth.store.create(str(body.get("username") or ""), str(body.get("password") or ""), str(body.get("name") or ""), "admin")
    except auth.AuthError as e:
        raise HTTPException(400, str(e))
    _adopt_existing(u["id"])
    return _sign_in(_json({"user": auth.Users.public(u)}), u)


@router.post("/api/auth/login")
async def auth_login(body: dict):
    u = auth.store.verify(str(body.get("username") or ""), str(body.get("password") or ""))
    if not u:
        await asyncio.sleep(0.5)
        raise HTTPException(401, "用户名或密码不正确")
    return _sign_in(_json({"user": auth.Users.public(u)}), u)


@router.post("/api/auth/logout")
async def auth_logout():
    resp = _json({"ok": True})
    resp.delete_cookie(auth.COOKIE)
    return resp


@router.post("/api/auth/password")
async def auth_password(body: dict, request: Request):
    u = auth.store.from_token(request.cookies.get(auth.COOKIE))
    if not u or (u.get("password") and not auth.store.verify(u["username"], str(body.get("old") or ""))):
        raise HTTPException(400, "原密码不正确")
    try:
        auth.store.set_password(u["id"], str(body.get("new") or ""))
    except auth.AuthError as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


def _feishu_redirect() -> str:
    return f"{config.PUBLIC_BASE_URL}/api/auth/feishu/callback"


@router.get("/api/auth/feishu/login")
async def feishu_login():
    from fastapi.responses import RedirectResponse
    if not auth.store.feishu_enabled():
        raise HTTPException(404, "飞书登录未配置")
    state = secrets.token_urlsafe(16)
    resp = RedirectResponse(auth.Users.feishu_authorize_url(state, _feishu_redirect()))
    resp.set_cookie("om_oauth_state", state, max_age=600, httponly=True, samesite="lax")
    return resp


@router.get("/api/auth/feishu/callback")
async def feishu_callback(request: Request, code: str = "", state: str = ""):
    from fastapi.responses import RedirectResponse
    if not state or not secrets.compare_digest(state, request.cookies.get("om_oauth_state") or ""):
        raise HTTPException(400, "登录状态已失效，请重试")
    try:
        u = await auth.store.feishu_login(code, _feishu_redirect())
    except (auth.AuthError, httpx.HTTPError) as e:
        return Response(f"<p>{e}</p><p><a href='/'>返回</a></p>", media_type="text/html", status_code=400)
    if len(auth.store.items) == 1:
        _adopt_existing(u["id"])
    return _sign_in(RedirectResponse("/"), u)


@router.get("/api/users")
async def list_users():
    admin()
    return [auth.Users.public(u) for u in sorted(auth.store.items.values(), key=lambda u: u["createdAt"])]


@router.post("/api/users")
async def create_user(body: dict):
    admin()
    try:
        u = auth.store.create(str(body.get("username") or ""), str(body.get("password") or ""), str(body.get("name") or ""),
                              "admin" if body.get("role") == "admin" else "member")
    except auth.AuthError as e:
        raise HTTPException(400, str(e))
    return auth.Users.public(u)


@router.patch("/api/users/{uid}")
async def update_user(uid: str, body: dict):
    me = admin()
    if uid not in auth.store.items:
        raise HTTPException(404, "user not found")
    u = auth.store.items[uid]
    if body.get("role") in ("admin", "member") and uid != me["id"]:
        u["role"] = body["role"]
    if body.get("name"):
        u["name"] = str(body["name"]).strip()[:40]
    try:
        if body.get("password"):
            auth.store.set_password(uid, str(body["password"]))
    except auth.AuthError as e:
        raise HTTPException(400, str(e))
    auth.store.save()
    return auth.Users.public(u)


@router.delete("/api/users/{uid}")
async def delete_user(uid: str):
    me = admin()
    if uid == me["id"]:
        raise HTTPException(400, "不能删除自己")
    auth.store.delete(uid)
    return {"ok": True}


def _adopt_existing(uid: str) -> None:
    """Switching to multi-user: the first admin owns everything made in single-user mode."""
    for s in session_mod.store.sessions.values():
        if not s.owner:
            s.owner = uid
            s.persist()
    for store, attr in ((projects.store, "items"), (scheduler_mod.scheduler, "items"), (triggers_mod.triggers, "items"),
                        (sites.store, "items"), (computers.store, "items"), (devices.store, "items"),
                        (agents.store, "agents"), (agents.store, "teams")):
        for item in getattr(store, attr).values():
            item.setdefault("owner", None)
            item["owner"] = item["owner"] or uid
        store.save()
    legacy, mine = config.DATA_DIR / "personal.json", config.DATA_DIR / f"personal-{uid}.json"
    if (d := storage.load_doc(legacy)) is not None and storage.load_doc(mine) is None:
        storage.save_doc(mine, d)
