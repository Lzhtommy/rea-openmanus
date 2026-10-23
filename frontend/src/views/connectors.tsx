// 连接器 (MCP): custom stdio / Streamable HTTP / SSE servers.
import { useState, type FormEvent } from "react";
import { S, render, useStore, openModal, closeModal, type Dict } from "../store";
import { ConnSt, Icon, cx, jfetch, linesToMap } from "../lib/util";
import { loadConns, openConnectors, openPlugins } from "../actions";

const CONN_STATUS: Record<string, [string, string]> = { connected: ["ok", "已连接"], connecting: ["", "连接中"], error: ["err", "连接失败"], disconnected: ["", "未连接"], disabled: ["", "已停用"] };

async function connAction(a: string, id: string) {
  const c = S.conns.find((x) => x.id === id);
  if (!c) return;
  if (a === "edit") return openModal("conn", { conn: c });
  if (a === "del") { if (!confirm(`删除连接器「${c.name}」？`)) return; await fetch(`/api/connectors/${id}`, { method: "DELETE" }); }
  if (a === "toggle") await jfetch(`/api/connectors/${id}`, "PATCH", { enabled: !c.enabled });
  if (a === "restart") { c.status = "connecting"; render(); await fetch(`/api/connectors/${id}/restart`, { method: "POST" }); }
  loadConns();
}

export function Connectors() {
  const s = useStore();
  return (
    <div id="connectors">
      <div className="lib-inner">
        <div className="lib-head"><h2><button className="icon-btn back-btn" id="conn-back" title="返回插件" onClick={() => openPlugins()}><Icon name="chevLeft" /></button>连接器</h2>
          <button className="btn primary" id="conn-new" onClick={() => openModal("conn", {})}>添加自定义连接器</button></div>
        <p className="auto-intro">通过 MCP 把外部工具和数据接入 OpenManus。Agent 会按需搜索并调用这些工具；未标记为只读的工具在调用前会请你确认。</p>
        <div id="conn-list">
          {s.conns.length ? s.conns.map((c) => {
            const [cls, label] = CONN_STATUS[c.status] || ["", c.status];
            const where = c.transport === "stdio" ? `${c.command} ${(c.args || []).join(" ")}` : c.url;
            return (
              <div key={c.id} className={cx("auto-card", !c.enabled && "off")}>
                <div className="auto-top"><span className="auto-ico"><Icon name="plug" /></span><div className="auto-main">
                  <div className="auto-title">{c.name} <ConnSt cls={cls}>{label}{c.status === "connected" ? ` · ${c.tools.length} 个工具` : ""}</ConnSt></div>
                  <div className="auto-when mono">{c.transport} · {where}</div></div>
                  <button className={cx("switch", c.enabled && "on")} title={c.enabled ? "停用" : "启用"} onClick={() => connAction("toggle", c.id)}><i></i></button></div>
                {c.error && <div className="err-detail">{c.error}</div>}
                {c.tools.length > 0 && <div className="tool-chips">{c.tools.map((t: Dict) => <span key={t.name} className="tool-chip" title={t.description}>{!t.readOnly && <Icon name="pencil" />}{t.name}</span>)}</div>}
                <div className="auto-foot"><div className="auto-runs">{c.autoApprove ? <span>已信任：调用不再确认</span> : <span>非只读工具调用前需确认（带 ✎ 标记）</span>}</div>
                  <button className="btn ghost sm" onClick={() => connAction("restart", c.id)}>重新连接</button>
                  <button className="icon-btn sm" title="编辑" onClick={() => connAction("edit", c.id)}><Icon name="pencil" /></button>
                  <button className="icon-btn sm" title="删除" onClick={() => connAction("del", c.id)}><Icon name="trash" /></button></div>
              </div>
            );
          }) : <div className="lib-empty"><Icon name="plug" /><div>还没有连接器</div><div className="muted">添加 MCP 服务器后，OpenManus 就能使用其中的工具</div></div>}
        </div>
      </div>
    </div>
  );
}

export function ConnModal() {
  const s = useStore();
  const m = s.modals.conn;
  if (!m) return null;
  return <ConnForm key={m._k} conn={m.conn || null} />;
}

function ConnForm({ conn }: { conn: Dict | null }) {
  const [editing, setEditing] = useState<Dict | null>(conn);
  const [v, setV] = useState(() => ({
    name: conn?.name || "", description: conn?.description || "", transport: conn?.transport || "stdio",
    command: conn?.command || "", args: (conn?.args || []).join("\n"), url: conn?.url || "",
    env: Object.keys(conn?.env || {}).map((k) => `${k}=••••`).join("\n"),
    headers: Object.keys(conn?.headers || {}).map((k) => `${k}: ••••`).join("\n"),
    autoApprove: !!conn?.autoApprove,
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: string) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const row = (forAttr: string) => ({ "data-for": forAttr, className: forAttr.split(" ").includes(v.transport) ? "" : "hidden" });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const body = { name: v.name, description: v.description, transport: v.transport, autoApprove: v.autoApprove,
      command: v.command, args: v.args.split("\n").map((x: string) => x.trim()).filter(Boolean),
      env: linesToMap(v.env, "="), url: v.url, headers: linesToMap(v.headers, ":") };
    setBusy(true); setErr("");
    const r = await jfetch(editing ? `/api/connectors/${editing.id}` : "/api/connectors", editing ? "PATCH" : "POST", body);
    setBusy(false);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.detail || "保存失败"); return; }
    if (j.status === "error") { setErr(`已保存，但连接失败：${j.error}`); setEditing(j); loadConns(); return; }
    closeModal("conn");
    if (S.view === "plugins") openConnectors(); else loadConns();
  };

  return (
    <div id="conn-modal">
      <form className="sched-card" id="conn-form" autoComplete="off" onSubmit={save}>
        <div className="viewer-head"><div className="viewer-title"><div id="conn-form-title" style={{ fontSize: 16, fontWeight: 500 }}>{conn ? "编辑连接器" : "添加连接器"}</div></div>
          <button type="button" className="icon-btn" id="conn-close" onClick={() => closeModal("conn")}><Icon name="x" /></button></div>
        <div className="sched-body">
          <label>名称<input name="name" placeholder="例如：GitHub" required value={v.name} onChange={set("name")} /></label>
          <label>说明（告诉 Agent 这个连接器能做什么）<input name="description" placeholder="可选" value={v.description} onChange={set("description")} /></label>
          <label>类型<select name="transport" value={v.transport} onChange={set("transport")}><option value="stdio">本地命令（stdio）</option><option value="http">远程 HTTP（Streamable HTTP）</option><option value="sse">远程 SSE</option></select></label>
          <label {...row("stdio")}>启动命令<input name="command" placeholder="npx" value={v.command} onChange={set("command")} /></label>
          <label {...row("stdio")}>参数（每行一个）<textarea name="args" rows={2} placeholder={"-y\n@modelcontextprotocol/server-github"} value={v.args} onChange={set("args")}></textarea></label>
          <label {...row("stdio")}>环境变量（每行 KEY=VALUE）<textarea name="env" rows={2} placeholder="GITHUB_TOKEN=..." value={v.env} onChange={set("env")}></textarea></label>
          <label {...row("http sse")}>地址<input name="url" placeholder="https://example.com/mcp" value={v.url} onChange={set("url")} /></label>
          <label {...row("http sse")}>请求头（每行 Key: Value）<textarea name="headers" rows={2} placeholder="Authorization: Bearer ..." value={v.headers} onChange={set("headers")}></textarea></label>
          <label className="check"><input type="checkbox" name="autoApprove" checked={v.autoApprove} onChange={(e) => setV({ ...v, autoApprove: e.target.checked })} />信任此连接器：调用工具时不再逐次确认</label>
          <div className="sched-err" id="conn-err">{err}</div>
        </div>
        <div className="cc-actions"><button type="button" className="btn ghost" id="conn-cancel" onClick={() => closeModal("conn")}>取消</button>
          <button type="submit" className="btn primary" id="conn-save" disabled={busy}>{busy ? "连接中…" : "连接"}</button></div>
      </form>
    </div>
  );
}
