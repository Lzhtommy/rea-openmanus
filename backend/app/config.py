import os
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _bool(name: str, default: bool) -> bool:
    return os.environ.get(name, str(default)).lower() in {"1", "true", "yes", "on"}


# OpenAI-compatible chat-completions gateway (LiteLLM proxy). MODEL is the gateway's model name.
LLM_BASE_URL = os.environ.get("MANUS_LLM_BASE_URL", "")
LLM_API_KEY = os.environ.get("MANUS_LLM_API_KEY") or os.environ.get("LITELLM_API_KEY", "")
MODEL = os.environ.get("MANUS_MODEL", "claude-opus-5-5")
# Agent modes over the gateway (Manus' Max / 2.0 / Lite): model per mode, standard is MODEL.
MODEL_MAX = os.environ.get("MANUS_MODEL_MAX") or MODEL
MODEL_LITE = os.environ.get("MANUS_MODEL_LITE") or MODEL
DEFAULT_MODE = os.environ.get("MANUS_DEFAULT_MODE", "standard")
EFFORT = os.environ.get("MANUS_EFFORT", "high")
SUBAGENT_EFFORT = os.environ.get("MANUS_SUBAGENT_EFFORT", "medium")
MAX_TOKENS = int(os.environ.get("MANUS_MAX_TOKENS", "64000"))
MAX_ITERATIONS = int(os.environ.get("MANUS_MAX_ITERATIONS", "200"))
WATCHER_MAX_ITERATIONS = int(os.environ.get("MANUS_WATCHER_MAX_ITERATIONS", "25"))
# Send reasoning_effort (LiteLLM maps it to Claude adaptive thinking; dropped for models without it).
REASONING = _bool("MANUS_REASONING", True)
# cache_control breakpoints on the system prompt and conversation tail (Anthropic prompt caching).
PROMPT_CACHE = _bool("MANUS_PROMPT_CACHE", True)

# "docker" (per-session container, production) or "local" (dev only: runs on host!)
SANDBOX_MODE = os.environ.get("MANUS_SANDBOX", "docker")
SANDBOX_IMAGE = os.environ.get("MANUS_SANDBOX_IMAGE", "manus-sandbox:latest")
SANDBOX_DIR = ROOT / "sandbox"
# Stop sandboxes idle this long (files are kept; the next use restarts them). 0 disables reclaiming.
SANDBOX_IDLE_MINUTES = float(os.environ.get("MANUS_SANDBOX_IDLE_MINUTES", "15"))


def _utc_offset_minutes() -> int:
    return -(time.altzone if time.localtime().tm_isdst > 0 else time.timezone) // 60


UTC_OFFSET = _utc_offset_minutes()
UTC_LABEL = f"UTC{'+' if UTC_OFFSET >= 0 else '-'}{abs(UTC_OFFSET) // 60:02d}:{abs(UTC_OFFSET) % 60:02d}"
# Sandboxes run in the server's timezone so "8 点" means the same thing to the agent, its shell, and the
# scheduler. POSIX form (sign inverted) works without tzdata in the image.
_hm = f"{abs(UTC_OFFSET) // 60:02d}" + (f"{abs(UTC_OFFSET) % 60:02d}" if UTC_OFFSET % 60 else "")
SANDBOX_TZ = os.environ.get("MANUS_SANDBOX_TZ") or \
    f"<{'+' if UTC_OFFSET >= 0 else '-'}{_hm}>{'-' if UTC_OFFSET >= 0 else '+'}{abs(UTC_OFFSET) // 60}" + \
    (f":{abs(UTC_OFFSET) % 60:02d}" if UTC_OFFSET % 60 else "")

DATA_DIR = Path(os.environ.get("MANUS_DATA_DIR", ROOT / "data"))
SESSIONS_DIR = DATA_DIR / "sessions"
WORKSPACES_DIR = DATA_DIR / "workspaces"  # local sandbox mode only
SKILLS_DIR = ROOT / "backend" / "skills"
STATIC_DIR = ROOT / "frontend"

PLANNER_ENABLED = _bool("MANUS_PLANNER", True)
# Hold outward-facing / irreversible actions until the user approves them (Manus' need_confirm).
CONFIRM_ENABLED = _bool("MANUS_CONFIRM", True)
# After a task finishes, suggest follow-up requests (Manus' `suggestion` step).
SUGGESTIONS_ENABLED = _bool("MANUS_SUGGESTIONS", True)
# Send browser screenshots to the model as images (better grounding, more tokens).
BROWSER_VISION = _bool("MANUS_BROWSER_VISION", True)
# published sites are served at <slug>.<SITES_DOMAIN> (default: PUBLIC_BASE_URL's host, e.g. localhost:8000)
SITES_DOMAIN = os.environ.get("MANUS_SITES_DOMAIN", "")
# media generation through the gateway (empty = capability off)
IMAGE_MODEL = os.environ.get("MANUS_IMAGE_MODEL", "")
TTS_MODEL = os.environ.get("MANUS_TTS_MODEL", "")
TTS_VOICE = os.environ.get("MANUS_TTS_VOICE", "alloy")
VIDEO_MODEL = os.environ.get("MANUS_VIDEO_MODEL", "")
# Observations longer than this are written to a sandbox file and replaced by a
# head/tail excerpt plus the path (Manus' "restorable compression").
OBSERVATION_LIMIT = int(os.environ.get("MANUS_OBSERVATION_LIMIT", "12000"))
WIDE_RESEARCH_CONCURRENCY = int(os.environ.get("MANUS_WIDE_CONCURRENCY", "4"))
WIDE_RESEARCH_MAX_TASKS = int(os.environ.get("MANUS_WIDE_MAX_TASKS", "20"))

TAVILY_API_KEY = os.environ.get("TAVILY_API_KEY", "")
PUBLIC_BASE_URL = os.environ.get("MANUS_PUBLIC_URL", "http://localhost:8000")
