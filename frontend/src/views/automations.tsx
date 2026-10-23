// 自动化: scheduled tasks, condition / webhook triggers, plain-language automations and the activity feed.
import { Fragment, useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { S, closeModal, openModal, render, setMenu, useStore, type Dict } from "../store";
import { Icon, SRC_ICO, Spin, ago, cx, errText, fmtTime, fmtTs, jfetch } from "../lib/util";
import { loadSchedules, openSession, refreshSessions } from "../actions";

// The plain-language box; saving the schedule / trigger it proposed clears it.
let nlText = "";

function RunLinks({ runs }: { runs?: string[] }) {
  const list = (runs || []).slice(0, 3);
  if (!list.length) return <span>还没有运行过</span>;
  return (
    <>
      <span>最近运行</span>
      {list.map((id) => {
        const sess = S.sessions.find((x) => x.id === id);
        return <a key={id} href={`#${id}`} onClick={(e) => { e.preventDefault(); openSession(id); }}><Icon name="message" />{sess?.title || id}</a>;
      })}
    </>
  );
}

// ------------------------------------------------------------------ schedules ---
async function schedAction(a: string, id: string) {
  const s = S.schedules.find((x) => x.id === id);
  if (!s) return;
  if (a === "toggle") await jfetch(`/api/schedules/${id}`, "PATCH", { enabled: !s.enabled });
  if (a === "del") { if (!confirm(`删除定时任务「${s.title}」？已运行的任务会保留。`)) return; await fetch(`/api/schedules/${id}`, { method: "DELETE" }); }
  if (a === "edit") return openModal("sched", { editing: s });
  if (a === "run") { const r = await (await fetch(`/api/schedules/${id}/run`, { method: "POST" })).json(); await refreshSessions(); openSession(r.sessionId); return; }
  loadSchedules();
}

/** The inside of a schedule's `.auto-card`. */
export function AutoCard({ s, actions = true }: { s: Dict; actions?: boolean }) {
  return (
    <>
      <div className="auto-top"><span className="auto-ico"><Icon name="clock" /></span>
        <div className="auto-main"><div className="auto-title">{s.title}</div>
          <div className="auto-when">{s.description}{s.enabled ? ` · 下次运行 ${fmtTs(s.nextRunAt)}` : " · 已暂停"}</div></div>
        {actions && <button className={cx("switch", s.enabled && "on")} title={s.enabled ? "暂停" : "启用"} onClick={() => schedAction("toggle", s.id)}><i></i></button>}
      </div>
      <div className="auto-prompt">{s.prompt}</div>
      {actions && (
        <div className="auto-foot"><div className="auto-runs"><RunLinks runs={s.runs} /></div>
          <button className="btn ghost sm" onClick={() => schedAction("run", s.id)}><Icon name="play2" />立即运行</button>
          <button className="icon-btn sm" title="编辑" onClick={() => schedAction("edit", s.id)}><Icon name="pencil" /></button>
          <button className="icon-btn sm" title="删除" onClick={() => schedAction("del", s.id)}><Icon name="trash" /></button>
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------ triggers ---
async function trigAction(a: string, id: string) {
  const t = S.triggers.find((x) => x.id === id);
  if (!t) return;
  if (a === "edit") return openModal("trig", { editing: t });
  if (a === "toggle") await jfetch(`/api/triggers/${id}`, "PATCH", { enabled: !t.enabled });
  if (a === "del") { if (!confirm(`删除触发器「${t.title}」？已运行的任务会保留。`)) return; await fetch(`/api/triggers/${id}`, { method: "DELETE" }); }
  if (a === "check") { t.checking = true; render(); await fetch(`/api/triggers/${id}/check`, { method: "POST" }); }
  if (a === "fire") { const r = await (await fetch(`/api/triggers/${id}/fire`, { method: "POST" })).json(); await refreshSessions(); openSession(r.sessionId); return; }
  loadSchedules();
}

/** The inside of a trigger's `.auto-card`. */
export function TrigCard({ t, actions = true }: { t: Dict; actions?: boolean }) {
  const [copied, setCopied] = useState(false);
  const last = (t.checks || [])[0];
  const copy = async () => { try { await navigator.clipboard.writeText(t.url); setCopied(true); } catch { /* ignore */ } };
  const body = t.kind === "webhook" ? (
    <>
      <div className="hook-url"><code>{t.url}</code>{actions && <button className="btn ghost sm" onClick={copy}><Icon name="copy" />{copied ? "已复制" : "复制"}</button>}</div>
      {actions && <details className="hook-help"><summary>如何调用</summary><pre className="cc-cmd">{`curl -X POST ${t.url} \\\n  -H 'Content-Type: application/json' \\\n  -d '{"event": "示例", "detail": "..."}'`}</pre></details>}
    </>
  ) : (
    <>
      <div className="auto-prompt"><b>条件</b>　{t.condition}</div>
      {t.checking ? <div className="check-row"><Spin />正在检查…</div>
        : last ? <div className={cx("check-row", last.met && "met")}><Icon name={last.met ? "check" : "clock"} />{ago(last.at)}检查：{last.met ? "条件满足，已运行" : "未满足"} · {last.summary}</div> : null}
    </>
  );
  return (
    <>
      <div className="auto-top"><span className="auto-ico"><Icon name={t.kind === "webhook" ? "webhook" : "zap"} /></span>
        <div className="auto-main"><div className="auto-title">{t.title}</div><div className="auto-when">{t.description}{t.enabled ? "" : " · 已暂停"}</div></div>
        {actions && <button className={cx("switch", t.enabled && "on")} title={t.enabled ? "暂停" : "启用"} onClick={() => trigAction("toggle", t.id)}><i></i></button>}
      </div>
      {body}
      <div className="auto-prompt"><b>执行</b>　{t.prompt}</div>
      {actions && (
        <div className="auto-foot"><div className="auto-runs"><RunLinks runs={t.runs} /></div>
          {t.kind === "condition" && <button className="btn ghost sm" disabled={!!t.checking} onClick={() => trigAction("check", t.id)}><Icon name="search" />立即检查</button>}
          <button className="btn ghost sm" onClick={() => trigAction("fire", t.id)}><Icon name="play2" />试运行</button>
          <button className="icon-btn sm" title="编辑" onClick={() => trigAction("edit", t.id)}><Icon name="pencil" /></button>
          <button className="icon-btn sm" title="删除" onClick={() => trigAction("del", t.id)}><Icon name="trash" /></button>
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------ activity ---
function Activity() {
  if (!S.activity.length) return <div className="lib-empty"><Icon name="clock" /><div>还没有自动运行记录</div><div className="muted">定时任务到点运行、触发器触发或条件检查后，会按时间显示在这里</div></div>;
  let day = "";
  return (
    <>
      {S.activity.map((a, i) => {
        const d = new Date(a.at * 1000).toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "short" });
        const head = d !== day ? <div className="nav-section" style={{ paddingLeft: 0 }}>{d}</div> : null;
        day = d;
        const lead = a.type === "check" ? "条件检查：未满足" : ({ schedule: "已到达预定时间", webhook: "收到 Webhook 事件", condition: "条件满足" } as Dict)[a.source.kind] || "自动运行";
        const st = a.type === "run" ? (({ running: "运行中", waiting: "等待你的回复", error: "出错", stopped: "已停止" } as Dict)[a.status] || "已完成") : "";
        return (
          <Fragment key={i}>
            {head}
            <div className={cx("act-row", a.type)}><span className="act-time">{fmtTime(a.at * 1000)}</span><span className="act-ico"><Icon name={SRC_ICO[a.source.kind] || "zap"} /></span>
              <div className="act-main">
                <div><b>{a.source.title}</b><span className="muted"> · {lead}</span>{st && <span className="lib-tag">{st}</span>}</div>
                {a.type === "run"
                  ? <a href={`#${a.sessionId}`} className="act-link" onClick={(e) => { e.preventDefault(); openSession(a.sessionId); }}><Icon name="message" />{a.title}</a>
                  : <div className="muted act-sum">{a.summary}</div>}
                {a.files?.length ? <div className="act-files">{a.files.map((f: Dict, k: number) => <a key={k} className="chip-file" href={f.url} target="_blank"><Icon name="fileText" /><span>{f.filename}</span></a>)}</div> : null}
              </div>
            </div>
          </Fragment>
        );
      })}
    </>
  );
}

// ------------------------------------------------------------------ page ---
export function Automations() {
  const s = useStore();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // 高级自动化: describe it in your own words; the model proposes a schedule or trigger for the user to confirm.
  const parse = async (e?: FormEvent) => {
    e?.preventDefault();
    const text = nlText.trim(); if (!text) return;
    setBusy(true); setErr("");
    const r = await jfetch("/api/automations/parse", "POST", { text });
    setBusy(false);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.detail || "解析失败"); return; }
    if (j.type === "schedule") openModal("sched", { preset: { title: j.title || "", prompt: j.prompt || text, ...(j.schedule || {}) } });
    else openModal("trig", { preset: { kind: j.type, title: j.title, prompt: j.prompt || text, condition: j.condition, everyMinutes: j.everyMinutes || 60 } });
  };
  const newItem = (kind: string) => { setMenu("autoNew", false); if (kind === "schedule") openModal("sched"); else openModal("trig", { preset: { kind } }); };

  const tabs: [string, ReactNode][] = [["activity", "动态"], ["schedules", <>定时任务<span>{s.schedules.length}</span></>], ["triggers", <>触发器<span>{s.triggers.length}</span></>]];
  let list: ReactNode;
  if (s.autoTab === "activity") list = <Activity />;
  else if (s.autoTab === "triggers") list = s.triggers.length ? s.triggers.map((t) => <div key={t.id} className={cx("auto-card", !t.enabled && "off")}><TrigCard t={t} /></div>)
    : <div className="lib-empty"><Icon name="zap" /><div>还没有触发器</div><div className="muted">选择一个事件，并定义它发生时 OpenManus 应执行的操作：条件满足时，或外部系统发来 Webhook 时</div></div>;
  else list = s.schedules.length ? s.schedules.map((x) => <div key={x.id} className={cx("auto-card", !x.enabled && "off")}><AutoCard s={x} /></div>)
    : <div className="lib-empty"><Icon name="clock" /><div>还没有定时任务</div><div className="muted">选择运行的时间和频率，让重复性工作自动完成；也可以在对话中让 OpenManus 帮你创建</div></div>;

  return (
    <div id="automations">
      <div className="lib-inner">
        <div className="lib-head"><h2>自动化</h2>
          <div className="more-wrap"><button className="btn primary" id="auto-new" onClick={() => setMenu("autoNew", !s.menus.autoNew)}>新建</button>
            <div className={cx("more-menu right", !s.menus.autoNew && "hidden")} id="auto-new-menu">
              <button className="mode-item" onClick={() => newItem("schedule")}><span><Icon name="clock" /></span>定时任务</button>
              <button className="mode-item" onClick={() => newItem("condition")}><span><Icon name="zap" /></span>条件触发器</button>
              <button className="mode-item" onClick={() => newItem("webhook")}><span><Icon name="webhook" /></span>Webhook 触发器</button>
            </div></div></div>
        <form className="nl-card" id="nl-form" autoComplete="off" onSubmit={parse}>
          <div className="nl-head"><span><Icon name="spark" /></span>高级自动化<span className="badge">Beta</span><span className="muted">用你自己的话描述 OpenManus 应在何时做什么</span></div>
          <textarea id="nl-text" rows={2} placeholder="例如：每个工作日早上 9 点汇总昨天的无人机行业新闻；或者：当 DJI 官网发布新机型时，整理参数对比发给我"
            value={nlText} onChange={(e) => { nlText = e.target.value; render(); }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); parse(); } }} />
          <div className="nl-foot"><span className="sched-err" id="nl-err">{err}</span><span className="spacer"></span><button className="btn primary sm" id="nl-go" disabled={busy}>{busy ? "理解中…" : "创建"}</button></div>
        </form>
        <div className="lib-tabs" id="auto-tabs">
          {tabs.map(([k, l]) => <button key={k} className={cx("lib-tab", s.autoTab === k && "on")} onClick={() => { S.autoTab = k; render(); }}>{l}</button>)}
        </div>
        <div id="auto-list">{list}</div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ schedule dialog ---
const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
function SchedForm({ m }: { m: Dict }) {
  const ed: Dict | undefined = m.editing, p: Dict = m.preset || {};
  const [v, setV] = useState(() => {
    const t = new Date(Date.now() + 3600e3); t.setMinutes(0, 0, 0);
    const f: Dict = { title: "", prompt: "", kind: "daily", weekday: "0", time: "09:00", everyMinutes: "60", at: new Date(+t - t.getTimezoneOffset() * 60e3).toISOString().slice(0, 16) };
    if (ed) {
      Object.assign(f, { title: ed.title, prompt: ed.prompt, kind: ed.schedule.kind });
      if (ed.schedule.time) f.time = ed.schedule.time;
      if (ed.schedule.weekday !== undefined) f.weekday = String(ed.schedule.weekday);
      if (ed.schedule.everyMinutes) f.everyMinutes = String(ed.schedule.everyMinutes);
      if (ed.schedule.at) f.at = ed.schedule.at;
    } else if (m.preset) {
      f.title = p.title || ""; f.prompt = p.prompt || "";
      if (p.kind) f.kind = p.kind;
      if (p.time) f.time = p.time;
      if (p.weekday !== undefined) f.weekday = String(p.weekday);
      if (p.everyMinutes) f.everyMinutes = String(p.everyMinutes);
      if (p.at) f.at = String(p.at).slice(0, 16);
    }
    return f;
  });
  const [err, setErr] = useState("");
  const set = (k: string) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const shown = (forKinds: string) => !forKinds.split(" ").includes(v.kind) ? "hidden" : undefined;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const kind = v.kind, schedule: Dict = { kind };
    if (kind === "once") schedule.at = v.at;
    if (kind === "interval") schedule.everyMinutes = +v.everyMinutes;
    if (kind === "daily" || kind === "weekly") schedule.time = v.time;
    if (kind === "weekly") schedule.weekday = +v.weekday;
    const body = { title: v.title.trim() || v.prompt.trim().slice(0, 30), prompt: v.prompt, schedule };
    const r = await jfetch(ed ? `/api/schedules/${ed.id}` : "/api/schedules", ed ? "PATCH" : "POST", body);
    if (!r.ok) { setErr(await errText(r, "保存失败")); return; }
    closeModal("sched");
    if (S.view === "automations") { S.autoTab = "schedules"; nlText = ""; }
    loadSchedules();
  };
  const close = () => closeModal("sched");
  return (
    <div id="sched-modal" onClick={(e: MouseEvent) => { if ((e.target as HTMLElement).id === "sched-modal") close(); }}>
      <form className="sched-card" id="sched-form" autoComplete="off" onSubmit={save}>
        <div className="viewer-head"><div className="viewer-title"><div id="sched-form-title">{ed ? "编辑定时任务" : "新建定时任务"}</div></div>
          <button type="button" className="icon-btn" id="sched-close" onClick={close}><Icon name="x" /></button></div>
        <div className="sched-body">
          <label>名称<input name="title" placeholder="例如：每日科技新闻摘要" value={v.title} onChange={set("title")} /></label>
          <label>要执行的指令<textarea name="prompt" rows={4} placeholder="每次运行时发给 OpenManus 的完整指令" required autoFocus value={v.prompt} onChange={set("prompt")} /></label>
          <label>频率<select name="kind" value={v.kind} onChange={set("kind")}><option value="daily">每天</option><option value="weekly">每周</option><option value="interval">按间隔</option><option value="once">仅一次</option></select></label>
          <div className={cx("sched-row", shown("daily weekly"))} data-for="daily weekly">
            <label data-for="weekly" className={shown("weekly")}>星期<select name="weekday" value={v.weekday} onChange={set("weekday")}>{WEEKDAYS.map((d, i) => <option key={i} value={String(i)}>{d}</option>)}</select></label>
            <label>时间<input type="time" name="time" value={v.time} onChange={set("time")} /></label>
          </div>
          <label data-for="interval" className={shown("interval")}>间隔（分钟）<input type="number" name="everyMinutes" min="5" value={v.everyMinutes} onChange={set("everyMinutes")} /></label>
          <label data-for="once" className={shown("once")}>时间<input type="datetime-local" name="at" value={v.at} onChange={set("at")} /></label>
          <div className="sched-err" id="sched-err">{err}</div>
        </div>
        <div className="cc-actions"><button type="button" className="btn ghost" id="sched-cancel" onClick={close}>取消</button><button type="submit" className="btn primary">保存</button></div>
      </form>
    </div>
  );
}
export function SchedModal() {
  const s = useStore();
  const m = s.modals.sched;
  if (!m) return null;
  return <SchedForm key={m._k} m={m} />;
}

// ------------------------------------------------------------------ trigger dialog ---
function TrigForm({ m }: { m: Dict }) {
  const ed: Dict | undefined = m.editing;
  const [v, setV] = useState(() => {
    const src: Dict = ed || m.preset || {};
    const f: Dict = { kind: "condition", title: "", prompt: "", condition: "", everyMinutes: "60" };
    if (src.kind) f.kind = src.kind;
    (["title", "prompt", "condition"] as const).forEach((k) => { if (src[k]) f[k] = src[k]; });
    if (src.everyMinutes) f.everyMinutes = String(Math.max(10, src.everyMinutes));
    return f;
  });
  const [err, setErr] = useState("");
  const set = (k: string) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const shown = (k: string) => (v.kind !== k ? "hidden" : undefined);
  const close = () => closeModal("trig");

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const body = { kind: v.kind, title: v.title.trim() || v.prompt.trim().slice(0, 30), prompt: v.prompt, condition: v.condition, everyMinutes: +v.everyMinutes };
    const r = await jfetch(ed ? `/api/triggers/${ed.id}` : "/api/triggers", ed ? "PATCH" : "POST", body);
    if (!r.ok) { setErr(await errText(r, "保存失败")); return; }
    closeModal("trig"); nlText = "";
    S.autoTab = "triggers"; loadSchedules();
  };
  return (
    <div id="trig-modal">
      <form className="sched-card" id="trig-form" autoComplete="off" onSubmit={save}>
        <div className="viewer-head"><div className="viewer-title"><div id="trig-form-title" style={{ fontSize: 16, fontWeight: 500 }}>{ed ? "编辑触发器" : "新建触发器"}</div></div>
          <button type="button" className="icon-btn" id="trig-close" onClick={close}><Icon name="x" /></button></div>
        <div className="sched-body">
          <label>类型<select name="kind" value={v.kind} disabled={!!ed} onChange={set("kind")}><option value="condition">条件触发：条件满足时运行</option><option value="webhook">Webhook：外部系统发来事件时运行</option></select></label>
          <label>名称<input name="title" placeholder="例如：竞品降价提醒" value={v.title} onChange={set("title")} /></label>
          <label data-for="condition" className={shown("condition")}>触发条件（用自然语言描述，OpenManus 会定期去查证）<textarea name="condition" rows={2} placeholder="例如：DJI 商城 Mavic 4 Pro 标准版的价格比上次检查时低" value={v.condition} onChange={set("condition")} /></label>
          <label data-for="condition" className={shown("condition")}>检查间隔（分钟）<input type="number" name="everyMinutes" min="10" value={v.everyMinutes} onChange={set("everyMinutes")} /></label>
          <label>触发后要执行的指令<textarea name="prompt" rows={4} placeholder="例如：整理降价信息和历史价格，生成一页简报" required value={v.prompt} onChange={set("prompt")} /></label>
          <div className={cx("muted", shown("webhook"))} data-for="webhook" style={{ fontSize: 12 }}>保存后会生成一个专属地址。向它 POST 任意 JSON 或文本，就会新建一个任务，请求内容作为上下文交给 OpenManus。</div>
          <div className="sched-err" id="trig-err">{err}</div>
        </div>
        <div className="cc-actions"><button type="button" className="btn ghost" id="trig-cancel" onClick={close}>取消</button><button type="submit" className="btn primary">保存</button></div>
      </form>
    </div>
  );
}
export function TrigModal() {
  const s = useStore();
  const m = s.modals.trig;
  if (!m) return null;
  return <TrigForm key={m._k} m={m} />;
}
