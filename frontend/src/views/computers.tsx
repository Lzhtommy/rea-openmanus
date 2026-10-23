// 电脑: cloud computers (persistent machines), connected devices and their dialogs.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { S, render, useStore, openModal, closeModal, type Dict } from "../store";
import { ConnSt, Icon, PC_ST, Spin, copyText, cx, errText, fmtDate, jfetch } from "../lib/util";
import { loadAgents, loadComputers, newTaskOn, openSession } from "../actions";
import { loadRFB, wsUrl, type RFBClient } from "../lib/vnc";

const PcSt = ({ c }: { c: Dict }) => { const [cls, l] = PC_ST[c.status] || ["", c.status]; return <ConnSt cls={cls}>{l}</ConnSt>; };
const tplIcon = (id: string) => (id === "custom" ? "pencil" : id === "gameserver" ? "gamepad" : id === "blender" ? "layers" : "monitor");

export function openPcNew(tpl = "custom") { openModal("pcnew", { tpl }); }
export async function openPcView(id: string, tab?: string) {
  S.pcOpen = id; if (tab) S.pcTab = tab;
  render();
  await loadComputers();
}
function closePcView() { S.pcOpen = null; render(); }

export async function startPairing() {
  const r = await jfetch("/api/devices", "POST", {});
  S.pairing = { ...(await r.json()), myBrowser: false };
  await loadComputers();
}
function closePairing() { S.pairing = null; render(); loadComputers(); }

// ------------------------------------------------------------------ page ---
export function Computers() {
  useStore();
  const { computers, templates, unavailable, tasks } = S.pcs;
  const trust = async (d: Dict, el: HTMLInputElement) => {
    if (el.checked && !confirm("信任后，OpenManus 在这台电脑上执行命令和修改文件将不再逐次征求你的同意。确定吗？")) { el.checked = false; return; }
    await jfetch(`/api/devices/${d.id}`, "PATCH", { autoApprove: el.checked }); loadComputers();
  };
  const removeDev = async (d: Dict) => {
    if (!confirm("移除这台设备？它的连接器会立即断开，需要重新连接才能再使用。")) return;
    await fetch(`/api/devices/${d.id}`, { method: "DELETE" }); loadComputers();
  };
  return (
    <div id="computers">
      <div className="lib-inner wide">
        <div className="lib-head"><h2>电脑</h2><button className="btn primary" id="pc-new" onClick={() => openPcNew()}>创建云电脑</button></div>
        <div id="pc-mine">
          {computers.length ? <>
            <div className="nav-section" style={{ paddingLeft: 0 }}>我的电脑</div>
            <div className="sk-grid">{computers.map((c: Dict) => (
              <div className="sk-card" key={c.id} onClick={() => openPcView(c.id, "desktop")}>
                <div className="sk-top"><span className="auto-ico"><Icon name="monitor" /></span>
                  <div className="sk-title">{c.name}<div className="sk-name">Linux · {c.cpus} CPU · {c.memory} GB{c.autoStop ? ` · 空闲 ${c.autoStop} 分钟关机` : " · 始终在线"}</div></div><PcSt c={c} /></div>
                <div className="sk-meta"><span>{(tasks[c.id] || []).length} 个任务</span>{c.ports.length ? <span>{c.ports.length} 个开放端口</span> : null}<span className="spacer"></span>
                  <button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); newTaskOn(c.id); }}><Icon name="newTask" />新任务</button></div>
              </div>))}
            </div>
          </> : null}
        </div>
        <div className="lib-head" style={{ margin: "20px 0 8px" }}><div className="nav-section" style={{ padding: 0 }}>连接您的设备 · 让 OpenManus 在你自己的电脑上工作</div><button className="btn ghost sm" id="dev-new" onClick={startPairing}>连接新计算机</button></div>
        <div id="dev-list">
          {S.devs.devices.length ? <div className="sk-grid">{S.devs.devices.map((d: Dict) => (
            <div className="sk-card dev-card" key={d.id}>
              <div className="sk-top"><span className="auto-ico"><Icon name="laptop" /></span><div className="sk-title">{d.name}<div className="sk-name">{d.os || "尚未连接"}{d.myBrowser ? " · 使用你的 Chrome" : ""}</div></div>
                <ConnSt cls={d.online ? "ok" : ""}>{d.online ? "在线" : "离线"}</ConnSt></div>
              <div className="sk-desc" style={{ minHeight: 0 }}>{d.workdir ? <>工作目录 <code>{d.workdir}</code></> : "在这台电脑上运行连接器后即可使用"}</div>
              <div className="sk-meta"><label className="check dev-trust" title="开启后，在这台电脑上执行命令和修改文件不再逐次确认">
                <input type="checkbox" key={`${d.id}:${!!d.autoApprove}`} defaultChecked={!!d.autoApprove} onChange={(e) => trust(d, e.target)} />信任此设备</label>
                <span>{(S.devs.tasks[d.id] || []).length} 个任务</span><span className="spacer"></span>
                <button className="btn ghost sm" disabled={!d.online} onClick={() => newTaskOn("dev:" + d.id)}><Icon name="newTask" />新任务</button>
                <button className="icon-btn sm" title="移除" onClick={() => removeDev(d)}><Icon name="trash" /></button></div>
            </div>))}</div>
            : <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>还没有连接的设备。连接后，任务可以直接在你的电脑上运行命令、处理本地文件，或使用你自己的浏览器。</div>}
        </div>
        <div className="nav-section" style={{ paddingLeft: 0 }}>创建云电脑 · 为你找到合适的配置</div>
        <div id="pc-templates" className="sk-grid">
          {templates.map((t: Dict) => (
            <div className="sk-card" key={t.id} onClick={() => openPcNew(t.id)}>
              <div className="sk-top"><span className="auto-ico"><Icon name={tplIcon(t.id)} /></span><div className="sk-title">{t.name}<div className="sk-name">{t.os}{t.tags.map((x: string) => ` · ${x}`).join("")}</div></div></div>
              <div className="sk-desc">{t.description}</div></div>))}
          {unavailable.map((t: Dict, i: number) => (
            <div className="sk-card off" title="暂不支持" key={`u${i}`}>
              <div className="sk-top"><span className="auto-ico"><Icon name="monitor" /></span><div className="sk-title">{t.name}<div className="sk-name">{t.os}{t.tags.map((x: string) => ` · ${x}`).join("")}</div></div><span className="lib-tag">暂不支持</span></div>
              <div className="sk-desc">{t.description}</div></div>))}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ create dialog ---
export function PcNewModal() {
  useStore();
  const m = S.modals.pcnew;
  if (!m) return null;
  return <PcNewForm key={m._k} tpl={m.tpl || "custom"} />;
}
function PcNewForm({ tpl }: { tpl: string }) {
  const { templates, cpus, memory } = S.pcs;
  const sync = (id: string) => {
    const t = templates.find((x: Dict) => x.id === id);
    return t ? { cpus: String(t.cpus), memory: String(t.memory), autoStop: String(t.autoStop || 0), ph: t.name, desc: t.description + (t.setup ? " 创建后会自动安装所需软件，需要几分钟。" : "") } : null;
  };
  const init = sync(tpl);
  const [template, setTemplate] = useState(tpl);
  const [name, setName] = useState("");
  const [cpu, setCpu] = useState(init?.cpus ?? String(cpus?.[0] ?? ""));
  const [mem, setMem] = useState(init?.memory ?? String(memory?.[0] ?? ""));
  const [autoStop, setAutoStop] = useState(init?.autoStop ?? "0");
  const [ph, setPh] = useState(init?.ph ?? "例如：数据服务器");
  const [desc, setDesc] = useState(init?.desc ?? "");
  const [err, setErr] = useState("");
  const changeTpl = (id: string) => {
    setTemplate(id);
    const s = sync(id); if (!s) return;
    setCpu(s.cpus); setMem(s.memory); setAutoStop(s.autoStop); setPh(s.ph); setDesc(s.desc);
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const r = await jfetch("/api/computers", "POST", { template, name, cpus: +cpu, memory: +mem, autoStop: +autoStop });
    if (!r.ok) { setErr(await errText(r, "创建失败")); return; }
    closeModal("pcnew");
    await loadComputers();
  };
  const close = () => closeModal("pcnew");
  return (
    <div id="pcnew-modal">
      <form className="sched-card" id="pcnew-form" autoComplete="off" onSubmit={save}>
        <div className="viewer-head"><div className="viewer-title"><div style={{ fontSize: 16, fontWeight: 500 }}>创建云电脑</div></div><button type="button" className="icon-btn" id="pcnew-close" onClick={close}><Icon name="x" /></button></div>
        <div className="sched-body">
          <label>模板<select name="template" id="pcnew-template" value={template} onChange={(e) => changeTpl(e.target.value)}>
            {templates.map((t: Dict) => <option value={t.id} key={t.id}>{t.name}</option>)}</select></label>
          <div className="muted" id="pcnew-desc" style={{ fontSize: 12, marginTop: -6 }}>{desc}</div>
          <label>名称<input name="name" placeholder={ph} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <div className="sched-row">
            <label>CPU<select name="cpus" id="pcnew-cpus" value={cpu} onChange={(e) => setCpu(e.target.value)}>{(cpus || []).map((n: number) => <option value={n} key={n}>{n} 核</option>)}</select></label>
            <label>内存<select name="memory" id="pcnew-mem" value={mem} onChange={(e) => setMem(e.target.value)}>{(memory || []).map((n: number) => <option value={n} key={n}>{n} GB</option>)}</select></label>
          </div>
          <label>空闲时自动关机<select name="autoStop" value={autoStop} onChange={(e) => setAutoStop(e.target.value)}>
            <option value="0">从不（始终在线）</option><option value="30">空闲 30 分钟后</option><option value="60">空闲 1 小时后</option><option value="120">空闲 2 小时后</option></select></label>
          <div className="sched-err" id="pcnew-err">{err}</div>
        </div>
        <div className="cc-actions"><button type="button" className="btn ghost" id="pcnew-cancel" onClick={close}>取消</button><button type="submit" className="btn primary">创建</button></div>
      </form>
    </div>
  );
}

// ------------------------------------------------------------------ computer dialog ---
const PCV_TABS: [string, string][] = [["desktop", "桌面"], ["console", "终端"], ["ports", "端口"], ["tasks", "任务"], ["settings", "设置"]];

export function PcViewModal() {
  useStore();
  if (!S.pcOpen) return null;
  return <PcView key={S.pcOpen} />;
}
function PcView() {
  const c: Dict | undefined = S.pcs.computers.find((x: Dict) => x.id === S.pcOpen);
  useEffect(() => { if (!c) closePcView(); });
  if (!c) return null;
  const on = ["running", "ready"].includes(c.status);
  const pcCall = async (op: string) => {
    const r = await fetch(`/api/computers/${c.id}/${op}`, { method: "POST" });
    if (!r.ok) alert(await errText(r, "操作失败"));
    await loadComputers();
  };
  return (
    <div id="pcview-modal">
      <div className="sched-card pcview-card">
        <div className="viewer-head"><span className="auto-ico"><Icon name="monitor" /></span>
          <div className="viewer-title"><div id="pcv-name" style={{ fontSize: 16, fontWeight: 500 }}>{c.name} <PcSt c={c} /></div>
            <div id="pcv-sub" className="muted" style={{ fontSize: 12 }}>Linux · {c.cpus} CPU · {c.memory} GB · 创建于 {fmtDate(c.createdAt)}</div></div>
          <button className="btn ghost sm" id="pcv-power" disabled={["starting", "setting_up"].includes(c.status)} onClick={() => pcCall(on ? "stop" : "start")}>
            {on ? <><Icon name="stop" />关机</> : <><Icon name="play2" />开机</>}</button>
          <button type="button" className="icon-btn" id="pcv-close" onClick={closePcView}><Icon name="x" /></button></div>
        <div className="lib-tabs" id="pcv-tabs" style={{ padding: "10px 18px 0" }}>
          {PCV_TABS.map(([k, l]) => <button key={k} className={cx("lib-tab", S.pcTab === k && "on")} onClick={() => { S.pcTab = k; render(); }}>{l}</button>)}
        </div>
        <div className="pcv-body" id="pcv-body">
          {S.pcTab === "desktop" ? <DesktopTab c={c} on={on} />
            : S.pcTab === "console" ? <ConsoleTab c={c} on={on} />
            : S.pcTab === "ports" ? <PortsTab c={c} />
            : S.pcTab === "tasks" ? <TasksTab c={c} />
            : <SettingsTab c={c} key={c.id} />}
        </div>
      </div>
    </div>
  );
}

function DesktopTab({ c, on }: { c: Dict; on: boolean }) {
  const screen = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"ok" | "disconnected" | "failed">("ok");
  useEffect(() => {
    if (!on) return;
    setState("ok");
    let alive = true, rfb: RFBClient = null;
    (async () => {
      let RFB;
      try { RFB = await loadRFB(); } catch { if (alive) setState("failed"); return; }
      if (!alive || !screen.current) return;
      rfb = new RFB(screen.current, wsUrl(`/api/computers/${c.id}/vnc`), { wsProtocols: ["binary"] });
      rfb.scaleViewport = true; rfb.background = "transparent";
      rfb.addEventListener("disconnect", () => { rfb = null; if (alive) setState("disconnected"); });
    })();
    return () => { alive = false; if (rfb) { try { rfb.disconnect(); } catch { /* closed */ } rfb = null; } };
  }, [c.id, on]);
  if (!on) return <div className="pc-empty" style={{ height: 420 }}><Icon name="monitor" /><span>{c.status === "setting_up" ? "正在安装模板所需的软件…" : c.status === "starting" ? "正在开机…" : "电脑已关机，点击右上角「开机」"}</span></div>;
  if (state === "failed") return <div className="pc-empty">无法加载远程桌面组件</div>;
  return <>
    {state === "disconnected"
      ? <div className="pcv-screen" id="pcv-screen" key="d"><div className="pc-empty" style={{ height: 400 }}>桌面连接已断开</div></div>
      : <div className="pcv-screen" id="pcv-screen" key="s" ref={screen}></div>}
    <div className="muted" style={{ fontSize: 12, padding: "6px 2px" }}>可以直接操作这台电脑的桌面；Agent 在这台电脑上运行任务时，画面也会显示在这里。</div>
  </>;
}

function ConsoleTab({ c, on }: { c: Dict; on: boolean }) {
  const [out, setOut] = useState(c.setupLog ? c.setupLog + "\n" : "");
  const [enabled] = useState(on); // like the legacy client, decided when the tab opens
  const [busy, setBusy] = useState(false);
  const [cmd, setCmd] = useState("");
  const outRef = useRef<HTMLDivElement>(null), inp = useRef<HTMLInputElement>(null);
  useEffect(() => { if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight; }, [out]);
  useEffect(() => { if (!busy && enabled && out) inp.current?.focus(); }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (e: FormEvent) => {
    e.preventDefault();
    const command = cmd.trim(); if (!command) return;
    setCmd(""); setBusy(true);
    const r = await jfetch(`/api/computers/${c.id}/exec`, "POST", { command });
    const j = await r.json().catch(() => ({}));
    setOut((o) => o + (r.ok ? j.output : `错误：${j.detail}`) + "\n");
    setBusy(false);
  };
  return <>
    <div className="term pcv-term" id="pcv-out" ref={outRef}>{out}</div>
    <form id="pcv-cmd-form" className="pcv-cmd" onSubmit={run}><span>$</span>
      <input id="pcv-cmd" ref={inp} placeholder={enabled ? "输入命令，回车执行" : "电脑已关机"} disabled={!enabled || busy} autoComplete="off" value={cmd} onChange={(e) => setCmd(e.target.value)} /></form>
  </>;
}

function PortsTab({ c }: { c: Dict }) {
  const [port, setPort] = useState("");
  const [err, setErr] = useState("");
  const remove = async (i: number) => {
    const ports = c.ports.filter((_: Dict, k: number) => k !== i);
    await jfetch(`/api/computers/${c.id}`, "PATCH", { ports }); loadComputers();
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    const p = +port; if (!p) return;
    const r = await jfetch(`/api/computers/${c.id}`, "PATCH", { ports: [...c.ports.map(({ port, label }: Dict) => ({ port, label })), { port: p }] });
    if (!r.ok) { setErr(await errText(r, "开放失败")); return; }
    setPort(""); setErr("");
    loadComputers(); loadAgents();
  };
  return <>
    <p className="auto-intro" style={{ margin: "4px 0 12px" }}>开放端口后，这台电脑上监听该端口的服务会获得一个固定地址，任何拿到链接的人都能访问。</p>
    {c.ports.length ? c.ports.map((p: Dict, i: number) => (
      <div className="hook-url" key={i}><span className="lib-tag">{p.port}</span><code>{p.url}</code><a className="btn ghost sm" href={p.url} target="_blank"><Icon name="external" />打开</a>
        <button className="icon-btn sm" title="关闭端口" onClick={() => remove(i)}><Icon name="x" /></button></div>))
      : <div className="muted">还没有开放端口</div>}
    <form className="pcv-cmd" id="pcv-port-form" style={{ marginTop: 14 }} onSubmit={add}>
      <input id="pcv-port" type="number" min="1" max="65535" placeholder="端口号，例如 3000" value={port} onChange={(e) => setPort(e.target.value)} />
      <button className="btn primary sm">开放端口</button></form>
    <div className="sched-err" id="pcv-port-err">{err}</div>
  </>;
}

function TasksTab({ c }: { c: Dict }) {
  const tasks = (S.pcs.tasks[c.id] || []).map((id: string) => S.sessions.find((x) => x.id === id)).filter(Boolean) as Dict[];
  return <>
    <div style={{ margin: "4px 0 12px" }}><button className="btn primary sm" onClick={() => newTaskOn(c.id)}><Icon name="newTask" />在这台电脑上新建任务</button></div>
    {tasks.length ? tasks.map((x) => (
      <div className="session-item" key={x.id} onClick={() => { closePcView(); openSession(x.id); }}><span className="s-ico"><Icon name="message" /></span><span className="s-title">{x.title}</span></div>))
      : <div className="muted">还没有任务</div>}
  </>;
}

function SettingsTab({ c }: { c: Dict }) {
  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = e.currentTarget.elements as unknown as Record<string, HTMLInputElement>;
    await jfetch(`/api/computers/${c.id}`, "PATCH", { name: f.name.value, autoStop: +f.autoStop.value });
    loadComputers();
  };
  const del = async () => {
    if (!confirm(`删除「${c.name}」？电脑上的所有文件都会被清除，相关任务会保留。`)) return;
    await fetch(`/api/computers/${c.id}`, { method: "DELETE" }); closePcView(); loadComputers();
  };
  return (
    <form id="pcv-settings" className="sched-body" style={{ padding: "4px 0" }} onSubmit={save}>
      <label>名称<input name="name" defaultValue={c.name} /></label>
      <label>空闲时自动关机<select name="autoStop" defaultValue={String(c.autoStop)}>
        {([[0, "从不（始终在线）"], [30, "空闲 30 分钟后"], [60, "空闲 1 小时后"], [120, "空闲 2 小时后"]] as [number, string][]).map(([v, l]) => <option value={v} key={v}>{l}</option>)}</select></label>
      <div className="cc-actions" style={{ padding: 0 }}><button type="button" className="btn ghost danger" id="pcv-del" onClick={del}><Icon name="trash" />删除这台电脑</button><span className="spacer"></span><button className="btn primary">保存</button></div>
    </form>
  );
}

// ------------------------------------------------------------------ pairing dialog ---
export function DevNewModal() {
  useStore();
  if (!S.pairing) return null;
  return <DevNew key={S.pairing.token} />;
}
function DevNew() {
  const p = S.pairing!;
  const [copied, setCopied] = useState<Record<string, boolean>>({});
  const server = p.server.startsWith("http://localhost") || p.server.startsWith("http://127.") ? location.origin : p.server;
  const online = S.devs.devices.find((d: Dict) => d.id === p.device.id)?.online;
  const run = `python3 openmanus_device.py --server ${server} --token ${p.token}${p.myBrowser ? " --my-browser http://127.0.0.1:9222" : ""}`;
  const cmd = (label: string, text: string) => <>
    <div className="mcp-label">{label}</div>
    <div className="hook-url"><code>{text}</code><button className="btn ghost sm" onClick={async () => { if (await copyText(text)) setCopied((x) => ({ ...x, [text]: true })); }}><Icon name="copy" />{copied[text] ? "已复制" : "复制"}</button></div>
  </>;
  return (
    <div id="devnew-modal">
      <div className="sched-card devnew-card">
        <div className="viewer-head"><div className="viewer-title"><div style={{ fontSize: 16, fontWeight: 500 }}>连接新计算机</div></div><button type="button" className="icon-btn" id="devnew-close" onClick={closePairing}><Icon name="x" /></button></div>
        <div className="sched-body" id="devnew-body">
          <div className="share-desc">在要连接的电脑上打开终端，依次运行下面的命令。连接器只主动向 OpenManus 建立连接，不会在这台电脑上开放端口；OpenManus 在这台电脑上执行每条命令、修改每个文件之前都会先征求你的同意。</div>
          {cmd("1. 下载连接器", `curl -fsSLo openmanus_device.py ${server}/api/devices/agent.py`)}
          {cmd("2. 安装依赖（Python 3.10+）", `pip install fastapi "uvicorn[standard]" httpx python-multipart websockets playwright && python3 -m playwright install chromium`)}
          {cmd("3. 运行（令牌只显示这一次）", run)}
          <label className="check"><input type="checkbox" id="devnew-mybrowser" checked={!!p.myBrowser} onChange={(e) => { p.myBrowser = e.target.checked; setCopied({}); render(); }} />使用我自己的 Chrome（My Browser：保留你的登录状态）</label>
          {p.myBrowser ? cmd("先用调试端口启动 Chrome（建议使用单独的配置目录）", `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222 --user-data-dir="$HOME/.openmanus-chrome"`) : null}
        </div>
        <div className="cc-actions"><span id="devnew-status" className="muted">{online ? <ConnSt cls="ok">已连接</ConnSt> : <><Spin />等待这台电脑连接…</>}</span><span className="spacer"></span>
          <button className="btn primary" id="devnew-done" onClick={closePairing}>完成</button></div>
      </div>
    </div>
  );
}
