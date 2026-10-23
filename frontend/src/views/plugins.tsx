// 插件: a catalog of ready-made MCP connectors; connecting one asks only for its keys.
import { useState, type FormEvent } from "react";
import { S, render, useStore, openModal, closeModal, type Dict } from "../store";
import { ConnSt, Icon, Spin, cx, jfetch } from "../lib/util";
import { loadPlugins, openConnectors } from "../actions";

function PlugLogo({ p, id }: { p: Dict; id?: string }) {
  return <span className="plug-logo" id={id} style={{ background: p.color }}>{String(p.name).replace(/^[^\p{L}\p{N}]+/u, "").slice(0, 1).toUpperCase()}</span>;
}

function PlugState({ p }: { p: Dict }) {
  const c = p.connector;
  if (!c) return <button className="btn ghost sm" data-plug={p.id}><Icon name="plus" />连接</button>;
  const [cls, label] = c.status === "connected" ? ["ok", "已连接"] : c.status === "error" ? ["err", "连接失败"] : !c.enabled ? ["", "已停用"] : ["", "连接中"];
  return <ConnSt cls={cls} title={c.status === "connected" ? `${c.tools} 个工具` : ""}>{label}</ConnSt>;
}

export function Plugins() {
  const s = useStore();
  const { plugins, categories } = s.plugins;
  const tabs: [string, string][] = [["all", "全部"], ["installed", "已连接"], ...categories.map((c: string) => [c, c] as [string, string])];
  const rows = plugins.filter((p: Dict) => s.plugCat === "all" || (s.plugCat === "installed" ? p.connector : p.category === s.plugCat));
  return (
    <div id="plugins">
      <div className="lib-inner wide">
        <div className="lib-head"><h2>插件</h2><div className="head-btns">
          <button className="btn ghost" id="plug-manage" onClick={() => openConnectors()}>管理连接器</button>
          <button className="btn primary" id="plug-create" onClick={() => openModal("conn", {})}>创建</button>
        </div></div>
        <p className="auto-intro">把常用的服务接入 OpenManus。连接后，Agent 会在需要时搜索并调用这些服务提供的工具；有写入操作的工具调用前会请你确认。</p>
        <div className="lib-tabs" id="plug-cats">
          {tabs.map(([k, l]) => <button key={k} className={cx("lib-tab", s.plugCat === k && "on")} data-plugcat={k} onClick={() => { S.plugCat = k; render(); }}>{l}</button>)}
        </div>
        <div id="plug-list" className="sk-grid">
          {rows.length ? rows.map((p: Dict) => (
            <div key={p.id} className="sk-card plug-card" data-plug={p.id} onClick={() => openModal("plug", { id: p.id })}>
              <div className="sk-top"><PlugLogo p={p} /><div className="sk-title">{p.name}<div className="sk-name">{p.category} · {p.transport === "stdio" ? "本地运行" : "远程服务"}{p.fields.some((f: Dict) => f.required) ? "" : " · 免密钥"}</div></div><PlugState p={p} /></div>
              <div className="sk-desc">{p.description}</div>
            </div>
          )) : <div className="lib-empty"><Icon name="puzzle" /><div>还没有已连接的插件</div></div>}
        </div>
      </div>
    </div>
  );
}

export function PluginModal() {
  const s = useStore();
  const m = s.modals.plug;
  if (!m) return null;
  return <PluginForm key={m._k} id={m.id} />;
}

function PluginForm({ id }: { id: string }) {
  const p = S.plugins.plugins.find((x: Dict) => x.id === id);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [plainLabel, setPlainLabel] = useState(false); // legacy resets the button to "连接" after a failed attempt
  if (!p) return null;
  const c = p.connector;

  const connect = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const values = Object.fromEntries(p.fields.map((f: Dict) => [f.key, String(fd.get(f.key) ?? "")]));
    setBusy(true); setErr("");
    const r = await jfetch(`/api/plugins/${p.id}/install`, "POST", { values });
    setBusy(false);
    const j = await r.json().catch(() => ({}));
    await loadPlugins();
    if (!r.ok) { setPlainLabel(true); setErr(j.detail || "连接失败"); return; }
    if (j.status === "error") { setPlainLabel(false); setErr(`已保存，但连接失败：${j.error}`); return; }
    closeModal("plug");
  };
  const remove = async () => {
    if (!c || !confirm(`断开「${p.name}」并删除其配置？`)) return;
    await fetch(`/api/connectors/${c.id}`, { method: "DELETE" }); closeModal("plug"); loadPlugins();
  };

  return (
    <div id="plug-modal">
      <form className="sched-card" id="plug-form" autoComplete="off" onSubmit={connect}>
        <div className="viewer-head"><PlugLogo p={p} id="plug-m-logo" /><div className="viewer-title"><div id="plug-m-name" style={{ fontSize: 16, fontWeight: 500 }}>{p.name}</div>
          <div id="plug-m-sub" className="muted" style={{ fontSize: 12 }}>{p.category} · {p.transport === "stdio" ? "在 OpenManus 服务器上运行" : "远程 MCP 服务"} · <a href={p.docs} target="_blank">文档</a></div></div>
          <button type="button" className="icon-btn" id="plug-close" onClick={() => closeModal("plug")}><Icon name="x" /></button></div>
        <div className="sched-body" id="plug-m-body">
          <div className="sk-desc full">{p.description}</div>
          {c && <div className={cx("check-row", c.status === "connected" && "met")}><PlugState p={p} />{c.status === "error" && <span className="muted">可在「管理连接器」中查看错误详情</span>}</div>}
          {p.fields.map((f: Dict) => (
            <label key={f.key}>{f.label}<input name={f.key} type={f.secret ? "password" : "text"} placeholder={c && f.secret ? "已保存，留空则需重新填写" : f.placeholder} required={!!f.required} />
              {f.help && <span className="muted" style={{ fontSize: 12 }}>{f.help}</span>}</label>
          ))}
          {!p.fields.length && <div className="muted" style={{ fontSize: 13 }}>无需配置，点击「连接」即可使用。</div>}
          <div className="sched-err" id="plug-err">{err}</div>
        </div>
        <div className="cc-actions">
          <button type="button" className={cx("btn ghost danger", !c && "hidden")} id="plug-remove" onClick={remove}>断开</button><span className="spacer"></span>
          <button type="button" className="btn ghost" id="plug-cancel" onClick={() => closeModal("plug")}>取消</button>
          <button type="submit" className="btn primary" id="plug-connect" disabled={busy}>{busy ? <><Spin />连接中</> : c && !plainLabel ? "重新连接" : "连接"}</button>
        </div>
      </form>
    </div>
  );
}
