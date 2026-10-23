// The Manus-style event stream over one WebSocket (chat / toolUsed / planUpdate / statusUpdate /
// liveStatus / title / sandboxUpdate), folded into turns: a user request, the agent's work log of
// grouped steps, and its result.
import { S, render, touch, type Dict, type Turn } from "./store";
import { store } from "./lib/util";
import { loadPersonal, refreshSessions } from "./actions";

// ------------------------------------------------------------------ socket ---
export function connect() {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  S.ws = ws;
  ws.onopen = () => { if (S.current && !S.readonly) join(S.current); };
  ws.onmessage = (e) => handle(JSON.parse(e.data));
  ws.onclose = () => setTimeout(connect, 1500);
}
export const send = (m: Dict) => { if (S.ws?.readyState === 1) S.ws.send(JSON.stringify(m)); };
export function join(sid: string) { S.replaying = true; send({ type: "join_session", sessionId: sid, lastSeq: S.lastSeq[sid] ?? -1 }); }

function handle(msg: Dict) {
  if (msg.type === "session") {
    if (msg.session.id !== S.current) return;
    S.replaying = false;
    S.title = msg.session.title; S.status = msg.session.status;
    if (msg.session.model?.mode) S.modelSel = msg.session.model; // the task keeps its own mode/model
    if (msg.session.plan?.length) S.plan = msg.session.plan;
    S.turns.forEach(touch);
    render(true);
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
export const lastTurn = (): Turn | undefined => S.turns[S.turns.length - 1];
function newTurn(user: Dict | null, ts: number): Turn {
  const t: Turn = { id: `t${S.turns.length}`, user, start: ts, end: null, status: "running", items: [], suggestions: null, open: undefined, groupOpen: {}, error: "", rev: 0 };
  S.turns.push(t);
  return t;
}
// The turn events belong to: a queued request's turn waits until the current run finishes.
export const activeTurn = (): Turn | undefined => { const t = lastTurn(); return t?.status === "queued" ? ([...S.turns].reverse().find((x) => x.status !== "queued") || t) : t; };
const ensureTurn = (ts: number) => activeTurn() || newTurn(null, ts);

// Steps held for the user's approval (Manus' need_confirm). While one is pending the turn is still in
// progress even though the agent status is "waiting".
export const pendingConfirms = (t: Turn) => S.steps.filter((s) => s.turn === t && s.status === "need_confirm");
export const isFinished = (t: Turn) => t.status !== "running" && !(t.status === "waiting" && (pendingConfirms(t).length || t.planConfirm));

// Index where the turn's result starts: the last chat marked deliveryKind "result", else the run of
// chat messages after the last step group. Everything before it lives in the collapsible work log.
export function finalIndex(t: Turn) {
  if (!isFinished(t)) return -1;
  const isResult = (it: Turn["items"][number]) => it.kind === "chat" && it.ev.deliveryKind === "result";
  let run = t.items.length;
  while (run > 0 && t.items[run - 1].kind === "chat") run--;
  const inRun = t.items.findIndex((it, i) => i >= run && isResult(it));
  if (inRun >= 0) return inRun; // e.g. answer + a follow-up correction, both delivered as results
  for (let i = run - 1; i >= 0; i--) if (isResult(t.items[i])) return i;
  return run < t.items.length ? run : -1;
}

export const selectedStep = () => (S.panel.sel !== null ? S.steps[S.stepIdx[S.panel.sel]] : S.steps[S.steps.length - 1]);

export function apply(ev: Dict) {
  switch (ev.type) {
    case "chat": {
      if (ev.sender === "user") { const nt = newTurn(ev, ev.timestamp); if (ev.queued) nt.status = "queued"; touch(nt); break; }
      const t = ensureTurn(ev.timestamp);
      // the finished message replaces its streaming draft in place
      const si = ev.streamId ? t.items.findIndex((it) => it.kind === "stream" && it.id === ev.streamId) : -1;
      if (ev.streamId) S.finalized.add(ev.streamId);
      if (si >= 0) t.items[si] = { kind: "chat", ev }; else t.items.push({ kind: "chat", ev });
      touch(t);
      break;
    }
    case "chatDelta": {
      if (S.finalized.has(ev.streamId)) return;
      const t = ensureTurn(ev.timestamp);
      const it = t.items.find((x) => x.kind === "stream" && x.id === ev.streamId);
      if (it && it.kind === "stream") it.text = ev.content; else t.items.push({ kind: "stream", id: ev.streamId, text: ev.content });
      touch(t);
      break;
    }
    case "toolUsed": {
      const t = ensureTurn(ev.timestamp);
      if (ev.tool === "suggestion") { t.suggestions = ev.detail?.suggestion?.commands || []; touch(t); break; }
      if (ev.detail?.knowledge && ev.status === "success" && !S.replaying) loadPersonal().then(() => { touch(t); render(); });
      let i = S.stepIdx[ev.actionId];
      if (i === undefined) {
        i = S.steps.length; S.stepIdx[ev.actionId] = i;
        S.steps.push({ ...ev, actionId: ev.actionId, turn: t, startTs: ev.timestamp });
        const last = t.items[t.items.length - 1];
        if (last?.kind === "group") last.steps.push(ev.actionId);
        else t.items.push({ kind: "group", id: `g${S.steps.length}`, steps: [ev.actionId] });
        if (!S.replaying && !S.panel.open && !S.panel.userClosed && window.innerWidth >= 1100) S.panel.open = true;
      } else {
        const prev = S.steps[i];
        S.steps[i] = { ...prev, ...ev, args: ev.args ?? prev.args, brief: ev.brief || prev.brief, turn: prev.turn, startTs: prev.startTs };
      }
      touch(t);
      break;
    }
    case "statusUpdate": {
      S.status = ev.agentStatus;
      let t = activeTurn();
      const waitingTurn = S.turns.find((x) => x.status === "queued");
      if (ev.agentStatus === "running" && waitingTurn && t && isFinished(t)) t = waitingTurn; // the queued request starts
      if (t) {
        if (ev.agentStatus === "running") { t.status = "running"; t.end = null; }
        else { t.status = ev.agentStatus; t.end = ev.timestamp; if (ev.agentStatus === "error") t.error = ev.description || ""; }
        touch(t);
      }
      if (ev.agentStatus !== "running") S.live = "";
      if (!S.replaying && document.hidden && store.get("notify", "0") === "1" && window.Notification?.permission === "granted" && ["idle", "waiting", "error"].includes(ev.agentStatus))
        new Notification(S.title || "OpenManus", { body: ({ idle: "任务已完成", waiting: "OpenManus 需要你的回复或确认", error: "任务出错" } as Dict)[ev.agentStatus], tag: S.current || undefined });
      if (!S.replaying) refreshSessions();
      break;
    }
    case "liveStatus": S.live = ev.text || ""; touch(activeTurn()); break;
    case "planUpdate": S.plan = ev.tasks || []; break;
    case "fileOperationPromotion": { const t = activeTurn(); if (t) { (t.promos ||= []).push(ev); touch(t); } break; }
    case "planConfirm": { const t = ensureTurn(ev.timestamp); t.planConfirm = ev.tasks || []; touch(t); break; }
    case "planConfirmed": { const t = lastTurn(); if (t) { t.planConfirm = null; touch(t); } break; }
    case "title": S.title = ev.title; refreshSessions(); break;
    case "sandboxUpdate": S.vnc = !!ev.vnc && !S.readonly; S.vncFailed = false; break;
    default: return; // explanation: not shown (Manus doesn't render it)
  }
  render();
}
