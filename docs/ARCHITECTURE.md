# Manus 实现原理分析与复刻设计

本文把 Manus（manus.im）的实现原理按**证据强度**分成四类，并说明本仓库的复刻方式。

| 标记 | 含义 |
|---|---|
| 🔬 **实测** | 用 REA 抓取 manus.im 线上下发的前端 bundle 和网络请求后检索得到（2026-10-13） |
| ⚡ **运行时** | 登录状态下跑一次真实任务，通过 CDP 抓 WebSocket 帧、Connect-RPC 请求和前端 IndexedDB 事件缓存（2026-10-22） |
| 📄 **官方** | Manus 团队公开发表的工程文章（Context Engineering for AI Agents） |
| 💭 **推断** | 根据上面几类证据和行业惯例推出来的，没有直接证据 |

> 范围说明：Manus 的后端（Agent 编排、模型调用、沙箱集群）是闭源服务端代码，从外部**不可能**完整逆向。
> 这里能拿到实证的是**已公开下发的前端代码**和**线上网络行为**，后端原理靠官方文章补全。
> 本仓库是基于这些结论的 clean-room 重新实现，没有复制任何 Manus 代码或提示词。

---

## 1. 总体架构

```
┌────────── 浏览器 (Next.js App) ──────────┐
│ 对话流 │ 计划进度 │ "Manus 的电脑" 面板    │
└───────┬──────────────────────────────────┘
        │ socket.io (wss://api.manus.im)  ← 实时事件流
        │ Connect-RPC (https://api.manus.im/<pkg>.v1.<Service>/<Method>) ← CRUD
┌───────▼──────────────────────────────────┐
│ 编排层: Agent Loop + Planner + Knowledge │  ← LLM (Claude 等)
└───────┬──────────────────────────────────┘
        │ 动作 API
┌───────▼──────────────────────────────────┐
│ 每个任务一台云端沙箱 VM                    │
│ shell / 文件系统 / Chromium / 端口暴露      │
└──────────────────────────────────────────┘
```

### 1.1 前端技术栈 🔬
- Next.js + Turbopack 构建，静态资源放在 `files.manuscdn.com/webapp/_next/static/chunks/*`（抓到 88 个 JS chunk）。
- 状态管理用 Redux Toolkit（`websocketSlice`、`sessionsSlice`、`chatSlice`、`agentWorkspaceSlice` 等 slice）。
- 监控和统计：Sentry（`sentry.prod.ops.butterfly-effect.dev`，Butterfly Effect 是 Manus 母公司）、Amplitude、Plausible、GTM。
- 登录防护：Cloudflare Turnstile、hCaptcha；支付：Stripe。

### 1.2 两条通信通道 🔬
1. **Connect-RPC**（请求-响应类）⚡：线上用的是 **JSON 编码**而不是二进制 protobuf，
   例如 `session.v1.SessionService/GetSession` 的请求体是 `{"sessionUid", "includeEmptyTasks": true}`。
   会话对象带 `status`（如 `SESSION_STATUS_STOPPED`）、`agentTaskMode`、`costedCredits`，以及
   `usage{pagesViewed, commandsRun, filesCreated, apiCalled, cumulativeRuntimeMs}`。线上请求还有 `https://api.manus.im/user.v1.UserPublicService/CheckRegion`、
   `user.v1.UserService/GetBackupSuggestion` 等。bundle 里有 82 个 protobuf 类型名，按包分组：
   `session.v1`（AgentSession、ListSessionsRequest、ScheduledTask、SessionCanvas…）、`connectors.v1`（MCPConfig、SSEConfig、StdioConfig、OAuth…）、
   `webdev.v1`（WebDevProject、CustomDomain、Secret、StripeConfig…）、`cloud_pc.v1`、`skill.v1`、`triggers.v1`、`desktop.v1`、`space.v1`。
2. **socket.io WebSocket**（Agent 实时事件）：`wss://api.manus.im`，`transports:["websocket"]`，鉴权用
   `auth:{token}`，query 带 `locale`、`tz`、`clientType`、`clientVersion`。
   ⚡ 实际路径为 `/socket.io/`（Engine.IO v4，`pingInterval` 15s）。连接帧是 `40{"token": <JWT>}`，
   JWT 为 HS256，载荷里有 `email`、`user_id`、`exp`。之后**双向只用一个事件名 `"message"`**，靠 `type` 字段分发。
3. ⚡ **通知 socket**：另有一条 `wss://api.manus.im/notifier-v2-socket-io/`，专门推送通知，和会话事件流分开。

### 1.3 Agent 事件协议（服务端 → 客户端）🔬
信封为 `{type:"event", id, sessionId, timestamp, event:{...}}`，前端用 `websocketSlice.actions.received` 入库，按 `event.type` 渲染。
核心事件类型和字段（从 bundle 内的 mock 数据和处理分支中提取）：

| event.type | 关键字段 | 作用 |
|---|---|---|
| `chat` | `sender: user\|assistant`、`messageType`、`content`、`attachments`、`deliveryKind:"result"` | 对话消息、最终交付 |
| `newPlanStep` | `stepId`、`title` | 计划新增一步 |
| `planUpdate` | `tasks[]`（含 `startedAt`/`endAt`） | 整份计划刷新 |
| `toolUsed` | `tool`、`actionId`、`status`、`planStepId`、`brief`、`description`、`message:{action,param}`、`detail` | 一次工具调用，按 `actionId` 原地更新状态 |
| `statusUpdate` | `agentStatus: running\|waiting\|stopped\|error`、`planStepId`、`brief`、`description` | Agent 生命周期 |
| `liveStatus` / `explanation` / `chatDelta` / `knowledge` | — | 实时状态、思考说明、流式文本、知识命中 |

⚡ 运行时补充：
- `chat.deliveryKind` 有三种取值：`opening`（开场说明计划）、`progress`（中途汇报）、`result`（最终交付，附件带 `path/url/contentPreview/contentLength`）。
- 用户消息里带 `extData.capabilities.enabledSkills`、`executionTarget{kind:"sandbox"}`、`mode:"lite"`，以及 `taskMode:"cascade"`。
- bundle 分析时漏掉的事件类型：

| event.type | 关键字段 | 作用 |
|---|---|---|
| `sandboxUpdate` | `sandboxId`、`status`、`vncUrl`（`wss://5901-<sandbox>…`）、`webRTCUrl` | 沙箱就绪；"Manus 的电脑"画面走 VNC/WebRTC 推流 |
| `computerActivity` | `tool`、`actionId`、`environment:"sandbox"`、`sandboxId` | 电脑面板上的活动（如浏览器操作） |
| `cascadeTaskClock` | `clock{taskId, startedAt, accumulatedMs, phase, terminalAt, terminalIntervalMs, deliveryEventId}` | 任务计时（计费） |
| `queueStatusChange` | `queueStatus`、`taskMode` | 排队状态 |
| `fileOperationPromotion` | `filePath`、`suggestion`、`promptForAI` | 交付后推荐下一步（如"做成网站"） |
| `eventsNotifyEventsAfter` | `events[]`、`eventId`、`noPersistent:true` | `join_session` 的增量补发 |

`toolUsed.tool` 实测取值有 `terminal`、`browser`、`text_editor`、`search`、`map_reduce`、`webdev`、`submit_plan`、`agent`、`mcp`、
`slides`、`media_viewer`、`search_image`、`search_scholar`、`webpage_extract`、`gmail`、`google_calendar` 等。
`toolUsed.status` 的生命周期为 `start → streaming → argumentsFinished → success | error`（另有 `need_confirm` 等确认态）。
`detail` 按工具携带渲染数据，例如 `detail.mapReduce = {taskStatus, taskDetails[{status,result,sessionId}]}`、`detail.textEditor = {path, content}`。
⚡ 运行时看到的 `detail` 结构：
- `textEditor{action, path, content, oldContent, updatedFileInfo, skillExtra}`
- `search{queries[], results[{title, link, snippet, favicon}]}`：一次搜索可以同时带多个查询
- `webpageExtract{action, url, markdown, truncated}`
- `browser{toolName, url, screenshot}`
- `terminal{action, shellId, command, output[], finished}`
- `mcp{server, primitive, action, argumentsPreview, resultPreview}`
- `suggestion{commands[{content, commandType:"followup_requirement"}]}`

### 1.4 客户端 → 服务端消息 🔬
`messageSentToSocket(name, payload)`，共 72 种，核心的几种：
- `join_session {sessionId, lastMessageId, version:2}`：进入或重连会话，服务端从 `lastMessageId` 之后补发事件（断线续传）。
  ⚡ 运行时确认：前端把事件缓存在 IndexedDB `session-cache-v3`（两个 store：`sessions`、`events`）。
  刷新页面时只要求补发缓存之后的事件，所以已结束的会话会收到空的 `eventsNotifyEventsAfter`。
- `user_message {sessionId, id, content, attachments, extData, deliveryMode}`：发送消息；`deliveryMode:"queue"` 支持运行中排队。
- `stop_session {sessionId}`、`leave_session`。
- 确认类：`confirm_submit_plan`（计划确认）、`confirm_deploy`、`confirm_gmail_message`、`confirm_local_terminal_execution`……
  也就是说，**对外有副作用的动作会被服务端挂起，等用户确认后再执行**。
- Wide Research 控制：`get_map_reduce_sub_info`、`retry_map_reduce_subtask`、`resume_map_reduce`、`force_continue_map_reduce`。
- 沙箱控制：`start_sandbox`、`reset_sandbox`、`enable_device_sandbox`。

### 1.5 UI 模型 🔬
左侧是会话列表；中间是对话，工具步骤按计划步骤（`planStepId`）分组；右侧 **"Manus 的电脑"** 按 `toolUsed.tool` 切换终端、浏览器截图、文件编辑器、搜索结果等视图，
既可以跟随实时，也可以点开历史步骤回放（分享页里有 `simulateMapReduceProcess` 回放逻辑）。

### 1.6 一次真实任务的事件流 ⚡
任务是"帮我调研当前无人机行业的现状"，用时 115 秒，消耗 32 积分，共 82 个事件：`liveStatus` 38、`toolUsed` 29、`chat` 5、`statusUpdate` 2、
`cascadeTaskClock` 2，`sandboxUpdate`、`queueStatusChange`、`planUpdate`、`newPlanStep`、`computerActivity`、`fileOperationPromotion` 各 1。
按时间顺序：
1. 用户消息 → `queueStatusChange` → `statusUpdate:running` → `planUpdate`/`newPlanStep`。lite 模式下计划只有一步"Manus 正在工作"。
2. `sandboxUpdate` → 读 `skills/deep-research/SKILL.md` 和 `skills/data-analysis/SKILL.md` → `chat(opening)`。
3. 多轮"并行搜索 → 并行 `webpage_extract`（同一时刻 3–4 个）"。中间用 `mcp/manus-tools search` 查工具定义，用 `browser` 打开统计公报，
   用 `terminal` 跑 python 算占比，用 `text_editor` 写研究笔记。
4. `chat(progress)` → 写报告 → 回读核对 → `chat(result)` 附报告 → `statusUpdate:stopped` → `suggestion`（3 条追问）→ `fileOperationPromotion`。

`liveStatus.text` 是状态条文字，例如"思考中""正在搜索 <查询>""编辑文件 <路径>""查看浏览器"。

---

## 2. Agent 内核原理

### 2.1 Agent Loop 📄
每次迭代从预定义的动作空间里选一个动作 → 在沙箱执行 → 把观察结果追加进上下文 → 进入下一轮。
平均每个任务约 **50 次工具调用**，输入和输出的 token 比约 **100:1**。

### 2.2 上下文工程六原则 📄（本仓库全部实现）
| 原则 | Manus 做法 | 本仓库实现 |
|---|---|---|
| 围绕 KV-cache 设计 | 稳定前缀、只追加的上下文、确定性序列化 | 系统提示词完全静态（不含日期和 ID）；工具按名称排序；历史只追加；system 断点加顶层自动缓存（`llm.py`） |
| 遮蔽而不是移除工具 | 状态机控制 logits，工具名带统一前缀 | 工具表对所有 Agent 恒定；按前缀拒绝被遮蔽的工具，例如子代理禁用 `message_`/`agent_`（`tools.py: ROLE_DENY`） |
| 文件系统即上下文 | 可恢复压缩：保留 URL 或路径，丢弃正文 | 超过阈值的观察结果整份写入沙箱 `.manus/observations/<id>.txt`，上下文里只留头尾摘录和路径（`agent.py: _compress`） |
| 复述操纵注意力 | 不断更新 todo.md，把目标推到上下文末尾 | `plan_update` 每次回显完整计划；提示词要求长任务维护 todo.md |
| 保留错误 | 失败的动作和报错留在上下文里 | 所有异常作为 `is_error` tool_result 返回给模型，不重试、不清理 |
| 避免 few-shot 固化 | 引入受控的多样性 | 子代理各有独立上下文；工具输出模板按工具区分 |

### 2.3 模块 📄💭
- **Planner**：独立模块先生成计划，以事件形式注入；Agent 执行过程中维护和更新。本仓库用结构化输出（JSON Schema）单独调用一次模型，结果作为 mid-conversation system 消息注入，不改动已缓存的前缀。
- **Skills** ⚡：沙箱里放着 `skills/<name>/SKILL.md`（`skillExtra{name, version, ownerType:"official"}`），
  Agent 动手前先用 text_editor 读相关技能。用户消息里的 `enabledSkills` 决定启用哪些技能。机制和 Claude 的 Agent Skills 相同。
  本仓库的做法：`backend/skills/*/SKILL.md` 每次运行时写进沙箱，上下文里只放"名称 + 描述 + 路径"的目录（`skills.py`），由 Agent 自己按需读取。
- **工具按需发现** ⚡：出现过 `toolUsed.tool:"mcp"`，server 是 `manus-tools`，`action:"search"`，查询为 "browser open navigate read webpage text"。
  说明并不是所有工具定义都常驻上下文，而是先搜索、再加载需要的工具。本仓库没有复刻：工具只有 30 个，常驻在缓存前缀里更划算。
- **并行工具调用** ⚡：同一时间戳出现多个 `webpage_extract` / `search`。本仓库中，一轮里如果全是只读调用（`tools.PARALLEL_SAFE`），就用
  `asyncio.gather` 并发执行；新增的 `info_extract_webpage` 在独立的无头标签页里抓正文，不会干扰交互式浏览器。
- **追问建议** ⚡：任务结束后发一个 `toolUsed.tool:"suggestion"`。本仓库在 `statusUpdate:idle` 之后单独调用一次模型（结构化输出），生成 3 条追问。
- **Wide Research（map_reduce）** 📄🔬：并行派发一组**同构**的完整 Agent，最后汇总。本仓库为 `agent_map_reduce`：子代理共享沙箱、复用父代理完全相同的 tools+system 前缀（缓存命中），可配置并发数，单个子任务失败不影响整批。
- **用户确认** 🔬：对外有副作用的操作先挂起等待确认。本仓库通过 `message_ask_user` 和提示词里的安全规则实现。

### 2.4 沙箱 📄🔬
每个任务分配一台隔离的云端 VM，自带网络栈、文件系统、浏览器和工具链。⚡ 运行时可见：
- 用户是 `ubuntu`，工作目录 `/home/ubuntu`；
- 画面通过 VNC（5901 端口）或 WebRTC 推给前端；
- 产出的文件会同步到 `private-us-east-1.manuscdn.com/sessionFile/<sid>/sandbox/…`，用 CloudFront 签名 URL 下载。

此外，Agent 在里面有 root 权限，破坏性操作被限制在沙箱内（Zero Trust）。
前端出现的 `start_sandbox`/`reset_sandbox`、`cloud_pc.v1` 也说明沙箱有独立的生命周期管理。本仓库的做法：
- 生产环境：每个会话一个 Docker 容器（`manus-sbx-<sid>`），非 root 用户加 sudo，限制内存和 CPU；
- 容器内跑**动作 API 服务**（`sandbox/server.py`），编排层只通过 HTTP 发送动作，自身不执行任何命令；
- 浏览器用 Playwright Chromium，并沿用 browser-use 的做法给可交互元素编号 `[index]<tag>`，同时返回截图；
- 端口暴露通过沙箱内的反向代理完成（`/proxy/{port}` → 后端 `/preview/{sid}/{port}/`）；
- 搜索 API 密钥只放在编排层，**不会进入沙箱**。

---

## 3. 本仓库与 Manus 的对应表

| Manus | 本仓库 |
|---|---|
| socket.io `join_session{lastMessageId}` 断线续传 | WebSocket `/ws` 上的 `join_session{lastSeq}` 补发 |
| `toolUsed{tool,actionId,status,message,detail}` | 同名同结构事件（`agent.py: _run_tool`） |
| `planUpdate{tasks}` / `statusUpdate{agentStatus}` | 同名同结构 |
| map_reduce 详情卡 | `detail.mapReduce.taskDetails` 实时更新 |
| 每任务 VM | 每会话 Docker 容器（另有本地开发模式） |
| Planner / Skills / todo.md | `llm.plan` / `skills.py` + `backend/skills/` / `plan_update` + 提示词 |
| 并行 `search` + `webpage_extract` | `PARALLEL_SAFE` 批次并发 + `info_extract_webpage`（沙箱 `/web/extract`） |
| `chat.deliveryKind` opening/progress/result | 首条消息记为 opening；`message_notify_user(kind="result")` 记为 result |
| `suggestion` 追问 | `llm.suggest` → `toolUsed{tool:"suggestion"}`，前端渲染为可点击的按钮 |
| `sandboxUpdate` | 同名事件（没有 VNC 地址） |

## 4. 有意没有复刻的部分
webdev 全栈托管（自定义域名、Stripe 等）、Connectors 和 MCP 市场、Slides/图片/视频生成、桌面端 My Computer、多人协作和团队计费。
⚡ 运行时看到但同样没做的：工具按需发现、`cascadeTaskClock` 计费、通知 socket、前端 IndexedDB 事件缓存（本仓库靠 `lastSeq` 补发）。

后来补上的（对照 Manus 的同类机制）：
| Manus | 本仓库 |
|---|---|
| `sandboxUpdate.vncUrl` 实时画面 + 用户接管 | 沙箱内 Xvfb + x11vnc，动作 API 的 `/vnc` 桥接，后端 `/api/sessions/<id>/vnc` 转发，前端 noVNC；`message_ask_user(suggest_user_takeover=browser)` 时可接管 |
| `toolUsed.status: need_confirm` + `confirm_*` | `tools.needs_confirm` 规则（部署、git push、发布、对外 POST、远程登录、邮件、大范围删除），`confirm_action` 消息，拒绝作为错误结果返回模型 |
| `chatDelta` 流式文本 | 网关流式输出，从 `message_*` 的部分 JSON 参数里实时解析 `text`，按 `streamId` 被最终 `chat` 替换 |
| 沙箱文件同步到 `sessionFile/...`、资料库 | 写入/交付/上传的文件另存到 `data/sessions/<id>/files`，下载优先实时、回退副本；`/api/library` 与"资料库"页面 |
| Manus 2.0 Max / 2.0 / Lite 模式与 Manus Flex（自带密钥：OpenAI、Anthropic、Google AI Studio、xAI、OpenRouter、Fireworks…）📷 | `providers.py`：三档模式 + Flex 提供商（另含 DeepSeek、Kimi、智谱、通义、硅基流动、自定义），网关专有参数只发给网关 |
| `connectors.v1`（MCP stdio/SSE/HTTP）+ `manus-tools` 工具检索 | `connectors.py`：`mcp_search_tools` / `mcp_call_tool`，工具表保持静态 |
| 分享页回放 | `/api/share/<token>`（文件与截图按 token 限定），前端只读回放 |
| `retry_map_reduce_subtask` / `force_continue_map_reduce` / `resume_map_reduce` | `map_reduce_control` 消息 + 按会话缓存已完成子任务 |
| `ProjectService` 项目 | `projects.py`：指令 + 文件，任务首轮装入沙箱 |
| `start_sandbox` 等沙箱生命周期 | 空闲回收：`docker stop` 保留文件，下次使用自动 `docker start` |
| `/app/personalization`：个人资料、自定义指令、知识、"从其他 AI 导入记忆"；`knowledge` 事件 | `personal.py`：每次运行开头以 system 消息注入（内容变化才重发）；`knowledge_save` 只提议、用户接受后生效；`llm.import_memory` 结构化解析导出文本 |
| `/app/skills`：探索技能、我的技能（个人/官方/第三方）、使用 Manus 创建 / 上传 / 从 GitHub 导入；`enabledSkills` | `skills.py`：三种来源、启用开关、使用计数（Agent 读取 SKILL.md 时计数）；按消息指定的技能以 `<selected_skills>` 追加在用户消息里，即使停用也会装入沙箱；技能目录变化时重发 `<skills>` 系统消息 |
| `search{queries[]}`、`search_image`、`search_scholar` 工具类别 | `info_search_web` 接受 `queries`（并发、按 URL 去重），`info_search_image`（DuckDuckGo 图片，失败回退 Tavily），`info_search_scholar`（OpenAlex：作者、年份、期刊、被引、摘要、开放获取 PDF）；电脑面板分别渲染为结果列表、图片网格、论文列表 |
| 资料库分类：全部 / 文本和 PDF / 幻灯片 / 表格 / 图片 / 视频 / 音频 / 其他 | 同名分类（前端按扩展名归类） |
| 自动化 → 触发器（事件 → 动作、自定义条件）、高级自动化（Beta）、`tab=updates` 动态 | `triggers.py`：webhook（`/api/hooks/<token>`，每 5 秒限一次）与条件触发（`watcher` 角色的只读 Agent，在独立沙箱 `watch-<id>` 里查证，需确认的操作一律拒绝，结果为 `{met, summary, state}`）；`/api/automations/parse` 把自然语言解析成定时任务或触发器；`/api/automations/activity` 汇总运行与检查 |
| `/app/plugins` 插件目录（分类、管理连接器、创建） | `plugins.py`：连接器模板 + 需要填写的字段，安装即生成带 `plugin` 标记的普通连接器；`connectors.mask_url` 隐藏 URL 中的密钥；中文名连接器使用唯一前缀，避免工具限定名冲突 |
| `slides` / `media_viewer` 工具类别，"创建幻灯片、图片和视频" | `slides` 技能 + `slides_export`（沙箱 `/slides/export`：逐页截图、打印 CSS 生成矢量 PDF、python-pptx 生成 PPTX）；`media.py` 经网关生成图片（images API，带参考图时走 chat 图像输出）、语音（audio.speech）、视频（`/v1/videos` 创建、轮询、下载） |
| `/app/creations` 创作（网站 / 游戏 / 移动应用）、`webdev` 托管 | `sites.py`：`deploy_publish` 复制构建产物到 `data/sites/<id>/v<n>/`，版本可回滚；按 Host 头 `<slug>.<sites 域名>` 提供独立源的站点（路径形式加 CSP sandbox），SPA 路由回退到 index.html；沙箱 `/web/screenshot` 生成封面 |
| `ScheduledTask` / 自动化 | `scheduler.py`（once/interval/daily/weekly），`/api/schedules`、`schedule_create` 工具、"自动化"页面 |
这些都是在同一个 Agent 内核上叠加的业务功能，事件协议里已预留扩展点（`toolUsed.tool` 新增类别即可）。

## 5. 证据索引
- REA 浏览器场景抓包（manus.im/app，746 个网络事件，88 个 JS chunk）：`ev_a9d6a2e3892c339912663421a872de73bfe363d5f05e2bf5b7c3509646614fd4`
- REA JavaScript 应用图分析（受堆内存和结果预算限制，覆盖不完整）：`ev_6a1a016c3c1e2dee491f6674645780a8b16b7cb3c0238fe6b1cdb2ff494afb22`
- 事件类型、socket 消息名和 protobuf 类型都由对上述 bundle 的定向检索得到；静态分析不等于运行时观察，未登录状态下没有抓到真实的会话事件流。
- 运行时抓取（2026-10-22，登录态，经 CDP 只读接入用户本机 Chrome）：
  - 页面检查 `ev_3882681f2a4376ce71b5f607c1c8e249797cc6bdac848c93890a0f83da09fc78`；
  - WebSocket 帧和 `GetSession` 响应由 CDP 脚本记录；
  - 事件流取自 IndexedDB `session-cache-v3` 的只读导出；
  - 原始数据含个人会话内容和凭据，脱敏后只留在本机，不入库。
- 官方文章：https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus
