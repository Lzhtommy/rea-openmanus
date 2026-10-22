# OpenManus：类 Manus 通用 Agent 平台

参照 [Manus](https://manus.im) 的架构做的 clean-room 实现：用户给出任务，Agent 在**独立沙箱电脑**里自主规划、搜索、浏览网页、写代码、跑命令，完成后交付文件。前端实时展示每一步，并提供 “Manus 的电脑” 面板。

实现原理分析（含 REA 逆向证据）见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 功能
- **Agent Loop**：分析事件 → 选择工具 → 沙箱执行 → 观察 → 迭代 → 交付 → idle
- **31 个工具**：`shell_*`、`file_*`、`browser_*`（元素编号加截图视觉）、`info_search_web`、`info_extract_webpage`、`deploy_expose_port`、`message_*`、`plan_update`、`agent_map_reduce`、`schedule_create`、`idle`
- **并行工具调用**：一轮里如果全是只读调用（搜索、网页提取、读文件），就并发执行
- **Planner 模块**：结构化输出生成计划；**Skills**：`backend/skills/<name>/SKILL.md` 装进沙箱，上下文里只放目录，Agent 按需读取
- **交付语义**：`chat.deliveryKind` 分为 `opening` / `progress` / `result`；任务结束后生成追问建议（`suggestion` 步骤）
- **Wide Research**：`agent_map_reduce` 并行派发同构子代理
- **上下文工程**：静态前缀加 prompt caching、只追加的历史、按前缀遮蔽工具、可恢复压缩（大观察结果落盘到沙箱）、错误保留、计划复述
- **沙箱**：每会话一个 Docker 容器（Ubuntu + Python + Node + Chromium），通过动作 API 控制；端口预览代理；与服务器同一时区
- **实时画面与接管**：浏览器跑在 Xvfb 虚拟显示器上，经 VNC 实时推到"电脑"面板（noVNC）；用户可一键接管浏览器（登录、验证码），结束后交还 Agent
- **操作确认**：部署、推送代码、发布、对外发送数据、远程登录、大范围删除等操作会挂起（`need_confirm`），用户允许后才执行，拒绝则作为错误返回模型
- **流式输出**：回复和 `message_*` 的文本边生成边推送（`chatDelta`）
- **文件持久化与资料库**：Agent 写入/交付的文件和用户上传都另存到会话目录，容器删除后仍可下载；"资料库"跨任务浏览、筛选、预览
- **自动化（定时任务）**：仅一次 / 按间隔 / 每天 / 每周，到点自动新建任务运行；可在"自动化"页面管理，也可在对话里让 Agent 用 `schedule_create` 创建
- **界面**：按 Manus 2.0 网页端还原（用 REA/CDP 实测的布局、设计变量和交互）：可折叠的工作日志与步骤分组、结果文件卡片与预览、追问建议、带时间轴回放的"电脑"面板、计划进度条、浅色/深色主题
- **实时协议**：WebSocket 上传输 Manus 同构事件（`chat`/`toolUsed`/`planUpdate`/`statusUpdate`），支持断线续传、运行中追加消息、向用户提问、停止后恢复
- **模型**：通过 LiteLLM 网关以 OpenAI chat completions 协议调用（默认 `claude-opus-5-5`）；`reasoning_effort` 映射为自适应思考，签名思考块在工具调用间回传，`cache_control` 做提示缓存

## 快速开始

```bash
# 1. 凭据
cp .env.example .env                  # 填 MANUS_LLM_API_KEY（LiteLLM 虚拟 key）
set -a; source .env; set +a
# .env 里的 TAVILY_API_KEY 可选；不设置时回退到 DuckDuckGo

# 2a. 生产模式：Docker 沙箱（推荐）
docker build -t manus-sandbox:latest sandbox/
cd backend && uv sync && uv run uvicorn app.main:app --port 8000

# 2b. 开发模式：本地沙箱（命令直接在本机执行，仅供开发调试！）
cd sandbox && uv venv .venv && uv pip install -p .venv/bin/python -r requirements.txt && .venv/bin/python -m playwright install chromium
cd ../backend && uv sync && MANUS_SANDBOX=local uv run uvicorn app.main:app --port 8000
```

打开 http://localhost:8000 即可使用。

## 配置（环境变量）
| 变量 | 默认值 | 说明 |
|---|---|---|
| `MANUS_LLM_BASE_URL` | — | LiteLLM 网关地址（OpenAI 兼容），必填 |
| `MANUS_LLM_API_KEY` | — | 网关 key（也可用 `LITELLM_API_KEY`） |
| `MANUS_MODEL` | `claude-opus-5-5` | 网关上的模型名 |
| `MANUS_REASONING` | `true` | 是否发送 `reasoning_effort` |
| `MANUS_PROMPT_CACHE` | `true` | 是否加 `cache_control` 缓存断点 |
| `MANUS_EFFORT` / `MANUS_SUBAGENT_EFFORT` | `high` / `medium` | 主代理、子代理的推理强度 |
| `MANUS_SANDBOX` | `docker` | `docker` 或 `local` |
| `MANUS_SANDBOX_MEMORY` / `MANUS_SANDBOX_CPUS` | `4g` / `2` | 容器资源限制 |
| `MANUS_PLANNER` | `true` | 是否启用 Planner 模块 |
| `MANUS_CONFIRM` | `true` | 有外部影响的操作是否需要用户确认 |
| `MANUS_SANDBOX_TZ` | 服务器时区 | 沙箱时区（POSIX TZ，例如 `<+08>-8`） |
| `MANUS_SUGGESTIONS` | `true` | 任务结束后是否生成追问建议 |
| `MANUS_BROWSER_VISION` | `true` | 是否把浏览器截图发给模型 |
| `MANUS_OBSERVATION_LIMIT` | `12000` | 观察结果超过这个字符数就落盘压缩 |
| `MANUS_WIDE_CONCURRENCY` / `MANUS_WIDE_MAX_TASKS` | `4` / `20` | Wide Research 并发数和子任务上限 |
| `MANUS_PUBLIC_URL` | `http://localhost:8000` | 生成预览链接时使用的外部地址 |

## 目录
```
backend/app/
  main.py       HTTP + WebSocket API、文件上传下载、端口预览代理
  session.py    会话：事件日志、LLM 历史、计划、收件箱、Planner/Skills 注入、追问建议
  agent.py      Agent 循环、工具分发、可恢复压缩、Wide Research
  llm.py        LiteLLM 网关客户端：Anthropic 块格式历史 ↔ OpenAI chat 格式转换、缓存、思考、Planner
  tools.py      动作空间定义（统一前缀、角色遮蔽、UI 分类）
  prompts.py    静态系统提示词、Planner 提示词、子代理任务说明
  sandbox.py    沙箱生命周期（Docker / 本地）和动作 API 客户端
  search.py     网页搜索（Tavily / DuckDuckGo）
  skills.py     Skills 目录加载、装入沙箱
  scheduler.py  定时任务（下次运行时间计算、后台循环、按计划新建会话）
backend/skills/     Skills（<name>/SKILL.md）
backend/tests/      端到端测试（脚本化模型，不需要 API key）
sandbox/            沙箱镜像（Dockerfile）和沙箱内动作 API 服务（server.py）
frontend/           Web 界面（原生 JS，无需构建）
docs/ARCHITECTURE.md  Manus 原理分析和复刻对照
```

## 测试
```bash
cd backend && MANUS_SANDBOX=local uv run python -m pytest tests -q
```
测试会启动真实的本地沙箱，用脚本化模型覆盖全部工具类别、Planner、提问等待、并行子代理、可恢复压缩、停止后修复历史，以及端口预览代理。

## 安全提示
- `local` 模式下 Agent 的命令直接在宿主机执行，只能用于开发。
- Docker 模式下沙箱以非 root 用户运行（有 sudo），网络不受限；如果需要出网管控，请在容器网络层配置。
- 搜索 API key 只保存在编排层，不会注入沙箱。
