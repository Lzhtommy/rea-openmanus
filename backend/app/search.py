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


async def search_images(query: str, limit: int = 12) -> list[dict]:
    """Image results: {image, thumbnail, title, source (page URL), width, height}."""
    try:
        results = await _ddg_images(query, limit)
        if results:
            return results
    except (httpx.HTTPError, ValueError, KeyError):
        if not config.TAVILY_API_KEY:
            raise
    if not config.TAVILY_API_KEY:
        return []
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post("https://api.tavily.com/search", json={"query": query, "include_images": True,
                                                                 "include_image_descriptions": True, "max_results": 5},
                         headers={"Authorization": f"Bearer {config.TAVILY_API_KEY}"})
        r.raise_for_status()
    out = []
    for x in r.json().get("images", [])[:limit]:
        x = x if isinstance(x, dict) else {"url": x}
        out.append({"image": x.get("url", ""), "thumbnail": x.get("url", ""), "title": x.get("title") or x.get("description", ""),
                    "source": "", "width": None, "height": None})
    return out


async def _ddg_images(query: str, limit: int) -> list[dict]:
    async with httpx.AsyncClient(timeout=20, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0"}) as c:
        r = await c.get("https://duckduckgo.com/", params={"q": query, "iax": "images", "ia": "images"})
        m = re.search(r"vqd=[\"']?([\d-]+)", r.text)
        if not m:
            raise ValueError("no vqd token")
        r = await c.get("https://duckduckgo.com/i.js", params={"l": "wt-wt", "o": "json", "q": query, "vqd": m.group(1),
                                                              "f": ",,,", "p": "1"}, headers={"Referer": "https://duckduckgo.com/"})
        r.raise_for_status()
    return [{"image": x["image"], "thumbnail": x.get("thumbnail") or x["image"], "title": x.get("title", ""),
             "source": x.get("url", ""), "width": x.get("width"), "height": x.get("height")}
            for x in r.json().get("results", [])[:limit]]


def _abstract(inv: dict | None) -> str:
    """OpenAlex stores abstracts as an inverted index {word: [positions]}."""
    if not inv:
        return ""
    words = sorted((p, w) for w, ps in inv.items() for p in ps)
    return " ".join(w for _, w in words)


async def search_scholar(query: str, year_from: int | None = None, limit: int = 10) -> list[dict]:
    """Scholarly works from OpenAlex: title, authors, year, venue, citations, abstract, links."""
    params = {"search": query, "per-page": limit, "select": "id,display_name,publication_year,authorships,primary_location,"
              "cited_by_count,doi,abstract_inverted_index,best_oa_location"}
    if year_from:
        params["filter"] = f"from_publication_date:{int(year_from)}-01-01"
    async with httpx.AsyncClient(timeout=30, headers={"User-Agent": "OpenManus (mailto:openmanus@example.com)"}) as c:
        r = await c.get("https://api.openalex.org/works", params=params)
        r.raise_for_status()
    out = []
    for w in r.json().get("results", []):
        loc = w.get("primary_location") or {}
        oa = w.get("best_oa_location") or {}
        authors = [a["author"]["display_name"] for a in w.get("authorships", [])[:6] if a.get("author")]
        out.append({"title": w.get("display_name") or "", "authors": authors, "year": w.get("publication_year"),
                    "venue": ((loc.get("source") or {}).get("display_name")) or "", "citations": w.get("cited_by_count", 0),
                    "url": w.get("doi") or loc.get("landing_page_url") or w.get("id"), "pdf": oa.get("pdf_url") or "",
                    "abstract": _abstract(w.get("abstract_inverted_index"))[:800]})
    return out
