"""Agents & teams."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from .. import agents, auth
from .common import visible, own

router = APIRouter()


def _agent_call(fn, *a):
    try:
        return fn(*a)
    except KeyError:
        raise HTTPException(404, "not found")
    except agents.AgentError as e:
        raise HTTPException(400, str(e))


@router.get("/api/agents")
async def list_agents():
    v = agents.store.view()
    return {"agents": [a for a in v["agents"] if auth.visible(a)], "teams": [t for t in v["teams"] if auth.visible(t)]}


@router.post("/api/agents")
async def create_agent(body: dict):
    return own(_agent_call(agents.store.create_agent, body), agents.store)


@router.patch("/api/agents/{aid}")
async def update_agent(aid: str, body: dict):
    visible(agents.store.agents.get(aid))
    return _agent_call(agents.store.update_agent, aid, body)


@router.delete("/api/agents/{aid}")
async def delete_agent(aid: str):
    visible(agents.store.agents.get(aid))
    agents.store.delete_agent(aid)
    return {"ok": True}


@router.post("/api/teams")
async def create_team(body: dict):
    return own(_agent_call(agents.store.create_team, body), agents.store)


@router.patch("/api/teams/{tid}")
async def update_team(tid: str, body: dict):
    visible(agents.store.teams.get(tid))
    return _agent_call(agents.store.update_team, tid, body)


@router.delete("/api/teams/{tid}")
async def delete_team(tid: str):
    visible(agents.store.teams.get(tid))
    agents.store.delete_team(tid)
    return {"ok": True}
