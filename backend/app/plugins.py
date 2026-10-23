"""Plugins (Manus' 插件 page): a catalog of ready-made MCP connectors.

Each entry is a connector template: transport plus command/args/env or url/headers with {{field}}
placeholders, and the fields the user fills in (API keys, IDs, paths). Installing an entry renders the
template and saves it as an ordinary connector tagged with the plugin id, so it is then managed, searched
and called like any other connector.

Secrets never go into args or a visible URL where avoidable: stdio servers that want a key on the
command line get it through an environment variable (`sh -c 'exec ... "$KEY"'`), and keys that must sit
in a URL are masked by connectors.mask_url when listed.
"""

from __future__ import annotations

import re

CATEGORIES = ["效率", "创作", "商业", "开发", "财经", "出行"]


def _f(key: str, label: str, secret: bool = True, placeholder: str = "", help: str = "", required: bool = True) -> dict:
    return {"key": key, "label": label, "secret": secret, "placeholder": placeholder, "help": help, "required": required}


CATALOG: list[dict] = [
    # ---- 效率
    {"id": "lark", "name": "飞书", "category": "效率", "color": "#3370ff",
     "description": "读写飞书云文档、多维表格、日历、群聊消息和通讯录（飞书开放平台官方 MCP）。",
     "transport": "stdio", "command": "sh",
     "args": ["-c", 'exec npx -y @larksuiteoapi/lark-mcp mcp -a "$LARK_APP_ID" -s "$LARK_APP_SECRET"'],
     "env": {"LARK_APP_ID": "{{app_id}}", "LARK_APP_SECRET": "{{app_secret}}"},
     "fields": [_f("app_id", "App ID", False, "cli_xxx"), _f("app_secret", "App Secret")],
     "docs": "https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/mcp_integration/mcp_introduction"},
    {"id": "notion", "name": "Notion", "category": "效率", "color": "#111111",
     "description": "搜索、读取和更新 Notion 页面与数据库。",
     "transport": "stdio", "command": "npx", "args": ["-y", "@notionhq/notion-mcp-server"],
     "env": {"NOTION_TOKEN": "{{token}}"}, "fields": [_f("token", "Integration Token", placeholder="ntn_...")],
     "docs": "https://github.com/makenotion/notion-mcp-server"},
    {"id": "airtable", "name": "Airtable", "category": "效率", "color": "#18bfff",
     "description": "查询和编辑 Airtable 表格中的记录、字段和视图。",
     "transport": "stdio", "command": "npx", "args": ["-y", "airtable-mcp-server"],
     "env": {"AIRTABLE_API_KEY": "{{token}}"}, "fields": [_f("token", "Personal Access Token", placeholder="pat...")],
     "docs": "https://github.com/domdomegg/airtable-mcp-server"},
    {"id": "fetch", "trusted": True, "name": "网页抓取", "category": "效率", "color": "#6b7280",
     "description": "抓取任意网页并转成 Markdown，适合读取简单页面。", "transport": "stdio",
     "command": "uvx", "args": ["mcp-server-fetch"], "fields": [],
     "docs": "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch"},
    {"id": "time", "trusted": True, "name": "时间与时区", "category": "效率", "color": "#6b7280",
     "description": "查询任意时区的当前时间并进行时区换算。", "transport": "stdio",
     "command": "uvx", "args": ["mcp-server-time"], "fields": [],
     "docs": "https://github.com/modelcontextprotocol/servers/tree/main/src/time"},
    {"id": "memory", "trusted": True, "name": "知识图谱记忆", "category": "效率", "color": "#8b5cf6",
     "description": "以实体和关系的形式长期保存信息，跨任务检索。", "transport": "stdio",
     "command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"], "fields": [],
     "docs": "https://github.com/modelcontextprotocol/servers/tree/main/src/memory"},
    {"id": "exa", "trusted": True, "name": "Exa 搜索", "category": "效率", "color": "#1f40ed",
     "description": "面向 AI 的语义网页搜索，能按含义找到公司、论文和代码资料。",
     "transport": "http", "url": "https://mcp.exa.ai/mcp?exaApiKey={{key}}", "fields": [_f("key", "API Key")],
     "docs": "https://docs.exa.ai/reference/exa-mcp"},
    {"id": "tavily", "trusted": True, "name": "Tavily", "category": "效率", "color": "#0f766e",
     "description": "实时网页搜索、页面提取和站点爬取。",
     "transport": "http", "url": "https://mcp.tavily.com/mcp/?tavilyApiKey={{key}}", "fields": [_f("key", "API Key", placeholder="tvly-...")],
     "docs": "https://docs.tavily.com/documentation/mcp"},
    # ---- 创作
    {"id": "elevenlabs", "name": "ElevenLabs", "category": "创作", "color": "#000000",
     "description": "生成逼真的语音、克隆声音、转写音频和制作音效。",
     "transport": "stdio", "command": "uvx", "args": ["elevenlabs-mcp"],
     "env": {"ELEVENLABS_API_KEY": "{{key}}"}, "fields": [_f("key", "API Key")],
     "docs": "https://github.com/elevenlabs/elevenlabs-mcp"},
    {"id": "minimax", "name": "MiniMax", "category": "创作", "color": "#e5484d",
     "description": "调用 MiniMax 生成语音、音乐、图片和视频。",
     "transport": "stdio", "command": "uvx", "args": ["minimax-mcp"],
     "env": {"MINIMAX_API_KEY": "{{key}}", "MINIMAX_API_HOST": "{{host}}"},
     "fields": [_f("key", "API Key"), _f("host", "API Host", False, "https://api.minimaxi.com", "国内账号用 api.minimaxi.com，海外用 api.minimax.io")],
     "docs": "https://github.com/MiniMax-AI/MiniMax-MCP"},
    # ---- 商业
    {"id": "stripe", "name": "Stripe", "category": "商业", "color": "#635bff",
     "description": "查询和管理 Stripe 的客户、商品、价格、发票和支付链接。",
     "transport": "stdio", "command": "sh", "args": ["-c", 'exec npx -y @stripe/mcp --tools=all --api-key="$STRIPE_SECRET_KEY"'],
     "env": {"STRIPE_SECRET_KEY": "{{key}}"}, "fields": [_f("key", "Secret Key", placeholder="sk_... 或受限密钥 rk_...")],
     "docs": "https://docs.stripe.com/mcp"},
    {"id": "zapier", "name": "Zapier", "category": "商业", "color": "#ff4f00",
     "description": "通过 Zapier 连接上千款应用，执行你在 Zapier 中启用的动作。",
     "transport": "http", "url": "{{url}}", "fields": [_f("url", "Zapier MCP 地址", True, "https://mcp.zapier.com/api/mcp/s/.../mcp", "在 Zapier MCP 设置页复制专属地址")],
     "docs": "https://zapier.com/mcp"},
    # ---- 开发
    {"id": "github", "name": "GitHub", "category": "开发", "color": "#24292f",
     "description": "管理代码仓库、Issue、Pull Request 和代码审查（GitHub 官方远程 MCP）。",
     "transport": "http", "url": "https://api.githubcopilot.com/mcp/", "headers": {"Authorization": "Bearer {{token}}"},
     "fields": [_f("token", "Personal Access Token", placeholder="github_pat_...")],
     "docs": "https://github.com/github/github-mcp-server"},
    {"id": "context7", "trusted": True, "name": "Context7", "category": "开发", "color": "#059669",
     "description": "获取各类库和框架最新的官方文档与代码示例。",
     "transport": "http", "url": "https://mcp.context7.com/mcp", "headers": {"CONTEXT7_API_KEY": "{{key}}"},
     "fields": [_f("key", "API Key（可选，提高额度）", required=False)], "docs": "https://github.com/upstash/context7"},
    {"id": "deepwiki", "trusted": True, "name": "DeepWiki", "category": "开发", "color": "#2563eb",
     "description": "阅读任意 GitHub 公开仓库的结构化文档，并就代码库提问。",
     "transport": "http", "url": "https://mcp.deepwiki.com/mcp", "fields": [], "docs": "https://docs.devin.ai/work-with-devin/deepwiki-mcp"},
    {"id": "mslearn", "trusted": True, "name": "Microsoft Learn", "category": "开发", "color": "#0078d4",
     "description": "检索微软官方技术文档（Azure、.NET、Windows、Microsoft 365）。",
     "transport": "http", "url": "https://learn.microsoft.com/api/mcp", "fields": [], "docs": "https://github.com/MicrosoftDocs/mcp"},
    {"id": "cloudflare-docs", "trusted": True, "name": "Cloudflare 文档", "category": "开发", "color": "#f38020",
     "description": "检索 Cloudflare 开发者文档（Workers、R2、DNS 等）。",
     "transport": "http", "url": "https://docs.mcp.cloudflare.com/mcp", "fields": [], "docs": "https://github.com/cloudflare/mcp-server-cloudflare"},
    {"id": "huggingface", "name": "Hugging Face", "category": "开发", "color": "#ffbd2e",
     "description": "搜索模型、数据集、Spaces 和论文。",
     "transport": "http", "url": "https://huggingface.co/mcp", "headers": {"Authorization": "Bearer {{token}}"},
     "fields": [_f("token", "Access Token", placeholder="hf_...")], "docs": "https://huggingface.co/settings/mcp"},
    {"id": "supabase", "name": "Supabase", "category": "开发", "color": "#3ecf8e",
     "description": "查询 Supabase 项目的数据库、表结构和日志（只读模式）。",
     "transport": "stdio", "command": "sh",
     "args": ["-c", 'exec npx -y @supabase/mcp-server-supabase@latest --read-only --access-token="$SUPABASE_ACCESS_TOKEN"'],
     "env": {"SUPABASE_ACCESS_TOKEN": "{{token}}"}, "fields": [_f("token", "Personal Access Token", placeholder="sbp_...")],
     "docs": "https://supabase.com/docs/guides/getting-started/mcp"},
    {"id": "firecrawl", "name": "Firecrawl", "category": "开发", "color": "#ff6b00",
     "description": "抓取和爬取网站、提取结构化数据，适合大批量网页采集。",
     "transport": "stdio", "command": "npx", "args": ["-y", "firecrawl-mcp"],
     "env": {"FIRECRAWL_API_KEY": "{{key}}"}, "fields": [_f("key", "API Key", placeholder="fc-...")],
     "docs": "https://github.com/firecrawl/firecrawl-mcp-server"},
    {"id": "postgres", "name": "PostgreSQL", "category": "开发", "color": "#336791",
     "description": "只读查询 PostgreSQL 数据库并查看表结构。",
     "transport": "stdio", "command": "sh", "args": ["-c", 'exec npx -y @modelcontextprotocol/server-postgres "$DATABASE_URL"'],
     "env": {"DATABASE_URL": "{{url}}"}, "fields": [_f("url", "连接串", placeholder="postgresql://user:pass@host:5432/db")],
     "docs": "https://github.com/modelcontextprotocol/servers-archived/tree/main/src/postgres"},
    {"id": "playwright", "name": "Playwright 浏览器", "category": "开发", "color": "#2ead33",
     "description": "在服务器上用无头浏览器打开网页、点击和填写表单（运行在 OpenManus 所在主机上）。",
     "transport": "stdio", "command": "npx", "args": ["-y", "@playwright/mcp@latest", "--headless"], "fields": [],
     "docs": "https://github.com/microsoft/playwright-mcp"},
    # ---- 财经
    {"id": "coingecko", "trusted": True, "name": "CoinGecko", "category": "财经", "color": "#8dc63f",
     "description": "实时加密货币价格、市值、交易量和历史走势。",
     "transport": "http", "url": "https://mcp.api.coingecko.com/mcp", "fields": [], "docs": "https://docs.coingecko.com/reference/mcp-server"},
    # ---- 出行
    {"id": "amap", "trusted": True, "name": "高德地图", "category": "出行", "color": "#0091ff",
     "description": "地点搜索、地理编码、路线规划（驾车/公交/步行/骑行）、天气和周边查询。",
     "transport": "http", "url": "https://mcp.amap.com/mcp?key={{key}}", "fields": [_f("key", "Web 服务 Key")],
     "docs": "https://lbs.amap.com/api/mcp-server/summary"},
    {"id": "baidu-map", "trusted": True, "name": "百度地图", "category": "出行", "color": "#2932e1",
     "description": "地点检索、路线规划、实时路况和天气查询。",
     "transport": "sse", "url": "https://mcp.map.baidu.com/sse?ak={{key}}", "fields": [_f("key", "AK")],
     "docs": "https://lbsyun.baidu.com/faq/api?title=mcpserver/base"},
]

BY_ID = {p["id"]: p for p in CATALOG}


class PluginError(ValueError):
    pass


def _fill(value, values: dict):
    if isinstance(value, str):
        return re.sub(r"\{\{(\w+)\}\}", lambda m: values.get(m.group(1), ""), value)
    if isinstance(value, list):
        return [_fill(v, values) for v in value]
    if isinstance(value, dict):
        return {k: _fill(v, values) for k, v in value.items()}
    return value


def build(pid: str, values: dict) -> dict:
    """The connector config for catalog entry `pid` with the user's field values."""
    p = BY_ID.get(pid)
    if not p:
        raise PluginError("unknown plugin")
    values = {k: str(v).strip() for k, v in (values or {}).items()}
    missing = [f["label"] for f in p["fields"] if f["required"] and not values.get(f["key"])]
    if missing:
        raise PluginError("请填写：" + "、".join(missing))
    # lookup-only services (docs, search, maps, prices) are trusted: their calls need no confirmation
    c = {"name": p["name"], "description": p["description"], "transport": p["transport"], "plugin": pid,
         "autoApprove": bool(p.get("trusted"))}
    if p["transport"] == "stdio":
        c.update(command=p["command"], args=_fill(p["args"], values), env=_fill(p.get("env") or {}, values))
    else:
        c.update(url=_fill(p["url"], values),
                 headers={k: v for k, v in _fill(p.get("headers") or {}, values).items() if v and not v.endswith("Bearer ")})
    return c


def catalog(installed: dict[str, dict]) -> dict:
    """installed: plugin id -> its connector (public view)."""
    out = []
    for p in CATALOG:
        c = installed.get(p["id"])
        out.append({k: p[k] for k in ("id", "name", "category", "description", "color", "docs")} |
                   {"fields": p["fields"], "transport": p["transport"], "trusted": bool(p.get("trusted")),
                    "connector": {"id": c["id"], "status": c["status"], "tools": len(c["tools"]), "enabled": c["enabled"]} if c else None})
    return {"plugins": out, "categories": [c for c in CATEGORIES if any(p["category"] == c for p in CATALOG)]}
