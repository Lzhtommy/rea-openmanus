// Navigation, data loading and the commands shared across pages.
import { S, render, touch, touchAll, ui, resetSessionState, openModal, closeModal, type Dict, type View } from "./store";
import { apply, join, send, lastTurn, isFinished } from "./events";
import { getJSON, jfetch, shortModel, store } from "./lib/util";

// ------------------------------------------------------------------ views ---
export function resetSession() { resetSessionState(); }

/** Leave the current task and show a full-page view. */
export function enterView(view: View, hash: string) {
  if (S.current) send({ type: "leave_session", sessionId: S.current });
  S.current = null; resetSession(); S.view = view;
  history.replaceState(null, "", hash);
  render();
}

export function openSession(sid: string | null) {
  S.view = sid ? "session" : "home";
  try { S.modelSel = sid ? null : JSON.parse(store.get("model-sel", "null")); } catch { S.modelSel = null; }
  if (S.current && S.current !== sid) send({ type: "leave_session", sessionId: S.current });
  S.current = sid; if (sid) S.lastSeq[sid] = -1;
  history.replaceState(null, "", sid ? `#${sid}` : "#");
  resetSession();
  if (sid) join(sid);
  render(true);
}
/** Focus the composer after the next render (optionally with the caret at the end). */
export function focusInput(caretEnd = false) { ui.focusInput = true; ui.caretEnd = caretEnd; render(); }
export function goHome() { openSession(null); focusInput(); }

/** Start a new task with this text in the composer. */
export function prefill(text: string, skills?: string[]) {
  goHome(); S.input = text;
  if (skills) S.pickedSkills = skills;
  focusInput(true);
}
export function useIdea(prompt: string, skills: string[]) {
  prefill(prompt, (skills || []).filter((n) => S.skills.skills.some((x: Dict) => x.name === n)));
}

export async function ensureSession(): Promise<string> {
  if (S.current) return S.current;
  const projectId = S.view === "project" ? S.projectId : null; // a task started from a project page joins it
  const s = await (await jfetch("/api/sessions", "POST", {
    projectId, ...(S.target?.startsWith("dev:") ? { deviceId: S.target.slice(4) } : { computerId: S.target }),
    ...(S.crew ? { [S.crew.startsWith("team:") ? "teamId" : "agentId"]: S.crew.split(":")[1] } : {}),
  })).json();
  S.crew = null;
  S.target = null;
  S.sessions.unshift(s);
  openSession(s.id);
  return s.id;
}

export async function submit(text: string, queue = false) {
  text = text.trim();
  if (!text && S.status === "running") { send({ type: "stop_session", sessionId: S.current }); return; }
  if (!text) return;
  const sel = currentSel(); // creating the session resets the view, keep the chosen mode
  const sid = await ensureSession();
  S.modelSel = sel;
  await new Promise((r) => setTimeout(r, 60));
  send({ type: "user_message", sessionId: sid, content: text, attachments: S.attachments.map((a) => a.path), model: sel, skills: S.pickedSkills,
    ...(queue ? { deliveryMode: "queue" } : {}), ...(S.confirmPlan ? { confirmPlan: true } : {}) });
  S.attachments = []; S.pickedSkills = [];
  S.input = ""; ui.stickBottom = true;
  render();
}

export async function deleteSession(sid: string) {
  if (!confirm("删除该任务及其沙箱？")) return;
  await fetch(`/api/sessions/${sid}`, { method: "DELETE" });
  if (sid === S.current) goHome();
  refreshSessions();
}

// ------------------------------------------------------------------ loaders ---
export async function refreshSessions() {
  try { S.sessions = await (await fetch("/api/sessions")).json(); } catch { return; }
  render();
}
export async function loadProjects() { S.projects = await getJSON("/api/projects", []); render(); }
export async function loadConns() { S.conns = await getJSON("/api/connectors", []); render(); }
export async function loadComputers() {
  try { [S.pcs, S.devs] = await Promise.all([fetch("/api/computers").then((r) => r.json()), fetch("/api/devices").then((r) => r.json())]); } catch { /* keep */ }
  render();
}
export async function loadAgents() { try { S.ags = await (await fetch("/api/agents")).json(); } catch { /* keep */ } render(); }
export async function loadSites() { S.sites = await getJSON("/api/sites", []); render(); }
export async function loadPlugins() { try { S.plugins = await (await fetch("/api/plugins")).json(); } catch { /* keep */ } render(); }
export async function loadSkills() { try { S.skills = await (await fetch("/api/skills")).json(); } catch { /* keep */ } render(); }
export async function loadPersonal() { try { S.personal = await (await fetch("/api/personalization")).json(); } catch { /* keep */ } render(); }
export async function loadSchedules() {
  [S.schedules, S.triggers, S.activity] = await Promise.all([getJSON("/api/schedules", []), getJSON("/api/triggers", []), getJSON("/api/automations/activity", [])]);
  render();
}
export async function loadModels() {
  try { S.models = await (await fetch("/api/models")).json(); } catch { /* keep defaults */ }
  if (!S.current) { try { const saved = JSON.parse(store.get("model-sel", "null")); if (saved?.mode) S.modelSel = saved; } catch { /* ignore */ } }
  render();
}

// ------------------------------------------------------------------ page openers ---
export function openProject(pid: string) {
  enterView("project", `#project/${pid}`); S.projectId = pid;
  loadProjects();
}
export async function openConnectors() { enterView("connectors", "#connectors"); await loadConns(); }
export async function openComputers() { enterView("computers", "#computers"); await loadComputers(); }
export function openComputerUse() { enterView("computeruse", "#computeruse"); }
export async function openAgents() { enterView("agents", "#agents"); await loadAgents(); await loadSkills(); }
export async function openCreations() { enterView("creations", "#creations"); await loadSites(); }
export async function openPlugins() { enterView("plugins", "#plugins"); await loadPlugins(); }
export async function openLibrary() { enterView("library", "#library"); S.library = await getJSON("/api/library", []); render(); }
export async function openSkills(tab?: string) {
  enterView("skills", "#skills"); if (tab) S.skTab = tab; S.skErr = "";
  await loadSkills();
}
export async function openPersonal(tab?: string) {
  enterView("personal", "#personal"); S.persTab = tab || S.persTab;
  await loadPersonal();
}
export async function openAutomations(tab?: string) {
  enterView("automations", "#automations"); if (tab) S.autoTab = tab;
  await loadSchedules();
}

// ------------------------------------------------------------------ shared commands ---
export const skillTitle = (n: string) => S.skills.skills.find((x: Dict) => x.name === n)?.title || n;
export async function openSkill(name: string) {
  const r = await fetch(`/api/skills/${name}`); if (!r.ok) return;
  openModal("skill", { skill: await r.json() });
}
export function useSkill(name: string) { closeModal("skill"); goHome(); S.pickedSkills = [name]; focusInput(); }

export function crewName() {
  if (!S.crew) return "";
  const [k, id] = S.crew.split(":");
  return (k === "team" ? S.ags.teams : S.ags.agents).find((x: Dict) => x.id === id)?.name || "";
}
/** Close the computer dialog and start a task that runs on that computer / device (`dev:<id>`). */
export function newTaskOn(id: string) { S.pcOpen = null; goHome(); S.target = id; focusInput(); }

export function openRecorder() {
  S.rec = { step: "setup", target: "cloud", url: "", events: [], notes: "", _k: Date.now() };
  render(); loadComputers();
}

// Knowledge the agent proposed (knowledge_save) or listed on the personalization page.
export async function knowAction(op: string, id?: string) {
  const k = S.personal.knowledge.find((x: Dict) => x.id === id);
  if (op === "manage") return openPersonal("knowledge");
  if (op === "edit") return openModal("know", { know: k });
  if (op === "accept") await jfetch(`/api/knowledge/${id}`, "PATCH", { accept: true });
  if (op === "toggle") await jfetch(`/api/knowledge/${id}`, "PATCH", { enabled: !k.enabled });
  if (op === "dismiss" || op === "del") {
    if (op === "del" && !confirm(`删除知识「${k?.title}」？`)) return;
    await fetch(`/api/knowledge/${id}`, { method: "DELETE" });
  }
  await loadPersonal();
  S.steps.forEach((s) => { if (s.detail?.knowledge?.id === id) s.detail.knowledge._seen = true; });
  touchAll();
}

// ------------------------------------------------------------------ computer panel ---
export function refreshSel() { touchAll(); }
export function stepNav(delta: number) {
  if (!S.steps.length) return;
  S.panel.file = null;
  const cur = S.panel.sel === null ? S.steps.length - 1 : S.stepIdx[S.panel.sel];
  const next = Math.max(0, Math.min(S.steps.length - 1, cur + delta));
  S.panel.sel = next === S.steps.length - 1 ? null : S.steps[next].actionId;
  refreshSel();
}
export function toggleTakeover() {
  const ending = S.panel.takeover;
  S.panel.takeover = !ending;
  if (!ending) { S.panel.open = true; S.panel.userClosed = false; S.panel.sel = null; S.panel.file = null; }
  else if (S.status === "waiting") send({ type: "user_message", sessionId: S.current, content: "我已完成浏览器中的操作，请继续。", attachments: [] });
  refreshSel();
}

// ------------------------------------------------------------------ modes & Flex ---
// Max / standard / Lite run on the server's endpoint ("litellm"); Flex runs on any configured provider with your own key.
export const defaultSel = (): Dict => ({ mode: S.models.default || "standard" });
export const currentSel = (): Dict => S.modelSel || defaultSel();
export const providerInfo = (id: string): Dict | undefined =>
  (id === "litellm" ? { id, label: S.models.gatewayLabel || "LiteLLM 网关", configured: true, model: S.cfg.model } : S.models.providers.find((p: Dict) => p.id === id));
export function selLabel(sel = currentSel()) {
  if (sel.mode === "flex") return `Flex · ${shortModel(sel.model || providerInfo(sel.provider)?.model || "")}`;
  return S.models.modes.find((m: Dict) => m.id === sel.mode)?.label || "OpenManus";
}
export function modelBadge(sel = currentSel()) {
  if (sel.mode === "flex") return shortModel(sel.model || providerInfo(sel.provider)?.model || "");
  return shortModel(S.models.modes.find((m: Dict) => m.id === sel.mode)?.model || S.cfg.model || "");
}
export function setSel(sel: Dict) {
  S.modelSel = sel;
  if (!S.current) store.set("model-sel", JSON.stringify(sel));
  S.menus.mode = false;
  touchAll();
}

// ------------------------------------------------------------------ share (read-only replay) ---
let replayTimer: number | undefined;
export async function openShare(token: string) {
  S.readonly = true; S.shareToken = token;
  S.current = `share:${token}`; S.view = "session";
  resetSession();
  let data: Dict;
  try { const r = await fetch(`/api/share/${token}`); if (!r.ok) throw new Error(); data = await r.json(); }
  catch { S.shareMissing = true; render(); return; }
  S.shareData = data;
  S.replaying = true;
  data.events.forEach(apply);
  S.replaying = false; S.title = data.title; S.status = data.status; S.plan = data.plan || [];
  S.modelSel = data.model?.mode ? data.model : defaultSel(); // the task's own mode, not the viewer's
  touchAll(); render(true);
}
export function replayShare() {
  window.clearTimeout(replayTimer);
  const data = S.shareData; if (!data) return;
  const evs: Dict[] = data.events;
  resetSession(); S.status = "running";
  S.panel.open = window.innerWidth >= 1100;
  render(true);
  let i = 0;
  const step = () => {
    if (i >= evs.length) { S.status = data.status; S.clockNow = null; touchAll(); return; }
    const ev = evs[i++];
    S.clockNow = ev.timestamp;
    apply(ev);
    const gap = i < evs.length ? evs[i].timestamp - ev.timestamp : 0;
    replayTimer = window.setTimeout(step, Math.max(60, Math.min(gap, 900)));
  };
  step();
}

// ------------------------------------------------------------------ theme ---
export const THEMES = ["auto", "light", "dark"];
export function applyTheme(t: string) {
  S.theme = t;
  if (t === "auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", t);
  render();
}
export function setTheme(t: string) { store.set("theme", t); applyTheme(t); }

// ------------------------------------------------------------------ sign-in ---
export function showLogin() { S.authScreen = true; render(); }
export async function checkAuth(rawFetch: typeof fetch) {
  try { S.auth = await (await rawFetch("/api/auth/me")).json(); } catch { S.auth = { enabled: false }; }
  S.me = S.auth?.user || null;
  if (S.auth?.enabled && !S.me) { showLogin(); return false; }
  return true;
}

// ------------------------------------------------------------------ routing ---
const VIEW_ROUTES: Record<string, () => unknown> = {
  library: openLibrary, automations: () => openAutomations(), connectors: openConnectors, plugins: openPlugins,
  creations: openCreations, computers: openComputers, computeruse: openComputerUse, agents: openAgents,
  personal: () => openPersonal(), skills: () => openSkills(),
};
/** Open whatever the URL hash names (on load). */
export function routeInitial() {
  const h = location.hash.slice(1);
  if (h.startsWith("share/")) { openShare(h.slice(6)); return; }
  if (VIEW_ROUTES[h]) VIEW_ROUTES[h]();
  else if (h.startsWith("project/")) openProject(h.slice(8));
  else openSession(h && S.sessions.some((s) => s.id === h) ? h : null);
}
/** Back / forward and typed hashes route like the sidebar does. */
export function onHashChange() {
  const h = location.hash.slice(1);
  if (S.readonly || h === (S.current || "") || (h === S.view && !S.current)) return;
  if (h !== "computeruse" && h !== "agents" && VIEW_ROUTES[h]) VIEW_ROUTES[h]();
  else if (h.startsWith("project/")) openProject(h.slice(8));
  else if (!h || S.sessions.some((s) => s.id === h)) openSession(h || null);
}

// ------------------------------------------------------------------ background refresh ---
export function startTimers() {
  // a running turn's "工作中 · 12s" clock
  setInterval(() => { const t = lastTurn(); if (t && !isFinished(t)) { touch(t); render(); } }, 1000);
  // A pairing dialog waits for the connector to come online.
  setInterval(() => { if (S.pairing && !S.devs.devices.find((d: Dict) => d.id === S.pairing!.device.id)?.online) loadComputers(); }, 2500);
  setInterval(() => { if ((S.view === "computers" || S.pcOpen) && S.pcs.computers.some((c: Dict) => ["starting", "setting_up"].includes(c.status))) loadComputers(); }, 3000);
  // While a condition check runs, refresh the automation page so its result shows up.
  setInterval(() => { if (S.view === "automations" && S.triggers.some((t) => t.checking)) loadSchedules(); }, 3000);
}
