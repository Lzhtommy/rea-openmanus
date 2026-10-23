// 技能: explore official and community skills, manage my skills, create / upload / import.
import { useState, type ChangeEvent, type FormEvent, type MouseEvent } from "react";
import { S, render, useStore, openModal, closeModal, type Dict } from "../store";
import { Icon, Prose, SK_SRC, Spin, cx, errText, jfetch } from "../lib/util";
import { loadSkills, openRecorder, openSkill, prefill, useSkill } from "../actions";

const installing = new Set<string>();

async function skAction(op: string, x: Dict) {
  S.skErr = "";
  if (op === "toggle" || op === "enable") {
    await jfetch(`/api/skills/${x.name}`, "PATCH", { enabled: op === "enable" || !x.enabled });
  }
  if (op === "install") {
    installing.add(x.url); render();
    const r = await jfetch("/api/skills/import", "POST", { url: x.url });
    installing.delete(x.url);
    if (!r.ok) S.skErr = await errText(r, "添加失败");
  }
  await loadSkills();
}

function SkCard({ x, kind }: { x: Dict; kind: "catalog" | "explore" | "mine" }) {
  const act = (op: string) => (e: MouseEvent) => { e.stopPropagation(); skAction(op, x); };
  let action;
  if (kind === "catalog") action = x.installed ? <span className="sk-added"><Icon name="check" />已添加</span>
    : installing.has(x.url) ? <button className="btn ghost sm" disabled><Spin />添加中</button>
      : <button className="btn ghost sm" onClick={act("install")}><Icon name="plus" />添加</button>;
  else if (kind === "explore") action = x.enabled ? <span className="sk-added"><Icon name="check" />已添加</span> : <button className="btn ghost sm" onClick={act("enable")}><Icon name="plus" />添加</button>;
  else action = <button className={cx("switch", x.enabled && "on")} title={x.enabled ? "停用" : "启用"} onClick={act("toggle")}><i></i></button>;
  return (
    <div className={cx("sk-card", kind === "mine" && !x.enabled && "off")} onClick={kind !== "catalog" ? () => openSkill(x.name) : undefined}>
      <div className="sk-top"><span className="auto-ico"><Icon name={kind === "catalog" || x.source === "github" ? "github" : "spark"} /></span>
        <div className="sk-title">{x.title || x.name}<div className="sk-name">{x.name}</div></div>{action}</div>
      <div className="sk-desc">{x.summary || x.description}</div>
      <div className="sk-meta">
        {kind === "catalog" ? <span><Icon name="github" />{x.author}</span> : <><span>{x.author || SK_SRC[x.source]}</span>{x.uses ? <span>已使用 {x.uses} 次</span> : null}</>}
        <span className="spacer"></span>{(x.categories || []).map((c: string) => <span key={c} className="lib-tag">{c}</span>)}
      </div>
    </div>
  );
}

function newSkill(kind: string) {
  S.menus.skCreate = false;
  if (kind === "record") { render(); return openRecorder(); }
  if (kind === "agent") return prefill("帮我创建一个技能：", ["skill-creator"]);
  openModal("skillNew", { kind });
}

async function upload(e: ChangeEvent<HTMLInputElement>) {
  S.menus.skCreate = false; render();
  const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
  const fd = new FormData(); fd.append("file", f);
  const r = await fetch("/api/skills/upload", { method: "POST", body: fd });
  if (!r.ok) { S.skErr = await errText(r, "上传失败"); render(); return; }
  const x = await r.json(); S.skTab = "mine"; S.skSrc = "all"; await loadSkills(); openSkill(x.name);
}

export function Skills() {
  const s = useStore();
  const { skills, catalog, categories } = s.skills;
  const catOk = (x: Dict) => s.skCat === "all" || (x.categories || []).includes(s.skCat);
  let cats, list;
  if (s.skTab === "explore") {
    cats = [["all", "全部"], ...categories.map((c: string) => [c, c])].map(([k, l]) =>
      <button key={k} className={cx("lib-tab", s.skCat === k && "on")} onClick={() => { S.skCat = k; render(); }}>{l}</button>);
    const off = skills.filter((x: Dict) => x.source === "official" && catOk(x)), cat = catalog.filter(catOk);
    list = off.length || cat.length ? <>
      {off.length > 0 && <><div className="nav-section" style={{ paddingLeft: 0 }}>官方技能</div><div className="sk-grid">{off.map((x: Dict) => <SkCard key={x.name} x={x} kind="explore" />)}</div></>}
      {cat.length > 0 && <><div className="nav-section" style={{ paddingLeft: 0 }}>社区技能 · 来自 GitHub</div><div className="sk-grid">{cat.map((x: Dict) => <SkCard key={x.url} x={x} kind="catalog" />)}</div></>}
    </> : <div className="lib-empty"><Icon name="spark" /><div>该分类下还没有技能</div></div>;
  } else {
    const inSrc = (x: Dict, k: string) => (k === "all" ? x.enabled || x.source !== "official" : x.source === k);
    cats = [["all", "全部"], ["personal", "个人"], ["official", "官方"], ["github", "第三方"]].map(([k, l]) =>
      <button key={k} className={cx("lib-tab", s.skSrc === k && "on")} onClick={() => { S.skSrc = k; render(); }}>{l}<span>{skills.filter((x: Dict) => inSrc(x, k)).length}</span></button>);
    const rows = skills.filter((x: Dict) => inSrc(x, s.skSrc));
    list = rows.length ? <div className="sk-grid">{rows.map((x: Dict) => <SkCard key={x.name} x={x} kind="mine" />)}</div>
      : <div className="lib-empty"><Icon name="spark" /><div>尚无技能</div><div className="muted">点击右上角「创建」，或在「探索技能」中添加</div></div>;
  }
  return (
    <div id="skills">
      <div className="lib-inner wide">
        <div className="lib-head"><h2>技能</h2><div className="head-btns">
          <button className={cx("btn ghost", s.skTab === "mine" && "on")} id="sk-mine" onClick={() => { S.skTab = "mine"; render(); }}>我的技能</button>
          <div className="more-wrap"><button className="btn primary" id="sk-create" onClick={() => { S.menus.skCreate = !S.menus.skCreate; render(); }}>创建</button>
            <div className={cx("more-menu right", !s.menus.skCreate && "hidden")} id="sk-create-menu">
              <button className="mode-item" onClick={() => newSkill("agent")}><span><Icon name="logo" /></span>使用 OpenManus 创建技能</button>
              <button className="mode-item" onClick={() => newSkill("write")}><span><Icon name="pencil" /></span>手动编写</button>
              <label className="mode-item"><span><Icon name="upload" /></span>上传技能<input type="file" id="sk-upload" accept=".md,.zip" hidden onChange={upload} /></label>
              <button className="mode-item" onClick={() => newSkill("github")}><span><Icon name="github" /></span>从 GitHub 导入技能</button>
              <button className="mode-item" onClick={() => newSkill("record")}><span><Icon name="record" /></span>录制工作流</button>
            </div></div></div></div>
        <div className="lib-tabs" id="sk-tabs">
          {[["explore", "探索技能"], ["mine", "我的技能"]].map(([k, l]) => <button key={k} className={cx("lib-tab", s.skTab === k && "on")} onClick={() => { S.skTab = k; render(); }}>{l}</button>)}
        </div>
        <div className="lib-tabs sub" id="sk-cats">{cats}</div>
        <div className="sched-err" id="sk-err">{s.skErr}</div>
        <div id="sk-list">{list}</div>
      </div>
    </div>
  );
}

// ---- one skill: SKILL.md, edit, delete, use
export function SkillModal() {
  const s = useStore();
  const m = s.modals.skill;
  if (!m) return null;
  return <SkillView key={m._k} x={m.skill} />;
}

function SkillView({ x }: { x: Dict }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(x.content);
  const [err, setErr] = useState("");
  const save = async () => {
    const r = await jfetch(`/api/skills/${x.name}`, "PUT", { content: text });
    if (!r.ok) { setErr(await errText(r, "保存失败")); return; }
    await loadSkills(); openSkill(x.name);
  };
  const del = async () => {
    if (!confirm(`删除技能「${x.title}」？`)) return;
    await fetch(`/api/skills/${x.name}`, { method: "DELETE" }); closeModal("skill"); await loadSkills();
  };
  return (
    <div id="skill-modal">
      <div className="sched-card skill-card">
        <div className="viewer-head"><span className="auto-ico"><Icon name="spark" /></span><div className="viewer-title">
          <div id="sk-m-title" style={{ fontSize: 16, fontWeight: 500 }}>{x.title || x.name}</div>
          <div id="sk-m-sub" className="muted" style={{ fontSize: 12 }}>{[SK_SRC[x.source], x.author, x.uses ? `已使用 ${x.uses} 次` : "", x.repo || ""].filter(Boolean).join(" · ")}</div></div>
          <button className={cx("btn ghost sm", (!x.editable || editing) && "hidden")} id="sk-m-edit" onClick={() => { setEditing(true); setErr(""); }}>编辑</button>
          <button type="button" className="icon-btn" id="sk-m-close" onClick={() => closeModal("skill")}><Icon name="x" /></button></div>
        <div className="sched-body" id="sk-m-body">
          {editing ? <textarea id="sk-m-text" className="code-edit" rows={22} spellCheck={false} value={text} onChange={(e) => setText(e.target.value)}></textarea> : <>
            <div className="sk-desc full">{x.summary || x.description}</div>
            {x.summary && x.summary !== x.description && <div className="muted" style={{ fontSize: 12 }}>触发条件：{x.description}</div>}
            {x.files.length > 1 && <><div className="mcp-label">文件</div><div className="tool-chips">{x.files.map((f: string) => <span key={f} className="tool-chip">{f}</span>)}</div></>}
            <div className="mcp-label">SKILL.md</div><div className="page-md sk-md"><Prose text={x.content} /></div>
            <div className="cc-actions" style={{ padding: 0 }}><button className="btn ghost sm" onClick={() => useSkill(x.name)}><Icon name="play2" />在新任务中使用</button><span className="spacer"></span>
              {x.source !== "official" && <button className="btn ghost sm danger" onClick={del}><Icon name="trash" />删除</button>}</div>
          </>}
        </div>
        <div className={cx("cc-actions", !editing && "hidden")} id="sk-m-actions"><span className="sched-err" id="sk-m-err">{err}</span><span className="spacer"></span>
          <button className="btn ghost" id="sk-m-cancel" onClick={() => openSkill(x.name)}>取消</button><button className="btn primary" id="sk-m-save" onClick={save}>保存</button></div>
      </div>
    </div>
  );
}

// ---- write a skill by hand / import one from GitHub
export function SkillNewModal() {
  const s = useStore();
  const m = s.modals.skillNew;
  if (!m) return null;
  return <SkillNewForm key={m._k} kind={m.kind} />;
}

function SkillNewForm({ kind }: { kind: string }) {
  const gh = kind === "github";
  const [v, setV] = useState({ title: "", name: "", description: "", body: "", url: "" });
  const [cats, setCats] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: string) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const body = gh ? { url: v.url } : { title: v.title, name: v.name || v.title, description: v.description, body: v.body, categories: cats };
    setBusy(true);
    const r = await jfetch(gh ? "/api/skills/import" : "/api/skills", "POST", body);
    setBusy(false);
    if (!r.ok) { setErr(await errText(r, "保存失败")); return; }
    const x = await r.json();
    closeModal("skillNew");
    S.skTab = "mine"; S.skSrc = "all"; await loadSkills(); openSkill(x.name);
  };
  const label = gh ? "导入" : "保存";
  return (
    <div id="skill-new-modal">
      <form className="sched-card" id="sk-new-form" autoComplete="off" data-kind={kind} onSubmit={save}>
        <div className="viewer-head"><div className="viewer-title"><div id="sk-new-title" style={{ fontSize: 16, fontWeight: 500 }}>{gh ? "从 GitHub 导入技能" : "手动编写技能"}</div></div>
          <button type="button" className="icon-btn" id="sk-new-close" onClick={() => closeModal("skillNew")}><Icon name="x" /></button></div>
        <div className={cx("sched-body", kind !== "write" && "hidden")} id="sk-new-write">
          <div className="sched-row"><label>显示名称<input name="title" placeholder="例如：周报撰写" value={v.title} onChange={set("title")} /></label>
            <label>标识<input name="name" placeholder="weekly-report" pattern="[a-z0-9][a-z0-9-]*" title="小写字母、数字和连字符" value={v.name} onChange={set("name")} /></label></div>
          <label>何时使用（Agent 根据这句话判断是否读取该技能）<input name="description" placeholder="MUST read before writing a weekly report." value={v.description} onChange={set("description")} /></label>
          <div className="sk-cat-pick" id="sk-new-cats"><span className="muted" style={{ fontSize: 13 }}>分类</span>
            {S.skills.categories.map((c: string) => <label key={c} className="check"><input type="checkbox" value={c} checked={cats.includes(c)}
              onChange={(e) => setCats(e.target.checked ? [...cats, c] : cats.filter((x) => x !== c))} />{c}</label>)}</div>
          <label>操作说明（Markdown）<textarea name="body" rows={9} placeholder={"# 周报撰写\n1. 先写本周结论……"} value={v.body} onChange={set("body")}></textarea></label>
        </div>
        <div className={cx("sched-body", !gh && "hidden")} id="sk-new-github">
          <label>GitHub 地址<input name="url" placeholder="https://github.com/owner/repo/tree/main/skills/my-skill" value={v.url} onChange={set("url")} /></label>
          <div className="muted" style={{ fontSize: 12 }}>填写包含 SKILL.md 的目录地址；整个目录（脚本、模板等）都会被导入。</div>
        </div>
        <div className="sched-err" id="sk-new-err" style={{ padding: "0 18px" }}>{err}</div>
        <div className="cc-actions"><button type="button" className="btn ghost" id="sk-new-cancel" onClick={() => closeModal("skillNew")}>取消</button>
          <button type="submit" className="btn primary" id="sk-new-save" disabled={busy}>{busy ? (gh ? "导入中…" : "保存中…") : label}</button></div>
      </form>
    </div>
  );
}
