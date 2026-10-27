// Agent: custom agents with their own role, and teams of them.
import { type FormEvent, useState } from "react";
import { S, render, useStore, openModal, closeModal, type Dict } from "../store";
import { AgAvatar, Icon, cx, errText, jfetch } from "../lib/util";
import { focusInput, goHome, loadAgents, loadSkills } from "../actions";

const MODE_ZH: Dict = { max: "Max", standard: "标准", lite: "Lite" };
const AG_ICONS = ["🔍", "📊", "✍️", "💻", "🧠", "📚", "🎨", "📈", "🧪", "🛠️", "📝", "🌐", "💼", "📣", "🤝", "🎯", "🗂️", "⚖️", "🧾", "🚀"];

/** Pick an agent icon from a preset grid; submits as the hidden `icon` field. Empty = the name's first letter. */
function IconPick({ value }: { value: string }) {
  const [icon, setIcon] = useState(value), [open, setOpen] = useState(false);
  const pick = (x: string) => { setIcon(x); setOpen(false); };
  return (
    <div className="icon-pick">
      <input type="hidden" name="icon" value={icon} />
      <button type="button" className={cx("icon-pick-btn", !icon && "empty")} title="选择图标" onClick={() => setOpen(!open)}>{icon || <Icon name="plus" />}</button>
      {open ? <div className="icon-pick-pop">
        {AG_ICONS.map((x) => <button type="button" key={x} className={cx(x === icon && "on")} onClick={() => pick(x)}>{x}</button>)}
        <button type="button" className={cx("none", !icon && "on")} title="不用图标（显示名称首字）" onClick={() => pick("")}>无</button>
      </div> : null}
    </div>
  );
}

export function Agents() {
  useStore();
  const { agents, teams } = S.ags, byId: Dict = Object.fromEntries(agents.map((a: Dict) => [a.id, a]));
  const run = (key: string) => { goHome(); S.crew = key; focusInput(); };
  const edit = (k: string, id: string) => openModal("ag", { kind: k, item: (k === "team" ? teams : agents).find((x: Dict) => x.id === id) });
  const del = async (k: string, id: string) => {
    if (!confirm("确定删除？")) return;
    await fetch(`/api/${k === "team" ? "teams" : "agents"}/${id}`, { method: "DELETE" }); await loadAgents();
  };
  const foot = (kind: string, id: string) => (
    <div className="sk-meta"><span className="spacer"></span>
      <button className="btn primary sm" onClick={() => run(`${kind}:${id}`)}><Icon name="newTask" />开始任务</button>
      <button className="icon-btn sm" title="编辑" onClick={() => edit(kind, id)}><Icon name="pencil" /></button>
      <button className="icon-btn sm" title="删除" onClick={() => del(kind, id)}><Icon name="trash" /></button></div>
  );
  const tab = (k: string, l: string, n: number) => <button key={k} className={cx("lib-tab", S.agTab === k && "on")} onClick={() => { S.agTab = k; render(); }}>{l}<span>{n}</span></button>;
  return (
    <div id="agents">
      <div className="lib-inner wide">
        <div className="lib-head"><h2>Agent</h2><div className="head-btns">
          <button className="btn ghost" id="ag-new-team" onClick={() => openModal("ag", { kind: "team" })}>组建团队</button>
          <button className="btn primary" id="ag-new" onClick={async () => { await loadSkills(); openModal("ag", { kind: "agent" }); }}>创建 Agent</button></div></div>
        <p className="auto-intro">创建有专门职责的 Agent，并把它们组成协同工作的团队：团队负责人会拆分任务、分派给成员并汇总结果。</p>
        <div className="lib-tabs" id="ag-tabs">{tab("agents", "我的 Agent", agents.length)}{tab("teams", "团队", teams.length)}</div>
        <div id="ag-list" className="sk-grid">
          {S.agTab === "agents"
            ? (agents.length ? agents.map((a: Dict) => (
              <div className="sk-card" key={a.id}><div className="sk-top"><AgAvatar a={a} /><div className="sk-title">{a.name}<div className="sk-name">{MODE_ZH[a.mode] || "默认模式"}{a.skills.length ? ` · ${a.skills.length} 个技能` : ""}</div></div></div>
                <div className="sk-desc">{a.description || a.instructions}</div>{foot("agent", a.id)}</div>))
              : <div className="lib-empty" style={{ gridColumn: "1/-1" }}><Icon name="users" /><div>还没有 Agent</div><div className="muted">创建一个有专门职责的 Agent，例如"行业研究员""周报撰写员"</div></div>)
            : (teams.length ? teams.map((t: Dict) => (
              <div className="sk-card" key={t.id}><div className="sk-top"><span className="ag-stack">{t.members.slice(0, 4).map((m: string, i: number) => byId[m] ? <AgAvatar a={byId[m]} key={i} /> : null)}</span>
                <div className="sk-title">{t.name}<div className="sk-name">{t.members.length} 位成员{byId[t.lead] ? ` · 负责人 ${byId[t.lead].name}` : ""}</div></div></div>
                <div className="sk-desc">{t.description || t.members.map((m: string) => byId[m]?.name).filter(Boolean).join("、")}</div>{foot("team", t.id)}</div>))
              : <div className="lib-empty" style={{ gridColumn: "1/-1" }}><Icon name="users" /><div>还没有团队</div><div className="muted">至少创建两个 Agent，再把它们组成团队</div></div>)}
        </div>
      </div>
    </div>
  );
}

export function AgModal() {
  useStore();
  const m = S.modals.ag;
  if (!m) return null;
  return <AgForm key={m._k} kind={m.kind} item={m.item} />;
}

function AgForm({ kind, item }: { kind: "agent" | "team"; item?: Dict }) {
  const [err, setErr] = useState("");
  const v: Dict = item || {};
  const close = () => closeModal("ag");
  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget), g = (k: string) => String(fd.get(k) ?? "");
    const body = kind === "agent"
      ? { name: g("name"), icon: g("icon"), description: g("description"), instructions: g("instructions"), mode: g("mode"), skills: fd.getAll("skills").map(String) }
      : { name: g("name"), description: g("description"), lead: g("lead"), members: fd.getAll("members").map(String) };
    const base = kind === "agent" ? "/api/agents" : "/api/teams";
    const r = await jfetch(item?.id ? `${base}/${item.id}` : base, item?.id ? "PATCH" : "POST", body);
    if (!r.ok) { setErr(await errText(r, "保存失败")); return; }
    closeModal("ag"); S.agTab = kind === "agent" ? "agents" : "teams";
    await loadAgents();
  };
  const title = (item ? "编辑" : kind === "team" ? "组建" : "创建") + (kind === "team" ? "团队" : " Agent");
  return (
    <div id="ag-modal">
      <form className="sched-card" id="ag-form" autoComplete="off" onSubmit={save}>
        <div className="viewer-head"><div className="viewer-title"><div id="ag-form-title" style={{ fontSize: 16, fontWeight: 500 }}>{title}</div></div><button type="button" className="icon-btn" id="ag-close" onClick={close}><Icon name="x" /></button></div>
        <div className="sched-body" id="ag-form-body">
          {kind === "agent" ? <>
            <div className="sched-row"><label style={{ flex: "none" }}>图标<IconPick value={v.icon || ""} /></label><label>名称<input name="name" placeholder="例如：行业研究员" defaultValue={v.name || ""} /></label></div>
            <label>一句话介绍（团队负责人据此分派任务）<input name="description" placeholder="擅长检索一手资料、核实数据" defaultValue={v.description || ""} /></label>
            <label>职责与工作要求<textarea name="instructions" rows={6} placeholder="你是……；工作时要……；交付物格式……" defaultValue={v.instructions || ""}></textarea></label>
            <label>默认模式<select name="mode" defaultValue={v.mode || ""}><option value="">跟随当前选择</option><option value="max">Max</option><option value="standard">标准</option><option value="lite">Lite</option></select></label>
            {S.skills.skills.length ? <><div className="mcp-label">常用技能</div><div className="sk-cat-pick">
              {S.skills.skills.map((x: Dict) => <label className="check" key={x.name}><input type="checkbox" name="skills" value={x.name} defaultChecked={(v.skills || []).includes(x.name)} />{x.title}</label>)}</div></> : null}
          </> : <>
            <label>团队名称<input name="name" placeholder="例如：内容小组" defaultValue={v.name || ""} /></label>
            <label>团队介绍<input name="description" placeholder="负责行业研究和报告撰写" defaultValue={v.description || ""} /></label>
            <div className="mcp-label">成员</div>
            <div className="sk-cat-pick">{S.ags.agents.length
              ? S.ags.agents.map((a: Dict) => <label className="check" key={a.id}><input type="checkbox" name="members" value={a.id} defaultChecked={(v.members || []).includes(a.id)} />{a.name}</label>)
              : <span className="muted">请先创建 Agent</span>}</div>
            <label>负责人（负责拆分和汇总；不选则由默认 Agent 担任）<select name="lead" defaultValue={v.lead || ""}><option value="">默认</option>
              {S.ags.agents.map((a: Dict) => <option value={a.id} key={a.id}>{a.name}</option>)}</select></label>
          </>}
        </div>
        <div className="cc-actions"><span className="sched-err" id="ag-err">{err}</span><span className="spacer"></span>
          <button type="button" className="btn ghost" id="ag-cancel" onClick={close}>取消</button><button type="submit" className="btn primary">保存</button></div>
      </form>
    </div>
  );
}
