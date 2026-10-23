// 设置: account, members, general, usage, shortcuts, data management, developer API keys.
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { S, useStore, openModal, closeModal, type Dict } from "../store";
import { Icon, cx, fmtDate, fmtDur, fmtNum, jfetch, store } from "../lib/util";
import { defaultSel, openPersonal, openPlugins, openSession, openSkills, selLabel, setTheme } from "../actions";

const SET_TABS: [string, string, string][] = [["account", "账户", "user"], ["members", "成员", "users"], ["general", "通用", "sun"], ["usage", "用量", "chart"], ["shortcuts", "快捷键", "list"], ["data", "数据管理", "folder"], ["developer", "开发者", "code"], ["personal", "个性化", "user"], ["skills", "技能", "spark"], ["plugins", "插件与连接器", "puzzle"]];

export function openSettings(tab = "account") {
  if (tab === "members" && S.me?.role !== "admin") tab = "account";
  if (["personal", "skills", "plugins"].includes(tab)) {
    closeModal("settings");
    if (tab === "personal") openPersonal(); else if (tab === "skills") openSkills("mine"); else openPlugins();
    return;
  }
  openModal("settings", { tab });
}

/** Submit a settings form as JSON; returns [ok, body]. */
async function call(url: string, body: unknown, method = "POST"): Promise<[boolean, Dict]> {
  const r = await jfetch(url, method, body);
  return [r.ok, await r.json().catch(() => ({}))];
}
const formData = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); return Object.fromEntries(new FormData(e.currentTarget)); };

export function SettingsModal() {
  const s = useStore();
  const m = s.modals.settings;
  if (!m) return null;
  return <Settings key={m._k} tab={m.tab || "account"} />;
}

function Settings({ tab }: { tab: string }) {
  let body: ReactNode;
  if (tab === "account") body = <Account />;
  else if (tab === "members") body = <Members />;
  else if (tab === "data") body = <DataTab />;
  else if (tab === "developer") body = <Developer />;
  else if (tab === "general") body = <General />;
  else if (tab === "shortcuts") body = ([["⌘ / Ctrl + K", "新建任务"], ["Enter", "发送消息"], ["Shift + Enter", "换行"], ["Esc", "关闭预览 / 退出全屏"], ["← →", "在幻灯片查看器中翻页（幻灯片文件内）"]] as [string, string][])
    .map(([k, d]) => <div key={k} className="set-row"><span>{d}</span><kbd className="kbd">{k}</kbd></div>);
  else body = <Usage />;
  return (
    <div id="settings-modal">
      <div className="sched-card settings-card">
        <div className="settings-nav"><div className="settings-title">设置</div><div id="set-tabs">
          {SET_TABS.map(([k, l, ic]) => <button key={k} className={cx("set-tab", k === tab && "on")} onClick={() => openSettings(k)}><Icon name={ic} />{l}</button>)}
        </div></div>
        <div className="settings-main"><div className="viewer-head"><div className="viewer-title"><div id="set-h" style={{ fontSize: 16, fontWeight: 500 }}>{SET_TABS.find((x) => x[0] === tab)?.[1]}</div></div>
          <button type="button" className="icon-btn" id="set-close" onClick={() => closeModal("settings")}><Icon name="x" /></button></div>
          <div className="settings-body" id="set-body">{body}</div></div>
      </div>
    </div>
  );
}

function Account() {
  const [err, setErr] = useState("");
  const me = S.me;
  if (me) {
    const logout = async () => { await fetch("/api/auth/logout", { method: "POST" }); location.reload(); };
    const pw = async (e: FormEvent<HTMLFormElement>) => { const [ok, j] = await call("/api/auth/password", formData(e)); setErr(ok ? "已修改" : (j.detail || "修改失败")); };
    return <>
      <div className="set-row"><div><b>{me.name}</b><div className="muted">@{me.username} · {me.role === "admin" ? "管理员" : "成员"}{me.feishu ? " · 飞书账号" : ""}</div></div><button className="btn ghost sm" id="set-logout" onClick={logout}>退出登录</button></div>
      <form className="sched-body" id="set-pw" style={{ padding: "14px 0" }} onSubmit={pw}><div className="mcp-label">修改密码</div>
        <div className="sched-row"><label>原密码<input name="old" type="password" autoComplete="current-password" /></label><label>新密码<input name="new" type="password" autoComplete="new-password" minLength={8} /></label></div>
        <div className="cc-actions" style={{ padding: 0 }}><span className="sched-err" id="set-pw-err">{err}</span><span className="spacer"></span><button className="btn primary sm">保存</button></div></form>
    </>;
  }
  const setup = async (e: FormEvent<HTMLFormElement>) => { const [ok, j] = await call("/api/auth/setup", formData(e)); if (!ok) { setErr(j.detail || "创建失败"); return; } location.reload(); };
  return <>
    <div className="set-row"><div><b>单用户模式</b><div className="muted">当前没有账号，任何能打开这个页面的人都能看到所有任务。创建管理员账号后启用登录，现有数据归管理员所有，再由管理员添加成员。</div></div></div>
    <form className="sched-body" id="set-setup" style={{ padding: "14px 0" }} onSubmit={setup}><div className="mcp-label">创建管理员账号</div>
      <div className="sched-row"><label>用户名<input name="username" autoComplete="username" required /></label><label>名字<input name="name" /></label></div>
      <label>密码（至少 8 位）<input name="password" type="password" autoComplete="new-password" minLength={8} required /></label>
      <div className="cc-actions" style={{ padding: 0 }}><span className="sched-err" id="set-setup-err">{err}</span><span className="spacer"></span><button className="btn primary sm">创建并启用登录</button></div></form>
  </>;
}

function Members() {
  const [users, setUsers] = useState<Dict[] | null>(null);
  const [err, setErr] = useState("");
  const load = async () => setUsers(await (await fetch("/api/users")).json());
  useEffect(() => { load(); }, []);
  if (!users) return null;
  const del = async (id: string) => {
    if (!confirm("删除这个成员？他的任务和数据会保留在服务器上，但无法再登录。")) return;
    await fetch(`/api/users/${id}`, { method: "DELETE" }); openSettings("members");
  };
  const add = async (e: FormEvent<HTMLFormElement>) => { const [ok, j] = await call("/api/users", formData(e)); if (!ok) { setErr(j.detail || "添加失败"); return; } openSettings("members"); };
  return <>
    {users.map((u) => <div key={u.id} className="set-row"><div><b>{u.name}</b><div className="muted">@{u.username} · {u.role === "admin" ? "管理员" : "成员"}{u.feishu ? " · 飞书" : ""}</div></div>
      {u.id === S.me?.id ? <span className="muted">你</span> : <button className="icon-btn sm" title="删除" onClick={() => del(u.id)}><Icon name="trash" /></button>}</div>)}
    <form className="sched-body" id="set-adduser" style={{ padding: "14px 0" }} onSubmit={add}><div className="mcp-label">添加成员</div>
      <div className="sched-row"><label>用户名<input name="username" required /></label><label>名字<input name="name" /></label></div>
      <div className="sched-row"><label>初始密码<input name="password" type="password" minLength={8} required /></label><label>角色<select name="role"><option value="member">成员</option><option value="admin">管理员</option></select></label></div>
      <div className="cc-actions" style={{ padding: 0 }}><span className="sched-err" id="set-adduser-err">{err}</span><span className="spacer"></span><button className="btn primary sm">添加</button></div></form>
  </>;
}

function DataTab() {
  const wipe = async () => {
    if (!(confirm("确定删除你的所有任务？此操作无法恢复。") && confirm("再次确认：删除全部任务及其文件？"))) return;
    const r = await (await fetch("/api/data/tasks", { method: "DELETE" })).json();
    alert(`已删除 ${r.deleted} 个任务`); location.hash = ""; location.reload();
  };
  return <>
    <div className="set-row"><div><b>导出数据</b><div className="muted">下载你的全部任务（对话、步骤、保存的文件）、项目、自动化、Agent 和个性化设置（zip）</div></div><a className="btn ghost sm" href="/api/data/export"><Icon name="download" />导出</a></div>
    <div className="set-row"><div><b>删除所有任务</b><div className="muted">删除你的全部任务及其沙箱和文件，无法恢复。项目、技能和设置会保留。</div></div><button className="btn ghost sm danger" id="set-wipe" onClick={wipe}><Icon name="trash" />删除</button></div>
  </>;
}

function Developer() {
  const [keys, setKeys] = useState<Dict[] | null>(null);
  const [newKey, setNewKey] = useState("");
  const [copied, setCopied] = useState(false);
  const load = async () => setKeys(await (await fetch("/api/keys")).json());
  useEffect(() => { load(); }, []);
  if (!keys) return null;
  const origin = location.origin;
  const create = async (e: FormEvent<HTMLFormElement>) => {
    const form = e.currentTarget;
    const [ok, j] = await call("/api/keys", formData(e));
    if (ok) { form.reset(); await load(); setNewKey(j.key); setCopied(false); }
  };
  const del = async (id: string) => {
    if (!confirm("删除这个密钥？使用它的程序将立即失效。")) return;
    await fetch(`/api/keys/${id}`, { method: "DELETE" }); setNewKey(""); load();
  };
  const example = `curl -X POST ${origin}/api/v1/tasks \\\n  -H "Authorization: Bearer om_..." -H "Content-Type: application/json" \\\n  -d '{"prompt": "调研……并输出报告", "mode": "standard"}'\n\ncurl ${origin}/api/v1/tasks/<id> -H "Authorization: Bearer om_..."\n# → {status, result, files[], url}\n\ncurl -X POST ${origin}/api/v1/tasks/<id>/messages -H "Authorization: Bearer om_..." \\\n  -H "Content-Type: application/json" -d '{"content": "继续"}'`;
  return <>
    <div className="muted" style={{ fontSize: 13, margin: "6px 0 10px" }}>用 API 密钥从脚本或其他系统创建任务、查询结果。密钥只在创建时显示一次。</div>
    {keys.length ? keys.map((k) => <div key={k.id} className="set-row"><div><b>{k.name}</b><div className="muted"><code>{k.prefix}…</code> · 创建于 {fmtDate(k.createdAt)}{k.lastUsed ? ` · 最近使用 ${fmtDate(k.lastUsed)}` : " · 从未使用"}</div></div>
      <button className="icon-btn sm" title="删除" onClick={() => del(k.id)}><Icon name="trash" /></button></div>) : <div className="muted">还没有 API 密钥</div>}
    <form className="pcv-cmd" id="set-newkey" style={{ margin: "14px 0" }} onSubmit={create}><input name="name" placeholder="密钥名称，例如：CI 机器人" /><button className="btn primary sm">创建密钥</button></form>
    <div id="set-keyout">{newKey && <>
      <div className="hook-url"><code>{newKey}</code><button type="button" className="btn ghost sm" onClick={() => { navigator.clipboard?.writeText(newKey); setCopied(true); }}><Icon name="copy" />{copied ? "已复制" : "复制"}</button></div>
      <div className="sched-err">请立即复制保存，关闭后无法再次查看。</div></>}</div>
    <div className="mcp-label">示例</div><pre className="cc-cmd">{example}</pre>
  </>;
}

function General() {
  const [, bump] = useState(0);
  const notify = store.get("notify", "0") === "1";
  const toggleNotify = async () => {
    const on = store.get("notify", "0") !== "1";
    if (on && window.Notification && Notification.permission !== "granted") { if ((await Notification.requestPermission()) !== "granted") return; }
    store.set("notify", on ? "1" : "0"); bump((n) => n + 1);
  };
  return <>
    <div className="set-row"><div><b>外观</b><div className="muted">浅色、深色或跟随系统</div></div>
      <select id="set-theme" defaultValue={store.get("theme", "auto")} onChange={(e) => setTheme(e.target.value)}>{[["auto", "跟随系统"], ["light", "浅色"], ["dark", "深色"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
    <div className="set-row"><div><b>桌面通知</b><div className="muted">页面在后台时，任务完成、需要你回复或确认时提醒你</div></div><button className={cx("switch", notify && "on")} id="set-notify" onClick={toggleNotify}><i></i></button></div>
    <div className="set-row"><div><b>Mail Manus</b><div className="muted">{S.cfg.mail ? "把任务发邮件到这个地址，OpenManus 会完成后回信给你（多用户模式下需使用账号登记的邮箱）" : "未配置：设置 MANUS_MAIL_IMAP_HOST / USER / PASSWORD（以及回信用的 SMTP_HOST）后可通过邮件分配任务"}</div></div><span>{S.cfg.mail || "—"}</span></div>
    <div className="set-row"><div><b>默认模式</b><div className="muted">新任务默认使用的模式，可在顶栏随时切换</div></div><span>{selLabel(defaultSel())}</span></div>
  </>;
}

function Usage() {
  const [u, setU] = useState<Dict | null>(null);
  useEffect(() => { (async () => setU(await (await fetch("/api/usage")).json()))(); }, []);
  if (!u) return <div className="pc-empty" style={{ height: 200 }}><span className="shimmer">加载中</span></div>;
  const t = u.total;
  const stat = (n: ReactNode, l: string) => <div className="stat-tile"><div className="n">{n}</div><div className="l">{l}</div></div>;
  const go = (id: string) => (e: { preventDefault(): void }) => { e.preventDefault(); closeModal("settings"); openSession(id); };
  return <>
    <div className="stat-grid">{stat(t.tasks, "任务")}{stat(fmtDur(t.activeMs), "运行时长")}{stat(fmtNum(t.llmCalls), "模型调用")}{stat(fmtNum(t.toolCalls), "工具调用")}{stat(fmtNum(t.input), "输入 tokens")}{stat(fmtNum(t.output), "输出 tokens")}</div>
    <div className="muted" style={{ fontSize: 12, margin: "-4px 0 12px" }}>其中 {fmtNum(t.cached)} 个输入 tokens 命中缓存（{t.input ? Math.round(t.cached / t.input * 100) : 0}%）。</div>
    <div className="mcp-label">按模型</div><table className="u-table"><tbody><tr><th>模型</th><th>调用</th><th>输入</th><th>输出</th></tr>
      {u.models.map((m: Dict) => <tr key={m.model}><td>{m.model}</td><td>{fmtNum(m.calls)}</td><td>{fmtNum(m.input)}</td><td>{fmtNum(m.output)}</td></tr>)}</tbody></table>
    <div className="mcp-label">按日期</div><table className="u-table"><tbody><tr><th>日期</th><th>任务</th><th>运行时长</th><th>输入</th><th>输出</th></tr>
      {u.days.map((d: Dict) => <tr key={d.day}><td>{d.day}</td><td>{d.tasks}</td><td>{fmtDur(d.activeMs)}</td><td>{fmtNum(d.input)}</td><td>{fmtNum(d.output)}</td></tr>)}</tbody></table>
    <div className="mcp-label">用量最多的任务</div><table className="u-table"><tbody><tr><th>任务</th><th>时长</th><th>tokens</th></tr>
      {u.tasks.map((x: Dict) => <tr key={x.id}><td><a href={`#${x.id}`} onClick={go(x.id)}>{x.title}</a></td><td>{fmtDur(x.activeMs)}</td><td>{fmtNum(x.input + x.output)}</td></tr>)}</tbody></table>
  </>;
}
