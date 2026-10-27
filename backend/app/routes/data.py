"""Usage (用量) and data management (数据管理)."""

from __future__ import annotations

import json
import time

from fastapi import APIRouter
from fastapi.responses import Response

from .. import auth, personal, projects, triggers as triggers_mod, scheduler as scheduler_mod, session as session_mod
from .agents import list_agents

router = APIRouter()


@router.get("/api/usage")
async def usage():
    """用量: model calls, tokens, tool calls and active time, overall, per day, per model and per task."""
    from datetime import datetime
    keys = ("activeMs", "llmCalls", "input", "output", "cached", "toolCalls")
    total, days, models, tasks = dict.fromkeys(keys, 0), {}, {}, []
    for s in session_mod.store.sessions.values():
        if not auth.visible({"owner": s.owner}):
            continue
        u = s.usage
        day = datetime.fromtimestamp(s.created_at).strftime("%Y-%m-%d")
        d = days.setdefault(day, dict.fromkeys(keys, 0) | {"tasks": 0})
        d["tasks"] += 1
        for k in keys:
            total[k] += u.get(k, 0)
            d[k] += u.get(k, 0)
        for name, m in (u.get("models") or {}).items():
            mm = models.setdefault(name, {"calls": 0, "input": 0, "output": 0})
            for k in mm:
                mm[k] += m.get(k, 0)
        if u.get("llmCalls"):
            tasks.append({"id": s.session_id, "title": s.title, "createdAt": s.created_at, **{k: u.get(k, 0) for k in keys}})
    return {"total": {**total, "tasks": sum(d["tasks"] for d in days.values())},
            "days": [{"day": k, **v} for k, v in sorted(days.items(), reverse=True)][:30],
            "models": [{"model": k, **v} for k, v in sorted(models.items(), key=lambda x: -x[1]["calls"])],
            "tasks": sorted(tasks, key=lambda t: -(t["input"] + t["output"]))[:20]}


# ------------------------------------------------------------- data management (数据管理) ---

@router.get("/api/data/export")
async def export_data():
    """Everything of the current user's as a zip: tasks (history, events, kept files), projects, settings."""
    import io
    import zipfile
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for s in session_mod.store.sessions.values():
            if not auth.visible({"owner": s.owner}):
                continue
            for f in s.dir.rglob("*"):
                if f.is_file() and f.suffix != ".tmp":
                    z.write(f, f"tasks/{s.session_id}/{f.relative_to(s.dir)}")
        owned = lambda items: [x for x in items if auth.visible(x)]  # noqa: E731
        z.writestr("projects.json", json.dumps(owned(projects.store.items.values()), ensure_ascii=False, indent=1))
        z.writestr("schedules.json", json.dumps(owned(scheduler_mod.scheduler.items.values()), ensure_ascii=False, indent=1))
        z.writestr("triggers.json", json.dumps(owned(triggers_mod.triggers.items.values()), ensure_ascii=False, indent=1))
        z.writestr("agents.json", json.dumps(await list_agents(), ensure_ascii=False, indent=1))
        z.writestr("personalization.json", json.dumps(personal.of(auth.owner()).view(), ensure_ascii=False, indent=1))
    name = f"openmanus-export-{time.strftime('%Y%m%d-%H%M')}.zip"
    return Response(buf.getvalue(), media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.delete("/api/data/tasks")
async def delete_all_tasks():
    ids = [s.session_id for s in session_mod.store.sessions.values() if auth.visible({"owner": s.owner})]
    for sid in ids:
        await session_mod.store.delete(sid)
    return {"deleted": len(ids)}
