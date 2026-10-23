// "The computer" panel (what the agent is looking at, with a step timeline) and the taskbar above
// the composer (current step, plan progress, outcome).
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { S, render, type Dict, type Step } from "../store";
import { activeTurn, lastTurn, pendingConfirms, selectedStep, send } from "../events";
import { refreshSel, stepNav, toggleTakeover } from "../actions";
import { AgAvatar, Icon, Prose, TOOL, basename, cx, hostOf, liveText, zh } from "../lib/util";
import { loadRFB, wsUrl, type RFBClient } from "../lib/vnc";
import { CodeRows, FileBody } from "./FileBody";
import { KnowCard } from "./Thread";
import { AutoCard, TrigCard } from "../views/automations";

const isRunning = (s?: Step) => !!s && (s.status === "start" || s.status === "running");
const stepLine = (s?: Step) => (s && isRunning(s) ? (s.brief || `${zh(s.message?.action)} ${s.message?.param || ""}`) : liveText(S.live));

// ------------------------------------------------------------------ taskbar ---
export function Taskbar() {
  const t = lastTurn();
  if (!t || (!S.steps.length && !S.plan.length)) return <div id="taskbar" className="hidden"></div>;
  const last = S.steps[S.steps.length - 1];
  const shot = [...S.steps].reverse().find((s) => s.detail?.browser?.screenshot)?.detail.browser.screenshot;
  let text: ReactNode;
  if (S.status === "running") text = <span className="tb-text"><span className="shimmer">{stepLine(last)}</span></span>;
  else if (S.status === "waiting") text = activeTurn()?.planConfirm ? <span className="tb-text warn"><Icon name="list" />等待你确认计划</span>
    : pendingConfirms(t).length ? <span className="tb-text warn"><Icon name="alert" />等待你确认操作</span> : <span className="tb-text"><Icon name="hand" />等待你的回复</span>;
  else if (S.status === "error") text = <span className="tb-text err"><Icon name="alert" />任务出错</span>;
  else if (S.status === "stopped") text = <span className="tb-text"><Icon name="stop" />任务已停止</span>;
  else text = <span className="tb-text ok"><Icon name="check" />任务已完成</span>;
  const done = S.plan.filter((p) => p.status === "completed").length;
  const openLive = (e: React.MouseEvent) => {
    if ((e.target as Element).closest(".tb-plan, .plan-pop")) return;
    S.panel.open = true; S.panel.userClosed = false; S.panel.sel = null; S.panel.file = null; render();
  };
  return (
    <div id="taskbar" onClick={openLive}>
      <span className="tb-thumb">{shot ? <img src={shot} alt="" /> : <Icon name={TOOL[last?.tool]?.icon || "monitor"} />}</span>
      {text}
      {S.plan.length > 0 && <button className="tb-plan" onClick={() => { S.planOpen = !S.planOpen; render(); }}><Icon name="list" />{done} / {S.plan.length}<Icon name={S.planOpen ? "chevDown" : "chevUp"} /></button>}
      {S.planOpen && S.plan.length > 0 && <div className="plan-pop"><h4>任务进度<span>{done} / {S.plan.length}</span></h4><ol>{S.plan.map((p, i) => (
        <li className={p.status} key={i}><span className="pi">{p.status === "completed" && <Icon name="check" />}</span>{p.title}</li>))}</ol></div>}
    </div>
  );
}

// ------------------------------------------------------------------ step views ---
function Term({ t }: { t: Dict }) {
  const ps = S.sessions.find((x) => x.id === S.current)?.deviceId ? "device" : "ubuntu@sandbox";
  const lines = String(t.output || "").split("\n");
  return (
    <div className="term">
      {lines.map((l, i) => {
        const m = l.match(/^(\/\S*)\$ (.*)$/);
        const row = m ? <span className="cmd"><span className="ps">{ps}:{m[1].replace(/^\/home\/ubuntu/, "~")}$</span> {m[2]}</span> : l;
        return <Fragment key={i}>{i > 0 && "\n"}{row}</Fragment>;
      })}
      {t.running && <>{"\n"}<span className="shimmer">▍</span></>}
    </div>
  );
}

function Editor({ e }: { e: Dict }) {
  const isDiff = e.op === "edit";
  const head = <div className="file-head"><Icon name="fileText" /><span className="grow">{e.path}</span><span>{({ read: "读取", write: "写入", append: "追加", edit: "修改", search: "搜索" } as Dict)[e.op] || e.op || ""}</span></div>;
  if (!isDiff && /\.(md|markdown)$/i.test(e.path || "") && e.op !== "search") return <>{head}<div className="page-md"><Prose text={e.content} /></div></>;
  return <>{head}<CodeRows content={e.content} diff={isDiff} /></>;
}

function MrButton({ s, op, i, label }: { s: Step; op: string; i: number | null; label: string }) {
  const [sent, setSent] = useState(false);
  const click = () => {
    if (S.readonly) return;
    const msg: Dict = { type: "map_reduce_control", sessionId: S.current, actionId: s.actionId, op };
    if (i !== null) msg.index = i;
    send(msg); setSent(true);
  };
  return <button className="btn ghost sm" disabled={sent} onClick={click}>{label}</button>;
}

// Manus' map_reduce controls: stop / retry one item, or continue now with what is finished
function MapReduce({ s, d }: { s: Step; d: Dict }) {
  const live = !S.readonly && d.taskStatus === "running" && isRunning(s);
  const done = d.taskDetails.filter((t: Dict) => t.status === "completed").length;
  return (
    <div className="mr">
      {live && <div className="mr-head"><span>{done} / {d.taskDetails.length} 已完成</span><MrButton s={s} op="force_continue" i={null} label="强制继续" /></div>}
      {d.taskDetails.map((t: Dict) => (
        <div className="mr-row" key={t.index}>
          <span className={cx("s", t.status)}>{({ pending: "○", running: "◌", completed: "✓", failed: "✕", cancelled: "–" } as Dict)[t.status] || ""}</span>
          <div className="b"><div>{t.index + 1}. {t.item}{t.status === "cancelled" && <> <span className="p">已取消</span></>}</div>
            {t.progress && t.status !== "failed" && <div className="p">{t.progress}</div>}
            {t.result && <details><summary>结果</summary><Prose text={t.result} /></details>}</div>
          {live && (t.status === "running" || t.status === "pending") && <MrButton s={s} op="cancel" i={t.index} label="停止" />}
          {live && (t.status === "failed" || t.status === "cancelled") && <MrButton s={s} op="retry" i={t.index} label="重试" />}
        </div>
      ))}
    </div>
  );
}

// Manus-style slide viewer: the current slide large, a strip of thumbnails, and the exported files.
function Slides({ s }: { s: Step }) {
  const d = s.detail.slides, i = Math.min(S.slideIdx[s.actionId] || 0, d.count - 1), cur = d.slides[i] || {};
  const go = (n: number) => { S.slideIdx = { ...S.slideIdx, [s.actionId]: n }; render(); };
  return (
    <>
      <div className="file-head"><Icon name="presentation" /><span className="grow">{basename(d.file)} · {d.count} 页</span>
        {d.pdf && <a className="btn ghost sm" href={d.pdf.url} download>PDF</a>}{d.pptx && <a className="btn ghost sm" href={d.pptx.url} download>PPTX</a>}</div>
      <div className="slide-view">
        <div className="slide-main">{cur.thumb && <img src={cur.thumb} alt="" />}</div>
        <div className="slide-nav"><button className="icon-btn sm" disabled={i === 0} onClick={() => go(i - 1)}><Icon name="chevLeft" /></button>
          <span>{i + 1} / {d.count}{cur.title ? ` · ${cur.title}` : ""}</span>
          <button className="icon-btn sm" disabled={i >= d.count - 1} onClick={() => go(i + 1)}><Icon name="chevRight" /></button></div>
        <div className="slide-strip">{d.slides.map((x: Dict, k: number) => <button className={cx(k === i && "on")} key={k} onClick={() => go(k)}><img src={x.thumb} alt="" loading="lazy" /></button>)}</div>
      </div>
    </>
  );
}

function StepView({ s }: { s: Step }) {
  const d: Dict = s.detail || {};
  if (s.status === "need_confirm") return <div className="pc-empty"><Icon name="alert" /><span>等待你确认：{s.confirm?.reason || ""}</span>{s.confirm?.command && <pre className="cc-cmd" style={{ maxWidth: "80%" }}>{s.confirm.command}</pre>}</div>;
  if (d.terminal) return <Term t={d.terminal} />;
  if (d.browser?.screenshot) return <img className="shot" src={d.browser.screenshot} alt="" />;
  if (d.browser?.console) return <div className="term">{d.browser.console}</div>;
  if (d.webpageExtract) return <div className="page-md"><Prose text={d.webpageExtract.markdown} /></div>;
  if (d.search) {
    const qs: string[] = d.search.queries || [d.search.query];
    return (
      <div className="serp"><div className="serp-q"><Icon name="search" />{qs.map((q, i) => <span className="q-chip" key={i}>{q}</span>)}</div>
        {(d.search.results || []).map((r: Dict, i: number) => {
          const h = hostOf(r.url);
          return (
            <a className="serp-item" href={r.url} target="_blank" key={i}>
              <div className="serp-title"><span className="fav" style={{ backgroundImage: `url('https://icons.duckduckgo.com/ip3/${h}.ico')` }}>{(h[0] || "?").toUpperCase()}</span><span>{r.title}</span></div>
              <div className="serp-snip">{r.snippet}</div><div className="serp-url">{h}{qs.length > 1 && r.query ? ` · ${r.query}` : ""}</div>
            </a>
          );
        })}
      </div>
    );
  }
  if (d.searchImage) return (
    <div className="serp"><div className="serp-q"><Icon name="image" /><span className="q-chip">{d.searchImage.query}</span></div>
      <div className="img-grid">{(d.searchImage.results || []).map((r: Dict, i: number) => (
        <a className="img-item" href={r.source || r.image} target="_blank" title={r.title} key={i}><img src={r.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" />
          <span>{r.width ? `${r.width}×${r.height}` : hostOf(r.source || r.image)}</span></a>))}</div></div>
  );
  if (d.searchScholar) return (
    <div className="serp"><div className="serp-q"><Icon name="book" /><span className="q-chip">{d.searchScholar.query}</span></div>
      {(d.searchScholar.results || []).map((r: Dict, i: number) => (
        <div className="serp-item paper" key={i}><a className="serp-title" href={r.url} target="_blank"><span>{r.title}</span></a>
          <div className="serp-url">{(r.authors || []).slice(0, 4).join(", ")}{r.authors?.length > 4 ? " 等" : ""} · {r.year || ""}{r.venue ? ` · ${r.venue}` : ""} · 被引 {r.citations}</div>
          {r.abstract && <div className="serp-snip">{r.abstract}</div>}
          {r.pdf && <a className="paper-pdf" href={r.pdf} target="_blank"><Icon name="fileDoc" />PDF</a>}</div>))}</div>
  );
  if (d.textEditor) return <Editor e={d.textEditor} />;
  if (d.mapReduce) return <MapReduce s={s} d={d.mapReduce} />;
  if (d.mcp) return <>
    <div className="file-head"><Icon name="plug" /><span className="grow">{d.mcp.server} · {d.mcp.action}</span></div>
    <div className="page-md"><div className="mcp-label">参数</div><pre className="cc-cmd">{d.mcp.argumentsPreview}</pre><div className="mcp-label">结果</div><pre className="cc-cmd mcp-out">{d.mcp.resultPreview}</pre></div>
  </>;
  if (d.knowledge) return <div className="mr"><KnowCard k={d.knowledge} /></div>;
  if (d.delegate) {
    const g = d.delegate, a: Dict = g.agent || {};
    return (
      <div className="mr"><div className="dg-head"><AgAvatar a={a} /><div><b>{a.name}</b><div className="muted" style={{ fontSize: 12 }}>{a.description || ""}</div></div></div>
        <div className="mcp-label">子任务</div><div className="auto-prompt" style={{ WebkitLineClamp: "unset" }}>{g.task}</div>
        {g.result ? <><div className="mcp-label">结果</div><Prose text={g.result} /></> : <div className="check-row"><span className="spin"><Icon name="loader" /></span>{g.progress || "工作中…"}</div>}</div>
    );
  }
  if (d.slides) return <Slides s={s} />;
  if (d.media) {
    const m = d.media;
    const player = m.kind === "image" ? <img className="shot" src={m.url} alt="" /> : m.kind === "video" ? <video className="media-player" src={m.url} controls /> : <div className="audio-wrap"><Icon name="music" /><audio src={m.url} controls /></div>;
    return <>
      <div className="file-head"><Icon name={m.kind === "video" ? "film" : m.kind === "audio" ? "music" : "image"} /><span className="grow">{m.path}</span><a className="icon-btn sm" href={m.url} download title="下载"><Icon name="download" /></a></div>
      <div className="media-view">{player}{m.prompt && <div className="media-prompt">{m.prompt}</div>}</div>
    </>;
  }
  if (d.trigger) return <div className="mr"><div className="auto-card" style={{ margin: "8px 0" }}><TrigCard t={d.trigger} actions={false} /></div></div>;
  if (d.schedule) return <div className="mr"><div className="auto-card" style={{ margin: "8px 0" }}><AutoCard s={d.schedule} actions={false} /></div></div>;
  if (d.site) return <><div className="urlbar"><Icon name="globe" /><a href={d.site.url} target="_blank">{d.site.url}</a><span className="lib-tag">v{d.site.current}</span></div>
    <iframe className="preview-frame" style={{ height: "calc(100% - 37px)" }} src={d.site.url} /></>;
  if (d.deploy) return <><div className="urlbar"><Icon name="globe" /><a href={d.deploy.url} target="_blank">{d.deploy.url}</a></div>
    <iframe className="preview-frame" style={{ height: "calc(100% - 37px)" }} src={d.deploy.url} /></>;
  if (d.error) return <div className="err-view"><div className="term">{d.error}</div></div>;
  if (isRunning(s)) return <div className="pc-empty"><span className="shimmer">{s.brief || zh(s.message?.action)}</span></div>;
  return <div className="err-view"><div className="term" style={{ color: "var(--text-secondary)", background: "var(--bg-code)" }}>{JSON.stringify(s.args || {}, null, 2)}</div></div>;
}

// ------------------------------------------------------------------ live screen (noVNC) ---
// The sandbox runs its browser on a virtual display exported over VNC; the backend relays it at
// /api/sessions/<id>/vnc. View-only by default, interactive while the user has taken over.
let rfb: RFBClient = null, rfbSid: string | null = null;
function vncDisconnect() {
  if (!rfb) { rfbSid = null; return; }
  const r = rfb; rfb = null; rfbSid = null;
  try { r.disconnect(); } catch { /* already closed */ }
}
async function vncConnect(el: HTMLElement) {
  const sid = S.current!;
  if (rfb && rfbSid === sid) { rfb.viewOnly = !S.panel.takeover; return; }
  if (rfbSid === sid) return; // still loading
  vncDisconnect();
  rfbSid = sid;
  let RFB;
  try { RFB = await loadRFB(); } catch { S.vncFailed = true; render(); return; }
  if (rfbSid !== sid || rfb) return;
  const r = new RFB(el, wsUrl(`/api/sessions/${sid}/vnc`), { wsProtocols: ["binary"] });
  r.scaleViewport = true; r.resizeSession = false; r.viewOnly = !S.panel.takeover; r.background = "transparent";
  r.addEventListener("disconnect", () => {
    if (rfb !== r) return;
    rfb = null; rfbSid = null;
    if (S.current === sid) { S.vncFailed = true; S.panel.takeover = false; refreshSel(); } // fall back to screenshots
  });
  rfb = r;
}

// ------------------------------------------------------------------ the panel ---
function closePanel() { S.panel.open = false; S.panel.userClosed = true; S.panel.full = false; S.panel.takeover = false; render(); }

export function ComputerPanel() {
  const open = S.panel.open && !!S.current;
  const vncEl = useRef<HTMLDivElement>(null);
  const viewEl = useRef<HTMLDivElement>(null);
  const running = S.status === "running";
  const n = S.steps.length;
  const lastStep = S.steps[n - 1];
  const live = S.panel.sel === null && !S.panel.file;
  const showVnc = open && S.vnc && !S.vncFailed && live && (S.panel.takeover || lastStep?.tool === "browser");
  const s = open && !showVnc && !S.panel.file ? selectedStep() : undefined;

  useEffect(() => { if (showVnc && vncEl.current) vncConnect(vncEl.current); else vncDisconnect(); });
  useEffect(() => vncDisconnect, []);
  useLayoutEffect(() => {
    const v = viewEl.current;
    if (v && S.panel.sel === null && v.querySelector(".term")) v.scrollTop = v.scrollHeight;
  });

  if (!open) return <section id="computer" className="hidden"></section>;

  const takeBtn = S.vnc && !S.vncFailed && live
    ? <button className={cx("takeover-btn", S.panel.takeover && "on")} onClick={() => !S.readonly && toggleTakeover()}><Icon name="hand" />{S.panel.takeover ? "结束接管" : "接管"}</button> : null;
  let status: ReactNode, view: ReactNode = null;
  if (showVnc && S.panel.takeover) {
    status = <><span className="grow"><span className="who">你正在控制 OpenManus 的电脑</span><span className="div"></span><span className="what">完成后点击「结束接管」把控制权交还给 OpenManus</span></span>{takeBtn}</>;
  } else if (showVnc) {
    status = <><span className="grow"><span className="who">OpenManus {running ? "正在使用" : "使用了"}浏览器</span><span className="div"></span><span className="what">{lastStep?.detail?.browser?.url || lastStep?.message?.param || ""}</span></span>
      <span className="live-badge"><i></i>实时画面</span>{takeBtn}</>;
  } else if (S.panel.file) {
    const f = S.panel.file;
    status = <><span className="who">OpenManus 正在查看文件</span><span className="div"></span><span className="what">{f.path || f.name}</span></>;
    view = <><div className="file-head"><Icon name="fileText" /><span className="grow">{f.name}</span><a className="icon-btn sm" href={f.url} download={f.name} title="下载"><Icon name="download" /></a>
      <a className="icon-btn sm" href={f.url} target="_blank" title="新窗口打开"><Icon name="external" /></a></div><div id="file-body"><FileBody f={f} /></div></>;
  } else if (!s) {
    status = <span className="who">OpenManus 的电脑</span>;
    view = <div className="pc-empty"><Icon name="monitor" /><span>任务开始后，终端、浏览器和文件操作会实时显示在这里</span></div>;
  } else {
    const use = TOOL[s.tool]?.use || "工具";
    const what = s.tool === "browser" || s.tool === "webpage_extract" ? (s.detail?.browser?.url || s.detail?.webpageExtract?.url || s.message?.param) : `${zh(s.message?.action)} ${s.message?.param || ""}`;
    status = <><span className="grow"><span className="who">OpenManus {isRunning(s) ? "正在使用" : "使用了"}{use}</span><span className="div"></span><span className="what">{what}</span></span>{takeBtn}</>;
    view = <StepView s={s} key={s.actionId} />;
  }

  const idx = S.panel.sel === null ? n - 1 : S.stepIdx[S.panel.sel];
  const isLive = S.panel.sel === null && !S.panel.file;
  let foot: ReactNode, footCls = "";
  if (running) foot = <span className="shimmer">{stepLine(S.steps[n - 1])}</span>;
  else if (S.status === "waiting") { const lt = lastTurn(); foot = lt && pendingConfirms(lt).length ? <><Icon name="alert" />等待你确认操作</> : <><Icon name="hand" />等待你的回复</>; }
  else if (S.status === "error") { footCls = "err"; foot = <><Icon name="alert" />任务出错</>; }
  else if (S.status === "stopped") foot = <><Icon name="stop" />任务已停止</>;
  else { footCls = "ok"; foot = <><Icon name="check" />任务已完成</>; }

  const onRange = (v: number) => {
    const st = S.steps[v];
    S.panel.file = null;
    S.panel.sel = v === S.steps.length - 1 ? null : st?.actionId ?? null;
    refreshSel();
  };
  return (
    <section id="computer">
      <header className="pc-head">
        <div className="pc-tab"><span><Icon name="monitor" /></span><span>OpenManus 的电脑</span><button className="pc-tab-x" id="pc-close-tab" title="关闭" onClick={closePanel}><Icon name="x" /></button></div>
        <div className="pc-head-actions">
          <button className="icon-btn" id="pc-full" title="全屏" onClick={() => { S.panel.full = !S.panel.full; render(); }}><Icon name={S.panel.full ? "minimize" : "maximize"} /></button>
          <button className="icon-btn" id="pc-close" title="收起" onClick={closePanel}><Icon name="panelRight" /></button>
        </div>
      </header>
      <div className="pc-status" id="pc-status">{status}</div>
      <div className="pc-body">
        <div id="pc-view" ref={viewEl} className={cx(showVnc && "hidden")}>{view}</div>
        <div id="pc-vnc" ref={vncEl} className={cx(!showVnc && "hidden", S.panel.takeover && "control")}></div>
        <button className={cx("jump-live", (isLive || !n) && "hidden")} id="jump-live" onClick={() => { S.panel.sel = null; S.panel.file = null; refreshSel(); }}><span><Icon name="play" /></span>跳到实时</button>
      </div>
      <div className="pc-timeline">
        <button className="icon-btn sm" id="pc-prev" title="上一步" onClick={() => stepNav(-1)}><Icon name="skipBack" /></button>
        <button className="icon-btn sm" id="pc-next" title="下一步" onClick={() => stepNav(1)}><Icon name="skipForward" /></button>
        <input type="range" id="pc-range" min={0} max={Math.max(1, n - 1)} value={n > 1 ? Math.max(0, idx) : 1} disabled={n < 2}
          style={{ "--p": n > 1 ? `${(idx / (n - 1)) * 100}%` : "100%" } as React.CSSProperties} onChange={(e) => onRange(+e.target.value)} />
        <span className={cx("live-tag", isLive && running && "on")} id="live-tag"><i></i>实时</span>
      </div>
      <div className={cx("pc-foot", footCls)} id="pc-foot">{foot}</div>
    </section>
  );
}
