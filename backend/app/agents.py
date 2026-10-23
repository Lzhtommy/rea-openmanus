"""Custom agents and agent teams (Manus' Agent page, now its Cue app).

An agent is a role: a name, what it is good at, standing instructions, a default mode and default skills. A
task started with an agent works in that role. A team is a set of agents with a lead: the task's main agent
acts as the lead, sees the roster, and hands sub-tasks to members with agent_delegate; each member runs as
a sub-agent with its own instructions in the same sandbox and reports back.
"""

from __future__ import annotations

import json
import secrets
import time

from . import config

COLORS = ["#2563eb", "#7c3aed", "#059669", "#d97706", "#dc2626", "#0891b2", "#db2777", "#4b5563"]


class AgentError(ValueError):
    pass


class Agents:
    def __init__(self):
        self.path = config.DATA_DIR / "agents.json"
        self.agents: dict[str, dict] = {}
        self.teams: dict[str, dict] = {}
        if self.path.exists():
            try:
                d = json.loads(self.path.read_text())
                self.agents = {a["id"]: a for a in d.get("agents", [])}
                self.teams = {t["id"]: t for t in d.get("teams", [])}
            except (ValueError, KeyError):
                pass

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps({"agents": list(self.agents.values()), "teams": list(self.teams.values())},
                                        ensure_ascii=False, indent=1))

    def view(self) -> dict:
        key = lambda x: -x["createdAt"]  # noqa: E731
        return {"agents": sorted(self.agents.values(), key=key), "teams": sorted(self.teams.values(), key=key)}

    # ---- agents
    def _agent_fields(self, a: dict, body: dict) -> None:
        if "name" in body:
            a["name"] = str(body["name"] or "").strip()[:30]
        for k, n in (("description", 200), ("instructions", 6000), ("icon", 4)):
            if k in body:
                a[k] = str(body[k] or "").strip()[:n]
        if body.get("mode") in ("max", "standard", "lite"):
            a["mode"] = body["mode"]
        if "skills" in body:
            a["skills"] = [str(x) for x in body["skills"] or []][:10]
        if not a.get("name"):
            raise AgentError("请填写 Agent 名称")
        if not a.get("instructions"):
            raise AgentError("请填写这个 Agent 的职责和工作要求")

    def create_agent(self, body: dict) -> dict:
        a = {"id": secrets.token_hex(4), "icon": "", "description": "", "mode": "", "skills": [], "createdAt": time.time(),
             "color": COLORS[len(self.agents) % len(COLORS)]}
        self._agent_fields(a, body)
        self.agents[a["id"]] = a
        self.save()
        return a

    def update_agent(self, aid: str, body: dict) -> dict:
        a = self.agents[aid]
        self._agent_fields(a, body)
        self.save()
        return a

    def delete_agent(self, aid: str) -> None:
        self.agents.pop(aid, None)
        for t in self.teams.values():
            t["members"] = [m for m in t["members"] if m != aid]
            if t.get("lead") == aid:
                t["lead"] = ""
        self.save()

    # ---- teams
    def _team_fields(self, t: dict, body: dict) -> None:
        if "name" in body:
            t["name"] = str(body["name"] or "").strip()[:30]
        if "description" in body:
            t["description"] = str(body["description"] or "").strip()[:300]
        if "members" in body:
            t["members"] = [m for m in body["members"] or [] if m in self.agents][:8]
        if "lead" in body:
            t["lead"] = body["lead"] if body["lead"] in self.agents else ""
        if not t.get("name"):
            raise AgentError("请填写团队名称")
        if len(t.get("members", [])) < 2:
            raise AgentError("团队至少需要两个成员")

    def create_team(self, body: dict) -> dict:
        t = {"id": secrets.token_hex(4), "description": "", "members": [], "lead": "", "createdAt": time.time()}
        self._team_fields(t, body)
        self.teams[t["id"]] = t
        self.save()
        return t

    def update_team(self, tid: str, body: dict) -> dict:
        t = self.teams[tid]
        self._team_fields(t, body)
        self.save()
        return t

    def delete_team(self, tid: str) -> None:
        self.teams.pop(tid, None)
        self.save()

    # ---- what the agent is told
    def role_note(self, aid: str) -> str:
        a = self.agents.get(aid)
        if not a:
            return ""
        return (f"<agent_role name=\"{a['name']}\">\nFor this task you work as \"{a['name']}\""
                + (f" ({a['description']})" if a["description"] else "") + ". Follow these standing instructions:\n"
                + a["instructions"] + "\n</agent_role>")

    def team_note(self, tid: str) -> str:
        t = self.teams.get(tid)
        if not t:
            return ""
        members = [self.agents[m] for m in t["members"] if m in self.agents]
        lead = self.agents.get(t.get("lead") or "")
        rows = "\n".join(f"- {m['name']}: {m['description'] or m['instructions'][:120]}" for m in members if m is not lead)
        return (f"<agent_team name=\"{t['name']}\">\n" + (f"{t['description']}\n" if t["description"] else "")
                + "You lead this team. Split the task, hand each part to the member best suited with agent_delegate "
                  "(several delegations in one turn run in parallel), review what they return, fix gaps, and deliver one "
                  "combined result. Do the coordination yourself; do not delegate trivial steps.\nMembers:\n"
                + rows + "\n</agent_team>")

    def member(self, team_id: str | None, name: str) -> dict | None:
        """A team member by name (case-insensitive); any agent when no team restricts the choice."""
        pool = [self.agents[m] for m in self.teams[team_id]["members"]] if team_id in self.teams else list(self.agents.values())
        name = name.strip().lower()
        return next((a for a in pool if a["name"].lower() == name), None) or \
            next((a for a in pool if name and name in a["name"].lower()), None)


store: Agents | None = None
