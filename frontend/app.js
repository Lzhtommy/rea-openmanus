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
  map_reduce: { icon: "layers", use: "并行子任务" },
  deploy: { icon: "rocket", use: "部署服务" },
  schedule: { icon: "clock", use: "自动化" },
  mcp: { icon: "plug", use: "连接器" },
  knowledge: { icon: "brain", use: "知识" },
};
const ACTION_ZH = {
  "Executing command": "执行命令", "Checking terminal": "查看终端", Browsing: "浏览", Typing: "输入", Clicking: "点击",
  "Running JavaScript": "执行 JavaScript", "Reading file": "读取文件", "Editing file": "编辑文件", "Searching files": "搜索文件", "Creating scheduled task": "创建定时任务", "Searching tools": "搜索工具", "Using MCP": "调用工具", "Saving knowledge": "提议记住",
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
  const auto = S.view === "automations", conn = S.view === "connectors";
  const proj = S.view === "project", pers = S.view === "personal";
  const lib = S.view === "library" || auto || conn || proj || pers; // full-page views without a composer dock
  $("#personal").classList.toggle("hidden", !pers);
  $("#nav-more").classList.toggle("active", pers);
  $("#project-view").classList.toggle("hidden", !proj);
  const home = !S.current && !lib;
  $("#home").classList.toggle("hidden", !home);
  $("#library").classList.toggle("hidden", S.view !== "library");
  $("#automations").classList.toggle("hidden", !auto);
  $("#connectors").classList.toggle("hidden", !conn);
  $("#nav-conn").classList.toggle("active", conn);
  $("#nav-auto").classList.toggle("active", auto);
  $("#scroller").classList.toggle("hidden", home || lib);
  $("#dock").classList.toggle("hidden", home || lib);
  $("#nav-library").classList.toggle("active", S.view === "library");
  (proj ? $("#proj-slot") : home || lib ? $("#home-slot") : $("#dock-slot")).appendChild($("#composer"));
  $("#composer").classList.toggle("hidden", pers);
  const title = proj ? (S.projects.find((p) => p.id === S.projectId)?.name || "项目") : pers ? "个性化" : conn ? "连接器" : auto ? "自动化" : lib ? "资料库" : home ? "OpenManus" : (S.title || "新任务");
  $("#session-title").textContent = title;
  renderModeButton();
  document.title = home ? "OpenManus" : `${title} - OpenManus`;
  ["#share-btn", "#delete-btn"].forEach((s) => $(s).classList.toggle("hidden", home || lib));
  $("#panel-btn").classList.toggle("hidden", home || lib || !S.steps.length || S.panel.open);
  if (auto) { renderAutomations(); renderPanel(); return; }
  if (conn) { renderConnectors(); renderPanel(); return; }
  if (proj) { renderProject(); renderPanel(); return; }
  if (pers) { renderPersonal(); renderPanel(); return; }
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
  return `<div class="msg-user"><div><div class="bubble">${esc(ev.content)}</div>${files ? `<div class="files">${files}</div>` : ""}</div></div>`;
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
    if (n === "info_search_web") c.q++;
    else if (n === "info_extract_webpage" || n === "browser_navigate" || n === "browser_restart") c.web++;
    else if (n.startsWith("browser_")) c.bro++;
    else if (n === "file_read") c.read.add(s.message?.param);
    else if (n === "file_write" || n === "file_str_replace") c.edit.add(s.message?.param);
    else if (n.startsWith("file_find")) c.find++;
    else if (n === "shell_exec") c.cmd++;
    else if (n.startsWith("shell_")) c.term++;
    else if (n === "agent_map_reduce") c.mr++;
    else if (n.startsWith("deploy_")) c.dep++;
    else if (n.startsWith("schedule_")) c.sched = (c.sched || 0) + 1;
    else if (n === "mcp_search_tools") c.ts = (c.ts || 0) + 1;
    else if (n === "mcp_call_tool") c.tc = (c.tc || 0) + 1;
    else if (n === "knowledge_save") c.kn = (c.kn || 0) + 1;
  }
  const parts = [];
  if (c.q) parts.push(`已搜索 ${c.q} 个查询`);
  if (c.web) parts.push(`浏览了 ${c.web} 个网页`);
  if (c.bro) parts.push(`操作了 ${c.bro} 次浏览器`);
  if (c.edit.size) parts.push(`编辑了 ${c.edit.size} 个文件`);
  if (c.cmd) parts.push(`已运行 ${c.cmd} 个命令`);
  if (c.term) parts.push(`查看了 ${c.term} 次终端`);
  if (c.read.size) parts.push(`读取了 ${c.read.size} 个文件`);
  if (c.find) parts.push(`搜索了 ${c.find} 次文件`);
  if (c.mr) parts.push(`并行执行了 ${c.mr} 批子任务`);
  if (c.dep) parts.push(`部署了 ${c.dep} 个服务`);
  if (c.sched) parts.push(`创建了 ${c.sched} 个定时任务`);
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
  if (d.search) return `<div class="serp"><div class="serp-q">${icon("search")} ${esc(d.search.query)}</div>${(d.search.results || []).map((r) => {
    const h = hostOf(r.url);
    return `<a class="serp-item" href="${esc(r.url)}" target="_blank"><div class="serp-title"><span class="fav">${esc((h[0] || "?").toUpperCase())}</span><span>${esc(r.title)}</span></div><div class="serp-snip">${esc(r.snippet)}</div><div class="serp-url">${esc(h)}</div></a>`;
  }).join("")}</div>`;
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
  if (d.schedule) return `<div class="mr"><div class="auto-card" style="margin:8px 0">${autoCardHtml(d.schedule, false)}</div></div>`;
  if (d.deploy) return `<div class="urlbar">${icon("globe")}<a href="${esc(d.deploy.url)}" target="_blank">${esc(d.deploy.url)}</a></div><iframe class="preview-frame" style="height:calc(100% - 37px)" src="${esc(d.deploy.url)}"></iframe>`;
  if (d.error) return `<div class="err-view"><div class="term">${esc(d.error)}</div></div>`;
  if (s.status === "start" || s.status === "running") return `<div class="pc-empty"><span class="shimmer">${esc(s.brief || zh(s.message?.action))}</span></div>`;
  return `<div class="err-view"><div class="term" style="color:var(--text-secondary);background:var(--bg-code)">${esc(JSON.stringify(s.args || {}, null, 2))}</div></div>`;
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
  loadConns();
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
    `<span class="s-ico">${s.status === "running" ? icon("loader", "spin-i") : icon(s.status === "error" ? "alert" : s.scheduleId ? "clock" : "message")}</span>` +
    `<span class="s-title">${esc(s.title)}</span><button class="s-more" data-del="${esc(s.id)}" title="删除">${icon("trash")}</button></div>`).join("") ||
    `<div class="session-empty">${q ? "没有匹配的任务" : "暂无任务"}</div>`;
  $("#session-list").querySelectorAll(".spin-i").forEach((n) => (n.style.animation = "spin 1s linear infinite"));
}

// ------------------------------------------------------------------ library (资料库) ---
// Every file kept outside the sandboxes (deliverables, files the agent wrote, uploads), across tasks.
const LIB_TABS = [["all", "全部"], ["doc", "文档"], ["image", "图片"], ["code", "代码"], ["data", "数据"], ["other", "其他"]];
function fileKind(name) {
  const e = ext(name);
  if (IMG.has(e)) return "image";
  if (["md", "markdown", "txt", "pdf", "docx", "doc", "pptx", "html"].includes(e)) return "doc";
  if (["py", "js", "ts", "css", "sh", "json", "yaml", "yml"].includes(e)) return "code";
  if (["csv", "xlsx", "xls", "parquet", "sqlite"].includes(e)) return "data";
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
  $("#lib-tabs").innerHTML = LIB_TABS.filter(([k]) => k === "all" || counts[k]).map(([k, label]) =>
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

async function openAutomations() {
  if (S.current) send({ type: "leave_session", sessionId: S.current });
  S.current = null; resetSession(); S.view = "automations";
  history.replaceState(null, "", "#automations");
  renderSessions();
  await loadSchedules();
}
async function loadSchedules() {
  try { S.schedules = await (await fetch("/api/schedules")).json(); } catch { S.schedules = []; }
  scheduleRender();
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
  $("#auto-list").innerHTML = S.schedules.length ? S.schedules.map((s) => `<div class="auto-card ${s.enabled ? "" : "off"}">${autoCardHtml(s)}</div>`).join("")
    : `<div class="lib-empty">${icon("clock")}<div>还没有定时任务</div><div class="muted">点击右上角「新建定时任务」，或在对话中让 OpenManus 帮你创建</div></div>`;
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
  const s = await (await fetch("/api/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId }) })).json();
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
  send({ type: "user_message", sessionId: sid, content: text, attachments: S.attachments.map((a) => a.path), model: sel });
  S.attachments = []; renderAttachments();
  $("#input").value = ""; autoGrow(); stickBottom = true;
  renderComposerState();
}
function autoGrow() { const i = $("#input"); i.style.height = "auto"; i.style.height = Math.min(i.scrollHeight, 240) + "px"; }
function renderAttachments() {
  $("#attach-list").innerHTML = S.attachments.map((a, i) => `<span class="chip-file">${icon("paperclip")}<span>${esc(a.name)}</span><button type="button" data-rm="${i}">${icon("x")}</button></span>`).join("");
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
  $("#attach-list").onclick = (e) => { const b = e.target.closest("[data-rm]"); if (b) { S.attachments.splice(+b.dataset.rm, 1); renderAttachments(); } };
  $("#file-input").onchange = async (e) => {
    const sid = await ensureSession();
    for (const f of e.target.files) {
      const fd = new FormData(); fd.append("file", f);
      const r = await fetch(`/api/sessions/${sid}/upload`, { method: "POST", body: fd });
      if (r.ok) { const j = await r.json(); S.attachments.push({ name: f.name, path: j.path }); } else alert(`上传失败：${await r.text()}`);
    }
    e.target.value = ""; renderAttachments();
  };

  const newTask = () => goHome();
  $("#new-task").onclick = newTask; $("#new-task-2").onclick = newTask;
  $("#nav-library").onclick = openLibrary;
  $("#thread").addEventListener("click", (e) => {
    if (e.target.closest("#replay-btn")) replayShare();
    if (e.target.closest("#share-bar-copy")) navigator.clipboard?.writeText(location.href).then(() => (e.target.closest("button").lastChild.textContent = "已复制"));
  });
  $("#nav-conn").onclick = openConnectors;
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
  $("#more-menu").onclick = (e) => { const b = e.target.closest("[data-goto-view]"); if (!b) return; $("#more-menu").classList.add("hidden"); if (b.dataset.gotoView === "personal") openPersonal(); };
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
  $("#auto-new").onclick = () => openSchedForm(null);
  $("#auto-list").onclick = (e) => {
    const g = e.target.closest("[data-goto]");
    if (g) { e.preventDefault(); openSession(g.dataset.goto); return; }
    const b = e.target.closest("[data-sched]");
    if (b) schedAction(b.dataset.sched, b.dataset.id);
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
    $("#config-info").textContent = `${shortModel(S.cfg.model)} · ${S.cfg.sandbox} 沙箱`;
  } catch { /* backend not reachable yet */ }
  await refreshSessions();
  const sid = location.hash.slice(1);
  if (sid.startsWith("share/")) { openShare(sid.slice(6)); return; }
  if (sid === "library") openLibrary();
  else if (sid === "automations") openAutomations();
  else if (sid === "connectors") openConnectors();
  else if (sid === "personal") openPersonal();
  else if (sid.startsWith("project/")) openProject(sid.slice(8));
  else openSession(sid && S.sessions.some((s) => s.id === sid) ? sid : null);
  autoGrow();
})();
