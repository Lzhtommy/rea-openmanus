"""HTTP and WebSocket routes, one router per area of the app.

Requests match routes in registration order, so ROUTERS keeps the order they had in main.py.
"""

from . import (accounts, agents, automations, computers, connectors, data, developer, devices, live, models, personal,
               plugins, projects, recordings, schedules, sessions, share, sites, skills)

ROUTERS = [m.router for m in (accounts, sessions, projects, skills, agents, recordings, personal, share,
                              models, connectors, plugins, schedules, automations, computers, devices, sites, data, developer, live)]
