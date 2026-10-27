"""Models (modes + Flex)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from .. import config, llm, providers
from .common import org_admin

router = APIRouter()


_gateway_models: list[str] = []


@router.get("/api/models")
async def models():
    """Modes over the gateway and the Flex providers (keys never leave the server)."""
    global _gateway_models
    _, base, key = providers.default_endpoint()
    if not _gateway_models and base and key:
        try:
            _gateway_models = await llm.list_models(base, key)
        except Exception:
            _gateway_models = []
    mm = providers.mode_models()
    return {"default": config.DEFAULT_MODE,
            "modes": [{**m, "model": mm.get(m["id"], "")} for m in providers.MODES],
            "gatewayModels": _gateway_models, "gatewayLabel": providers.default_label(),
            "providers": providers.store.catalog()}


async def _probe(base: str, key: str, model: str) -> list[str]:
    """Connection test: list models, or (when the endpoint has no /models) a one-token completion."""
    import openai

    def why(e: Exception) -> str:  # the provider's own message, not the raw response dump
        body = getattr(e, "body", None)
        err = body.get("error", body) if isinstance(body, dict) else None
        return str(err.get("message") if isinstance(err, dict) else getattr(e, "message", e))[:200]
    try:
        return await llm.list_models(base, key)
    except openai.AuthenticationError as e:
        raise HTTPException(400, f"API 密钥无效：{why(e)}")
    except (openai.NotFoundError, openai.BadRequestError):
        if not model:
            raise HTTPException(400, "该提供商不支持列出模型，请填写模型名称后再连接")
    except openai.OpenAIError as e:
        raise HTTPException(400, f"连接失败：{why(e)}")
    try:
        c = openai.AsyncOpenAI(api_key=key, base_url=base, max_retries=0, timeout=30)
        await c.chat.completions.create(model=model, messages=[{"role": "user", "content": "ping"}], max_tokens=1)
        await c.close()
        return [model]
    except openai.OpenAIError as e:
        raise HTTPException(400, f"连接失败：{why(e)}")


@router.put("/api/providers/{pid}")
async def set_provider(pid: str, body: dict):
    org_admin()  # the stored key is sent to baseUrl when probing
    if pid not in providers.CATALOG or pid == "litellm":
        raise HTTPException(404, "unknown provider")
    base = (body.get("baseUrl") or providers.store.public(pid)["baseUrl"]).strip()
    key = (body.get("apiKey") or providers.store.credentials(pid)[1]).strip()
    if not base or not key:
        raise HTTPException(400, "请填写 API 密钥" + ("和 Base URL" if not base else ""))
    found = await _probe(base, key, (body.get("model") or "").strip())
    model = (body.get("model") or "").strip() or providers.store.public(pid)["model"]
    if found and model not in found:
        model = found[0] if not model else model
    info = providers.store.set(pid, key, base, model)
    return {**info, "models": found}


@router.delete("/api/providers/{pid}")
async def delete_provider(pid: str):
    org_admin()
    providers.store.delete(pid)
    return {"ok": True}


@router.get("/api/providers/{pid}/models")
async def provider_models(pid: str):
    if pid not in providers.CATALOG:
        raise HTTPException(404, "unknown provider")
    base, key = providers.store.credentials(pid)
    if not key:
        raise HTTPException(400, "provider not configured")
    try:
        return await llm.list_models(base, key)
    except Exception as e:
        raise HTTPException(400, f"无法获取模型列表：{e}")
