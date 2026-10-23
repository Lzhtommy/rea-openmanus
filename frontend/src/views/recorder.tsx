// 技能录制器: demonstrate a workflow in a browser; the model turns it into a SKILL.md draft.
import { useEffect, useRef, type ReactNode } from "react";
import { S, render, useStore, type Dict } from "../store";
import { Icon, Spin, jfetch } from "../lib/util";
import { openSkill, openSkills } from "../actions";
import { loadRFB, wsUrl, type RFBClient } from "../lib/vnc";

const recEvText = (e: Dict) => ({ navigate: `打开 ${e.url}`, click: `点击 ${e.target}`, input: `填写 ${e.target} = ${e.value}`, key: `按 ${e.key}`, submit: `提交 ${e.target}` } as Dict)[e.type] || e.type;

function closeRecorder() {
  const r = S.rec;
  if (r?.id && r.step === "recording") fetch(`/api/recordings/${r.id}`, { method: "DELETE" });
  S.rec = null; render();
}

export function RecorderModal() {
  useStore();
  if (!S.rec) return null;
  return <Recorder key={S.rec._k} />;
}

function Recorder() {
  const r = S.rec!;
  const screen = useRef<HTMLDivElement>(null), live = useRef<HTMLOListElement>(null), draft = useRef<HTMLFormElement>(null);
  const err = (m: string) => { r.err = m; render(); };

  // poll the recorded events while recording
  useEffect(() => {
    if (r.step !== "recording") return;
    const id = r.id;
    const t = setInterval(async () => {
      if (!S.rec || S.rec.step !== "recording" || S.rec.id !== id) return clearInterval(t);
      const x = await fetch(`/api/recordings/${id}/events`).then((q) => q.json()).catch(() => null);
      if (x?.events && S.rec?.id === id) { S.rec.events = x.events; S.rec.count = x.count; render(); }
    }, 1500);
    return () => clearInterval(t);
  }, [r.step, r.id]);

  // the cloud browser's live screen
  useEffect(() => {
    if (r.step !== "recording" || r.target !== "cloud") return;
    let alive = true, rfb: RFBClient = null;
    (async () => {
      let RFB;
      try { RFB = await loadRFB(); } catch { return; }
      if (!alive || !S.rec || S.rec.id !== r.id || !screen.current) return;
      rfb = new RFB(screen.current, wsUrl(`/api/recordings/${r.id}/vnc`), { wsProtocols: ["binary"] });
      rfb.scaleViewport = true; rfb.background = "transparent";
    })();
    return () => { alive = false; if (rfb) { try { rfb.disconnect(); } catch { /* closed */ } rfb = null; } };
  }, [r.step, r.target, r.id]);

  useEffect(() => { if (live.current) live.current.scrollTop = 1e9; });

  const act = async (op: string) => {
    if (op === "close") return closeRecorder();
    if (op === "start") {
      const res = await jfetch("/api/recordings", "POST", { target: r.target, url: r.url.trim() });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return err(j.detail || "无法开始录制");
      Object.assign(r, { id: j.id, step: "recording", err: "" }); render();
    }
    if (op === "stop") {
      Object.assign(r, { step: "drafting", err: "" }); render();
      const res = await jfetch(`/api/recordings/${r.id}/stop`, "POST", { notes: r.notes });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { r.step = "setup"; return err(j.detail || "生成失败"); }
      r.draft = j.draft; r.step = "review"; render();
    }
    if (op === "save") {
      const fd = new FormData(draft.current!), g = (k: string) => String(fd.get(k) ?? "");
      const res = await jfetch("/api/skills", "POST", { name: g("name"), title: g("title"), description: g("description"), summary: g("summary"), body: g("body"), categories: r.draft.categories || [] });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return err(j.detail || "保存失败");
      S.rec = null; render();
      await openSkills("mine"); openSkill(j.name);
    }
  };

  const recordingSub = <><span className="rec-dot"></span>正在录制 · 已记录 {r.count || 0} 步</>;
  let sub: ReactNode, body: ReactNode, actions: ReactNode;
  if (r.step === "setup") {
    const devs = S.devs.devices.filter((d: Dict) => d.online);
    sub = "在浏览器里演示一遍工作流，OpenManus 会把它整理成技能";
    body = <div className="sched-body">
      <label>在哪里演示<select id="rec-target" value={r.target} onChange={(e) => { r.target = e.target.value; render(); }}>
        <option value="cloud">云端浏览器（在下方画面中直接操作）</option>
        {devs.map((d: Dict) => <option value={`dev:${d.id}`} key={d.id}>{d.name}{d.myBrowser ? " · 你的 Chrome" : ""}</option>)}</select></label>
      <label>起始网址<input id="rec-url" placeholder="例如 https://oa.example.com" value={r.url} onChange={(e) => { r.url = e.target.value; render(); }} /></label>
      <div className="muted" style={{ fontSize: 12 }}>录制会记下你打开的页面、点击的元素和填写的内容（密码等敏感字段只记“需要询问用户”，不记内容）。</div>
      <div className="sched-err" id="rec-err">{r.err}</div></div>;
    actions = <><span className="spacer"></span><button className="btn ghost" onClick={() => act("close")}>取消</button><button className="btn primary" onClick={() => act("start")}><Icon name="record" />开始录制</button></>;
  } else if (r.step === "recording") {
    sub = recordingSub;
    body = <div className="rec-grid">
      <div className="rec-screen" id="rec-screen" ref={screen}>{r.target === "cloud" ? null
        : <div className="pc-empty"><Icon name="compass" /><span>请在「{S.devs.devices.find((d: Dict) => "dev:" + d.id === r.target)?.name || "你的电脑"}」的 Chrome 中操作；操作会实时记录在右侧</span></div>}</div>
      <div className="rec-side"><div className="mcp-label">已记录的操作</div>
        <ol className="rec-events" id="rec-live" ref={live}>{r.events.length ? r.events.map((e: Dict, i: number) => <li key={i}>{recEvText(e)}</li>) : <li className="muted">在左侧浏览器中开始操作…</li>}</ol>
        <div className="mcp-label">补充说明（可选）</div>
        <textarea id="rec-notes" rows={4} placeholder="例如：每次的日期和金额都不同；最后一步提交前先让我确认" value={r.notes} onChange={(e) => { r.notes = e.target.value; render(); }}></textarea></div>
    </div>;
    actions = <><span className="sched-err" id="rec-err">{r.err}</span><span className="spacer"></span><button className="btn ghost" onClick={() => act("close")}>放弃</button><button className="btn primary" onClick={() => act("stop")}>停止并生成技能</button></>;
  } else if (r.step === "drafting") {
    sub = recordingSub;
    body = <div className="pc-empty" style={{ height: 360 }}><Spin /><span>正在把 {r.count || 0} 步操作整理成技能…</span></div>;
    actions = null;
  } else {
    const d = r.draft;
    sub = "检查并修改技能草稿，保存后即可在任务中使用";
    body = <form className="sched-body" id="rec-draft" ref={draft} onSubmit={(e) => e.preventDefault()}>
      <div className="sched-row"><label>显示名称<input name="title" defaultValue={d.title} /></label><label>标识<input name="name" defaultValue={d.name} /></label></div>
      <label>何时使用<input name="description" defaultValue={d.description} /></label><label>简介<input name="summary" defaultValue={d.summary} /></label>
      <label>操作说明<textarea name="body" rows={14} className="code-edit" style={{ minHeight: 300 }} defaultValue={d.body}></textarea></label>
      <div className="sched-err" id="rec-err">{r.err}</div></form>;
    actions = <><span className="spacer"></span><button className="btn ghost" onClick={() => act("close")}>放弃</button><button className="btn primary" onClick={() => act("save")}>保存为技能</button></>;
  }

  return (
    <div id="rec-modal">
      <div className="sched-card rec-card">
        <div className="viewer-head"><span className="auto-ico"><Icon name="record" /></span>
          <div className="viewer-title"><div style={{ fontSize: 16, fontWeight: 500 }}>技能录制器</div><div className="muted" id="rec-sub" style={{ fontSize: 12 }}>{sub}</div></div>
          <button type="button" className="icon-btn" id="rec-close" onClick={closeRecorder}><Icon name="x" /></button></div>
        <div className="rec-body" id="rec-body">{body}</div>
        <div className="cc-actions" id="rec-actions">{actions}</div>
      </div>
    </div>
  );
}
