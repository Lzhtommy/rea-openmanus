"""Web search. Runs in the backend (not the sandbox) so API keys never enter the sandbox."""

from __future__ import annotations

import html
import re
from urllib.parse import parse_qs, unquote, urlparse

import httpx

from . import config

_TAVILY_RANGE = {"past_day": "day", "past_week": "week", "past_month": "month", "past_year": "year"}
_DDG_RANGE = {"past_day": "d", "past_week": "w", "past_month": "m", "past_year": "y"}


async def search_web(query: str, date_range: str = "all", limit: int = 10) -> list[dict]:
    if config.TAVILY_API_KEY:
        return await _tavily(query, date_range, limit)
    return await _duckduckgo(query, date_range, limit)


async def _tavily(query: str, date_range: str, limit: int) -> list[dict]:
    body = {"query": query, "max_results": limit, "search_depth": "basic"}
    if date_range in _TAVILY_RANGE:
        body["time_range"] = _TAVILY_RANGE[date_range]
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post("https://api.tavily.com/search", json=body,
                         headers={"Authorization": f"Bearer {config.TAVILY_API_KEY}"})
        r.raise_for_status()
        return [{"title": x.get("title", ""), "url": x.get("url", ""), "snippet": x.get("content", "")[:500]}
                for x in r.json().get("results", [])]


async def _duckduckgo(query: str, date_range: str, limit: int) -> list[dict]:
    params = {"q": query}
    if date_range in _DDG_RANGE:
        params["df"] = _DDG_RANGE[date_range]
    async with httpx.AsyncClient(timeout=30, headers={"User-Agent": "Mozilla/5.0"}) as c:
        r = await c.post("https://html.duckduckgo.com/html/", data=params)
        r.raise_for_status()
    results = []
    blocks = re.findall(r'<a rel="nofollow" class="result__a" href="([^"]+)">(.*?)</a>.*?'
                        r'class="result__snippet"[^>]*>(.*?)</a>', r.text, re.S)
    for href, title, snippet in blocks[:limit]:
        if "uddg=" in href:
            href = unquote(parse_qs(urlparse(href).query).get("uddg", [href])[0])
        strip = lambda s: html.unescape(re.sub(r"<[^>]+>", "", s)).strip()
        results.append({"title": strip(title), "url": href, "snippet": strip(snippet)})
    return results
