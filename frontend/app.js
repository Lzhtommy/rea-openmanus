// OpenManus web client. Consumes the Manus-style event stream over one WebSocket
// (chat / toolUsed / planUpdate / statusUpdate / liveStatus / title / sandboxUpdate) and renders it
// the way the Manus 2.0 app does: turns with a collapsible work log of grouped steps, a result
// with file cards and follow-up suggestions, and "the computer" panel with a step timeline.
"use strict";

// ------------------------------------------------------------------ icons (lucide, ISC) ---
const ICONS = {
  logo: '<path d="M12 2.5l2.3 6.6 6.7 2.4-6.7 2.4L12 20.5l-2.3-6.6L3 11.5l6.7-2.4z"/><circle cx="19" cy="4.5" r="1.6"/>',
  newTask: '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.4 2.6a1.4 1.4 0 0 1 3 3l-9 9-3.6 1 1-3.6z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  panelLeft: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
  panelRight: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8M12 17v4"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  arrowUp: '<path d="m5 12 7-7 7 7M12 19V5"/>',
  stop: '<rect width="10" height="10" x="7" y="7" rx="1.5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  maximize: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  minimize: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>',
  skipBack: '<path d="M19 20 9 12l10-8z"/><path d="M5 19V5"/>',
  skipForward: '<path d="m5 4 10 8-10 8z"/><path d="M19 5v14"/>',
  play: '<path d="M6 3l14 9-14 9z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  chevRight: '<path d="m9 18 6-6-6-6"/>',
  chevDown: '<path d="m6 9 6 6 6-6"/>',
  chevUp: '<path d="m18 15-6-6-6 6"/>',
  terminal: '<path d="m4 17 6-6-6-6M12 19h8"/>',
  compass: '<circle cx="12" cy="12" r="10"/><path d="m16.2 7.8-2.1 6.3-6.3 2.1 2.1-6.3z"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20"/>',
  fileText: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M16 13H8M16 17H8M10 9H8"/>',
  fileDoc: '<path d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="currentColor" stroke="none"/><path d="M8 13h8M8 17h6" stroke="#fff"/>',
  pencil: '<path d="M21.2 6.8a1 1 0 0 0-4-4L3.8 16.2a2 2 0 0 0-.5.8l-1.3 4.4 4.4-1.3a2 2 0 0 0 .8-.5z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2"/>',
  message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/>',
  arrowRight: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  share: '<path d="m15 17 5-5-5-5"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
  auto: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18a9 9 0 0 0 0-18z" fill="currentColor"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  rocket: '<path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2a2.1 2.1 0 0 0-3-3z"/><path d="m12 15-3-3a22 22 0 0 1 2-4A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22 22 0 0 1-4 2z"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  list: '<path d="m3 17 2 2 4-4M3 7l2 2 4-4M13 6h8M13 12h8M13 18h8"/>',
  loader: '<path d="M21 12a9 9 0 1 1-6.2-8.6"/>',
  external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  chart: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  play2: '<path d="M6 4l14 8-14 8z"/>',
  flex: '<circle cx="9" cy="14" r="5.5"/><circle cx="15" cy="10" r="5.5"/>',
  plug: '<path d="M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z"/>',
  folderPlus: '<path d="M12 10v6M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/>',
  library: '<path d="m16 6 4 14M12 6v14M8 8v12M4 4v16"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/>',
  spark: '<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  github: '<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.1-1.3-.3-2.5-1-3.5.3-1.2.3-2.4 0-3.5 0 0-1 0-3 1.5-2.6-.5-5.4-.5-8 0C6 2 5 2 5 2c-.3 1.1-.3 2.3 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.4.5-.7 1-.8 1.6-.2.6-.3 1.3-.2 1.9v4"/><path d="M9 18c-4.5 2-5-2-7-2"/>',
  sparkBox: '<rect width="18" height="18" x="3" y="3" rx="4"/><path d="M12 7.5l1.2 3.3 3.3 1.2-3.3 1.2L12 16.5l-1.2-3.3L7.5 12l3.3-1.2z"/>',
  gamepad: '<path d="M6 11h4M8 9v4M15 12h.01M18 10h.01"/><rect width="20" height="12" x="2" y="6" rx="6"/>',
  phone: '<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>',
  presentation: '<path d="M2 3h20M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3M7 21l5-5 5 5"/>',
  film: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18M17 3v18M3 7.5h4M3 12h18M3 16.5h4M17 7.5h4M17 16.5h4"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  puzzle: '<path d="M19.4 11H18V7a2 2 0 0 0-2-2h-4V3.6a2.1 2.1 0 1 0-4 0V5H4a2 2 0 0 0-2 2v3.8h1.5a2.7 2.7 0 0 1 0 5.4H2V20a2 2 0 0 0 2 2h3.8v-1.5a2.7 2.7 0 0 1 5.4 0V22H17a2 2 0 0 0 2-2v-4h1.4a2.5 2.5 0 0 0 0-5z"/>',
  chevLeft: '<path d="m15 18-6-6 6-6"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  webhook: '<path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"/><path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06"/><path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8"/>',
  book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  brain: '<path d="M12 5a3 3 0 1 0-6 .1 4 4 0 0 0-2.5 5.9A4 4 0 0 0 6 18a3 3 0 0 0 6 0z"/><path d="M12 5a3 3 0 1 1 6 .1 4 4 0 0 1 2.5 5.9A4 4 0 0 1 18 18a3 3 0 0 1-6 0zM12 5v13"/>',
  paperclip: '<path d="m21.4 11-9.2 9.2a6 6 0 0 1-8.5-8.5l8.6-8.6a4 4 0 0 1 5.7 5.7l-8.6 8.6a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
};
const icon = (name, cls = "") => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;
const hydrateIcons = (root = document) => root.querySelectorAll("[data-icon]").forEach((n) => {
  if (!n.dataset.iconDone) { n.insertAdjacentHTML("afterbegin", icon(n.dataset.icon)); n.dataset.iconDone = "1"; }
});

// ------------------------------------------------------------------ helpers ---
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const md = (s) => {
  // single "~" is a range ("261~1168 亿"), not strikethrough; drop YAML front matter of skill/report files
  const src = String(s ?? "").replace(/^---\n[\s\S]*?\n---\n/, "").split(/(```[\s\S]*?```|`[^`\n]*`)/).map((part, i) => i % 2 ? part
    : part.replace(/(^|[^~])~(?!~)/g, "$1\\~")
      // bare URLs end at CJK punctuation / markdown emphasis (GFM autolinks would swallow "，**标题**")
      .replace(/(^|[^<(\[\w/])(https?:\/\/[^\s<>()\[\]，。；：、！？（）【】「」“”‘’*]+)/g, "$1<$2>")).join("");
  const html = window.marked ? marked.parse(src, { breaks: true }) : `<p>${esc(s).replace(/\n/g, "<br>")}</p>`;
  return window.DOMPurify ? DOMPurify.sanitize(html, { ADD_ATTR: ["target"] }) : esc(s);
};
if (window.DOMPurify) DOMPurify.addHook("afterSanitizeAttributes", (n) => { if (n.tagName === "A") { n.setAttribute("target", "_blank"); n.setAttribute("rel", "noopener"); } });
const basename = (p) => String(p || "").split("/").pop();
const ext = (p) => (basename(p).split(".").pop() || "").toLowerCase();
const fmtDur = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); const m = Math.floor(s / 60); return m ? `${m}m ${s % 60}s` : `${s}s`; };
const fmtTime = (ts) => new Date(ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } } };
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

// tool category -> step icon, human label for "OpenManus 正在使用…"
const TOOL = {
  terminal: { icon: "terminal", use: "终端" },
  browser: { icon: "compass", use: "浏览器", round: true },
  webpage_extract: { icon: "compass", use: "浏览器", round: true },
  text_editor: { icon: "pencil", use: "编辑器" },
  search: { icon: "search", use: "搜索" },
  search_image: { icon: "image", use: "图片搜索" },
  search_scholar: { icon: "book", use: "学术搜索" },
  map_reduce: { icon: "layers", use: "并行子任务" },
  deploy: { icon: "rocket", use: "部署服务" },
  schedule: { icon: "clock", use: "自动化" },
  mcp: { icon: "plug", use: "连接器" },
  knowledge: { icon: "brain", use: "知识" },
  slides: { icon: "presentation", use: "幻灯片" },
  media: { icon: "image", use: "生成工具" },
};
const ACTION_ZH = {
  "Executing command": "执行命令", "Checking terminal": "查看终端", Browsing: "浏览", Typing: "输入", Clicking: "点击",
  "Running JavaScript": "执行 JavaScript", "Reading file": "读取文件", "Editing file": "编辑文件", "Searching files": "搜索文件", "Creating scheduled task": "创建定时任务", "Searching tools": "搜索工具", "Using MCP": "调用工具", "Saving knowledge": "提议记住", "Searching images": "搜索图片", "Searching papers": "搜索论文",
  "Exporting slides": "渲染幻灯片", "Publishing site": "发布站点", "Generating image": "生成图片", "Generating speech": "生成语音", "Generating video": "生成视频",
  Searching: "搜索", "Reading webpage": "提取网页", "Running parallel sub-agents": "并行执行子任务", "Exposing port": "部署预览",
};
const zh = (a) => ACTION_ZH[a] || a || "";

// ------------------------------------------------------------------ state ---
const S = {
  models: { modes: [], providers: [], gatewayModels: [] }, modelSel: null, modeMenu: false,
  conns: [], editingConn: null, projects: [], projectId: null,
  view: "home", library: [], libFilter: "all", libQuery: "", schedules: [], editing: null,
  sessions: [], cfg: {}, current: null, ws: null, lastSeq: {}, replaying: false, filter: "",
  title: "", status: "idle", live: "", plan: [], planOpen: false,
  turns: [], steps: [], stepIdx: {}, dirty: new Set(), finalized: new Set(),
  panel: { open: false, userClosed: false, sel: null, file: null, full: false, takeover: false },
  vnc: false, vncFailed: false,
  attachments: [], previews: {},
  personal: { profile: {}, instructions: "", knowledge: [] }, persTab: "profile", editingKnow: null,
  plugins: { plugins: [], categories: [] }, plugCat: "all", plugOpen: null, sites: [], crTab: "all",
  pcs: { computers: [], templates: [], unavailable: [], tasks: {} }, pcOpen: null, pcTab: "desktop", target: null,
  triggers: [], activity: [], autoTab: "activity", editingTrig: null,
  skills: { skills: [], catalog: [], categories: [] }, skTab: "explore", skCat: "all", skSrc: "all", pickedSkills: [], skillView: null,
};

function resetSession() {
  Object.assign(S, { title: "", status: "idle", live: "", plan: [], planOpen: false, turns: [], steps: [], stepIdx: {}, dirty: new Set(), finalized: new Set(), vnc: false, vncFailed: false });
  S.panel = { open: false, userClosed: false, sel: null, file: null, full: false, takeover: false };
  vncDisconnect();
  $("#thread").innerHTML = "";
}

// ------------------------------------------------------------------ socket ---
function connect() {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  S.ws = ws;
  ws.onopen = () => { if (S.current && !S.readonly) join(S.current); };
  ws.onmessage = (e) => handle(JSON.parse(e.data));
  ws.onclose = () => setTimeout(connect, 1500);
}
const send = (m) => S.ws?.readyState === 1 && S.ws.send(JSON.stringify(m));
function join(sid) { S.replaying = true; send({ type: "join_session", sessionId: sid, lastSeq: S.lastSeq[sid] ?? -1 }); }

function handle(msg) {
  if (msg.type === "session") {
    if (msg.session.id !== S.current) return;
    S.replaying = false;
    S.title = msg.session.title; S.status = msg.session.status;
    if (msg.session.model?.mode) S.modelSel = msg.session.model; // the task keeps its own mode/model
    if (msg.session.plan?.length) S.plan = msg.session.plan;
    scheduleRender(true);
    return;
  }
  if (msg.type !== "event") return;
  const ev = msg.event;
  if (msg.sessionId !== S.current) {
    if (["statusUpdate", "title"].includes(ev.type)) refreshSessions();
    return;
  }
  if (ev.seq !== undefined) S.lastSeq[msg.sessionId] = Math.max(S.lastSeq[msg.sessionId] ?? -1, ev.seq);
  apply(ev);
}

// ------------------------------------------------------------------ event model ---
const lastTurn = () => S.turns[S.turns.length - 1];
function newTurn(user, ts) {
  const t = { id: `t${S.turns.length}`, user, start: ts, end: null, status: "running", items: [], suggestions: null, open: undefined, groupOpen: {}, error: "" };
  S.turns.push(t);
  return t;
}
const ensureTurn = (ts) => lastTurn() || newTurn(null, ts);

function apply(ev) {
  switch (ev.type) {
    case "chat": {
      if (ev.sender === "user") { S.dirty.add(newTurn(ev, ev.timestamp)); break; }
      const t = ensureTurn(ev.timestamp);
      // the finished message replaces its streaming draft in place
      const si = ev.streamId ? t.items.findIndex((it) => it.kind === "stream" && it.id === ev.streamId) : -1;
      if (ev.streamId) S.finalized.add(ev.streamId);
      if (si >= 0) t.items[si] = { kind: "chat", ev }; else t.items.push({ kind: "chat", ev });
      S.dirty.add(t);
      break;
    }
    case "chatDelta": {
      if (S.finalized.has(ev.streamId)) return;
      const t = ensureTurn(ev.timestamp);
      const it = t.items.find((x) => x.kind === "stream" && x.id === ev.streamId);
      if (it) it.text = ev.content; else t.items.push({ kind: "stream", id: ev.streamId, text: ev.content });
      S.dirty.add(t);
      break;
    }
    case "toolUsed": {
      const t = ensureTurn(ev.timestamp);
      if (ev.tool === "suggestion") { t.suggestions = ev.detail?.suggestion?.commands || []; S.dirty.add(t); break; }
      if (ev.detail?.knowledge && ev.status === "success" && !S.replaying) loadPersonal().then(() => { S.dirty.add(t); scheduleRender(); });
      let i = S.stepIdx[ev.actionId];
      if (i === undefined) {
        i = S.steps.length; S.stepIdx[ev.actionId] = i;
        S.steps.push({ ...ev, turn: t, startTs: ev.timestamp });
        const last = t.items[t.items.length - 1];
        if (last?.kind === "group") last.steps.push(ev.actionId);
        else t.items.push({ kind: "group", id: `g${S.steps.length}`, steps: [ev.actionId] });
        if (!S.replaying && !S.panel.open && !S.panel.userClosed && window.innerWidth >= 1100) S.panel.open = true;
      } else {
        const prev = S.steps[i];
        S.steps[i] = { ...prev, ...ev, args: ev.args ?? prev.args, brief: ev.brief || prev.brief, turn: prev.turn, startTs: prev.startTs };
      }
      S.dirty.add(t);
      break;
    }
    case "statusUpdate": {
      S.status = ev.agentStatus;
      const t = lastTurn();
      if (t) {
        if (ev.agentStatus === "running") { t.status = "running"; t.end = null; }
        else { t.status = ev.agentStatus; t.end = ev.timestamp; if (ev.agentStatus === "error") t.error = ev.description || ""; }
        S.dirty.add(t);
      }
      if (ev.agentStatus !== "running") S.live = "";
      if (!S.replaying) refreshSessions();
      break;
    }
    case "liveStatus": S.live = ev.text || ""; if (lastTurn()) S.dirty.add(lastTurn()); break;
    case "planUpdate": S.plan = ev.tasks || []; break;
    case "title": S.title = ev.title; refreshSessions(); break;
    case "sandboxUpdate": S.vnc = !!ev.vnc && !S.readonly; S.vncFailed = false; break;
    default: return; // explanation: not shown (Manus doesn't render it)
  }
  scheduleRender();
}

// ------------------------------------------------------------------ rendering ---
let rafPending = false, stickBottom = true;
function scheduleRender(scrollEnd = false) {
  if (scrollEnd) stickBottom = true;
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; renderAll(); });
}

function renderAll() {
  const auto = S.view === "automations", conn = S.view === "connectors", plug = S.view === "plugins", cr = S.view === "creations", pcv = S.view === "computers";
  const proj = S.view === "project", pers = S.view === "personal", sk = S.view === "skills";
  const lib = S.view === "library" || auto || conn || proj || pers || sk || plug || cr || pcv; // full-page views without a composer dock
  $("#computers").classList.toggle("hidden", !pcv);
  $("#nav-pc").classList.toggle("active", pcv);
  $("#creations").classList.toggle("hidden", !cr);
  $("#nav-create").classList.toggle("active", cr);
  $("#plugins").classList.toggle("hidden", !plug);
  $("#personal").classList.toggle("hidden", !pers);
  $("#skills").classList.toggle("hidden", !sk);
  $("#nav-more").classList.toggle("active", pers || sk);
  $("#project-view").classList.toggle("hidden", !proj);
  const home = !S.current && !lib;
  $("#home").classList.toggle("hidden", !home);
  $("#library").classList.toggle("hidden", S.view !== "library");
  $("#automations").classList.toggle("hidden", !auto);
  $("#connectors").classList.toggle("hidden", !conn);
  $("#nav-conn").classList.toggle("active", conn || plug);
  $("#nav-auto").classList.toggle("active", auto);
  $("#scroller").classList.toggle("hidden", home || lib);
  $("#dock").classList.toggle("hidden", home || lib);
  $("#nav-library").classList.toggle("active", S.view === "library");
  (proj ? $("#proj-slot") : home || lib ? $("#home-slot") : $("#dock-slot")).appendChild($("#composer"));
  $("#composer").classList.toggle("hidden", pers || sk || plug || conn || cr || pcv);
  const title = proj ? (S.projects.find((p) => p.id === S.projectId)?.name || "项目") : pers ? "个性化" : sk ? "技能" : plug ? "插件" : cr ? "创作" : pcv ? "电脑" : conn ? "连接器" : auto ? "自动化" : lib ? "资料库" : home ? "OpenManus" : (S.title || "新任务");
  $("#session-title").textContent = title;
  const meta = S.current && S.sessions.find((x) => x.id === S.current);
  const pcName = meta?.computerId && (S.pcs.computers.find((c) => c.id === meta.computerId)?.name || "云电脑");
  if (pcName) $("#session-title").insertAdjacentHTML("beforeend", `<span class="lib-tag pc-chip">${icon("monitor")}${esc(pcName)}</span>`);
  renderModeButton();
  document.title = home ? "OpenManus" : `${title} - OpenManus`;
  ["#share-btn", "#delete-btn"].forEach((s) => $(s).classList.toggle("hidden", home || lib));
  $("#panel-btn").classList.toggle("hidden", home || lib || !S.steps.length || S.panel.open);
  if (auto) { renderAutomations(); renderPanel(); return; }
  if (conn) { renderConnectors(); renderPanel(); return; }
  if (plug) { renderPlugins(); renderPanel(); return; }
  if (cr) { renderCreations(); renderPanel(); return; }
  if (pcv) { renderComputers(); renderPanel(); return; }
  if (proj) { renderProject(); renderPanel(); return; }
  if (pers) { renderPersonal(); renderPanel(); return; }
  if (sk) { renderSkills(); renderPanel(); return; }
  if (lib) { renderLibrary(); renderPanel(); return; }
  if (home) { renderPanel(); return; }

  const sc = $("#scroller");
  const atBottom = stickBottom || sc.scrollHeight - sc.scrollTop - sc.clientHeight < 80;
  for (const t of S.dirty) renderTurn(t);
  S.dirty.clear();
  renderTaskbar();
  renderComposerState();
  renderPanel();
  if (atBottom) sc.scrollTop = sc.scrollHeight;
  stickBottom = false;
}

// Steps held for the user's approval (Manus' need_confirm). While one is pending the turn is still in
// progress even though the agent status is "waiting".
const pendingConfirms = (t) => S.steps.filter((s) => s.turn === t && s.status === "need_confirm");
const isFinished = (t) => t.status !== "running" && !(t.status === "waiting" && pendingConfirms(t).length);

// Index where the turn's result starts: the last chat marked deliveryKind "result", else the run of
// chat messages after the last step group. Everything before it lives in the collapsible work log.
function finalIndex(t) {
  if (!isFinished(t)) return -1;
  const isResult = (it) => it.kind === "chat" && it.ev.deliveryKind === "result";
  let run = t.items.length;
  while (run > 0 && t.items[run - 1].kind === "chat") run--;
  const inRun = t.items.findIndex((it, i) => i >= run && isResult(it));
  if (inRun >= 0) return inRun; // e.g. answer + a follow-up correction, both delivered as results
  for (let i = run - 1; i >= 0; i--) if (isResult(t.items[i])) return i;
  return run < t.items.length ? run : -1;
}

function renderTurn(t) {
  let node = document.getElementById(t.id);
  if (!node) { node = document.createElement("div"); node.className = "turn"; node.id = t.id; $("#thread").appendChild(node); }
  const fi = finalIndex(t);
  const logItems = fi >= 0 ? t.items.slice(0, fi) : t.items;
  const finalItems = fi >= 0 ? t.items.slice(fi) : [];
  const running = !isFinished(t);
  const isLast = t === lastTurn();
  const open = t.open ?? (running || fi < 0);
  let h = "";
  if (t.user) h += userHtml(t.user.ev ?? t.user);
  const hasAssistant = t.items.length || running;
  if (hasAssistant) {
    h += `<div class="assistant"><div class="a-head"><span class="brand-mark">${icon("logo")}</span><span class="brand-word">openmanus</span><span class="badge">${esc(modelBadge())}</span></div>`;
    if (logItems.length || running) {
      const now = S.clockNow || Date.now(); // replays run on the recording's clock
      const dur = fmtDur((t.end || now) - (t.start || now));
      h += `<button class="worked" data-act="toggle-log" data-turn="${t.id}">${running ? `<span class="spin">${icon("loader")}</span>工作中 · ${dur}` : `工作了 ${dur}`}${icon(open ? "chevDown" : "chevRight")}</button>`;
      if (open) h += `<div class="worklog">${logItems.map((it) => itemHtml(t, it, running && it === t.items[t.items.length - 1])).join("")}</div>`;
    }
    if (running && isLast && S.status !== "waiting") h += liveLineHtml(t);
    h += pendingConfirms(t).map(confirmHtml).join("");
    h += S.steps.filter((s) => s.turn === t && s.detail?.knowledge && s.status === "success").map((s) => knowCardHtml(s.detail.knowledge)).join("");
    if (finalItems.length) h += `<div class="final">${finalItems.map((it) => (it.kind === "chat" ? chatHtml(it.ev, true) : itemHtml(t, it, false))).join("")}</div>`;
    if (isFinished(t)) h += doneRowHtml(t, fi);
    if (t.suggestions?.length && isLast) h += `<div class="suggestions">${t.suggestions.map((c, i) =>
      `<button class="suggestion" data-act="suggest" data-turn="${t.id}" data-i="${i}">${icon("message")}<span>${esc(c.content)}</span>${icon("arrowRight")}</button>`).join("")}</div>`;
    h += `</div>`;
  }
  node.innerHTML = h;
  node.querySelectorAll("[data-preview]").forEach(loadPreview);
  // suggestions only belong to the latest turn; re-render the previous one to drop them
  if (isLast && S.turns.length > 1) { const prev = S.turns[S.turns.length - 2]; if (prev.suggestions?.length && !prev._sugCleared) { prev._sugCleared = true; renderTurn(prev); } }
}

const shortModel = (m) => String(m).split("/").pop();

function userHtml(ev) {
  const files = (ev.attachments || []).map((a) => `<a class="chip-file" href="${esc(a.url)}" target="_blank">${icon("fileText")}<span>${esc(a.filename)}</span></a>`).join("");
  const sks = (ev.skills || []).map((n) => `<span class="chip-file skill">${icon("spark")}<span>${esc(skillTitle(n))}</span></span>`).join("");
  const te = ev.triggerEvent;
  const evHtml = te ? `<details class="trig-ev"><summary>${icon(SRC_ICO[te.source] || "zap")}${esc({ webhook: "收到 Webhook 事件", condition: "触发条件已满足", manual: "试运行" }[te.source] || "触发事件")}</summary><pre>${esc(te.text.replace(/^<trigger_event[^>]*>\n?|\n?<\/trigger_event>[\s\S]*$/g, ""))}</pre></details>` : "";
  return `<div class="msg-user"><div>${evHtml}<div class="bubble">${esc(ev.content)}</div>${files || sks ? `<div class="files">${sks}${files}</div>` : ""}</div></div>`;
}

function itemHtml(t, it, isCurrent) {
  if (it.kind === "chat") return chatHtml(it.ev, false);
  if (it.kind === "stream") return `<div class="narr streaming"><div class="prose">${md(it.text)}</div></div>`;
  const steps = it.steps.map((id) => S.steps[S.stepIdx[id]]).filter(Boolean);
  const open = t.groupOpen[it.id] ?? (isCurrent && !isFinished(t));
  return `<div class="group ${open ? "open" : ""}"><button class="group-sum" data-act="toggle-group" data-turn="${t.id}" data-group="${it.id}">${esc(summarize(steps))}${icon("chevDown", "chev")}</button>` +
    (open ? `<div class="steps">${steps.map(stepHtml).join("")}</div>` : "") + `</div>`;
}

function chatHtml(ev, isFinal) {
  const cls = ev.messageType === "ask" ? "narr ask" : "narr";
  const takeover = ev.messageType === "ask" && ev.takeover === "browser" && S.vnc && S.status === "waiting"
    ? `<div class="ask-takeover"><button class="takeover-btn ${S.panel.takeover ? "on" : ""}" data-act="takeover">${icon("hand")}${S.panel.takeover ? "结束接管并继续" : "接管浏览器"}</button></div>` : "";
  return `<div class="${isFinal ? "final-msg" : cls}"><div class="prose">${md(ev.content)}</div>${cardsHtml(ev.attachments)}${takeover}</div>`;
}

function stepText(s) {
  if (s.brief) return esc(s.brief);
  const act = zh(s.message?.action), param = s.message?.param || "";
  if (s.tool === "text_editor" && param) return `${esc(act)} <b>${esc(basename(param))}</b>`;
  return `${esc(act)}${param ? ` <b>${esc(param.length > 90 ? param.slice(0, 90) + "…" : param)}</b>` : ""}`;
}

function stepHtml(s) {
  const meta = TOOL[s.tool] || { icon: "list" };
  const running = s.status === "start" || s.status === "running";
  if (s.status === "need_confirm") return `<button class="step hold" data-act="step" data-id="${esc(s.actionId)}"><span class="step-ico">${icon("alert")}</span><span class="step-text">${stepText(s)}<em>等待确认</em></span></button>`;
  const editFile = s.tool === "text_editor" && /write|str_replace/.test(s.name || "");
  const ico = editFile ? `<span class="step-ico file">${icon("fileDoc")}</span>` : `<span class="step-ico ${meta.round ? "round" : ""}">${icon(meta.icon)}</span>`;
  const sel = S.panel.open && selectedStep()?.actionId === s.actionId;
  return `<button class="step ${s.status === "error" ? "err" : ""} ${running ? "run" : ""} ${sel ? "sel" : ""}" data-act="step" data-id="${esc(s.actionId)}">${ico}` +
    `<span class="step-text ${running ? "shimmer" : ""}">${stepText(s)}</span></button>`;
}

function summarize(steps) {
  const c = { q: 0, web: 0, bro: 0, edit: new Set(), read: new Set(), cmd: 0, term: 0, mr: 0, dep: 0, find: 0 };
  for (const s of steps) {
    const n = s.name || "";
    if (n === "info_search_web") c.q += Math.max(1, s.detail?.search?.queries?.length || 1);
    else if (n === "info_search_image") c.img = (c.img || 0) + 1;
    else if (n === "info_search_scholar") c.sch = (c.sch || 0) + 1;
    else if (n === "info_extract_webpage" || n === "browser_navigate" || n === "browser_restart") c.web++;
    else if (n.startsWith("browser_")) c.bro++;
    else if (n === "file_read") c.read.add(s.message?.param);
    else if (n === "file_write" || n === "file_str_replace") c.edit.add(s.message?.param);
    else if (n.startsWith("file_find")) c.find++;
    else if (n === "shell_exec") c.cmd++;
    else if (n.startsWith("shell_")) c.term++;
    else if (n === "agent_map_reduce") c.mr++;
    else if (n === "deploy_publish") c.pub = (c.pub || 0) + 1;
    else if (n.startsWith("deploy_")) c.dep++;
    else if (n.startsWith("schedule_")) c.sched = (c.sched || 0) + 1;
    else if (n === "trigger_create") c.trig = (c.trig || 0) + 1;
    else if (n === "slides_export") c.sl = (c.sl || 0) + 1;
    else if (n.startsWith("media_generate_")) c.gen = (c.gen || 0) + 1;
    else if (n === "mcp_search_tools") c.ts = (c.ts || 0) + 1;
    else if (n === "mcp_call_tool") c.tc = (c.tc || 0) + 1;
    else if (n === "knowledge_save") c.kn = (c.kn || 0) + 1;
  }
  const parts = [];
  if (c.q) parts.push(`已搜索 ${c.q} 个查询`);
  if (c.img) parts.push(`搜索了 ${c.img} 次图片`);
  if (c.sch) parts.push(`检索了 ${c.sch} 次论文`);
  if (c.web) parts.push(`浏览了 ${c.web} 个网页`);
  if (c.bro) parts.push(`操作了 ${c.bro} 次浏览器`);
  if (c.edit.size) parts.push(`编辑了 ${c.edit.size} 个文件`);
  if (c.cmd) parts.push(`已运行 ${c.cmd} 个命令`);
  if (c.term) parts.push(`查看了 ${c.term} 次终端`);
  if (c.read.size) parts.push(`读取了 ${c.read.size} 个文件`);
  if (c.find) parts.push(`搜索了 ${c.find} 次文件`);
  if (c.mr) parts.push(`并行执行了 ${c.mr} 批子任务`);
  if (c.dep) parts.push(`部署了 ${c.dep} 个服务`);
  if (c.pub) parts.push(`发布了 ${c.pub} 次站点`);
  if (c.sched) parts.push(`创建了 ${c.sched} 个定时任务`);
  if (c.trig) parts.push(`创建了 ${c.trig} 个触发器`);
  if (c.sl) parts.push(`渲染了 ${c.sl} 次幻灯片`);
  if (c.gen) parts.push(`生成了 ${c.gen} 个媒体文件`);
  if (c.ts) parts.push(`搜索了 ${c.ts} 次工具`);
  if (c.tc) parts.push(`调用了 ${c.tc} 次连接器工具`);
  if (c.kn) parts.push(`提议记住 ${c.kn} 条知识`);
  return parts.join(" · ") || `执行了 ${steps.length} 个步骤`;
}

function confirmHtml(s) {
  const c = s.confirm || {};
  const detail = c.command ? `<pre class="cc-cmd">${esc(c.command)}</pre>` : c.port ? `<pre class="cc-cmd">端口 ${esc(c.port)}</pre>` : "";
  return `<div class="confirm-card"><div class="cc-head">${icon("alert")}OpenManus 需要你的确认</div>` +
    `<div class="cc-body"><div class="cc-reason">${esc(s.brief || zh(s.message?.action))}<span>${esc(c.reason || "")}</span></div>${detail}</div>` +
    `<div class="cc-actions"><button class="btn ghost" data-act="confirm" data-id="${esc(s.actionId)}" data-ok="0" ${s._answered ? "disabled" : ""}>拒绝</button>` +
    `<button class="btn primary" data-act="confirm" data-id="${esc(s.actionId)}" data-ok="1" ${s._answered ? "disabled" : ""}>允许执行</button></div></div>`;
}

// Knowledge the agent proposed in this turn (knowledge_save): the user accepts or dismisses it in place.
function knowCardHtml(k) {
  const cur = S.personal.knowledge.find((x) => x.id === k.id);
  const state = !cur ? "dismissed" : cur.pending ? "pending" : "saved";
  if (state === "dismissed" && !k._seen) return "";
  const actions = S.readonly ? "" : state === "pending"
    ? `<button class="btn ghost sm" data-act="know" data-id="${esc(k.id)}" data-op="dismiss">忽略</button><button class="btn primary sm" data-act="know" data-id="${esc(k.id)}" data-op="accept">记住</button>`
    : `<span class="muted">${state === "saved" ? "已保存到知识" : "已忽略"}</span><button class="btn ghost sm" data-act="know" data-op="manage">管理</button>`;
  return `<div class="know-card"><span class="auto-ico">${icon("brain")}</span><div class="auto-main"><div class="auto-title">${state === "pending" ? "OpenManus 想记住这条信息" : esc(k.title)}</div>` +
    `<div class="auto-when">${state === "pending" ? `<b>${esc(k.title)}</b>：` : ""}${esc(k.content)}</div></div><div class="know-actions">${actions}</div></div>`;
}

function liveLineHtml(t) {
  // a running step already shimmers in its own row; the live line only covers "thinking" gaps
  if (S.steps.some((s) => s.turn === t && (s.status === "start" || s.status === "running"))) return "";
  if (t.items[t.items.length - 1]?.kind === "stream") return ""; // text is already streaming in
  return `<div class="live-line"><span class="live-dot"></span><span class="shimmer">${esc(liveText(S.live))}</span></div>`;
}
const liveText = (t) => ({ Thinking: "思考中", Planning: "正在规划任务" }[t] || t || "思考中");

function doneRowHtml(t, fi) {
  const st = {
    idle: `<span class="st ok">${icon("check")}任务已完成</span>`,
    stopped: `<span class="st">${icon("stop")}任务已停止</span>`,
    error: `<span class="st err">${icon("alert")}任务出错</span>`,
    waiting: `<span class="st wait">${icon("hand")}等待你的回复</span>`,
  }[t.status] || "";
  const copy = fi >= 0 ? `<span class="sep"></span><button class="icon-btn" title="复制" data-act="copy" data-turn="${t.id}">${icon("copy")}</button>` : "";
  return `<div class="done-row">${st}${copy}${t.end ? `<span>${fmtTime(t.end)}</span>` : ""}</div>` +
    (t.status === "error" && t.error ? `<div class="err-detail">${esc(t.error)}</div>` : "");
}

// ---- attachments as file cards (Manus shows a previewable document card)
const TEXTY = new Set(["md", "markdown", "txt", "csv", "json", "py", "js", "ts", "html", "css", "yaml", "yml", "log", "sh"]);
const IMG = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
function fileIconCls(name) {
  const e = ext(name);
  if (e === "pdf") return ["fileDoc", "pdf"];
  if (IMG.has(e)) return ["image", "img"];
  if (["csv", "xlsx", "xls"].includes(e)) return ["fileDoc", "sheet"];
  if (["pptx", "ppt", "key"].includes(e)) return ["presentation", "slides"];
  if (["mp4", "webm", "mov"].includes(e)) return ["film", "video"];
  if (["mp3", "wav", "m4a", "ogg"].includes(e)) return ["music", "audio"];
  if (["py", "js", "ts", "html", "css", "json", "sh"].includes(e)) return ["code", "code"];
  return ["fileDoc", ""];
}
function cardsHtml(list) {
  if (!list?.length) return "";
  return `<div class="cards">${list.map((a, i) => {
    const [ic, cls] = fileIconCls(a.filename);
    const e = ext(a.filename);
    const preview = TEXTY.has(e) || IMG.has(e);
    return `<div class="file-card"><div class="fc-head" data-act="open-file" data-url="${esc(a.url)}" data-name="${esc(a.filename)}" data-path="${esc(a.path)}">` +
      `<span class="fc-ico ${cls}">${icon(ic)}</span><span class="fc-name">${esc(a.filename)}<div class="fc-sub">${esc(e.toUpperCase() || "文件")}</div></span>` +
      (a.filename === "SKILL.md" && !S.readonly ? (S.skills.skills.some((x) => x.name === basename(String(a.path).replace(/\/SKILL\.md$/, "")) && x.source === "personal")
        ? `<span class="sk-added">${icon("check")}已在我的技能中</span>` : `<button class="btn ghost sm" data-act="add-skill" data-path="${esc(a.path)}">${icon("plus")}添加到我的技能</button>`) : "") +
      `<a class="icon-btn" href="${esc(a.url)}" download="${esc(a.filename)}" title="下载" data-stop="1">${icon("download")}</a></div>` +
      (preview ? `<div class="fc-preview" data-preview="${esc(a.url)}" data-kind="${IMG.has(e) ? "img" : e}" data-act="open-file" data-url="${esc(a.url)}" data-name="${esc(a.filename)}" data-path="${esc(a.path)}"></div>` : "") +
      `</div>`;
  }).join("")}</div>`;
}
async function fetchText(url) {
  if (!(url in S.previews)) S.previews[url] = fetch(url).then((r) => (r.ok ? r.text() : "")).catch(() => "");
  return S.previews[url];
}
async function loadPreview(n) {
  const url = n.dataset.preview, kind = n.dataset.kind;
  if (kind === "img") { n.innerHTML = `<img src="${esc(url)}" alt="" />`; return; }
  const text = await fetchText(url);
  n.innerHTML = kind === "md" || kind === "markdown" ? `<div class="prose">${md(text.slice(0, 6000))}</div>` : `<pre style="margin:0;white-space:pre-wrap;font:12px/18px var(--font-mono)">${esc(text.slice(0, 3000))}</pre>`;
}

// ---- taskbar above the composer (current step / plan progress / done)
function renderTaskbar() {
  const bar = $("#taskbar");
  const t = lastTurn();
  if (!t || (!S.steps.length && !S.plan.length)) { bar.classList.add("hidden"); return; }
  bar.classList.remove("hidden");
  const last = S.steps[S.steps.length - 1];
  const shot = [...S.steps].reverse().find((s) => s.detail?.browser?.screenshot)?.detail.browser.screenshot;
  const thumb = shot ? `<img src="${esc(shot)}" alt="" />` : icon(TOOL[last?.tool]?.icon || "monitor");
  let text;
  if (S.status === "running") {
    const txt = last && (last.status === "start" || last.status === "running") ? (last.brief || `${zh(last.message?.action)} ${last.message?.param || ""}`) : liveText(S.live);
    text = `<span class="tb-text"><span class="shimmer">${esc(txt)}</span></span>`;
  } else if (S.status === "waiting") text = t && pendingConfirms(t).length ? `<span class="tb-text warn">${icon("alert")}等待你确认操作</span>` : `<span class="tb-text">${icon("hand")}等待你的回复</span>`;
  else if (S.status === "error") text = `<span class="tb-text err">${icon("alert")}任务出错</span>`;
  else if (S.status === "stopped") text = `<span class="tb-text">${icon("stop")}任务已停止</span>`;
  else text = `<span class="tb-text ok">${icon("check")}任务已完成</span>`;
  const done = S.plan.filter((p) => p.status === "completed").length;
  const plan = S.plan.length ? `<button class="tb-plan" data-act="plan">${icon("list")}${done} / ${S.plan.length}${icon(S.planOpen ? "chevDown" : "chevUp")}</button>` : "";
  const pop = S.planOpen && S.plan.length ? `<div class="plan-pop" data-stop="1"><h4>任务进度<span>${done} / ${S.plan.length}</span></h4><ol>${S.plan.map((p) =>
    `<li class="${esc(p.status)}"><span class="pi">${p.status === "completed" ? icon("check") : ""}</span>${esc(p.title)}</li>`).join("")}</ol></div>` : "";
  bar.innerHTML = `<span class="tb-thumb">${thumb}</span>${text}${plan}${pop}`;
}

function renderComposerState() {
  const busy = S.current && (S.status === "running");
  const btn = $("#send-btn");
  const hasText = $("#input").value.trim().length > 0;
  btn.classList.toggle("stop", !!busy && !hasText);
  btn.innerHTML = icon(busy && !hasText ? "stop" : "arrowUp");
  btn.disabled = !(hasText || busy);
  btn.title = busy && !hasText ? "停止" : "发送";
  $("#input").placeholder = S.current ? "向 OpenManus 发送消息" : "分配一个任务或提问任何问题";
}

// ------------------------------------------------------------------ computer panel ---
const selectedStep = () => (S.panel.sel !== null ? S.steps[S.stepIdx[S.panel.sel]] : S.steps[S.steps.length - 1]);

function renderPanel() {
  const open = S.panel.open && !!S.current;
  $("#computer").classList.toggle("hidden", !open);
  document.body.classList.toggle("pc-open", open);
  document.body.classList.toggle("pc-full", open && S.panel.full);
  $("#panel-btn").classList.toggle("hidden", !S.current || !S.steps.length || open);
  if (!open) { vncDisconnect(); return; }
  $("#pc-full").innerHTML = icon(S.panel.full ? "minimize" : "maximize");

  const view = $("#pc-view"), status = $("#pc-status");
  const running = S.status === "running";
  const lastStep = S.steps[S.steps.length - 1];
  const live = S.panel.sel === null && !S.panel.file;
  const showVnc = S.vnc && !S.vncFailed && live && (S.panel.takeover || lastStep?.tool === "browser");
  const takeBtn = S.vnc && !S.vncFailed && live
    ? `<button class="takeover-btn ${S.panel.takeover ? "on" : ""}" data-act="takeover">${icon("hand")}${S.panel.takeover ? "结束接管" : "接管"}</button>` : "";
  $("#pc-vnc").classList.toggle("hidden", !showVnc);
  $("#pc-vnc").classList.toggle("control", S.panel.takeover);
  view.classList.toggle("hidden", showVnc);
  if (showVnc) vncConnect(); else vncDisconnect();
  if (showVnc && S.panel.takeover) {
    status.innerHTML = `<span class="grow"><span class="who">你正在控制 OpenManus 的电脑</span><span class="div"></span><span class="what">完成后点击「结束接管」把控制权交还给 OpenManus</span></span>${takeBtn}`;
  } else if (showVnc) {
    status.innerHTML = `<span class="grow"><span class="who">OpenManus ${running ? "正在使用" : "使用了"}浏览器</span><span class="div"></span><span class="what">${esc(lastStep?.detail?.browser?.url || lastStep?.message?.param || "")}</span></span><span class="live-badge"><i></i>实时画面</span>${takeBtn}`;
  } else if (S.panel.file) {
    const f = S.panel.file;
    status.innerHTML = `<span class="who">OpenManus 正在查看文件</span><span class="div"></span><span class="what">${esc(f.path || f.name)}</span>`;
    view.innerHTML = `<div class="file-head">${icon("fileText")}<span class="grow">${esc(f.name)}</span><a class="icon-btn sm" href="${esc(f.url)}" download="${esc(f.name)}" title="下载">${icon("download")}</a><a class="icon-btn sm" href="${esc(f.url)}" target="_blank" title="新窗口打开">${icon("external")}</a></div><div id="file-body"></div>`;
    renderFileBody(f);
  } else {
    const s = selectedStep();
    if (!s) {
      status.innerHTML = `<span class="who">OpenManus 的电脑</span>`;
      view.innerHTML = `<div class="pc-empty">${icon("monitor")}<span>任务开始后，终端、浏览器和文件操作会实时显示在这里</span></div>`;
    } else {
      const use = TOOL[s.tool]?.use || "工具";
      const what = s.tool === "browser" || s.tool === "webpage_extract" ? (s.detail?.browser?.url || s.detail?.webpageExtract?.url || s.message?.param) : `${zh(s.message?.action)} ${s.message?.param || ""}`;
      const verb = s.status === "start" || s.status === "running" ? "正在使用" : "使用了";
      status.innerHTML = `<span class="grow"><span class="who">OpenManus ${verb}${esc(use)}</span><span class="div"></span><span class="what">${esc(what)}</span></span>${takeBtn}`;
      view.innerHTML = stepView(s);
      const term = view.querySelector(".term"); if (term && S.panel.sel === null) view.scrollTop = view.scrollHeight;
    }
  }
  // timeline
  const n = S.steps.length, idx = S.panel.sel === null ? n - 1 : S.stepIdx[S.panel.sel];
  const r = $("#pc-range");
  r.max = Math.max(1, n - 1); r.value = n > 1 ? Math.max(0, idx) : 1; r.disabled = n < 2;
  r.style.setProperty("--p", n > 1 ? `${(idx / (n - 1)) * 100}%` : "100%");
  const isLive = S.panel.sel === null && !S.panel.file;
  $("#live-tag").classList.toggle("on", isLive && running);
  $("#jump-live").classList.toggle("hidden", isLive || !n);
  const foot = $("#pc-foot");
  foot.className = "pc-foot";
  if (running) { const s = S.steps[n - 1]; foot.innerHTML = `<span class="shimmer">${esc(s && (s.status === "start" || s.status === "running") ? (s.brief || `${zh(s.message?.action)} ${s.message?.param || ""}`) : liveText(S.live))}</span>`; }
  else if (S.status === "waiting") foot.innerHTML = lastTurn() && pendingConfirms(lastTurn()).length ? `${icon("alert")}等待你确认操作` : `${icon("hand")}等待你的回复`;
  else if (S.status === "error") { foot.classList.add("err"); foot.innerHTML = `${icon("alert")}任务出错`; }
  else if (S.status === "stopped") foot.innerHTML = `${icon("stop")}任务已停止`;
  else { foot.classList.add("ok"); foot.innerHTML = `${icon("check")}任务已完成`; }
}

function stepView(s) {
  const d = s.detail || {};
  if (s.status === "need_confirm") return `<div class="pc-empty">${icon("alert")}<span>等待你确认：${esc(s.confirm?.reason || "")}</span>${s.confirm?.command ? `<pre class="cc-cmd" style="max-width:80%">${esc(s.confirm.command)}</pre>` : ""}</div>`;
  if (d.terminal) return termHtml(d.terminal);
  if (d.browser?.screenshot) return `<img class="shot" src="${esc(d.browser.screenshot)}" alt="" />`;
  if (d.browser?.console) return `<div class="term">${esc(d.browser.console)}</div>`;
  if (d.webpageExtract) return `<div class="page-md"><div class="prose">${md(d.webpageExtract.markdown)}</div></div>`;
  if (d.search) {
    const qs = d.search.queries || [d.search.query];
    return `<div class="serp"><div class="serp-q">${icon("search")}${qs.map((q) => `<span class="q-chip">${esc(q)}</span>`).join("")}</div>${(d.search.results || []).map((r) => {
      const h = hostOf(r.url);
      return `<a class="serp-item" href="${esc(r.url)}" target="_blank"><div class="serp-title"><span class="fav" style="background-image:url('https://icons.duckduckgo.com/ip3/${esc(h)}.ico')">${esc((h[0] || "?").toUpperCase())}</span><span>${esc(r.title)}</span></div><div class="serp-snip">${esc(r.snippet)}</div><div class="serp-url">${esc(h)}${qs.length > 1 && r.query ? ` · ${esc(r.query)}` : ""}</div></a>`;
    }).join("")}</div>`;
  }
  if (d.searchImage) return `<div class="serp"><div class="serp-q">${icon("image")}<span class="q-chip">${esc(d.searchImage.query)}</span></div><div class="img-grid">${(d.searchImage.results || []).map((r) =>
    `<a class="img-item" href="${esc(r.source || r.image)}" target="_blank" title="${esc(r.title)}"><img src="${esc(r.thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer" /><span>${esc(r.width ? `${r.width}×${r.height}` : hostOf(r.source || r.image))}</span></a>`).join("")}</div></div>`;
  if (d.searchScholar) return `<div class="serp"><div class="serp-q">${icon("book")}<span class="q-chip">${esc(d.searchScholar.query)}</span></div>${(d.searchScholar.results || []).map((r) =>
    `<div class="serp-item paper"><a class="serp-title" href="${esc(r.url)}" target="_blank"><span>${esc(r.title)}</span></a>` +
    `<div class="serp-url">${esc((r.authors || []).slice(0, 4).join(", "))}${r.authors?.length > 4 ? " 等" : ""} · ${esc(r.year || "")}${r.venue ? ` · ${esc(r.venue)}` : ""} · 被引 ${esc(r.citations)}</div>` +
    (r.abstract ? `<div class="serp-snip">${esc(r.abstract)}</div>` : "") + (r.pdf ? `<a class="paper-pdf" href="${esc(r.pdf)}" target="_blank">${icon("fileDoc")}PDF</a>` : "") + `</div>`).join("")}</div>`;
  if (d.textEditor) return editorHtml(d.textEditor);
  if (d.mapReduce) {
    // Manus' map_reduce controls: stop / retry one item, or continue now with what is finished
    const live = !S.readonly && d.mapReduce.taskStatus === "running" && (s.status === "running" || s.status === "start");
    const ctl = (op, i, label) => `<button class="btn ghost sm" data-act="mr" data-id="${esc(s.actionId)}" data-op="${op}" data-i="${i ?? ""}">${label}</button>`;
    const done = d.mapReduce.taskDetails.filter((t) => t.status === "completed").length;
    return `<div class="mr">${live ? `<div class="mr-head"><span>${done} / ${d.mapReduce.taskDetails.length} 已完成</span>${ctl("force_continue", null, "强制继续")}</div>` : ""}${
      d.mapReduce.taskDetails.map((t) => `<div class="mr-row"><span class="s ${t.status}">${{ pending: "○", running: "◌", completed: "✓", failed: "✕", cancelled: "–" }[t.status] || ""}</span><div class="b"><div>${t.index + 1}. ${esc(t.item)}${t.status === "cancelled" ? ' <span class="p">已取消</span>' : ""}</div>` +
      (t.progress && t.status !== "failed" ? `<div class="p">${esc(t.progress)}</div>` : "") + (t.result ? `<details><summary>结果</summary><div class="prose">${md(t.result)}</div></details>` : "") + `</div>` +
      (live && (t.status === "running" || t.status === "pending") ? ctl("cancel", t.index, "停止") : "") +
      (live && (t.status === "failed" || t.status === "cancelled") ? ctl("retry", t.index, "重试") : "") + `</div>`).join("")}</div>`;
  }
  if (d.mcp) return `<div class="file-head">${icon("plug")}<span class="grow">${esc(d.mcp.server)} · ${esc(d.mcp.action)}</span></div>` +
    `<div class="page-md"><div class="mcp-label">参数</div><pre class="cc-cmd">${esc(d.mcp.argumentsPreview)}</pre><div class="mcp-label">结果</div><pre class="cc-cmd mcp-out">${esc(d.mcp.resultPreview)}</pre></div>`;
  if (d.knowledge) return `<div class="mr">${knowCardHtml(d.knowledge)}</div>`;
  if (d.slides) return slidesViewHtml(s);
  if (d.media) {
    const m = d.media;
    const player = m.kind === "image" ? `<img class="shot" src="${esc(m.url)}" alt="" />` : m.kind === "video" ? `<video class="media-player" src="${esc(m.url)}" controls></video>` : `<div class="audio-wrap">${icon("music")}<audio src="${esc(m.url)}" controls></audio></div>`;
    return `<div class="file-head">${icon(m.kind === "video" ? "film" : m.kind === "audio" ? "music" : "image")}<span class="grow">${esc(m.path)}</span><a class="icon-btn sm" href="${esc(m.url)}" download title="下载">${icon("download")}</a></div>` +
      `<div class="media-view">${player}${m.prompt ? `<div class="media-prompt">${esc(m.prompt)}</div>` : ""}</div>`;
  }
  if (d.trigger) return `<div class="mr"><div class="auto-card" style="margin:8px 0">${trigCardHtml(d.trigger, false)}</div></div>`;
  if (d.schedule) return `<div class="mr"><div class="auto-card" style="margin:8px 0">${autoCardHtml(d.schedule, false)}</div></div>`;
  if (d.site) return `<div class="urlbar">${icon("globe")}<a href="${esc(d.site.url)}" target="_blank">${esc(d.site.url)}</a><span class="lib-tag">v${esc(d.site.current)}</span></div><iframe class="preview-frame" style="height:calc(100% - 37px)" src="${esc(d.site.url)}"></iframe>`;
  if (d.deploy) return `<div class="urlbar">${icon("globe")}<a href="${esc(d.deploy.url)}" target="_blank">${esc(d.deploy.url)}</a></div><iframe class="preview-frame" style="height:calc(100% - 37px)" src="${esc(d.deploy.url)}"></iframe>`;
  if (d.error) return `<div class="err-view"><div class="term">${esc(d.error)}</div></div>`;
  if (s.status === "start" || s.status === "running") return `<div class="pc-empty"><span class="shimmer">${esc(s.brief || zh(s.message?.action))}</span></div>`;
  return `<div class="err-view"><div class="term" style="color:var(--text-secondary);background:var(--bg-code)">${esc(JSON.stringify(s.args || {}, null, 2))}</div></div>`;
}

// Manus-style slide viewer: the current slide large, a strip of thumbnails, and the exported files.
function slidesViewHtml(s) {
  const d = s.detail.slides, i = Math.min(S.slideIdx?.[s.actionId] || 0, d.count - 1), cur = d.slides[i] || {};
  const nav = (n, ic, dis) => `<button class="icon-btn sm" data-act="slide" data-id="${esc(s.actionId)}" data-i="${n}" ${dis ? "disabled" : ""}>${icon(ic)}</button>`;
  return `<div class="file-head">${icon("presentation")}<span class="grow">${esc(basename(d.file))} · ${d.count} 页</span>` +
    (d.pdf ? `<a class="btn ghost sm" href="${esc(d.pdf.url)}" download>PDF</a>` : "") + (d.pptx ? `<a class="btn ghost sm" href="${esc(d.pptx.url)}" download>PPTX</a>` : "") + `</div>` +
    `<div class="slide-view"><div class="slide-main">${cur.thumb ? `<img src="${esc(cur.thumb)}" alt="" />` : ""}</div>` +
    `<div class="slide-nav">${nav(i - 1, "chevLeft", i === 0)}<span>${i + 1} / ${d.count}${cur.title ? ` · ${esc(cur.title)}` : ""}</span>${nav(i + 1, "chevRight", i >= d.count - 1)}</div>` +
    `<div class="slide-strip">${d.slides.map((x, k) => `<button class="${k === i ? "on" : ""}" data-act="slide" data-id="${esc(s.actionId)}" data-i="${k}"><img src="${esc(x.thumb)}" alt="" loading="lazy" /></button>`).join("")}</div></div>`;
}

function termHtml(t) {
  const lines = String(t.output || "").split("\n").map((l) => {
    const m = l.match(/^(\/\S*)\$ (.*)$/);
    if (m) return `<span class="cmd"><span class="ps">ubuntu@sandbox:${esc(m[1].replace(/^\/home\/ubuntu/, "~"))}$</span> ${esc(m[2])}</span>`;
    return esc(l);
  });
  return `<div class="term">${lines.join("\n")}${t.running ? "\n<span class=\"shimmer\">▍</span>" : ""}</div>`;
}

function editorHtml(e) {
  const isDiff = e.op === "edit";
  const head = `<div class="file-head">${icon("fileText")}<span class="grow">${esc(e.path)}</span><span>${esc({ read: "读取", write: "写入", append: "追加", edit: "修改", search: "搜索" }[e.op] || e.op || "")}</span></div>`;
  if (!isDiff && /\.(md|markdown)$/i.test(e.path || "") && e.op !== "search") return head + `<div class="page-md"><div class="prose">${md(e.content)}</div></div>`;
  const rows = String(e.content || "").split("\n").map((l, i) => {
    const cls = isDiff ? (l.startsWith("+ ") ? "add" : l.startsWith("- ") ? "del" : "") : "";
    return `<span class="ln">${i + 1}</span><span class="lc ${cls}">${esc(l) || " "}</span>`;
  }).join("");
  return head + `<div class="code">${rows}</div>`;
}

async function renderFileBody(f, body = $("#file-body"), still = () => S.panel.file === f) {
  const e = ext(f.name);
  if (IMG.has(e)) { body.innerHTML = `<img class="shot" src="${esc(f.url)}" alt="" />`; return; }
  if (e === "pdf") { body.innerHTML = `<iframe class="preview-frame" style="height:calc(100vh - 240px)" src="${esc(f.url)}"></iframe>`; return; }
  if (["mp4", "webm", "mov"].includes(e)) { body.innerHTML = `<div class="media-view"><video class="media-player" src="${esc(f.url)}" controls></video></div>`; return; }
  if (["mp3", "wav", "m4a", "ogg"].includes(e)) { body.innerHTML = `<div class="media-view"><div class="audio-wrap">${icon("music")}<audio src="${esc(f.url)}" controls></audio></div></div>`; return; }
  if (!TEXTY.has(e)) { body.innerHTML = `<div class="pc-empty" style="height:300px">${icon("fileDoc")}<span>该文件无法预览，<a href="${esc(f.url)}" download>点击下载</a></span></div>`; return; }
  const text = await fetchText(f.url);
  if (!still()) return;
  body.innerHTML = e === "md" || e === "markdown" ? `<div class="page-md"><div class="prose">${md(text)}</div></div>` : editorHtml({ path: f.path, content: text, op: "read" }).replace(/^<div class="file-head">.*?<\/div>/, "");
}

// ------------------------------------------------------------------ live screen (noVNC) ---
// The sandbox runs its browser on a virtual display exported over VNC; the backend relays it at
// /api/sessions/<id>/vnc. View-only by default, interactive while the user has taken over.
const NOVNC = "https://cdn.jsdelivr.net/gh/novnc/noVNC@v1.5.0/core/rfb.js";
let rfb = null, rfbSid = null, RFB = null;
async function vncConnect() {
  const sid = S.current;
  if (rfb && rfbSid === sid) { rfb.viewOnly = !S.panel.takeover; return; }
  vncDisconnect();
  rfbSid = sid;
  try { RFB = RFB || (await import(NOVNC)).default; } catch { S.vncFailed = true; scheduleRender(); return; }
  if (rfbSid !== sid || rfb) return;
  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/sessions/${sid}/vnc`;
  const r = new RFB($("#pc-vnc"), url, { wsProtocols: ["binary"] });
  r.scaleViewport = true; r.resizeSession = false; r.viewOnly = !S.panel.takeover; r.background = "transparent";
  r.addEventListener("disconnect", () => {
    if (rfb !== r) return;
    rfb = null; rfbSid = null;
    if (S.current === sid) { S.vncFailed = true; S.panel.takeover = false; scheduleRender(); } // fall back to screenshots
  });
  rfb = r;
}
function vncDisconnect() {
  if (!rfb) return;
  const r = rfb; rfb = null; rfbSid = null;
  try { r.disconnect(); } catch { /* already closed */ }
}
function toggleTakeover() {
  const ending = S.panel.takeover;
  S.panel.takeover = !ending;
  if (!ending) { S.panel.open = true; S.panel.userClosed = false; S.panel.sel = null; S.panel.file = null; }
  else if (S.status === "waiting") send({ type: "user_message", sessionId: S.current, content: "我已完成浏览器中的操作，请继续。", attachments: [] });
  refreshSel();
}

// ------------------------------------------------------------------ projects (项目) ---
async function loadProjects() {
  try { S.projects = await (await fetch("/api/projects")).json(); } catch { S.projects = []; }
  $("#project-list").innerHTML = S.projects.map((p) => `<div class="session-item ${S.view === "project" && S.projectId === p.id ? "active" : ""}" data-project="${esc(p.id)}">` +
    `<span class="s-ico">${icon("folder")}</span><span class="s-title">${esc(p.name)}</span></div>`).join("");
}
function openProject(pid) {
  if (S.current) send({ type: "leave_session", sessionId: S.current });
  S.current = null; resetSession(); S.view = "project"; S.projectId = pid;
  history.replaceState(null, "", `#project/${pid}`);
  renderSessions(); loadProjects().then(() => scheduleRender());
}
function renderProject() {
  const p = S.projects.find((x) => x.id === S.projectId);
  if (!p) return;
  if (document.activeElement !== $("#proj-name")) $("#proj-name").value = p.name;
  if (document.activeElement !== $("#proj-instr")) $("#proj-instr").value = p.instructions || "";
  $("#input").placeholder = `在「${p.name}」中新建任务`;
  $("#proj-files").innerHTML = p.files.length ? p.files.map((f) => { const [ic, cls] = fileIconCls(f.name);
    return `<div class="proj-file"><span class="fc-ico ${cls}">${icon(ic)}</span><a href="${esc(f.url)}" target="_blank">${esc(f.name)}</a><span class="muted">${fmtSize(f.size)}</span><button class="icon-btn sm" data-rmfile="${esc(f.name)}" title="移除">${icon("x")}</button></div>`; }).join("")
    : `<div class="small-pad">上传的文件会在该项目的每个任务开始时复制到沙箱的 ~/project/ 目录</div>`;
  const tasks = S.sessions.filter((x) => x.projectId === p.id);
  $("#proj-tasks").innerHTML = tasks.length ? tasks.map((x) => `<div class="session-item" data-id="${esc(x.id)}"><span class="s-ico">${icon("message")}</span><span class="s-title">${esc(x.title)}</span></div>`).join("")
    : `<div class="small-pad">还没有任务，在上方输入框中分配一个</div>`;
}
async function saveProject(patch) {
  const r = await fetch(`/api/projects/${S.projectId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
  if (r.ok) { $("#proj-saved").textContent = "已保存"; setTimeout(() => ($("#proj-saved").textContent = ""), 1500); await loadProjects(); scheduleRender(); }
}

// ------------------------------------------------------------------ connectors (MCP) ---
async function openConnectors() {
  if (S.current) send({ type: "leave_session", sessionId: S.current });
  S.current = null; resetSession(); S.view = "connectors";
  history.replaceState(null, "", "#connectors");
  renderSessions();
  await loadConns();
}
async function loadConns() { try { S.conns = await (await fetch("/api/connectors")).json(); } catch { S.conns = []; } scheduleRender(); }
const CONN_STATUS = { connected: ["ok", "已连接"], connecting: ["", "连接中"], error: ["err", "连接失败"], disconnected: ["", "未连接"], disabled: ["", "已停用"] };
function renderConnectors() {
  $("#conn-list").innerHTML = S.conns.length ? S.conns.map((c) => {
    const [cls, label] = CONN_STATUS[c.status] || ["", c.status];
    const where = c.transport === "stdio" ? `${c.command} ${(c.args || []).join(" ")}` : c.url;
    const tools = c.tools.map((t) => `<span class="tool-chip" title="${esc(t.description)}">${t.readOnly ? "" : icon("pencil")}${esc(t.name)}</span>`).join("");
    return `<div class="auto-card ${c.enabled ? "" : "off"}"><div class="auto-top"><span class="auto-ico">${icon("plug")}</span><div class="auto-main">` +
      `<div class="auto-title">${esc(c.name)} <span class="conn-st ${cls}"><i></i>${label}${c.status === "connected" ? ` · ${c.tools.length} 个工具` : ""}</span></div>` +
      `<div class="auto-when mono">${esc(c.transport)} · ${esc(where)}</div></div>` +
      `<button class="switch ${c.enabled ? "on" : ""}" data-conn="toggle" data-id="${esc(c.id)}" title="${c.enabled ? "停用" : "启用"}"><i></i></button></div>` +
      (c.error ? `<div class="err-detail">${esc(c.error)}</div>` : "") + (tools ? `<div class="tool-chips">${tools}</div>` : "") +
      `<div class="auto-foot"><div class="auto-runs">${c.autoApprove ? "<span>已信任：调用不再确认</span>" : "<span>非只读工具调用前需确认（带 ✎ 标记）</span>"}</div>` +
      `<button class="btn ghost sm" data-conn="restart" data-id="${esc(c.id)}">重新连接</button>` +
      `<button class="icon-btn sm" data-conn="edit" data-id="${esc(c.id)}" title="编辑">${icon("pencil")}</button>` +
      `<button class="icon-btn sm" data-conn="del" data-id="${esc(c.id)}" title="删除">${icon("trash")}</button></div></div>`;
  }).join("") : `<div class="lib-empty">${icon("plug")}<div>还没有连接器</div><div class="muted">添加 MCP 服务器后，OpenManus 就能使用其中的工具</div></div>`;
}
const linesToMap = (text, sep) => Object.fromEntries(text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf(sep); return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : [l, ""]; }));
function openConnForm(c) {
  S.editingConn = c || null;
  const f = $("#conn-form"); f.reset();
  $("#conn-form-title").textContent = c ? "编辑连接器" : "添加连接器";
  $("#conn-err").textContent = "";
  if (c) {
    f.name.value = c.name; f.description.value = c.description || ""; f.transport.value = c.transport;
    f.command.value = c.command || ""; f.args.value = (c.args || []).join("\n"); f.url.value = c.url || "";
    f.env.value = Object.keys(c.env || {}).map((k) => `${k}=••••`).join("\n");
    f.headers.value = Object.keys(c.headers || {}).map((k) => `${k}: ••••`).join("\n");
    f.autoApprove.checked = !!c.autoApprove;
  }
  syncConnFields();
  $("#conn-modal").classList.remove("hidden");
}
function syncConnFields() { const t = $("#conn-form").transport.value; $("#conn-form").querySelectorAll("[data-for]").forEach((n) => n.classList.toggle("hidden", !n.dataset.for.split(" ").includes(t))); }
async function saveConn(e) {
  e.preventDefault();
  const f = e.target, btn = $("#conn-save");
  const body = { name: f.name.value, description: f.description.value, transport: f.transport.value, autoApprove: f.autoApprove.checked,
    command: f.command.value, args: f.args.value.split("\n").map((x) => x.trim()).filter(Boolean),
    env: linesToMap(f.env.value, "="), url: f.url.value, headers: linesToMap(f.headers.value, ":") };
  btn.disabled = true; btn.textContent = "连接中…"; $("#conn-err").textContent = "";
  const r = await fetch(S.editingConn ? `/api/connectors/${S.editingConn.id}` : "/api/connectors",
    { method: S.editingConn ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  btn.disabled = false; btn.textContent = "连接";
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { $("#conn-err").textContent = j.detail || "保存失败"; return; }
  if (j.status === "error") { $("#conn-err").textContent = `已保存，但连接失败：${j.error}`; S.editingConn = j; loadConns(); return; }
  $("#conn-modal").classList.add("hidden");
  if (S.view === "plugins") openConnectors(); else loadConns();
}
async function connAction(a, id) {
  const c = S.conns.find((x) => x.id === id);
  if (!c) return;
  if (a === "edit") return openConnForm(c);
  if (a === "del") { if (!confirm(`删除连接器「${c.name}」？`)) return; await fetch(`/api/connectors/${id}`, { method: "DELETE" }); }
  if (a === "toggle") await fetch(`/api/connectors/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !c.enabled }) });
  if (a === "restart") { c.status = "connecting"; renderConnectors(); await fetch(`/api/connectors/${id}/restart`, { method: "POST" }); }
  loadConns();
}

// ------------------------------------------------------------------ cloud computers (电脑) ---
const PC_ST = { running: ["ok", "运行中"], ready: ["ok", "运行中"], stopped: ["", "已关机"], starting: ["", "启动中"], setting_up: ["", "正在配置"], error: ["err", "出错"] };
async function openComputers() {
  if (S.current) send({ type: "leave_session", sessionId: S.current });
  S.current = null; resetSession(); S.view = "computers";
  history.replaceState(null, "", "#computers");
  renderSessions(); await loadComputers();
}
async function loadComputers() { try { S.pcs = await (await fetch("/api/computers")).json(); } catch { /* keep */ } scheduleRender(); if (S.pcOpen) renderPcView(); }
setInterval(() => { if ((S.view === "computers" || S.pcOpen) && S.pcs.computers.some((c) => ["starting", "setting_up"].includes(c.status))) loadComputers(); }, 3000);
const pcSt = (c) => { const [cls, l] = PC_ST[c.status] || ["", c.status]; return `<span class="conn-st ${cls}"><i></i>${l}</span>`; };
function renderComputers() {
  const { computers, templates, unavailable, tasks } = S.pcs;
  $("#pc-mine").innerHTML = computers.length ? `<div class="nav-section" style="padding-left:0">我的电脑</div><div class="sk-grid">${computers.map((c) =>
    `<div class="sk-card" data-pc="${esc(c.id)}"><div class="sk-top"><span class="auto-ico">${icon("monitor")}</span><div class="sk-title">${esc(c.name)}<div class="sk-name">Linux · ${c.cpus} CPU · ${c.memory} GB${c.autoStop ? ` · 空闲 ${c.autoStop} 分钟关机` : " · 始终在线"}</div></div>${pcSt(c)}</div>` +
    `<div class="sk-meta"><span>${(tasks[c.id] || []).length} 个任务</span>${c.ports.length ? `<span>${c.ports.length} 个开放端口</span>` : ""}<span class="spacer"></span><button class="btn ghost sm" data-pc-task="${esc(c.id)}">${icon("newTask")}新任务</button></div></div>`).join("")}</div>` : "";
  $("#pc-templates").innerHTML = templates.map((t) => `<div class="sk-card" data-pc-tpl="${esc(t.id)}"><div class="sk-top"><span class="auto-ico">${icon(t.id === "custom" ? "pencil" : t.id === "gameserver" ? "gamepad" : t.id === "blender" ? "layers" : "monitor")}</span><div class="sk-title">${esc(t.name)}<div class="sk-name">${esc(t.os)}${t.tags.map((x) => ` · ${esc(x)}`).join("")}</div></div></div><div class="sk-desc">${esc(t.description)}</div></div>`).join("") +
    unavailable.map((t) => `<div class="sk-card off" title="暂不支持"><div class="sk-top"><span class="auto-ico">${icon("monitor")}</span><div class="sk-title">${esc(t.name)}<div class="sk-name">${esc(t.os)}${t.tags.map((x) => ` · ${esc(x)}`).join("")}</div></div><span class="lib-tag">暂不支持</span></div><div class="sk-desc">${esc(t.description)}</div></div>`).join("");
}
function openPcNew(tpl = "custom") {
  const f = $("#pcnew-form"); f.reset(); $("#pcnew-err").textContent = "";
  $("#pcnew-template").innerHTML = S.pcs.templates.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("");
  $("#pcnew-cpus").innerHTML = S.pcs.cpus.map((n) => `<option value="${n}">${n} 核</option>`).join("");
  $("#pcnew-mem").innerHTML = S.pcs.memory.map((n) => `<option value="${n}">${n} GB</option>`).join("");
  f.template.value = tpl; syncPcNew();
  $("#pcnew-modal").classList.remove("hidden");
}
function syncPcNew() {
  const f = $("#pcnew-form"), t = S.pcs.templates.find((x) => x.id === f.template.value); if (!t) return;
  f.cpus.value = t.cpus; f.memory.value = t.memory; f.autoStop.value = String(t.autoStop || 0); f.name.placeholder = t.name;
  $("#pcnew-desc").textContent = t.description + (t.setup ? " 创建后会自动安装所需软件，需要几分钟。" : "");
}
async function savePcNew(e) {
  e.preventDefault();
  const f = e.target;
  const r = await fetch("/api/computers", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ template: f.template.value, name: f.name.value, cpus: +f.cpus.value, memory: +f.memory.value, autoStop: +f.autoStop.value }) });
  if (!r.ok) { $("#pcnew-err").textContent = (await r.json().catch(() => ({}))).detail || "创建失败"; return; }
  $("#pcnew-modal").classList.add("hidden");
  await loadComputers();
}
let pcRfb = null;
function pcVncClose() { if (pcRfb) { try { pcRfb.disconnect(); } catch { /* closed */ } pcRfb = null; } }
async function openPcView(id, tab) {
  S.pcOpen = id; if (tab) S.pcTab = tab;
  $("#pcview-modal").classList.remove("hidden");
  await loadComputers();
}
function closePcView() { S.pcOpen = null; pcVncClose(); $("#pcview-modal").classList.add("hidden"); }
function renderPcView() {
  const c = S.pcs.computers.find((x) => x.id === S.pcOpen); if (!c) return closePcView();
  const on = ["running", "ready"].includes(c.status);
  $("#pcv-name").innerHTML = `${esc(c.name)} ${pcSt(c)}`;
  $("#pcv-sub").textContent = `Linux · ${c.cpus} CPU · ${c.memory} GB · 创建于 ${fmtDate(c.createdAt)}`;
  $("#pcv-power").innerHTML = on ? `${icon("stop")}关机` : `${icon("play2")}开机`;
  $("#pcv-power").dataset.op = on ? "stop" : "start";
  $("#pcv-power").disabled = ["starting", "setting_up"].includes(c.status);
  $("#pcv-tabs").innerHTML = [["desktop", "桌面"], ["console", "终端"], ["ports", "端口"], ["tasks", "任务"], ["settings", "设置"]].map(([k, l]) => `<button class="lib-tab ${S.pcTab === k ? "on" : ""}" data-pcv-tab="${k}">${l}</button>`).join("");
  const body = $("#pcv-body"), tasks = (S.pcs.tasks[c.id] || []).map((id) => S.sessions.find((x) => x.id === id)).filter(Boolean);
  if (S.pcTab !== "desktop") pcVncClose();
  if (S.pcTab === "desktop") {
    if (!on) { body.innerHTML = `<div class="pc-empty" style="height:420px">${icon("monitor")}<span>${c.status === "setting_up" ? "正在安装模板所需的软件…" : c.status === "starting" ? "正在开机…" : "电脑已关机，点击右上角「开机」"}</span></div>`; return; }
    if (!pcRfb) {
      body.innerHTML = `<div class="pcv-screen" id="pcv-screen"></div><div class="muted" style="font-size:12px;padding:6px 2px">可以直接操作这台电脑的桌面；Agent 在这台电脑上运行任务时，画面也会显示在这里。</div>`;
      (async () => {
        try { RFB = RFB || (await import(NOVNC)).default; } catch { body.innerHTML = `<div class="pc-empty">无法加载远程桌面组件</div>`; return; }
        if (S.pcOpen !== c.id || S.pcTab !== "desktop") return;
        pcRfb = new RFB($("#pcv-screen"), `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/computers/${c.id}/vnc`, { wsProtocols: ["binary"] });
        pcRfb.scaleViewport = true; pcRfb.background = "transparent";
        pcRfb.addEventListener("disconnect", () => { pcRfb = null; if (S.pcOpen === c.id && S.pcTab === "desktop") $("#pcv-screen") && ($("#pcv-screen").innerHTML = `<div class="pc-empty" style="height:400px">桌面连接已断开</div>`); });
      })();
    }
    return;
  }
  if (S.pcTab === "console") {
    if (!$("#pcv-out")) body.innerHTML = `<div class="term pcv-term" id="pcv-out">${c.setupLog ? esc(c.setupLog) + "\n" : ""}</div><form id="pcv-cmd-form" class="pcv-cmd"><span>$</span><input id="pcv-cmd" placeholder="${on ? "输入命令，回车执行" : "电脑已关机"}" ${on ? "" : "disabled"} autocomplete="off" /></form>`;
    return;
  }
  if (S.pcTab === "ports") {
    body.innerHTML = `<p class="auto-intro" style="margin:4px 0 12px">开放端口后，这台电脑上监听该端口的服务会获得一个固定地址，任何拿到链接的人都能访问。</p>` +
      (c.ports.length ? c.ports.map((p, i) => `<div class="hook-url"><span class="lib-tag">${p.port}</span><code>${esc(p.url)}</code><a class="btn ghost sm" href="${esc(p.url)}" target="_blank">${icon("external")}打开</a><button class="icon-btn sm" data-pcv-rmport="${i}" title="关闭端口">${icon("x")}</button></div>`).join("") : `<div class="muted">还没有开放端口</div>`) +
      `<form class="pcv-cmd" id="pcv-port-form" style="margin-top:14px"><input id="pcv-port" type="number" min="1" max="65535" placeholder="端口号，例如 3000" /><button class="btn primary sm">开放端口</button></form><div class="sched-err" id="pcv-port-err"></div>`;
    return;
  }
  if (S.pcTab === "tasks") {
    body.innerHTML = `<div style="margin:4px 0 12px"><button class="btn primary sm" data-pc-task="${esc(c.id)}">${icon("newTask")}在这台电脑上新建任务</button></div>` +
      (tasks.length ? tasks.map((x) => `<div class="session-item" data-goto="${esc(x.id)}"><span class="s-ico">${icon("message")}</span><span class="s-title">${esc(x.title)}</span></div>`).join("") : `<div class="muted">还没有任务</div>`);
    return;
  }
  body.innerHTML = `<form id="pcv-settings" class="sched-body" style="padding:4px 0"><label>名称<input name="name" value="${esc(c.name)}" /></label>` +
    `<label>空闲时自动关机<select name="autoStop">${[[0, "从不（始终在线）"], [30, "空闲 30 分钟后"], [60, "空闲 1 小时后"], [120, "空闲 2 小时后"]].map(([v, l]) => `<option value="${v}" ${c.autoStop === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>` +
    `<div class="cc-actions" style="padding:0"><button type="button" class="btn ghost danger" id="pcv-del">${icon("trash")}删除这台电脑</button><span class="spacer"></span><button class="btn primary">保存</button></div></form>`;
}
async function pcCall(op) {
  const c = S.pcs.computers.find((x) => x.id === S.pcOpen); if (!c) return;
  const r = await fetch(`/api/computers/${c.id}/${op}`, { method: "POST" });
  if (!r.ok) alert((await r.json().catch(() => ({}))).detail || "操作失败");
  pcVncClose(); await loadComputers();
}
function newTaskOn(id) { closePcView(); goHome(); S.target = id; renderAttachments(); $("#input").focus(); }

// ------------------------------------------------------------------ creations (创作) ---
const CR_KINDS = { website: ["网站", "globe"], game: ["游戏", "gamepad"], app: ["移动应用", "phone"] };
async function openCreations() {
  if (S.current) send({ type: "leave_session", sessionId: S.current });
  S.current = null; resetSession(); S.view = "creations";
  history.replaceState(null, "", "#creations");
  renderSessions(); await loadSites();
}
async function loadSites() { try { S.sites = await (await fetch("/api/sites")).json(); } catch { S.sites = []; } scheduleRender(); }
function renderCreations() {
  const n = (k) => S.sites.filter((x) => k === "all" || x.kind === k).length;
  $("#cr-tabs").innerHTML = [["all", "全部"], ...Object.entries(CR_KINDS).map(([k, [l]]) => [k, l])].map(([k, l]) => `<button class="lib-tab ${S.crTab === k ? "on" : ""}" data-crtab="${k}">${l}<span>${n(k)}</span></button>`).join("");
  const rows = S.sites.filter((x) => S.crTab === "all" || x.kind === S.crTab);
  $("#cr-list").innerHTML = rows.length ? `<div class="cr-grid">${rows.map((x) => {
    const [label, ic] = CR_KINDS[x.kind] || CR_KINDS.website;
    const sess = S.sessions.find((y) => y.id === x.sessionId);
    const versions = x.versions.length > 1 ? `<select class="cr-ver" data-site="${esc(x.id)}" title="版本">${[...x.versions].reverse().map((v) => `<option value="${v.n}" ${v.n === x.current ? "selected" : ""}>v${v.n} · ${esc(fmtDate(v.at))}</option>`).join("")}</select>` : `<span class="lib-tag">v${x.current}</span>`;
    return `<div class="cr-card"><a class="cr-thumb" href="${esc(x.url)}" target="_blank">${x.thumbUrl ? `<img src="${esc(x.thumbUrl)}?v=${x.current}" alt="" loading="lazy" />` : icon(ic)}</a>` +
      `<div class="cr-body"><div class="cr-title"><span class="grow">${esc(x.title)}</span><span class="lib-tag">${icon(ic)}${label}</span></div>` +
      `<div class="cr-url"><a href="${esc(x.url)}" target="_blank">${esc(x.url.replace(/^https?:\/\//, ""))}</a><button class="icon-btn sm" data-cr="copy" data-site="${esc(x.id)}" title="复制链接">${icon("copy")}</button></div>` +
      `<div class="auto-foot"><div class="auto-runs">${sess ? `<a href="#${esc(x.sessionId)}" data-goto="${esc(x.sessionId)}">${icon("message")}${esc(sess.title)}</a>` : ""}<span>更新于 ${esc(fmtDate(x.updatedAt))}</span></div>${versions}` +
      `<button class="icon-btn sm" data-cr="del" data-site="${esc(x.id)}" title="下线并删除">${icon("trash")}</button></div></div></div>`;
  }).join("")}</div>` : `<div class="lib-empty">${icon("sparkBox")}<div>还没有创作内容</div><div class="muted">让 OpenManus 做一个网站、小游戏或应用，发布后会出现在这里，并有一个固定的访问地址</div></div>`;
}
async function crAction(op, id, el) {
  const x = S.sites.find((y) => y.id === id); if (!x) return;
  if (op === "copy") { try { await navigator.clipboard.writeText(x.url); el.innerHTML = icon("check"); } catch { /* ignore */ } return; }
  if (op === "del") { if (!confirm(`下线「${x.title}」？链接将失效，所有版本都会删除。`)) return; await fetch(`/api/sites/${id}`, { method: "DELETE" }); }
  if (op === "version") await fetch(`/api/sites/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current: +el.value }) });
  loadSites();
}

// ------------------------------------------------------------------ plugins (插件) ---
async function openPlugins() {
  if (S.current) send({ type: "leave_session", sessionId: S.current });
  S.current = null; resetSession(); S.view = "plugins";
  history.replaceState(null, "", "#plugins");
  renderSessions(); await loadPlugins();
}
async function loadPlugins() { try { S.plugins = await (await fetch("/api/plugins")).json(); } catch { /* keep */ } scheduleRender(); }
const plugLogo = (p) => `<span class="plug-logo" style="background:${esc(p.color)}">${esc(p.name.replace(/^[^\p{L}\p{N}]+/u, "").slice(0, 1).toUpperCase())}</span>`;
function plugState(p) {
  const c = p.connector;
  if (!c) return `<button class="btn ghost sm" data-plug="${esc(p.id)}">${icon("plus")}连接</button>`;
  const [cls, label] = c.status === "connected" ? ["ok", "已连接"] : c.status === "error" ? ["err", "连接失败"] : !c.enabled ? ["", "已停用"] : ["", "连接中"];
  return `<span class="conn-st ${cls}" title="${c.status === "connected" ? `${c.tools} 个工具` : ""}"><i></i>${label}</span>`;
}
function renderPlugins() {
  const { plugins, categories } = S.plugins;
  $("#plug-cats").innerHTML = [["all", "全部"], ["installed", "已连接"], ...categories.map((c) => [c, c])].map(([k, l]) => `<button class="lib-tab ${S.plugCat === k ? "on" : ""}" data-plugcat="${esc(k)}">${l}</button>`).join("");
  const rows = plugins.filter((p) => S.plugCat === "all" || (S.plugCat === "installed" ? p.connector : p.category === S.plugCat));
  $("#plug-list").innerHTML = rows.map((p) => `<div class="sk-card plug-card" data-plug="${esc(p.id)}"><div class="sk-top">${plugLogo(p)}<div class="sk-title">${esc(p.name)}<div class="sk-name">${esc(p.category)} · ${p.transport === "stdio" ? "本地运行" : "远程服务"}${p.fields.some((f) => f.required) ? "" : " · 免密钥"}</div></div>${plugState(p)}</div><div class="sk-desc">${esc(p.description)}</div></div>`).join("")
    || `<div class="lib-empty">${icon("puzzle")}<div>还没有已连接的插件</div></div>`;
}
function openPlugin(id) {
  const p = S.plugins.plugins.find((x) => x.id === id); if (!p) return;
  S.plugOpen = p;
  $("#plug-m-logo").outerHTML = plugLogo(p).replace('class="plug-logo"', 'class="plug-logo" id="plug-m-logo"');
  $("#plug-m-name").textContent = p.name;
  $("#plug-m-sub").innerHTML = `${esc(p.category)} · ${p.transport === "stdio" ? "在 OpenManus 服务器上运行" : "远程 MCP 服务"} · <a href="${esc(p.docs)}" target="_blank">文档</a>`;
  const c = p.connector;
  $("#plug-m-body").innerHTML = `<div class="sk-desc full">${esc(p.description)}</div>` +
    (c ? `<div class="check-row ${c.status === "connected" ? "met" : ""}">${plugState(p)}${c.status === "error" ? `<span class="muted">可在「管理连接器」中查看错误详情</span>` : ""}</div>` : "") +
    p.fields.map((f) => `<label>${esc(f.label)}<input name="${esc(f.key)}" type="${f.secret ? "password" : "text"}" placeholder="${esc(c && f.secret ? "已保存，留空则需重新填写" : f.placeholder)}" ${f.required ? "required" : ""} />${f.help ? `<span class="muted" style="font-size:12px">${esc(f.help)}</span>` : ""}</label>`).join("") +
    (p.fields.length ? "" : `<div class="muted" style="font-size:13px">无需配置，点击「连接」即可使用。</div>`) +
    `<div class="sched-err" id="plug-err"></div>`;
  $("#plug-connect").textContent = c ? "重新连接" : "连接";
  $("#plug-remove").classList.toggle("hidden", !c);
  $("#plug-modal").classList.remove("hidden");
}
async function connectPlugin(e) {
  e.preventDefault();
  const p = S.plugOpen, btn = $("#plug-connect");
  const values = Object.fromEntries(p.fields.map((f) => [f.key, e.target[f.key].value]));
  btn.disabled = true; btn.innerHTML = `<span class="spin">${icon("loader")}</span>连接中`; $("#plug-err").textContent = "";
  const r = await fetch(`/api/plugins/${p.id}/install`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values }) });
  btn.disabled = false; btn.textContent = "连接";
  const j = await r.json().catch(() => ({}));
  await loadPlugins();
  if (!r.ok) { $("#plug-err").textContent = j.detail || "连接失败"; return; }
  if (j.status === "error") { openPlugin(p.id); $("#plug-err").textContent = `已保存，但连接失败：${j.error}`; return; }
  $("#plug-modal").classList.add("hidden");
}

// ------------------------------------------------------------------ share (read-only replay) ---
const shareUrl = (token) => `${location.origin}${location.pathname}#share/${token}`;
function showShareLink(token) {
  S.shareToken = token;
  $("#share-link").value = shareUrl(token);
  $("#share-link-row").classList.remove("hidden");
  $("#share-create").classList.add("hidden");
  $("#share-revoke").classList.remove("hidden");
  $("#share-copy").textContent = "复制";
}
async function openShareDialog() {
  $("#share-err").textContent = "";
  $("#share-link-row").classList.add("hidden"); $("#share-create").classList.remove("hidden"); $("#share-revoke").classList.add("hidden");
  $("#share-modal").classList.remove("hidden");
  const meta = S.sessions.find((x) => x.id === S.current);
  if (meta?.shared || S.shareToken) {
    const r = await fetch(`/api/sessions/${S.current}/share`, { method: "POST" }); // idempotent: returns the existing token
    if (r.ok) showShareLink((await r.json()).token);
  }
}

let replayTimer = null;
async function openShare(token) {
  S.readonly = true; S.shareToken = token;
  document.body.classList.add("share-mode");
  S.current = `share:${token}`; S.view = "session";
  resetSession();
  let data;
  try { const r = await fetch(`/api/share/${token}`); if (!r.ok) throw new Error(); data = await r.json(); }
  catch { $("#thread").innerHTML = `<div class="lib-empty">${icon("alert")}<div>分享链接不存在或已被取消</div></div>`; $("#scroller").classList.remove("hidden"); return; }
  S.shareData = data;
  loadShareEvents(data.events);
  $("#thread").insertAdjacentHTML("afterbegin", shareBarHtml());
}
function shareBarHtml() {
  return `<div class="share-bar" id="share-bar">${icon("share")}<span>这是一个 OpenManus 任务的只读回放</span><span class="spacer"></span>` +
    `<button class="btn ghost sm" id="replay-btn">${icon("play2")}回放</button><button class="btn ghost sm" id="share-bar-copy">${icon("copy")}复制链接</button></div>`;
}
function loadShareEvents(events) {
  S.replaying = true;
  events.forEach(apply);
  S.replaying = false; S.title = S.shareData.title; S.status = S.shareData.status; S.plan = S.shareData.plan || [];
  S.modelSel = S.shareData.model?.mode ? S.shareData.model : defaultSel(); // the task's own mode, not the viewer's
  scheduleRender(true);
}
function replayShare() {
  clearTimeout(replayTimer);
  const evs = S.shareData.events;
  resetSession(); S.status = "running";
  $("#thread").innerHTML = shareBarHtml();
  S.panel.open = window.innerWidth >= 1100;
  let i = 0;
  const step = () => {
    if (i >= evs.length) { S.status = S.shareData.status; S.clockNow = null; scheduleRender(); return; }
    const ev = evs[i++];
    S.clockNow = ev.timestamp;
    apply(ev);
    const gap = i < evs.length ? evs[i].timestamp - ev.timestamp : 0;
    replayTimer = setTimeout(step, Math.max(60, Math.min(gap, 900)));
  };
  step();
}

// ------------------------------------------------------------------ modes & Flex (Manus' mode selector) ---
// Max / standard / Lite run on the gateway; Flex runs on any configured provider with your own key.
const defaultSel = () => ({ mode: S.models.default || "standard" });
function currentSel() { return S.modelSel || defaultSel(); }
function selLabel(sel = currentSel()) {
  if (sel.mode === "flex") return `Flex · ${shortModel(sel.model || providerInfo(sel.provider)?.model || "")}`;
  return S.models.modes.find((m) => m.id === sel.mode)?.label || "OpenManus";
}
function modelBadge(sel = currentSel()) {
  if (sel.mode === "flex") return shortModel(sel.model || providerInfo(sel.provider)?.model || "");
  return shortModel(S.models.modes.find((m) => m.id === sel.mode)?.model || S.cfg.model || "");
}
const providerInfo = (id) => (id === "litellm" ? { id, label: "LiteLLM 网关", configured: true, model: S.cfg.model } : S.models.providers.find((p) => p.id === id));

async function loadModels() {
  try { S.models = await (await fetch("/api/models")).json(); } catch { /* keep defaults */ }
  if (!S.current) { try { const saved = JSON.parse(store.get("model-sel", "null")); if (saved?.mode) S.modelSel = saved; } catch { /* ignore */ } }
  renderModeButton();
}

function renderModeButton() {
  $("#mode-label").textContent = selLabel();
  const menu = $("#mode-menu");
  menu.classList.toggle("hidden", !S.modeMenu);
  if (!S.modeMenu) return;
  const cur = currentSel();
  menu.innerHTML = S.models.modes.map((m) => {
    const on = cur.mode === m.id;
    const sub = m.id === "flex" && cur.mode === "flex" ? `${providerInfo(cur.provider)?.label || ""} · ${cur.model || ""}` : m.description;
    return `<div class="mode-item ${on ? "on" : ""}" data-mode="${esc(m.id)}"><div class="mode-text"><div class="mode-name">${esc(m.label)}${m.badge ? `<span class="badge">${esc(m.badge)}</span>` : ""}</div>` +
      `<div class="mode-desc">${esc(sub)}</div>${m.model && m.id !== "flex" ? `<div class="mode-model">${esc(shortModel(m.model))}</div>` : ""}</div>` +
      (m.id === "flex" ? `<button class="mode-set" data-flex-settings="1">设置</button>` : "") + (on ? icon("check") : "") + `</div>`;
  }).join("");
}

function setSel(sel) {
  S.modelSel = sel;
  if (!S.current) store.set("model-sel", JSON.stringify(sel));
  S.modeMenu = false;
  renderModeButton();
  S.turns.forEach((t) => S.dirty.add(t)); scheduleRender();
}

function openFlex() {
  S.modeMenu = false; renderModeButton();
  const f = $("#flex-form");
  const opts = [["litellm", "LiteLLM 网关（已配置）"], ...S.models.providers.map((p) => [p.id, p.label + (p.configured ? " ✓" : "")])];
  $("#flex-provider").innerHTML = opts.map(([id, label]) => `<option value="${esc(id)}">${esc(label)}</option>`).join("");
  const cur = currentSel();
  f.provider.value = cur.mode === "flex" && cur.provider ? cur.provider : (S.models.providers.find((p) => p.configured)?.id || "litellm");
  syncFlex(cur.mode === "flex" ? cur.model : "");
  $("#flex-modal").classList.remove("hidden");
}
async function syncFlex(model = "") {
  const f = $("#flex-form"), pid = f.provider.value, p = providerInfo(pid);
  const gw = pid === "litellm";
  $("#flex-key-row").classList.toggle("hidden", gw);
  $("#flex-base-row").classList.toggle("hidden", gw || !["custom", "fireworks", "openrouter"].includes(pid) && !!p?.baseUrl);
  f.apiKey.value = ""; f.apiKey.placeholder = p?.keyHint ? `已保存（${p.keyHint}），留空则沿用` : "sk-...";
  f.baseUrl.value = p?.baseUrl || "";
  f.model.value = model || p?.model || "";
  $("#flex-err").textContent = "";
  $("#flex-remove").classList.toggle("hidden", gw || !p?.configured);
  $("#flex-connect").textContent = gw || p?.configured ? "使用" : "连接";
  let list = gw ? S.models.gatewayModels : [];
  if (!gw && p?.configured) { try { const r = await fetch(`/api/providers/${pid}/models`); if (r.ok) list = await r.json(); } catch { /* offline */ } }
  $("#flex-models").innerHTML = list.map((m) => `<option value="${esc(m)}"></option>`).join("");
}
async function saveFlex(e) {
  e.preventDefault();
  const f = e.target, pid = f.provider.value, btn = $("#flex-connect");
  $("#flex-err").textContent = "";
  if (pid !== "litellm" && (f.apiKey.value || f.baseUrl.value !== (providerInfo(pid)?.baseUrl || "") || !providerInfo(pid)?.configured)) {
    btn.disabled = true; btn.textContent = "连接中…";
    const r = await fetch(`/api/providers/${pid}`, { method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: f.apiKey.value, baseUrl: f.baseUrl.value, model: f.model.value }) });
    btn.disabled = false; btn.textContent = "连接";
    if (!r.ok) { $("#flex-err").textContent = (await r.json().catch(() => ({}))).detail || "连接失败"; return; }
    const info = await r.json();
    if (!f.model.value) f.model.value = info.model;
    await loadModels();
  }
  if (!f.model.value.trim()) { $("#flex-err").textContent = "请选择或填写模型"; return; }
  $("#flex-modal").classList.add("hidden");
  setSel({ mode: "flex", provider: pid, model: f.model.value.trim() });
}

// ------------------------------------------------------------------ sessions / nav ---
async function refreshSessions() {
  try { S.sessions = await (await fetch("/api/sessions")).json(); } catch { return; }
  renderSessions();
}
function renderSessions() {
  const q = S.filter.trim().toLowerCase();
  const list = S.sessions.filter((s) => !q || String(s.title).toLowerCase().includes(q));
  $("#session-list").innerHTML = list.map((s) => `<div class="session-item ${s.id === S.current ? "active" : ""}" data-id="${esc(s.id)}">` +
    `<span class="s-ico">${s.status === "running" ? icon("loader", "spin-i") : icon(s.status === "error" ? "alert" : s.scheduleId ? "clock" : s.triggerId ? "zap" : "message")}</span>` +
    `<span class="s-title">${esc(s.title)}</span><button class="s-more" data-del="${esc(s.id)}" title="删除">${icon("trash")}</button></div>`).join("") ||
    `<div class="session-empty">${q ? "没有匹配的任务" : "暂无任务"}</div>`;
  $("#session-list").querySelectorAll(".spin-i").forEach((n) => (n.style.animation = "spin 1s linear infinite"));
}

// ------------------------------------------------------------------ library (资料库) ---
// Every file kept outside the sandboxes (deliverables, files the agent wrote, uploads), across tasks.
// Manus' 资料库 categories
const LIB_TABS = [["all", "全部"], ["doc", "文本和 PDF"], ["slides", "幻灯片"], ["sheet", "表格"], ["image", "图片"], ["video", "视频"], ["audio", "音频"], ["other", "其他"]];
function fileKind(name) {
  const e = ext(name);
  if (IMG.has(e)) return "image";
  if (["md", "markdown", "txt", "pdf", "docx", "doc", "rtf", "html"].includes(e)) return "doc";
  if (["pptx", "ppt", "key"].includes(e) || /slides?\.html$/i.test(name)) return "slides";
  if (["csv", "xlsx", "xls", "tsv", "numbers"].includes(e)) return "sheet";
  if (["mp4", "mov", "webm", "mkv", "avi"].includes(e)) return "video";
  if (["mp3", "wav", "m4a", "ogg", "flac", "aac"].includes(e)) return "audio";
  return "other";
}
const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const fmtDate = (sec) => new Date(sec * 1000).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

async function openLibrary() {
  if (S.current) send({ type: "leave_session", sessionId: S.current });
  S.current = null; resetSession(); S.view = "library";
  history.replaceState(null, "", "#library");
  renderSessions();
  try { S.library = await (await fetch("/api/library")).json(); } catch { S.library = []; }
  scheduleRender();
}

function renderLibrary() {
  const q = S.libQuery.trim().toLowerCase();
  const counts = Object.fromEntries(LIB_TABS.map(([k]) => [k, 0]));
  S.library.forEach((f) => { counts.all++; counts[fileKind(f.filename)]++; });
  $("#lib-tabs").innerHTML = LIB_TABS.map(([k, label]) =>
    `<button class="lib-tab ${S.libFilter === k ? "on" : ""}" data-tab="${k}">${label}<span>${counts[k]}</span></button>`).join("");
  const rows = S.library.filter((f) => (S.libFilter === "all" || fileKind(f.filename) === S.libFilter) &&
    (!q || f.filename.toLowerCase().includes(q) || String(f.sessionTitle).toLowerCase().includes(q)));
  $("#lib-list").innerHTML = rows.length ? rows.map((f, i) => {
    const [ic, cls] = fileIconCls(f.filename);
    const tag = f.kinds.includes("deliverable") ? "交付" : f.kinds.includes("upload") ? "上传" : "生成";
    return `<div class="lib-row" data-lib="${S.library.indexOf(f)}"><span class="fc-ico ${cls}">${icon(ic)}</span>` +
      `<div class="lib-main"><div class="lib-name">${esc(f.filename)}<span class="lib-tag">${tag}</span></div>` +
      `<div class="lib-sub"><a href="#${esc(f.sessionId)}" data-goto="${esc(f.sessionId)}">${icon("message")}${esc(f.sessionTitle)}</a><span>${fmtSize(f.size)}</span><span>${fmtDate(f.updatedAt)}</span></div></div>` +
      `<a class="icon-btn" href="${esc(f.url)}" download="${esc(f.filename)}" title="下载">${icon("download")}</a></div>`;
  }).join("") : `<div class="lib-empty">${icon("folder")}<div>${S.library.length ? "没有匹配的文件" : "还没有文件"}</div><div class="muted">任务中生成、交付和上传的文件都会保存在这里</div></div>`;
}

function openViewer(f) {
  const [ic, cls] = fileIconCls(f.filename);
  $("#viewer-ico").className = `fc-ico ${cls}`; $("#viewer-ico").innerHTML = icon(ic);
  $("#viewer-name").textContent = f.filename;
  $("#viewer-sub").textContent = `${f.sessionTitle} · ${fmtSize(f.size)} · ${fmtDate(f.updatedAt)}`;
  $("#viewer-dl").href = f.url; $("#viewer-dl").setAttribute("download", f.filename);
  $("#viewer").classList.remove("hidden");
  const body = $("#viewer-body");
  body.innerHTML = `<div class="pc-empty" style="height:200px"><span class="shimmer">加载中</span></div>`;
  S.viewing = f;
  renderFileBody({ url: f.url, name: f.filename, path: f.path }, body, () => S.viewing === f);
}
function closeViewer() { $("#viewer").classList.add("hidden"); S.viewing = null; }

// ------------------------------------------------------------------ skills (技能) ---
const SK_SRC = { official: "官方", personal: "个人", github: "第三方" };
const skillTitle = (n) => S.skills.skills.find((x) => x.name === n)?.title || n;
async function loadSkills() { try { S.skills = await (await fetch("/api/skills")).json(); } catch { /* keep */ } }
async function openSkills(tab) {
  if (S.current) send({ type: "leave_session", sessionId: S.current });
  S.current = null; resetSession(); S.view = "skills"; if (tab) S.skTab = tab;
  history.replaceState(null, "", "#skills");
  renderSessions(); $("#sk-err").textContent = "";
  await loadSkills(); scheduleRender();
}
function skCardHtml(x, kind) {
  const cats = (x.categories || []).map((c) => `<span class="lib-tag">${esc(c)}</span>`).join("");
  const meta = kind === "catalog" ? `<span>${icon("github")}${esc(x.author)}</span>` : `<span>${esc(x.author || SK_SRC[x.source])}</span>${x.uses ? `<span>已使用 ${x.uses} 次</span>` : ""}`;
  let act;
  if (kind === "catalog") act = x.installed ? `<span class="sk-added">${icon("check")}已添加</span>` : `<button class="btn ghost sm" data-sk="install" data-url="${esc(x.url)}">${icon("plus")}添加</button>`;
  else if (kind === "explore") act = x.enabled ? `<span class="sk-added">${icon("check")}已添加</span>` : `<button class="btn ghost sm" data-sk="enable" data-name="${esc(x.name)}">${icon("plus")}添加</button>`;
  else act = `<button class="switch ${x.enabled ? "on" : ""}" data-sk="toggle" data-name="${esc(x.name)}" title="${x.enabled ? "停用" : "启用"}"><i></i></button>`;
  return `<div class="sk-card ${kind === "mine" && !x.enabled ? "off" : ""}" ${kind !== "catalog" ? `data-sk-open="${esc(x.name)}"` : ""}>` +
    `<div class="sk-top"><span class="auto-ico">${icon(kind === "catalog" || x.source === "github" ? "github" : "spark")}</span><div class="sk-title">${esc(x.title || x.name)}<div class="sk-name">${esc(x.name)}</div></div>${act}</div>` +
    `<div class="sk-desc">${esc(x.summary || x.description)}</div><div class="sk-meta">${meta}<span class="spacer"></span>${cats}</div></div>`;
}
function renderSkills() {
  const { skills, catalog, categories } = S.skills;
  $("#sk-mine").classList.toggle("on", S.skTab === "mine");
  $("#sk-tabs").innerHTML = [["explore", "探索技能"], ["mine", "我的技能"]].map(([k, l]) => `<button class="lib-tab ${S.skTab === k ? "on" : ""}" data-sktab="${k}">${l}</button>`).join("");
  const catOk = (x) => S.skCat === "all" || (x.categories || []).includes(S.skCat);
  if (S.skTab === "explore") {
    $("#sk-cats").innerHTML = [["all", "全部"], ...categories.map((c) => [c, c])].map(([k, l]) => `<button class="lib-tab ${S.skCat === k ? "on" : ""}" data-skcat="${esc(k)}">${l}</button>`).join("");
    const off = skills.filter((x) => x.source === "official" && catOk(x)), cat = catalog.filter(catOk);
    $("#sk-list").innerHTML = (off.length ? `<div class="nav-section" style="padding-left:0">官方技能</div><div class="sk-grid">${off.map((x) => skCardHtml(x, "explore")).join("")}</div>` : "") +
      (cat.length ? `<div class="nav-section" style="padding-left:0">社区技能 · 来自 GitHub</div><div class="sk-grid">${cat.map((x) => skCardHtml(x, "catalog")).join("")}</div>` : "") ||
      `<div class="lib-empty">${icon("spark")}<div>该分类下还没有技能</div></div>`;
  } else {
    const count = (k) => skills.filter((x) => (k === "all" ? x.enabled || x.source !== "official" : x.source === k)).length;
    $("#sk-cats").innerHTML = [["all", "全部"], ["personal", "个人"], ["official", "官方"], ["github", "第三方"]].map(([k, l]) => `<button class="lib-tab ${S.skSrc === k ? "on" : ""}" data-sksrc="${k}">${l}<span>${count(k)}</span></button>`).join("");
    const rows = skills.filter((x) => (S.skSrc === "all" ? x.enabled || x.source !== "official" : x.source === S.skSrc));
    $("#sk-list").innerHTML = rows.length ? `<div class="sk-grid">${rows.map((x) => skCardHtml(x, "mine")).join("")}</div>`
      : `<div class="lib-empty">${icon("spark")}<div>尚无技能</div><div class="muted">点击右上角「创建」，或在「探索技能」中添加</div></div>`;
  }
}
async function skAction(op, b) {
  $("#sk-err").textContent = "";
  if (op === "toggle" || op === "enable") {
    const x = S.skills.skills.find((k) => k.name === b.dataset.name);
    await fetch(`/api/skills/${b.dataset.name}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: op === "enable" || !x.enabled }) });
  }
  if (op === "install") {
    b.disabled = true; b.innerHTML = `<span class="spin">${icon("loader")}</span>添加中`;
    const r = await fetch("/api/skills/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: b.dataset.url }) });
    if (!r.ok) $("#sk-err").textContent = (await r.json().catch(() => ({}))).detail || "添加失败";
  }
  await loadSkills(); renderSkills();
}
async function openSkill(name) {
  const r = await fetch(`/api/skills/${name}`); if (!r.ok) return;
  const x = await r.json(); S.skillView = x;
  $("#sk-m-title").textContent = x.title || x.name;
  $("#sk-m-sub").textContent = [SK_SRC[x.source], x.author, x.uses ? `已使用 ${x.uses} 次` : "", x.repo || ""].filter(Boolean).join(" · ");
  $("#sk-m-edit").classList.toggle("hidden", !x.editable);
  $("#sk-m-actions").classList.add("hidden");
  const files = x.files.length > 1 ? `<div class="mcp-label">文件</div><div class="tool-chips">${x.files.map((f) => `<span class="tool-chip">${esc(f)}</span>`).join("")}</div>` : "";
  $("#sk-m-body").innerHTML = `<div class="sk-desc full">${esc(x.summary || x.description)}</div>${x.summary && x.summary !== x.description ? `<div class="muted" style="font-size:12px">触发条件：${esc(x.description)}</div>` : ""}${files}<div class="mcp-label">SKILL.md</div><div class="page-md sk-md"><div class="prose">${md(x.content)}</div></div>` +
    `<div class="cc-actions" style="padding:0"><button class="btn ghost sm" data-sk-use="${esc(x.name)}">${icon("play2")}在新任务中使用</button><span class="spacer"></span>` +
    (x.source === "official" ? "" : `<button class="btn ghost sm danger" data-sk-del="${esc(x.name)}">${icon("trash")}删除</button>`) + `</div>`;
  $("#skill-modal").classList.remove("hidden");
}
function editSkill() {
  const x = S.skillView;
  $("#sk-m-body").innerHTML = `<textarea id="sk-m-text" class="code-edit" rows="22" spellcheck="false">${esc(x.content)}</textarea>`;
  $("#sk-m-actions").classList.remove("hidden"); $("#sk-m-err").textContent = ""; $("#sk-m-edit").classList.add("hidden");
}
async function saveSkillEdit() {
  const r = await fetch(`/api/skills/${S.skillView.name}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: $("#sk-m-text").value }) });
  if (!r.ok) { $("#sk-m-err").textContent = (await r.json().catch(() => ({}))).detail || "保存失败"; return; }
  await loadSkills(); renderSkills(); openSkill(S.skillView.name);
}
function useSkill(name) {
  $("#skill-modal").classList.add("hidden");
  goHome(); S.pickedSkills = [name]; renderAttachments(); $("#input").focus();
}
function openSkillNew(kind) {
  const f = $("#sk-new-form"); f.reset(); f.dataset.kind = kind;
  $("#sk-new-title").textContent = kind === "github" ? "从 GitHub 导入技能" : "手动编写技能";
  $("#sk-new-write").classList.toggle("hidden", kind !== "write"); $("#sk-new-github").classList.toggle("hidden", kind !== "github");
  $("#sk-new-cats").innerHTML = `<span class="muted" style="font-size:13px">分类</span>` + S.skills.categories.map((c) => `<label class="check"><input type="checkbox" value="${esc(c)}" />${esc(c)}</label>`).join("");
  $("#sk-new-save").textContent = kind === "github" ? "导入" : "保存"; $("#sk-new-err").textContent = "";
  $("#skill-new-modal").classList.remove("hidden");
}
async function saveSkillNew(e) {
  e.preventDefault();
  const f = e.target, kind = f.dataset.kind, btn = $("#sk-new-save");
  const body = kind === "github" ? { url: f.url.value } : { title: f.title.value, name: f.name.value || f.title.value, description: f.description.value, body: f.body.value,
    categories: [...document.querySelectorAll("#sk-new-cats input:checked")].map((n) => n.value) };
  btn.disabled = true; const label = btn.textContent; btn.textContent = kind === "github" ? "导入中…" : "保存中…";
  const r = await fetch(kind === "github" ? "/api/skills/import" : "/api/skills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  btn.disabled = false; btn.textContent = label;
  if (!r.ok) { $("#sk-new-err").textContent = (await r.json().catch(() => ({}))).detail || "保存失败"; return; }
  const x = await r.json();
  $("#skill-new-modal").classList.add("hidden");
  S.skTab = "mine"; S.skSrc = "all"; await loadSkills(); renderSkills(); openSkill(x.name);
}
function renderSkillPick() {
  const list = S.skills.skills.filter((x) => x.enabled || S.pickedSkills.includes(x.name));
  $("#skill-pick").innerHTML = list.map((x) => `<label class="mode-item"><input type="checkbox" data-pick="${esc(x.name)}" ${S.pickedSkills.includes(x.name) ? "checked" : ""} /><span class="grow">${esc(x.title)}<span class="muted"> ${esc(x.name)}</span></span></label>`).join("") +
    `<button type="button" class="mode-item muted" id="pick-manage">${icon("spark")}管理技能</button>`;
}

// ------------------------------------------------------------------ personalization (个性化) ---
async function loadPersonal() {
  try { S.personal = await (await fetch("/api/personalization")).json(); } catch { /* keep */ }
}
async function openPersonal(tab) {
  if (S.current) send({ type: "leave_session", sessionId: S.current });
  S.current = null; resetSession(); S.view = "personal"; S.persTab = tab || S.persTab;
  history.replaceState(null, "", "#personal");
  renderSessions();
  await loadPersonal();
  fillProfile();
  scheduleRender();
}
function fillProfile() {
  const f = $("#pers-profile");
  ["nickname", "occupation", "about"].forEach((k) => (f[k].value = S.personal.profile?.[k] || ""));
  f.instructions.value = S.personal.instructions || "";
  syncCounts();
}
function syncCounts() { const f = $("#pers-profile"); f.querySelectorAll("[data-count]").forEach((n) => (n.textContent = `${f[n.dataset.count].value.length} / ${f[n.dataset.count].maxLength}`)); }
function renderPersonal() {
  document.querySelectorAll("#pers-tabs [data-ptab]").forEach((b) => b.classList.toggle("on", b.dataset.ptab === S.persTab));
  $("#pers-profile").classList.toggle("hidden", S.persTab !== "profile");
  $("#pers-knowledge").classList.toggle("hidden", S.persTab !== "knowledge");
  const pend = S.personal.knowledge.filter((k) => k.pending).length;
  $("#pers-tabs [data-ptab=knowledge]").innerHTML = `知识${S.personal.knowledge.length ? `<span>${S.personal.knowledge.length}</span>` : ""}${pend ? `<i class="dot"></i>` : ""}`;
  if (S.persTab !== "knowledge") return;
  const row = (k) => `<div class="auto-card ${k.enabled && !k.pending ? "" : "off"}"><div class="auto-top"><span class="auto-ico">${icon("brain")}</span><div class="auto-main">` +
    `<div class="auto-title">${esc(k.title)}${k.pending ? '<span class="lib-tag">待确认</span>' : ""}${k.source === "agent" ? '<span class="lib-tag">任务中提议</span>' : k.source === "import" ? '<span class="lib-tag">导入</span>' : ""}</div>` +
    `<div class="auto-when">${esc(k.content)}</div></div>` +
    (k.pending ? `<button class="btn ghost sm" data-know="dismiss" data-id="${esc(k.id)}">忽略</button><button class="btn primary sm" data-know="accept" data-id="${esc(k.id)}">记住</button>`
      : `<button class="switch ${k.enabled ? "on" : ""}" data-know="toggle" data-id="${esc(k.id)}" title="${k.enabled ? "停用" : "启用"}"><i></i></button>`) + `</div>` +
    `<div class="auto-foot"><div class="auto-runs">${k.sessionId ? `<a href="#${esc(k.sessionId)}" data-goto="${esc(k.sessionId)}">${icon("message")}来源任务</a>` : ""}<span>${fmtDate(k.createdAt)}</span></div>` +
    `<button class="icon-btn sm" data-know="edit" data-id="${esc(k.id)}" title="编辑">${icon("pencil")}</button><button class="icon-btn sm" data-know="del" data-id="${esc(k.id)}" title="删除">${icon("trash")}</button></div></div>`;
  const list = S.personal.knowledge;
  $("#know-list").innerHTML = list.length ? [...list.filter((k) => k.pending), ...list.filter((k) => !k.pending)].map(row).join("")
    : `<div class="lib-empty">${icon("brain")}<div>还没有知识</div><div class="muted">添加你希望 OpenManus 长期记住的事实和偏好</div></div>`;
}
async function knowAction(op, id) {
  const k = S.personal.knowledge.find((x) => x.id === id);
  if (op === "manage") return openPersonal("knowledge");
  if (op === "edit") return openKnowForm(k);
  if (op === "accept") await fetch(`/api/knowledge/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accept: true }) });
  if (op === "toggle") await fetch(`/api/knowledge/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !k.enabled }) });
  if (op === "dismiss" || op === "del") {
    if (op === "del" && !confirm(`删除知识「${k?.title}」？`)) return;
    await fetch(`/api/knowledge/${id}`, { method: "DELETE" });
  }
  await loadPersonal();
  S.steps.forEach((s) => { if (s.detail?.knowledge?.id === id) s.detail.knowledge._seen = true; });
  S.turns.forEach((t) => S.dirty.add(t)); scheduleRender();
}
function openKnowForm(k) {
  S.editingKnow = k || null;
  const f = $("#know-form"); f.reset();
  $("#know-form-title").textContent = k ? "编辑知识" : "添加知识"; $("#know-err").textContent = "";
  if (k) { f.title.value = k.title; f.content.value = k.content; }
  $("#know-modal").classList.remove("hidden"); f.content.focus();
}
async function saveKnow(e) {
  e.preventDefault();
  const f = e.target, body = { title: f.title.value, content: f.content.value };
  const r = await fetch(S.editingKnow ? `/api/knowledge/${S.editingKnow.id}` : "/api/knowledge",
    { method: S.editingKnow ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) { $("#know-err").textContent = (await r.json().catch(() => ({}))).detail || "保存失败"; return; }
  $("#know-modal").classList.add("hidden");
  await loadPersonal(); scheduleRender();
}
async function saveProfile(e) {
  e.preventDefault();
  const f = e.target;
  const body = { profile: { nickname: f.nickname.value, occupation: f.occupation.value, about: f.about.value }, instructions: f.instructions.value };
  const r = await fetch("/api/personalization", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (r.ok) { S.personal = await r.json(); $("#pers-saved").textContent = "已保存"; setTimeout(() => ($("#pers-saved").textContent = ""), 1800); renderMe(); }
}
// Import another assistant's memory: the model extracts a profile and knowledge items; the user reviews them first.
async function runImport() {
  const btn = $("#import-run");
  if (S.importDraft) return applyImport();
  $("#import-err").textContent = "";
  btn.disabled = true; btn.textContent = "解析中…";
  const r = await fetch("/api/personalization/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: $("#import-text").value }) });
  btn.disabled = false; btn.textContent = "解析";
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { $("#import-err").textContent = j.detail || "解析失败"; return; }
  S.importDraft = j;
  const prof = [["昵称", j.nickname], ["职业", j.occupation], ["关于你", j.about]].filter(([, v]) => v);
  $("#import-result").innerHTML = `<div class="import-review"><div class="mcp-label">将填入个人资料（只覆盖空白项）</div>${prof.map(([k, v]) => `<div><b>${k}</b>：${esc(v)}</div>`).join("") || '<div class="muted">没有识别到个人资料</div>'}` +
    `<div class="mcp-label">将添加 ${j.knowledge.length} 条知识</div>${j.knowledge.map((k, i) => `<label class="check"><input type="checkbox" data-imp="${i}" checked />${esc(k.title)}：${esc(k.content)}</label>`).join("")}</div>`;
  btn.textContent = "导入";
}
async function applyImport() {
  const j = S.importDraft, cur = S.personal.profile || {};
  const profile = {};
  if (j.nickname && !cur.nickname) profile.nickname = j.nickname;
  if (j.occupation && !cur.occupation) profile.occupation = j.occupation;
  if (j.about && !cur.about) profile.about = j.about;
  if (Object.keys(profile).length) await fetch("/api/personalization", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile }) });
  for (const n of document.querySelectorAll("[data-imp]:checked")) {
    const k = j.knowledge[+n.dataset.imp];
    await fetch("/api/knowledge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...k, source: "import" }) });
  }
  closeImport();
  await openPersonal(Object.keys(profile).length ? "profile" : "knowledge");
  renderMe();
}
function closeImport() { $("#import-modal").classList.add("hidden"); S.importDraft = null; $("#import-result").innerHTML = ""; $("#import-text").value = ""; $("#import-run").textContent = "解析"; }
function renderMe() {
  const nick = S.personal.profile?.nickname;
  $(".me-name").textContent = nick || "OpenManus";
  $(".me .avatar").textContent = (nick || "O").slice(0, 1).toUpperCase();
}

// ------------------------------------------------------------------ automations (自动化) ---
const fmtTs = (sec) => (sec ? new Date(sec * 1000).toLocaleString("zh-CN", { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" }) : "—");

async function openAutomations(tab) {
  if (S.current) send({ type: "leave_session", sessionId: S.current });
  S.current = null; resetSession(); S.view = "automations"; if (tab) S.autoTab = tab;
  history.replaceState(null, "", "#automations");
  renderSessions();
  await loadSchedules();
}
async function loadSchedules() {
  const get = async (u, d) => { try { return await (await fetch(u)).json(); } catch { return d; } };
  [S.schedules, S.triggers, S.activity] = await Promise.all([get("/api/schedules", []), get("/api/triggers", []), get("/api/automations/activity", [])]);
  scheduleRender();
}
// While a condition check runs, refresh the automation page so its result shows up.
setInterval(() => { if (S.view === "automations" && S.triggers.some((t) => t.checking)) loadSchedules(); }, 3000);

const ago = (sec) => { const m = Math.round((Date.now() / 1000 - sec) / 60); return m < 1 ? "刚刚" : m < 60 ? `${m} 分钟前` : m < 1440 ? `${Math.round(m / 60)} 小时前` : fmtTs(sec); };
function trigCardHtml(t, actions = true) {
  const kindIco = t.kind === "webhook" ? "webhook" : "zap";
  const last = (t.checks || [])[0];
  const body = t.kind === "webhook"
    ? `<div class="hook-url"><code>${esc(t.url)}</code>${actions ? `<button class="btn ghost sm" data-trig="copy" data-id="${esc(t.id)}">${icon("copy")}复制</button>` : ""}</div>` +
      (actions ? `<details class="hook-help"><summary>如何调用</summary><pre class="cc-cmd">curl -X POST ${esc(t.url)} \\\n  -H 'Content-Type: application/json' \\\n  -d '{"event": "示例", "detail": "..."}'</pre></details>` : "")
    : `<div class="auto-prompt"><b>条件</b>　${esc(t.condition)}</div>` +
      (t.checking ? `<div class="check-row"><span class="spin">${icon("loader")}</span>正在检查…</div>` : last ? `<div class="check-row ${last.met ? "met" : ""}">${icon(last.met ? "check" : "clock")}${esc(ago(last.at))}检查：${last.met ? "条件满足，已运行" : "未满足"} · ${esc(last.summary)}</div>` : "");
  const runs = (t.runs || []).slice(0, 3).map((id) => { const sess = S.sessions.find((x) => x.id === id); return `<a href="#${esc(id)}" data-goto="${esc(id)}">${icon("message")}${esc(sess?.title || id)}</a>`; }).join("");
  return `<div class="auto-top"><span class="auto-ico">${icon(kindIco)}</span><div class="auto-main"><div class="auto-title">${esc(t.title)}</div><div class="auto-when">${esc(t.description)}${t.enabled ? "" : " · 已暂停"}</div></div>` +
    (actions ? `<button class="switch ${t.enabled ? "on" : ""}" data-trig="toggle" data-id="${esc(t.id)}" title="${t.enabled ? "暂停" : "启用"}"><i></i></button>` : "") + `</div>` +
    body + `<div class="auto-prompt"><b>执行</b>　${esc(t.prompt)}</div>` +
    (actions ? `<div class="auto-foot"><div class="auto-runs">${runs ? `<span>最近运行</span>${runs}` : `<span>还没有运行过</span>`}</div>` +
      (t.kind === "condition" ? `<button class="btn ghost sm" data-trig="check" data-id="${esc(t.id)}" ${t.checking ? "disabled" : ""}>${icon("search")}立即检查</button>` : "") +
      `<button class="btn ghost sm" data-trig="fire" data-id="${esc(t.id)}">${icon("play2")}试运行</button>` +
      `<button class="icon-btn sm" data-trig="edit" data-id="${esc(t.id)}" title="编辑">${icon("pencil")}</button>` +
      `<button class="icon-btn sm" data-trig="del" data-id="${esc(t.id)}" title="删除">${icon("trash")}</button></div>` : "");
}
const SRC_ICO = { schedule: "clock", webhook: "webhook", condition: "zap", trigger: "zap" };
function activityHtml() {
  if (!S.activity.length) return `<div class="lib-empty">${icon("clock")}<div>还没有自动运行记录</div><div class="muted">定时任务到点运行、触发器触发或条件检查后，会按时间显示在这里</div></div>`;
  let day = "", h = "";
  for (const a of S.activity) {
    const d = new Date(a.at * 1000).toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "short" });
    if (d !== day) { day = d; h += `<div class="nav-section" style="padding-left:0">${esc(d)}</div>`; }
    const lead = a.type === "check" ? "条件检查：未满足" : { schedule: "已到达预定时间", webhook: "收到 Webhook 事件", condition: "条件满足" }[a.source.kind] || "自动运行";
    const st = a.type === "run" ? ({ running: "运行中", waiting: "等待你的回复", error: "出错", stopped: "已停止" }[a.status] || "已完成") : "";
    h += `<div class="act-row ${a.type}"><span class="act-time">${fmtTime(a.at * 1000)}</span><span class="act-ico">${icon(SRC_ICO[a.source.kind] || "zap")}</span><div class="act-main">` +
      `<div><b>${esc(a.source.title)}</b><span class="muted"> · ${esc(lead)}</span>${st ? `<span class="lib-tag">${esc(st)}</span>` : ""}</div>` +
      (a.type === "run" ? `<a href="#${esc(a.sessionId)}" data-goto="${esc(a.sessionId)}" class="act-link">${icon("message")}${esc(a.title)}</a>` : `<div class="muted act-sum">${esc(a.summary)}</div>`) +
      (a.files?.length ? `<div class="act-files">${a.files.map((f) => `<a class="chip-file" href="${esc(f.url)}" target="_blank">${icon("fileText")}<span>${esc(f.filename)}</span></a>`).join("")}</div>` : "") + `</div></div>`;
  }
  return h;
}
function openTrigForm(t, preset = {}) {
  S.editingTrig = t || null;
  const f = $("#trig-form"); f.reset();
  $("#trig-form-title").textContent = t ? "编辑触发器" : "新建触发器"; $("#trig-err").textContent = "";
  const v = t || preset;
  if (v.kind) f.kind.value = v.kind;
  f.kind.disabled = !!t;
  ["title", "prompt", "condition"].forEach((k) => { if (v[k]) f[k].value = v[k]; });
  if (v.everyMinutes) f.everyMinutes.value = Math.max(10, v.everyMinutes);
  syncTrigFields();
  $("#trig-modal").classList.remove("hidden");
}
function syncTrigFields() { const k = $("#trig-form").kind.value; $("#trig-form").querySelectorAll("[data-for]").forEach((n) => n.classList.toggle("hidden", n.dataset.for !== k)); }
async function saveTrig(e) {
  e.preventDefault();
  const f = e.target;
  const body = { kind: f.kind.value, title: f.title.value.trim() || f.prompt.value.trim().slice(0, 30), prompt: f.prompt.value, condition: f.condition.value, everyMinutes: +f.everyMinutes.value };
  const r = await fetch(S.editingTrig ? `/api/triggers/${S.editingTrig.id}` : "/api/triggers",
    { method: S.editingTrig ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) { $("#trig-err").textContent = (await r.json().catch(() => ({}))).detail || "保存失败"; return; }
  $("#trig-modal").classList.add("hidden"); $("#nl-text").value = "";
  S.autoTab = "triggers"; loadSchedules();
}
async function trigAction(a, id, btn) {
  const t = S.triggers.find((x) => x.id === id);
  if (!t) return;
  if (a === "copy") { try { await navigator.clipboard.writeText(t.url); btn.lastChild.textContent = "已复制"; } catch { /* ignore */ } return; }
  if (a === "edit") return openTrigForm(t);
  if (a === "toggle") await fetch(`/api/triggers/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !t.enabled }) });
  if (a === "del") { if (!confirm(`删除触发器「${t.title}」？已运行的任务会保留。`)) return; await fetch(`/api/triggers/${id}`, { method: "DELETE" }); }
  if (a === "check") { t.checking = true; renderAutomations(); await fetch(`/api/triggers/${id}/check`, { method: "POST" }); }
  if (a === "fire") { const r = await (await fetch(`/api/triggers/${id}/fire`, { method: "POST" })).json(); await refreshSessions(); openSession(r.sessionId); return; }
  loadSchedules();
}
// 高级自动化: describe it in your own words; the model proposes a schedule or trigger for the user to confirm.
async function parseAutomation(e) {
  e.preventDefault();
  const text = $("#nl-text").value.trim(); if (!text) return;
  const btn = $("#nl-go"); btn.disabled = true; btn.textContent = "理解中…"; $("#nl-err").textContent = "";
  const r = await fetch("/api/automations/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  btn.disabled = false; btn.textContent = "创建";
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { $("#nl-err").textContent = j.detail || "解析失败"; return; }
  if (j.type === "schedule") {
    openSchedForm(null);
    const f = $("#sched-form"), sc = j.schedule || {};
    f.title.value = j.title || ""; f.prompt.value = j.prompt || text;
    if (sc.kind) f.kind.value = sc.kind;
    if (sc.time) f.time.value = sc.time;
    if (sc.weekday !== undefined) f.weekday.value = sc.weekday;
    if (sc.everyMinutes) f.everyMinutes.value = sc.everyMinutes;
    if (sc.at) f.at.value = String(sc.at).slice(0, 16);
    syncSchedFields();
  } else openTrigForm(null, { kind: j.type, title: j.title, prompt: j.prompt || text, condition: j.condition, everyMinutes: j.everyMinutes || 60 });
}

function autoCardHtml(s, actions = true) {
  const runs = (s.runs || []).slice(0, 3).map((id) => {
    const sess = S.sessions.find((x) => x.id === id);
    return `<a href="#${esc(id)}" data-goto="${esc(id)}">${icon("message")}${esc(sess?.title || id)}</a>`;
  }).join("");
  return `<div class="auto-top"><span class="auto-ico">${icon("clock")}</span><div class="auto-main"><div class="auto-title">${esc(s.title)}</div>` +
    `<div class="auto-when">${esc(s.description)}${s.enabled ? ` · 下次运行 ${fmtTs(s.nextRunAt)}` : " · 已暂停"}</div></div>` +
    (actions ? `<button class="switch ${s.enabled ? "on" : ""}" data-sched="toggle" data-id="${esc(s.id)}" title="${s.enabled ? "暂停" : "启用"}"><i></i></button>` : "") + `</div>` +
    `<div class="auto-prompt">${esc(s.prompt)}</div>` +
    (actions ? `<div class="auto-foot"><div class="auto-runs">${runs ? `<span>最近运行</span>${runs}` : `<span>还没有运行过</span>`}</div>` +
      `<button class="btn ghost sm" data-sched="run" data-id="${esc(s.id)}">${icon("play2")}立即运行</button>` +
      `<button class="icon-btn sm" data-sched="edit" data-id="${esc(s.id)}" title="编辑">${icon("pencil")}</button>` +
      `<button class="icon-btn sm" data-sched="del" data-id="${esc(s.id)}" title="删除">${icon("trash")}</button></div>` : "");
}

function renderAutomations() {
  $("#auto-tabs").innerHTML = [["activity", "动态"], ["schedules", `定时任务<span>${S.schedules.length}</span>`], ["triggers", `触发器<span>${S.triggers.length}</span>`]]
    .map(([k, l]) => `<button class="lib-tab ${S.autoTab === k ? "on" : ""}" data-autotab="${k}">${l}</button>`).join("");
  if (S.autoTab === "activity") { $("#auto-list").innerHTML = activityHtml(); return; }
  if (S.autoTab === "triggers") {
    $("#auto-list").innerHTML = S.triggers.length ? S.triggers.map((t) => `<div class="auto-card ${t.enabled ? "" : "off"}">${trigCardHtml(t)}</div>`).join("")
      : `<div class="lib-empty">${icon("zap")}<div>还没有触发器</div><div class="muted">选择一个事件，并定义它发生时 OpenManus 应执行的操作：条件满足时，或外部系统发来 Webhook 时</div></div>`;
    return;
  }
  $("#auto-list").innerHTML = S.schedules.length ? S.schedules.map((s) => `<div class="auto-card ${s.enabled ? "" : "off"}">${autoCardHtml(s)}</div>`).join("")
    : `<div class="lib-empty">${icon("clock")}<div>还没有定时任务</div><div class="muted">选择运行的时间和频率，让重复性工作自动完成；也可以在对话中让 OpenManus 帮你创建</div></div>`;
}

function openSchedForm(s) {
  S.editing = s || null;
  const f = $("#sched-form");
  f.reset();
  $("#sched-form-title").textContent = s ? "编辑定时任务" : "新建定时任务";
  $("#sched-err").textContent = "";
  if (s) {
    f.title.value = s.title; f.prompt.value = s.prompt; f.kind.value = s.schedule.kind;
    if (s.schedule.time) f.time.value = s.schedule.time;
    if (s.schedule.weekday !== undefined) f.weekday.value = s.schedule.weekday;
    if (s.schedule.everyMinutes) f.everyMinutes.value = s.schedule.everyMinutes;
    if (s.schedule.at) f.at.value = s.schedule.at;
  } else {
    const t = new Date(Date.now() + 3600e3); t.setMinutes(0, 0, 0);
    f.at.value = new Date(t - t.getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
  }
  syncSchedFields();
  $("#sched-modal").classList.remove("hidden");
  f.prompt.focus();
}
function syncSchedFields() {
  const kind = $("#sched-form").kind.value;
  $("#sched-form").querySelectorAll("[data-for]").forEach((n) => n.classList.toggle("hidden", !n.dataset.for.split(" ").includes(kind)));
}
async function saveSched(e) {
  e.preventDefault();
  const f = e.target;
  const kind = f.kind.value;
  const schedule = { kind };
  if (kind === "once") schedule.at = f.at.value;
  if (kind === "interval") schedule.everyMinutes = +f.everyMinutes.value;
  if (kind === "daily" || kind === "weekly") schedule.time = f.time.value;
  if (kind === "weekly") schedule.weekday = +f.weekday.value;
  const body = { title: f.title.value.trim() || f.prompt.value.trim().slice(0, 30), prompt: f.prompt.value, schedule };
  const r = await fetch(S.editing ? `/api/schedules/${S.editing.id}` : "/api/schedules",
    { method: S.editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) { $("#sched-err").textContent = (await r.json().catch(() => ({}))).detail || "保存失败"; return; }
  $("#sched-modal").classList.add("hidden");
  if (S.view === "automations") { S.autoTab = "schedules"; $("#nl-text").value = ""; }
  loadSchedules();
}
async function schedAction(a, id) {
  const s = S.schedules.find((x) => x.id === id);
  if (!s) return;
  if (a === "toggle") await fetch(`/api/schedules/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !s.enabled }) });
  if (a === "del") { if (!confirm(`删除定时任务「${s.title}」？已运行的任务会保留。`)) return; await fetch(`/api/schedules/${id}`, { method: "DELETE" }); }
  if (a === "edit") return openSchedForm(s);
  if (a === "run") { const r = await (await fetch(`/api/schedules/${id}/run`, { method: "POST" })).json(); await refreshSessions(); openSession(r.sessionId); return; }
  loadSchedules();
}

function openSession(sid) {
  S.view = sid ? "session" : "home";
  try { S.modelSel = sid ? null : JSON.parse(store.get("model-sel", "null")); } catch { S.modelSel = null; }
  if (S.current && S.current !== sid) send({ type: "leave_session", sessionId: S.current });
  S.current = sid; S.lastSeq[sid] = -1;
  history.replaceState(null, "", sid ? `#${sid}` : "#");
  resetSession();
  if (sid) join(sid);
  renderSessions();
  scheduleRender(true);
}
function goHome() { openSession(null); $("#input").focus(); }

async function ensureSession() {
  if (S.current) return S.current;
  const projectId = S.view === "project" ? S.projectId : null; // a task started from a project page joins it
  const s = await (await fetch("/api/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, computerId: S.target }) })).json();
  S.target = null;
  S.sessions.unshift(s);
  openSession(s.id);
  return s.id;
}

// ------------------------------------------------------------------ composer ---
async function submit(text) {
  text = text.trim();
  if (!text && S.status === "running") { send({ type: "stop_session", sessionId: S.current }); return; }
  if (!text) return;
  const sel = currentSel(); // creating the session resets the view, keep the chosen mode
  const sid = await ensureSession();
  S.modelSel = sel;
  await new Promise((r) => setTimeout(r, 60));
  send({ type: "user_message", sessionId: sid, content: text, attachments: S.attachments.map((a) => a.path), model: sel, skills: S.pickedSkills });
  S.attachments = []; S.pickedSkills = []; renderAttachments();
  $("#input").value = ""; autoGrow(); stickBottom = true;
  renderComposerState();
}
function autoGrow() { const i = $("#input"); i.style.height = "auto"; i.style.height = Math.min(i.scrollHeight, 240) + "px"; }
function renderAttachments() {
  const pc = S.target && S.pcs.computers.find((c) => c.id === S.target);
  $("#attach-list").innerHTML = (pc ? `<span class="chip-file target">${icon("monitor")}<span>在「${esc(pc.name)}」上运行</span><button type="button" data-rmtarget="1">${icon("x")}</button></span>` : "") + S.pickedSkills.map((n) => `<span class="chip-file skill">${icon("spark")}<span>${esc(skillTitle(n))}</span><button type="button" data-rmskill="${esc(n)}">${icon("x")}</button></span>`).join("") + S.attachments.map((a, i) => `<span class="chip-file">${icon("paperclip")}<span>${esc(a.name)}</span><button type="button" data-rm="${i}">${icon("x")}</button></span>`).join("");
}

// ------------------------------------------------------------------ theme ---
const THEMES = ["auto", "light", "dark"];
function applyTheme(t) {
  if (t === "auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", t);
  const b = $("#theme-btn"); b.innerHTML = icon({ auto: "auto", light: "sun", dark: "moon" }[t]);
  b.title = { auto: "主题：跟随系统", light: "主题：浅色", dark: "主题：深色" }[t];
}

// ------------------------------------------------------------------ events ---
function bind() {
  $("#composer").onsubmit = (e) => { e.preventDefault(); submit($("#input").value); };
  $("#input").addEventListener("input", () => { autoGrow(); renderComposerState(); });
  $("#input").onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); if ($("#input").value.trim()) submit($("#input").value); } };
  $("#attach-list").onclick = (e) => {
    if (e.target.closest("[data-rmtarget]")) { S.target = null; renderAttachments(); return; }
    const k = e.target.closest("[data-rmskill]"); if (k) { S.pickedSkills = S.pickedSkills.filter((n) => n !== k.dataset.rmskill); renderAttachments(); return; }
    const b = e.target.closest("[data-rm]"); if (b) { S.attachments.splice(+b.dataset.rm, 1); renderAttachments(); }
  };
  $("#plus-btn").onclick = (e) => { e.stopPropagation(); $("#plus-menu").classList.toggle("hidden"); $("#skill-pick").classList.add("hidden"); };
  $("#plus-skills").onclick = async (e) => { e.stopPropagation(); await loadSkills(); renderSkillPick(); $("#skill-pick").classList.toggle("hidden"); };
  $("#plus-menu").onclick = (e) => e.stopPropagation();
  $("#plus-target").onclick = async (e) => {
    e.stopPropagation(); await loadComputers();
    $("#target-pick").innerHTML = `<label class="mode-item"><input type="radio" name="tgt" value="" ${S.target ? "" : "checked"} /><span class="grow">云沙箱<span class="muted"> 每个任务独立</span></span></label>` +
      S.pcs.computers.map((c) => `<label class="mode-item"><input type="radio" name="tgt" value="${esc(c.id)}" ${S.target === c.id ? "checked" : ""} /><span class="grow">${esc(c.name)}<span class="muted"> ${esc((PC_ST[c.status] || [, ""])[1])}</span></span></label>`).join("") +
      `<button type="button" class="mode-item muted" id="tgt-manage">${icon("plus")}创建云电脑</button>`;
    $("#target-pick").classList.toggle("hidden");
  };
  $("#target-pick").onchange = (e) => { if (e.target.name === "tgt") { S.target = e.target.value || null; renderAttachments(); } };
  $("#target-pick").onclick = (e) => { if (e.target.closest("#tgt-manage")) { $("#plus-menu").classList.add("hidden"); openComputers(); } };
  $("#skill-pick").onchange = (e) => { const n = e.target.dataset.pick; if (!n) return; S.pickedSkills = e.target.checked ? [...S.pickedSkills, n] : S.pickedSkills.filter((x) => x !== n); renderAttachments(); };
  $("#skill-pick").onclick = (e) => { if (e.target.closest("#pick-manage")) { $("#plus-menu").classList.add("hidden"); openSkills("mine"); } };
  document.addEventListener("click", () => $("#plus-menu").classList.add("hidden"));
  $("#file-input").onchange = async (e) => {
    const sid = await ensureSession();
    for (const f of e.target.files) {
      const fd = new FormData(); fd.append("file", f);
      const r = await fetch(`/api/sessions/${sid}/upload`, { method: "POST", body: fd });
      if (r.ok) { const j = await r.json(); S.attachments.push({ name: f.name, path: j.path }); } else alert(`上传失败：${await r.text()}`);
    }
    e.target.value = ""; renderAttachments(); $("#plus-menu").classList.add("hidden");
  };

  const newTask = () => goHome();
  $("#new-task").onclick = newTask; $("#new-task-2").onclick = newTask;
  $("#nav-library").onclick = openLibrary;
  $("#thread").addEventListener("click", (e) => {
    if (e.target.closest("#replay-btn")) replayShare();
    if (e.target.closest("#share-bar-copy")) navigator.clipboard?.writeText(location.href).then(() => (e.target.closest("button").lastChild.textContent = "已复制"));
  });
  $("#nav-conn").onclick = openPlugins;
  $("#nav-create").onclick = openCreations;
  $("#nav-pc").onclick = openComputers;
  $("#pc-new").onclick = () => openPcNew();
  $("#pc-templates").onclick = (e) => { const t = e.target.closest("[data-pc-tpl]"); if (t) openPcNew(t.dataset.pcTpl); };
  $("#pc-mine").onclick = (e) => { const t = e.target.closest("[data-pc-task]"); if (t) { e.stopPropagation(); return newTaskOn(t.dataset.pcTask); } const c = e.target.closest("[data-pc]"); if (c) openPcView(c.dataset.pc, "desktop"); };
  $("#pcnew-form").onsubmit = savePcNew;
  $("#pcnew-form").template.onchange = syncPcNew;
  $("#pcnew-close").onclick = $("#pcnew-cancel").onclick = () => $("#pcnew-modal").classList.add("hidden");
  $("#pcv-close").onclick = closePcView;
  $("#pcv-power").onclick = (e) => pcCall(e.currentTarget.dataset.op);
  $("#pcv-tabs").onclick = (e) => { const b = e.target.closest("[data-pcv-tab]"); if (b) { S.pcTab = b.dataset.pcvTab; $("#pcv-body").innerHTML = ""; renderPcView(); } };
  $("#pcv-body").addEventListener("click", async (e) => {
    const t = e.target.closest("[data-pc-task]"); if (t) return newTaskOn(t.dataset.pcTask);
    const g = e.target.closest("[data-goto]"); if (g) { closePcView(); openSession(g.dataset.goto); return; }
    const c = S.pcs.computers.find((x) => x.id === S.pcOpen);
    const rm = e.target.closest("[data-pcv-rmport]");
    if (rm && c) { const ports = c.ports.filter((_, i) => i !== +rm.dataset.pcvRmport); await fetch(`/api/computers/${c.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ports }) }); loadComputers(); }
    if (e.target.closest("#pcv-del") && c && confirm(`删除「${c.name}」？电脑上的所有文件都会被清除，相关任务会保留。`)) { await fetch(`/api/computers/${c.id}`, { method: "DELETE" }); closePcView(); loadComputers(); }
  });
  $("#pcv-body").addEventListener("submit", async (e) => {
    e.preventDefault();
    const c = S.pcs.computers.find((x) => x.id === S.pcOpen); if (!c) return;
    if (e.target.id === "pcv-cmd-form") {
      const inp = $("#pcv-cmd"), cmd = inp.value.trim(); if (!cmd) return; inp.value = ""; inp.disabled = true;
      const out = $("#pcv-out");
      const r = await fetch(`/api/computers/${c.id}/exec`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command: cmd }) });
      const j = await r.json().catch(() => ({}));
      out.insertAdjacentHTML("beforeend", esc(r.ok ? j.output : `错误：${j.detail}`) + "\n"); out.scrollTop = out.scrollHeight;
      inp.disabled = false; inp.focus();
    }
    if (e.target.id === "pcv-port-form") {
      const port = +$("#pcv-port").value; if (!port) return;
      const r = await fetch(`/api/computers/${c.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ports: [...c.ports.map(({ port, label }) => ({ port, label })), { port }] }) });
      if (!r.ok) { $("#pcv-port-err").textContent = (await r.json().catch(() => ({}))).detail || "开放失败"; return; }
      loadComputers();
    }
    if (e.target.id === "pcv-settings") {
      await fetch(`/api/computers/${c.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: e.target.name.value, autoStop: +e.target.autoStop.value }) });
      loadComputers();
    }
  });
  $("#cr-tabs").onclick = (e) => { const b = e.target.closest("[data-crtab]"); if (b) { S.crTab = b.dataset.crtab; renderCreations(); } };
  $("#cr-list").onclick = (e) => {
    const g = e.target.closest("[data-goto]"); if (g) { e.preventDefault(); openSession(g.dataset.goto); return; }
    const b = e.target.closest("[data-cr]"); if (b) crAction(b.dataset.cr, b.dataset.site, b);
  };
  $("#cr-list").onchange = (e) => { if (e.target.matches(".cr-ver")) crAction("version", e.target.dataset.site, e.target); };
  $("#cr-build").onclick = () => { goHome(); $("#input").value = "帮我做一个网站："; autoGrow(); renderComposerState(); $("#input").focus(); };
  $("#conn-back").onclick = openPlugins;
  $("#plug-manage").onclick = openConnectors;
  $("#plug-create").onclick = () => openConnForm(null);
  $("#plug-cats").onclick = (e) => { const b = e.target.closest("[data-plugcat]"); if (b) { S.plugCat = b.dataset.plugcat; renderPlugins(); } };
  $("#plug-list").onclick = (e) => { const b = e.target.closest("[data-plug]"); if (b) openPlugin(b.dataset.plug); };
  $("#plug-form").onsubmit = connectPlugin;
  $("#plug-close").onclick = $("#plug-cancel").onclick = () => $("#plug-modal").classList.add("hidden");
  $("#plug-remove").onclick = async () => {
    const c = S.plugOpen?.connector; if (!c || !confirm(`断开「${S.plugOpen.name}」并删除其配置？`)) return;
    await fetch(`/api/connectors/${c.id}`, { method: "DELETE" }); $("#plug-modal").classList.add("hidden"); loadPlugins();
  };
  $("#new-project").onclick = async () => {
    const name = prompt("项目名称"); if (!name?.trim()) return;
    const r = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    if (r.ok) { const p = await r.json(); await loadProjects(); openProject(p.id); }
  };
  $("#project-list").onclick = (e) => { const it = e.target.closest("[data-project]"); if (it) openProject(it.dataset.project); };
  $("#proj-tasks").onclick = (e) => { const it = e.target.closest("[data-id]"); if (it) openSession(it.dataset.id); };
  $("#proj-name").onchange = (e) => saveProject({ name: e.target.value });
  $("#proj-instr").onchange = (e) => saveProject({ instructions: e.target.value });
  $("#proj-del").onclick = async () => { if (!confirm("删除该项目？项目中的任务会保留。")) return; await fetch(`/api/projects/${S.projectId}`, { method: "DELETE" }); await loadProjects(); goHome(); };
  $("#proj-upload").onchange = async (e) => {
    for (const f of e.target.files) { const fd = new FormData(); fd.append("file", f); await fetch(`/api/projects/${S.projectId}/files`, { method: "POST", body: fd }); }
    e.target.value = ""; await loadProjects(); scheduleRender();
  };
  $("#proj-files").onclick = async (e) => { const b = e.target.closest("[data-rmfile]"); if (!b) return; await fetch(`/api/projects/${S.projectId}/files/${encodeURIComponent(b.dataset.rmfile)}`, { method: "DELETE" }); await loadProjects(); scheduleRender(); };
  $("#conn-new").onclick = () => openConnForm(null);
  $("#conn-list").onclick = (e) => { const b = e.target.closest("[data-conn]"); if (b) connAction(b.dataset.conn, b.dataset.id); };
  $("#conn-form").onsubmit = saveConn;
  $("#conn-form").transport.onchange = syncConnFields;
  $("#conn-close").onclick = $("#conn-cancel").onclick = () => $("#conn-modal").classList.add("hidden");
  $("#mode-btn").onclick = (e) => { e.stopPropagation(); S.modeMenu = !S.modeMenu; renderModeButton(); };
  $("#mode-menu").onclick = (e) => {
    e.stopPropagation();
    if (e.target.closest("[data-flex-settings]")) return openFlex();
    const it = e.target.closest("[data-mode]");
    if (!it) return;
    if (it.dataset.mode !== "flex") return setSel({ mode: it.dataset.mode });
    const cur = currentSel();
    if (cur.mode === "flex") return (S.modeMenu = false, renderModeButton());
    const p = S.models.providers.find((x) => x.configured);
    if (p) setSel({ mode: "flex", provider: p.id, model: p.model }); else openFlex();
  };
  document.addEventListener("click", () => { if (S.modeMenu) { S.modeMenu = false; renderModeButton(); } });
  $("#flex-form").onsubmit = saveFlex;
  $("#flex-provider").onchange = () => syncFlex();
  $("#flex-close").onclick = $("#flex-cancel").onclick = () => $("#flex-modal").classList.add("hidden");
  $("#flex-remove").onclick = async () => {
    const pid = $("#flex-form").provider.value;
    if (!confirm("移除该提供商的密钥？")) return;
    await fetch(`/api/providers/${pid}`, { method: "DELETE" });
    await loadModels(); syncFlex();
    if (currentSel().provider === pid) setSel(defaultSel());
  };
  $("#nav-auto").onclick = openAutomations;
  $("#nav-more").onclick = (e) => { e.stopPropagation(); $("#more-menu").classList.toggle("hidden"); };
  $("#more-menu").onclick = (e) => { const b = e.target.closest("[data-goto-view]"); if (!b) return; $("#more-menu").classList.add("hidden"); if (b.dataset.gotoView === "personal") openPersonal(); if (b.dataset.gotoView === "skills") openSkills(); };
  $("#sk-tabs").onclick = (e) => { const b = e.target.closest("[data-sktab]"); if (b) { S.skTab = b.dataset.sktab; renderSkills(); } };
  $("#sk-mine").onclick = () => { S.skTab = "mine"; renderSkills(); };
  $("#sk-cats").onclick = (e) => { const b = e.target.closest("[data-skcat],[data-sksrc]"); if (!b) return; if (b.dataset.skcat) S.skCat = b.dataset.skcat; else S.skSrc = b.dataset.sksrc; renderSkills(); };
  $("#sk-list").onclick = (e) => { const b = e.target.closest("[data-sk]"); if (b) { e.stopPropagation(); skAction(b.dataset.sk, b); return; } const c = e.target.closest("[data-sk-open]"); if (c) openSkill(c.dataset.skOpen); };
  $("#sk-create").onclick = (e) => { e.stopPropagation(); $("#sk-create-menu").classList.toggle("hidden"); };
  $("#sk-create-menu").onclick = (e) => {
    const b = e.target.closest("[data-sk-new]"); if (!b) return;
    $("#sk-create-menu").classList.add("hidden");
    if (b.dataset.skNew === "agent") { goHome(); S.pickedSkills = ["skill-creator"]; renderAttachments(); $("#input").value = "帮我创建一个技能："; autoGrow(); renderComposerState(); $("#input").focus(); return; }
    openSkillNew(b.dataset.skNew);
  };
  $("#sk-upload").onchange = async (e) => {
    $("#sk-create-menu").classList.add("hidden");
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    const fd = new FormData(); fd.append("file", f);
    const r = await fetch("/api/skills/upload", { method: "POST", body: fd });
    if (!r.ok) { $("#sk-err").textContent = (await r.json().catch(() => ({}))).detail || "上传失败"; return; }
    const x = await r.json(); S.skTab = "mine"; S.skSrc = "all"; await loadSkills(); renderSkills(); openSkill(x.name);
  };
  $("#sk-new-form").onsubmit = saveSkillNew;
  $("#sk-new-close").onclick = $("#sk-new-cancel").onclick = () => $("#skill-new-modal").classList.add("hidden");
  $("#sk-m-close").onclick = () => $("#skill-modal").classList.add("hidden");
  $("#sk-m-edit").onclick = editSkill;
  $("#sk-m-cancel").onclick = () => openSkill(S.skillView.name);
  $("#sk-m-save").onclick = saveSkillEdit;
  $("#sk-m-body").onclick = async (e) => {
    const u = e.target.closest("[data-sk-use]"); if (u) return useSkill(u.dataset.skUse);
    const d = e.target.closest("[data-sk-del]");
    if (d && confirm(`删除技能「${S.skillView.title}」？`)) { await fetch(`/api/skills/${d.dataset.skDel}`, { method: "DELETE" }); $("#skill-modal").classList.add("hidden"); await loadSkills(); renderSkills(); }
  };
  document.addEventListener("click", (e) => { if (!e.target.closest("#sk-create") && !e.target.closest("#sk-create-menu")) $("#sk-create-menu").classList.add("hidden"); });
  document.addEventListener("click", (e) => { if (!e.target.closest(".more-wrap")) $("#more-menu").classList.add("hidden"); });
  $("#pers-tabs").onclick = (e) => { const b = e.target.closest("[data-ptab]"); if (b) { S.persTab = b.dataset.ptab; renderPersonal(); } };
  $("#pers-profile").onsubmit = saveProfile;
  $("#pers-profile").oninput = syncCounts;
  $("#know-new").onclick = () => openKnowForm(null);
  $("#know-list").onclick = (e) => {
    const g = e.target.closest("[data-goto]"); if (g) { e.preventDefault(); openSession(g.dataset.goto); return; }
    const b = e.target.closest("[data-know]"); if (b) knowAction(b.dataset.know, b.dataset.id);
  };
  $("#know-form").onsubmit = saveKnow;
  $("#know-close").onclick = $("#know-cancel").onclick = () => $("#know-modal").classList.add("hidden");
  $("#import-open").onclick = () => { closeImport(); $("#import-modal").classList.remove("hidden"); $("#import-text").focus(); };
  $("#import-close").onclick = $("#import-cancel").onclick = closeImport;
  $("#import-run").onclick = runImport;
  $("#import-text").oninput = () => { if (S.importDraft) { S.importDraft = null; $("#import-result").innerHTML = ""; $("#import-run").textContent = "解析"; } };
  $("#import-copy").onclick = async () => { try { await navigator.clipboard.writeText($("#import-prompt").value); $("#import-copy").textContent = "已复制"; } catch { $("#import-prompt").select(); } };
  $("#auto-new").onclick = (e) => { e.stopPropagation(); $("#auto-new-menu").classList.toggle("hidden"); };
  $("#auto-new-menu").onclick = (e) => { const b = e.target.closest("[data-auto-new]"); if (!b) return; $("#auto-new-menu").classList.add("hidden");
    if (b.dataset.autoNew === "schedule") openSchedForm(null); else openTrigForm(null, { kind: b.dataset.autoNew }); };
  document.addEventListener("click", (e) => { if (!e.target.closest("#auto-new")) $("#auto-new-menu").classList.add("hidden"); });
  $("#auto-tabs").onclick = (e) => { const b = e.target.closest("[data-autotab]"); if (b) { S.autoTab = b.dataset.autotab; renderAutomations(); } };
  $("#nl-form").onsubmit = parseAutomation;
  $("#nl-text").onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("#nl-form").requestSubmit(); } };
  $("#trig-form").onsubmit = saveTrig;
  $("#trig-form").kind.onchange = syncTrigFields;
  $("#trig-close").onclick = $("#trig-cancel").onclick = () => $("#trig-modal").classList.add("hidden");
  $("#auto-list").onclick = (e) => {
    const g = e.target.closest("[data-goto]");
    if (g) { e.preventDefault(); openSession(g.dataset.goto); return; }
    const b = e.target.closest("[data-sched]");
    if (b) schedAction(b.dataset.sched, b.dataset.id);
    const tb = e.target.closest("[data-trig]");
    if (tb) trigAction(tb.dataset.trig, tb.dataset.id, tb);
  };
  $("#sched-form").onsubmit = saveSched;
  $("#sched-form").kind.onchange = syncSchedFields;
  $("#sched-close").onclick = $("#sched-cancel").onclick = () => $("#sched-modal").classList.add("hidden");
  $("#sched-modal").onclick = (e) => { if (e.target.id === "sched-modal") $("#sched-modal").classList.add("hidden"); };
  $("#lib-search").oninput = (e) => { S.libQuery = e.target.value; renderLibrary(); };
  $("#lib-tabs").onclick = (e) => { const b = e.target.closest("[data-tab]"); if (b) { S.libFilter = b.dataset.tab; renderLibrary(); } };
  $("#lib-list").onclick = (e) => {
    if (e.target.closest("a[download]")) return;
    const g = e.target.closest("[data-goto]");
    if (g) { e.preventDefault(); openSession(g.dataset.goto); return; }
    const row = e.target.closest("[data-lib]");
    if (row) openViewer(S.library[+row.dataset.lib]);
  };
  $("#viewer-close").onclick = closeViewer;
  $("#viewer").onclick = (e) => { if (e.target.id === "viewer") closeViewer(); };
  $("#brand").onclick = (e) => { e.preventDefault(); goHome(); };
  const collapse = (v) => { document.body.classList.toggle("nav-collapsed", v); store.set("nav-collapsed", v ? "1" : "0"); };
  $("#nav-collapse").onclick = () => collapse(true);
  $("#nav-expand").onclick = () => collapse(false);
  $("#search-btn").onclick = () => { const n = $("#nav-search"); n.classList.toggle("hidden"); if (!n.classList.contains("hidden")) $("#search-input").focus(); else { S.filter = ""; $("#search-input").value = ""; renderSessions(); } };
  $("#search-input").oninput = (e) => { S.filter = e.target.value; renderSessions(); };
  $("#theme-btn").onclick = () => { const cur = store.get("theme", "auto"); const next = THEMES[(THEMES.indexOf(cur) + 1) % 3]; store.set("theme", next); applyTheme(next); };
  $("#share-btn").onclick = openShareDialog;
  $("#share-close").onclick = () => $("#share-modal").classList.add("hidden");
  $("#share-create").onclick = async () => {
    const r = await fetch(`/api/sessions/${S.current}/share`, { method: "POST" });
    if (!r.ok) { $("#share-err").textContent = "创建失败"; return; }
    showShareLink((await r.json()).token);
  };
  $("#share-revoke").onclick = async () => {
    if (!confirm("取消分享后，已发出的链接将立即失效。")) return;
    await fetch(`/api/sessions/${S.current}/share`, { method: "DELETE" });
    S.shareToken = null; openShareDialog();
  };
  $("#share-copy").onclick = async () => { const v = $("#share-link").value; try { await navigator.clipboard.writeText(v); $("#share-copy").textContent = "已复制"; } catch { $("#share-link").select(); } };
  $("#delete-btn").onclick = () => S.current && deleteSession(S.current);
  $("#panel-btn").onclick = () => { S.panel.open = true; S.panel.userClosed = false; scheduleRender(); };
  const closePanel = () => { S.panel.open = false; S.panel.userClosed = true; S.panel.full = false; S.panel.takeover = false; scheduleRender(); };
  $("#pc-close").onclick = closePanel; $("#pc-close-tab").onclick = closePanel;
  $("#pc-full").onclick = () => { S.panel.full = !S.panel.full; scheduleRender(); };
  $("#pc-prev").onclick = () => stepNav(-1);
  $("#pc-next").onclick = () => stepNav(1);
  $("#pc-range").oninput = (e) => { const s = S.steps[+e.target.value]; S.panel.file = null; S.panel.sel = +e.target.value === S.steps.length - 1 ? null : s?.actionId ?? null; refreshSel(); };
  $("#jump-live").onclick = () => { S.panel.sel = null; S.panel.file = null; refreshSel(); };

  $("#session-list").onclick = async (e) => {
    const del = e.target.closest("[data-del]");
    if (del) { e.stopPropagation(); return deleteSession(del.dataset.del); }
    const item = e.target.closest(".session-item");
    if (item && item.dataset.id !== S.current) openSession(item.dataset.id);
  };
  document.querySelectorAll("[data-example]").forEach((b) => b.onclick = () => { $("#input").value = b.dataset.example; autoGrow(); renderComposerState(); $("#input").focus(); });

  // delegated actions in the thread and taskbar
  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-act]");
    if (!a) { if (S.planOpen && !e.target.closest("#taskbar")) { S.planOpen = false; renderTaskbar(); } return; }
    const t = S.turns.find((x) => x.id === a.dataset.turn);
    switch (a.dataset.act) {
      case "toggle-log": t.open = !(t.open ?? (!isFinished(t) || finalIndex(t) < 0)); rerender(t); break;
      case "toggle-group": { const it = t.items.find((x) => x.id === a.dataset.group); const isCur = !isFinished(t) && it === t.items[t.items.length - 1]; t.groupOpen[a.dataset.group] = !(t.groupOpen[a.dataset.group] ?? isCur); rerender(t); break; }
      case "step": S.panel.open = true; S.panel.userClosed = false; S.panel.file = null; S.panel.sel = a.dataset.id === S.steps[S.steps.length - 1]?.actionId ? null : a.dataset.id; refreshSel(); break;
      case "suggest": if (!S.readonly) submit(t.suggestions[+a.dataset.i].content); break;
      case "copy": { const fi = finalIndex(t); if (fi >= 0) navigator.clipboard?.writeText(t.items.slice(fi).filter((x) => x.kind === "chat").map((x) => x.ev.content).join("\n\n")); break; }
      case "open-file": if (e.target.closest("a[download]")) return; S.panel.open = true; S.panel.userClosed = false; S.panel.file = { url: a.dataset.url, name: a.dataset.name, path: a.dataset.path }; refreshSel(); break;
      case "plan": e.stopPropagation(); S.planOpen = !S.planOpen; renderTaskbar(); return;
      case "takeover": if (!S.readonly) toggleTakeover(); break;
      case "know": if (!S.readonly) knowAction(a.dataset.op, a.dataset.id); break;
      case "slide": { S.slideIdx = { ...(S.slideIdx || {}), [a.dataset.id]: +a.dataset.i }; renderPanel(); break; }
      case "add-skill": {
        e.stopPropagation();
        if (S.readonly) break;
        a.disabled = true; a.textContent = "添加中…";
        fetch("/api/skills/from-session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: S.current, path: a.dataset.path }) })
          .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) { a.textContent = j.detail || "添加失败"; a.disabled = false; return; } await loadSkills(); refreshSel(); });
        break;
      }
      case "mr": {
        if (S.readonly) break;
        const msg = { type: "map_reduce_control", sessionId: S.current, actionId: a.dataset.id, op: a.dataset.op };
        if (a.dataset.i !== "") msg.index = +a.dataset.i;
        send(msg); a.disabled = true;
        break;
      }
      case "confirm": {
        const s = S.steps[S.stepIdx[a.dataset.id]];
        if (!s || s._answered || S.readonly) break;
        s._answered = true;
        send({ type: "confirm_action", sessionId: S.current, actionId: a.dataset.id, approved: a.dataset.ok === "1" });
        rerender(s.turn);
        break;
      }
    }
  });
  $("#taskbar").addEventListener("click", (e) => { if (!e.target.closest("[data-act]") && !e.target.closest(".plan-pop")) { S.panel.open = true; S.panel.userClosed = false; S.panel.sel = null; S.panel.file = null; scheduleRender(); } });

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); goHome(); }
    if (e.key === "Escape" && S.viewing) { closeViewer(); return; }
    if (e.key === "Escape" && S.panel.full) { S.panel.full = false; scheduleRender(); }
  });
  setInterval(() => { const t = lastTurn(); if (t && !isFinished(t)) { S.dirty.add(t); scheduleRender(); } }, 1000);
}

function rerender(t) { S.dirty.add(t); scheduleRender(); }
function refreshSel() { S.turns.forEach((t) => S.dirty.add(t)); scheduleRender(); }
function stepNav(delta) {
  if (!S.steps.length) return;
  S.panel.file = null;
  const cur = S.panel.sel === null ? S.steps.length - 1 : S.stepIdx[S.panel.sel];
  const next = Math.max(0, Math.min(S.steps.length - 1, cur + delta));
  S.panel.sel = next === S.steps.length - 1 ? null : S.steps[next].actionId;
  refreshSel();
}
async function deleteSession(sid) {
  if (!confirm("删除该任务及其沙箱？")) return;
  await fetch(`/api/sessions/${sid}`, { method: "DELETE" });
  if (sid === S.current) goHome();
  refreshSessions();
}

// ------------------------------------------------------------------ init ---
(async function init() {
  hydrateIcons();
  applyTheme(store.get("theme", "auto"));
  if (store.get("nav-collapsed", "0") === "1") document.body.classList.add("nav-collapsed");
  bind();
  connect();
  try {
    S.cfg = await (await fetch("/api/config")).json();
    await loadModels();
    await loadProjects();
    await loadPersonal(); renderMe();
    await loadSkills();
    loadComputers();
    $("#config-info").textContent = `${shortModel(S.cfg.model)} · ${S.cfg.sandbox} 沙箱`;
  } catch { /* backend not reachable yet */ }
  await refreshSessions();
  const sid = location.hash.slice(1);
  if (sid.startsWith("share/")) { openShare(sid.slice(6)); return; }
  if (sid === "library") openLibrary();
  else if (sid === "automations") openAutomations();
  else if (sid === "connectors") openConnectors();
  else if (sid === "plugins") openPlugins();
  else if (sid === "creations") openCreations();
  else if (sid === "computers") openComputers();
  else if (sid === "personal") openPersonal();
  else if (sid === "skills") openSkills();
  else if (sid.startsWith("project/")) openProject(sid.slice(8));
  else openSession(sid && S.sessions.some((s) => s.id === sid) ? sid : null);
  autoGrow();
  // back / forward and typed hashes route like the sidebar does
  window.addEventListener("hashchange", () => {
    const h = location.hash.slice(1);
    if (S.readonly || h === (S.current || "") || (h === S.view && !S.current)) return;
    if (h === "library") openLibrary(); else if (h === "automations") openAutomations(); else if (h === "connectors") openConnectors(); else if (h === "plugins") openPlugins(); else if (h === "creations") openCreations(); else if (h === "computers") openComputers();
    else if (h === "personal") openPersonal(); else if (h === "skills") openSkills();
    else if (h.startsWith("project/")) openProject(h.slice(8));
    else if (!h || S.sessions.some((s) => s.id === h)) openSession(h || null);
  });
})();
