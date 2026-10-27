"""Model providers and agent modes (Manus' Max / 2.0 / Lite modes and "Manus Flex": bring your own key).

A *mode* is a preset over the server's own endpoint (MANUS_LLM_PROVIDER, a LiteLLM gateway by default):
which model, how much reasoning, whether the planner runs. *Flex* runs a task on any configured
OpenAI-compatible provider with the user's own key. In a selection, provider "litellm" means the server's
own endpoint, whichever provider that is.
Keys are stored server-side in data/providers.json (0600) and never returned to the browser.

Providers differ in what they accept beyond the core chat-completions API; each one declares the
extras it supports so that strict APIs never receive gateway-only parameters.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field

from . import config, storage

# id -> label, default base URL, extras it accepts, suggested default model
CATALOG: dict[str, dict] = {
    "litellm": {"label": "LiteLLM 网关", "base": "", "extras": {"drop_params", "cache_control", "reasoning", "thinking_blocks"}, "model": "claude-opus-5-5"},
    "openai": {"label": "OpenAI", "base": "https://api.openai.com/v1", "extras": {"reasoning"}, "model": "gpt-5.1"},
    "anthropic": {"label": "Anthropic", "base": "https://api.anthropic.com/v1/", "extras": set(), "model": "claude-opus-5-5"},
    "google": {"label": "Google AI Studio", "base": "https://generativelanguage.googleapis.com/v1beta/openai/", "extras": {"reasoning"}, "model": "gemini-3.1-pro-preview"},
    "xai": {"label": "xAI", "base": "https://api.x.ai/v1", "extras": set(), "model": "grok-4"},
    "deepseek": {"label": "DeepSeek", "base": "https://api.deepseek.com/v1", "extras": set(), "model": "deepseek-chat"},
    "moonshot": {"label": "Kimi (Moonshot)", "base": "https://api.moonshot.cn/v1", "extras": set(), "model": "kimi-k2-turbo-preview"},
    "zhipu": {"label": "智谱 GLM", "base": "https://open.bigmodel.cn/api/paas/v4", "extras": set(), "model": "glm-4.6"},
    "qwen": {"label": "通义千问 (DashScope)", "base": "https://dashscope.aliyuncs.com/compatible-mode/v1", "extras": set(), "model": "qwen-max"},
    "siliconflow": {"label": "硅基流动", "base": "https://api.siliconflow.cn/v1", "extras": set(), "model": "deepseek-ai/DeepSeek-V3"},
    "openrouter": {"label": "OpenRouter", "base": "https://openrouter.ai/api/v1", "extras": {"reasoning"}, "model": "anthropic/claude-opus-5.5"},
    "fireworks": {"label": "Fireworks", "base": "https://api.fireworks.ai/inference/v1", "extras": set(), "model": ""},
    "custom": {"label": "自定义（OpenAI 兼容）", "base": "", "extras": set(), "model": ""},
}

MODES = [
    {"id": "max", "label": "OpenManus Max", "badge": "Pro", "description": "为复杂任务设计的高性能代理。"},
    {"id": "standard", "label": "OpenManus", "badge": "", "description": "多功能代理，能够执行大部分任务。"},
    {"id": "lite", "label": "OpenManus Lite", "badge": "", "description": "一个适合日常任务的轻量级代理。"},
    {"id": "flex", "label": "OpenManus Flex", "badge": "", "description": "使用你自己的模型 API 密钥来驱动 OpenManus。"},
]


@dataclass(frozen=True)
class Profile:
    """Everything an LLM call needs: where, with which key, which model, and how hard to think."""
    provider: str
    base_url: str
    api_key: str
    model: str
    effort: str
    subagent_effort: str
    planner: bool
    extras: frozenset = field(default_factory=frozenset)

    @property
    def label(self) -> str:
        return self.model

    def supports(self, extra: str) -> bool:
        return extra in self.extras


class ProviderStore:
    def __init__(self):
        self.path = config.DATA_DIR / "providers.json"
        self.items: dict[str, dict] = {}
        if self.path.exists():
            try:
                self.items = json.loads(self.path.read_text())
            except ValueError:
                self.items = {}

    def save(self) -> None:
        storage.write_json(self.path, self.items, private=True)

    def set(self, pid: str, api_key: str, base_url: str = "", model: str = "") -> dict:
        if pid not in CATALOG or pid == "litellm":
            raise KeyError(pid)
        prev = self.items.get(pid, {})
        self.items[pid] = {"apiKey": api_key or prev.get("apiKey", ""), "baseUrl": base_url or prev.get("baseUrl") or CATALOG[pid]["base"],
                           "model": model or prev.get("model") or CATALOG[pid].get("model", "")}
        self.save()
        return self.public(pid)

    def delete(self, pid: str) -> None:
        self.items.pop(pid, None)
        self.save()

    def public(self, pid: str) -> dict:
        c = CATALOG[pid]
        it = self.items.get(pid, {})
        key = it.get("apiKey", "")
        return {"id": pid, "label": c["label"], "configured": bool(key and (it.get("baseUrl") or c["base"])),
                "baseUrl": it.get("baseUrl") or c["base"], "model": it.get("model") or c.get("model", ""),
                "keyHint": f"{key[:3]}…{key[-4:]}" if len(key) > 10 else ("已设置" if key else "")}

    def catalog(self) -> list[dict]:
        return [self.public(pid) for pid in CATALOG if pid != "litellm"]

    def credentials(self, pid: str) -> tuple[str, str]:
        if pid == "litellm":
            return default_endpoint()[1:]
        it = self.items.get(pid, {})
        return it.get("baseUrl") or CATALOG[pid]["base"], it.get("apiKey", "")


if config.LLM_PROVIDER not in CATALOG:
    raise ValueError(f"MANUS_LLM_PROVIDER={config.LLM_PROVIDER!r} is not one of: {', '.join(CATALOG)}")


def default_endpoint() -> tuple[str, str, str]:
    """The server's own endpoint: (provider id, base URL, API key)."""
    pid = config.LLM_PROVIDER
    return pid, config.LLM_BASE_URL or CATALOG[pid]["base"], config.LLM_API_KEY


def default_model() -> str:
    return config.MODEL or CATALOG[config.LLM_PROVIDER].get("model", "")


def default_label() -> str:
    return CATALOG[config.LLM_PROVIDER]["label"]


store = ProviderStore()

MODE_EFFORT = {"max": ("high", "medium"), "standard": ("medium", "low"), "lite": ("low", "low")}


def mode_models() -> dict[str, str]:
    m = default_model()
    return {"max": config.MODEL_MAX or m, "standard": m, "lite": config.MODEL_LITE or m}


def resolve(selection: dict | None) -> Profile:
    """Turn a UI selection {mode, provider?, model?} into a Profile (defaults to the standard mode)."""
    sel = selection or {}
    mode = sel.get("mode") if sel.get("mode") in ("max", "standard", "lite", "flex") else config.DEFAULT_MODE
    if mode == "flex":
        pid = sel.get("provider") or "litellm"
        if pid not in CATALOG:
            raise ValueError(f"unknown provider {pid}")
        if pid == "litellm":  # the server's own endpoint
            pid, base, key = default_endpoint()
            model = sel.get("model") or default_model()
        else:
            base, key = store.credentials(pid)
            model = sel.get("model") or store.public(pid)["model"]
        return Profile(pid, base, key, model, config.EFFORT, config.SUBAGENT_EFFORT, config.PLANNER_ENABLED,
                       frozenset(CATALOG[pid]["extras"]))
    effort, sub = MODE_EFFORT[mode]
    pid, base, key = default_endpoint()
    return Profile(pid, base, key, mode_models()[mode], effort, sub,
                   config.PLANNER_ENABLED and mode != "lite", frozenset(CATALOG[pid]["extras"]))


def describe(selection: dict | None) -> dict:
    """What the UI shows for a selection: {mode, provider, model, label}."""
    p = resolve(selection)
    mode = (selection or {}).get("mode") or config.DEFAULT_MODE
    label = next(m["label"] for m in MODES if m["id"] == mode)
    return {"mode": mode, "provider": p.provider, "model": p.model, "label": label}
