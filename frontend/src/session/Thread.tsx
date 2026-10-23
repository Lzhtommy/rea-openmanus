// A task's conversation, the way the Manus 2.0 app shows it: turns with a collapsible work log of
// grouped steps, a result with file cards and follow-up suggestions.
import { memo, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { S, render, touch, ui, useStore, type Dict, type Item, type Step, type Turn } from "../store";
import { finalIndex, isFinished, lastTurn, pendingConfirms, selectedStep, send } from "../events";
import { knowAction, loadSkills, modelBadge, refreshSel, replayShare, skillTitle, submit, toggleTakeover } from "../actions";
import { IMG, Icon, Prose, SRC_ICO, TEXTY, TOOL, basename, copyText, cx, ext, fileIconCls, fmtDur, fmtTime, liveText, md, zh } from "../lib/util";
import { fetchText } from "./FileBody";

// ------------------------------------------------------------------ messages ---
function UserMsg({ ev }: { ev: Dict }) {
  const te = ev.triggerEvent;
  const queued = ev.queued && S.turns.find((t) => t.user === ev)?.status === "queued";
  const skills: string[] = ev.skills || [], files: Dict[] = ev.attachments || [];
  return (
    <div className="msg-user"><div>
      {te && <details className="trig-ev"><summary><Icon name={SRC_ICO[te.source] || "zap"} />{({ webhook: "收到 Webhook 事件", condition: "触发条件已满足", manual: "试运行" } as Dict)[te.source] || "触发事件"}</summary>
        <pre>{te.text.replace(/^<trigger_event[^>]*>\n?|\n?<\/trigger_event>[\s\S]*$/g, "")}</pre></details>}
      {queued && <div className="queued-tag"><Icon name="clock" />排队中，当前任务完成后执行</div>}
      <div className="bubble">{ev.content}</div>
      {(files.length > 0 || skills.length > 0) && <div className="files">
        {skills.map((n) => <span className="chip-file skill" key={`s:${n}`}><Icon name="spark" /><span>{skillTitle(n)}</span></span>)}
        {files.map((a, i) => <a className="chip-file" href={a.url} target="_blank" key={i}><Icon name="fileText" /><span>{a.filename}</span></a>)}
      </div>}
    </div></div>
  );
}

function ChatMsg({ ev, isFinal }: { ev: Dict; isFinal: boolean }) {
  const cls = ev.messageType === "ask" ? "narr ask" : "narr";
  const takeover = ev.messageType === "ask" && ev.takeover === "browser" && S.vnc && S.status === "waiting";
  return (
    <div className={isFinal ? "final-msg" : cls}>
      <Prose text={ev.content} />
      <FileCards list={ev.attachments} />
      {takeover && <div className="ask-takeover"><button className={cx("takeover-btn", S.panel.takeover && "on")} onClick={() => !S.readonly && toggleTakeover()}>
        <Icon name="hand" />{S.panel.takeover ? "结束接管并继续" : "接管浏览器"}</button></div>}
    </div>
  );
}

// ---- attachments as file cards (Manus shows a previewable document card)
function openFile(e: MouseEvent, a: Dict) {
  if ((e.target as Element).closest("a[download]")) return;
  S.panel.open = true; S.panel.userClosed = false; S.panel.file = { url: a.url, name: a.filename, path: a.path };
  refreshSel();
}

function Preview({ url, kind }: { url: string; kind: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (kind === "img") return;
    let alive = true;
    fetchText(url).then((t) => { if (alive) setText(t); });
    return () => { alive = false; };
  }, [url, kind]);
  if (kind === "img") return <img src={url} alt="" />;
  if (text === null) return null;
  if (kind === "md" || kind === "markdown") return <div className="prose" dangerouslySetInnerHTML={{ __html: md(text.slice(0, 6000)) }} />;
  return <pre style={{ margin: 0, whiteSpace: "pre-wrap", font: "12px/18px var(--font-mono)" }}>{text.slice(0, 3000)}</pre>;
}

function AddSkillButton({ path }: { path: string }) {
  const [state, setState] = useState<{ busy: boolean; label: string | null }>({ busy: false, label: null });
  const add = async (e: MouseEvent) => {
    e.stopPropagation();
    if (S.readonly) return;
    setState({ busy: true, label: "添加中…" });
    const r = await fetch("/api/skills/from-session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: S.current, path }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setState({ busy: false, label: j.detail || "添加失败" }); return; }
    await loadSkills(); refreshSel();
  };
  return <button className="btn ghost sm" disabled={state.busy} onClick={add}>{state.label ?? <><Icon name="plus" />添加到我的技能</>}</button>;
}

export function FileCards({ list }: { list?: Dict[] }) {
  if (!list?.length) return null;
  return (
    <div className="cards">
      {list.map((a, i) => {
        const [ic, cls] = fileIconCls(a.filename);
        const e = ext(a.filename);
        const preview = TEXTY.has(e) || IMG.has(e);
        const isSkill = a.filename === "SKILL.md" && !S.readonly;
        const added = isSkill && S.skills.skills.some((x: Dict) => x.name === basename(String(a.path).replace(/\/SKILL\.md$/, "")) && x.source === "personal");
        return (
          <div className="file-card" key={i}>
            <div className="fc-head" onClick={(ev) => openFile(ev, a)}>
              <span className={cx("fc-ico", cls)}><Icon name={ic} /></span>
              <span className="fc-name">{a.filename}<div className="fc-sub">{e.toUpperCase() || "文件"}</div></span>
              {isSkill && (added ? <span className="sk-added"><Icon name="check" />已在我的技能中</span> : <AddSkillButton path={a.path} />)}
              <a className="icon-btn" href={a.url} download={a.filename} title="下载"><Icon name="download" /></a>
            </div>
            {preview && <div className="fc-preview" onClick={(ev) => openFile(ev, a)}><Preview url={a.url} kind={IMG.has(e) ? "img" : e} /></div>}
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ steps ---
function StepText({ s }: { s: Step }) {
  if (s.brief) return <>{s.brief}</>;
  if (s.status === "streaming") return <>{zh(s.message?.action)}…</>;
  const act = zh(s.message?.action), param: string = s.message?.param || "";
  if (s.tool === "text_editor" && param) return <>{act} <b>{basename(param)}</b></>;
  return <>{act}{param && <> <b>{param.length > 90 ? param.slice(0, 90) + "…" : param}</b></>}</>;
}

function openStep(id: string) {
  S.panel.open = true; S.panel.userClosed = false; S.panel.file = null;
  S.panel.sel = id === S.steps[S.steps.length - 1]?.actionId ? null : id;
  refreshSel();
}

function StepRow({ s }: { s: Step }) {
  const meta = TOOL[s.tool] || { icon: "list" };
  const running = s.status === "start" || s.status === "running" || s.status === "streaming";
  if (s.status === "need_confirm") return (
    <button className="step hold" onClick={() => openStep(s.actionId)}><span className="step-ico"><Icon name="alert" /></span>
      <span className="step-text"><StepText s={s} /><em>等待确认</em></span></button>
  );
  const editFile = s.tool === "text_editor" && /write|str_replace/.test(s.name || "");
  const sel = S.panel.open && selectedStep()?.actionId === s.actionId;
  return (
    <button className={cx("step", s.status === "error" && "err", running && "run", sel && "sel")} onClick={() => openStep(s.actionId)}>
      {editFile ? <span className="step-ico file"><Icon name="fileDoc" /></span> : <span className={cx("step-ico", meta.round && "round")}><Icon name={meta.icon} /></span>}
      <span className={cx("step-text", running && "shimmer")}><StepText s={s} /></span>
    </button>
  );
}

function summarize(steps: Step[]) {
  const c: Dict = { q: 0, web: 0, bro: 0, edit: new Set(), read: new Set(), cmd: 0, term: 0, mr: 0, dep: 0, find: 0 };
  const inc = (k: string) => { c[k] = (c[k] || 0) + 1; };
  for (const s of steps) {
    const n: string = s.name || "";
    if (n === "info_search_web") c.q += Math.max(1, s.detail?.search?.queries?.length || 1);
    else if (n === "info_search_image") inc("img");
    else if (n === "info_search_scholar") inc("sch");
    else if (n === "info_extract_webpage" || n === "browser_navigate" || n === "browser_restart") c.web++;
    else if (n.startsWith("browser_")) c.bro++;
    else if (n === "file_read") c.read.add(s.message?.param);
    else if (n === "file_write" || n === "file_str_replace") c.edit.add(s.message?.param);
    else if (n.startsWith("file_find")) c.find++;
    else if (n === "shell_exec") c.cmd++;
    else if (n.startsWith("shell_")) c.term++;
    else if (n === "agent_map_reduce") c.mr++;
    else if (n === "agent_delegate") inc("dg");
    else if (n === "deploy_publish") inc("pub");
    else if (n.startsWith("deploy_")) c.dep++;
    else if (n.startsWith("schedule_")) inc("sched");
    else if (n === "trigger_create") inc("trig");
    else if (n === "slides_export") inc("sl");
    else if (n.startsWith("media_generate_")) inc("gen");
    else if (n === "mcp_search_tools") inc("ts");
    else if (n === "mcp_call_tool") inc("tc");
    else if (n === "knowledge_save") inc("kn");
  }
  const parts: string[] = [];
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
  if (c.dg) parts.push(`委派了 ${c.dg} 个子任务`);
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

function ItemView({ t, it, isCurrent }: { t: Turn; it: Item; isCurrent: boolean }) {
  if (it.kind === "chat") return <ChatMsg ev={it.ev} isFinal={false} />;
  if (it.kind === "stream") return <div className="narr streaming"><Prose text={it.text} /></div>;
  const steps = it.steps.map((id) => S.steps[S.stepIdx[id]]).filter(Boolean);
  const open = t.groupOpen[it.id] ?? (isCurrent && !isFinished(t));
  const toggle = () => {
    const isCur = !isFinished(t) && it === t.items[t.items.length - 1];
    t.groupOpen[it.id] = !(t.groupOpen[it.id] ?? isCur);
    touch(t); render();
  };
  return (
    <div className={cx("group", open && "open")}>
      <button className="group-sum" onClick={toggle}>{summarize(steps)}<Icon name="chevDown" cls="chev" /></button>
      {open && <div className="steps">{steps.map((s) => <StepRow s={s} key={s.actionId} />)}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ cards in a turn ---
function ConfirmCard({ s }: { s: Step }) {
  const c: Dict = s.confirm || {};
  const answer = (approved: boolean) => {
    if (s._answered || S.readonly) return;
    s._answered = true;
    send({ type: "confirm_action", sessionId: S.current, actionId: s.actionId, approved });
    touch(s.turn); render();
  };
  return (
    <div className="confirm-card">
      <div className="cc-head"><Icon name="alert" />OpenManus 需要你的确认</div>
      <div className="cc-body"><div className="cc-reason">{s.brief || zh(s.message?.action)}<span>{c.reason || ""}</span></div>
        {c.command ? <pre className="cc-cmd">{c.command}</pre> : c.port ? <pre className="cc-cmd">端口 {c.port}</pre> : null}</div>
      <div className="cc-actions"><button className="btn ghost" disabled={!!s._answered} onClick={() => answer(false)}>拒绝</button>
        <button className="btn primary" disabled={!!s._answered} onClick={() => answer(true)}>允许执行</button></div>
    </div>
  );
}

function PlanConfirm({ t }: { t: Turn }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const tasks = t.planConfirm || [];
  const answer = (approved: boolean) => {
    if (S.readonly) return;
    const steps = (ref.current?.value || "").split("\n").map((x) => x.trim()).filter(Boolean);
    send({ type: "confirm_plan", sessionId: S.current, approved, steps });
    t.planConfirm = null; touch(t); render();
  };
  return (
    <div className="confirm-card">
      <div className="cc-head"><Icon name="list" />请确认执行计划</div>
      <div className="cc-body"><div className="cc-reason">可以直接修改，每行一个步骤<span>确认后 OpenManus 按这个计划开始工作</span></div>
        <textarea className="plan-edit" id={`plan-edit-${t.id}`} ref={ref} rows={Math.min(10, tasks.length + 1)} defaultValue={tasks.map((x) => x.title).join("\n")} /></div>
      <div className="cc-actions"><button className="btn ghost" onClick={() => answer(false)}>取消任务</button><button className="btn primary" onClick={() => answer(true)}>开始执行</button></div>
    </div>
  );
}

// Knowledge the agent proposed in this turn (knowledge_save): the user accepts or dismisses it in place.
export function KnowCard({ k }: { k: Dict }) {
  const cur = S.personal.knowledge.find((x: Dict) => x.id === k.id);
  const state = !cur ? "dismissed" : cur.pending ? "pending" : "saved";
  if (state === "dismissed" && !k._seen) return null;
  const act = (op: string) => { if (!S.readonly) knowAction(op, k.id); };
  return (
    <div className="know-card"><span className="auto-ico"><Icon name="brain" /></span>
      <div className="auto-main"><div className="auto-title">{state === "pending" ? "OpenManus 想记住这条信息" : k.title}</div>
        <div className="auto-when">{state === "pending" && <><b>{k.title}</b>：</>}{k.content}</div></div>
      <div className="know-actions">{S.readonly ? null : state === "pending"
        ? <><button className="btn ghost sm" onClick={() => act("dismiss")}>忽略</button><button className="btn primary sm" onClick={() => act("accept")}>记住</button></>
        : <><span className="muted">{state === "saved" ? "已保存到知识" : "已忽略"}</span><button className="btn ghost sm" onClick={() => act("manage")}>管理</button></>}</div>
    </div>
  );
}

function LiveLine({ t }: { t: Turn }) {
  // a running step already shimmers in its own row; the live line only covers "thinking" gaps
  if (S.steps.some((s) => s.turn === t && (s.status === "start" || s.status === "running"))) return null;
  if (t.items[t.items.length - 1]?.kind === "stream") return null; // text is already streaming in
  return <div className="live-line"><span className="live-dot"></span><span className="shimmer">{liveText(S.live)}</span></div>;
}

function DoneRow({ t, fi }: { t: Turn; fi: number }) {
  const st = ({
    idle: <span className="st ok"><Icon name="check" />任务已完成</span>,
    stopped: <span className="st"><Icon name="stop" />任务已停止</span>,
    error: <span className="st err"><Icon name="alert" />任务出错</span>,
    waiting: <span className="st wait"><Icon name="hand" />等待你的回复</span>,
  } as Dict)[t.status] || null;
  const copy = () => copyText(t.items.slice(fi).flatMap((x) => (x.kind === "chat" ? [x.ev.content] : [])).join("\n\n"));
  return (
    <>
      <div className="done-row">{st}{fi >= 0 && <><span className="sep"></span><button className="icon-btn" title="复制" onClick={copy}><Icon name="copy" /></button></>}
        {t.end ? <span>{fmtTime(t.end)}</span> : null}</div>
      {t.status === "error" && t.error && <div className="err-detail">{t.error}</div>}
    </>
  );
}

// ------------------------------------------------------------------ a turn ---
const TurnView = memo(function TurnView({ t, isLast }: { t: Turn; rev: number; isLast: boolean }) {
  const fi = finalIndex(t);
  const logItems = fi >= 0 ? t.items.slice(0, fi) : t.items;
  const finalItems = fi >= 0 ? t.items.slice(fi) : [];
  const running = !isFinished(t);
  const finished = !running;
  const open = t.open ?? (running || fi < 0);
  const hasAssistant = t.items.length > 0 || running;
  const now = S.clockNow || Date.now(); // replays run on the recording's clock
  const dur = fmtDur((t.end || now) - (t.start || now));
  const toggleLog = () => { t.open = !(t.open ?? (!isFinished(t) || finalIndex(t) < 0)); touch(t); render(); };
  const knowledge = S.steps.filter((s) => s.turn === t && s.detail?.knowledge && s.status === "success");
  return (
    <div className="turn" id={t.id}>
      {t.user && <UserMsg ev={t.user} />}
      {hasAssistant && <div className="assistant">
        <div className="a-head"><span className="brand-mark"><Icon name="logo" /></span><span className="brand-word">openmanus</span><span className="badge">{modelBadge()}</span></div>
        {(logItems.length > 0 || running) && <>
          <button className="worked" onClick={toggleLog}>{running ? <><span className="spin"><Icon name="loader" /></span>工作中 · {dur}</> : `工作了 ${dur}`}<Icon name={open ? "chevDown" : "chevRight"} /></button>
          {open && <div className="worklog">{logItems.map((it, i) => <ItemView t={t} it={it} key={i} isCurrent={running && it === t.items[t.items.length - 1]} />)}</div>}
        </>}
        {running && isLast && S.status !== "waiting" && <LiveLine t={t} />}
        {pendingConfirms(t).map((s) => <ConfirmCard s={s} key={s.actionId} />)}
        {t.planConfirm && !S.readonly && <PlanConfirm t={t} />}
        {knowledge.map((s) => <KnowCard k={s.detail.knowledge} key={s.actionId} />)}
        {finalItems.length > 0 && <div className="final">{finalItems.map((it, i) => (it.kind === "chat" ? <ChatMsg ev={it.ev} isFinal key={i} /> : <ItemView t={t} it={it} isCurrent={false} key={i} />))}</div>}
        {finished && t.promos?.length && isLast && !S.readonly ? <div className="promos">{t.promos.map((p, i) => (
          <button className="promo" key={i} onClick={() => !S.readonly && submit(p.promptForAI)}><Icon name="spark" />{p.suggestion}<span>{basename(p.filePath)}</span></button>))}</div> : null}
        {finished && <DoneRow t={t} fi={fi} />}
        {t.suggestions?.length && isLast ? <div className="suggestions">{t.suggestions.map((c, i) => (
          <button className="suggestion" key={i} onClick={() => !S.readonly && submit(c.content)}><Icon name="message" /><span>{c.content}</span><Icon name="arrowRight" /></button>))}</div> : null}
      </div>}
    </div>
  );
}, (a, b) => a.t === b.t && a.rev === b.rev && a.isLast === b.isLast);

// ------------------------------------------------------------------ read-only share bar ---
function ShareBar() {
  const [copied, setCopied] = useState(false);
  return (
    <div className="share-bar" id="share-bar"><Icon name="share" /><span>这是一个 OpenManus 任务的只读回放</span><span className="spacer"></span>
      <button className="btn ghost sm" id="replay-btn" onClick={replayShare}><Icon name="play2" />回放</button>
      <button className="btn ghost sm" id="share-bar-copy" onClick={async () => { if (await copyText(location.href)) setCopied(true); }}><Icon name="copy" />{copied ? "已复制" : "复制链接"}</button></div>
  );
}

// ------------------------------------------------------------------ the thread ---
export function Thread() {
  const s = useStore();
  const sc = useRef<HTMLDivElement>(null);
  // follow the output while the user is at (or was sent to) the bottom
  const el = sc.current;
  const atBottom = ui.stickBottom || !el || el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  useLayoutEffect(() => {
    if (atBottom && sc.current) sc.current.scrollTop = sc.current.scrollHeight;
    ui.stickBottom = false;
  });
  const last = lastTurn();
  return (
    <div id="scroller" ref={sc}>
      <div id="thread">
        {s.shareMissing ? <div className="lib-empty"><Icon name="alert" /><div>分享链接不存在或已被取消</div></div> : <>
          {s.readonly && s.shareData && <ShareBar />}
          {s.turns.map((t) => <TurnView t={t} rev={t.rev} isLast={t === last} key={t.id} />)}
        </>}
      </div>
    </div>
  );
}
