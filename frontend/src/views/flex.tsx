// OpenManus Flex: run on your own API key and model (any configured provider or the gateway).
import { useEffect, useState, type FormEvent } from "react";
import { S, render, useStore, openModal, closeModal, type Dict } from "../store";
import { Icon, cx, errText, jfetch } from "../lib/util";
import { currentSel, defaultSel, loadModels, providerInfo, setSel } from "../actions";

export function openFlex() { S.menus.mode = false; render(); openModal("flex"); }

export function FlexModal() {
  const s = useStore();
  const m = s.modals.flex;
  if (!m) return null;
  return <FlexForm key={m._k} />;
}

function FlexForm() {
  const cur = currentSel();
  const [pid, setPid] = useState<string>(() => (cur.mode === "flex" && cur.provider ? cur.provider : (S.models.providers.find((p: Dict) => p.configured)?.id || "litellm")));
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [syncN, setSyncN] = useState(0);
  const [initModel] = useState(cur.mode === "flex" ? cur.model || "" : "");

  // legacy syncFlex(): reset the fields for the chosen provider and load its model list
  const sync = async (id: string, m = "") => {
    const p = providerInfo(id), gw = id === "litellm";
    setApiKey(""); setBaseUrl(p?.baseUrl || ""); setModel(m || p?.model || ""); setErr("");
    let list: string[] = gw ? S.models.gatewayModels : [];
    setModels(list);
    if (!gw && p?.configured) { try { const r = await fetch(`/api/providers/${id}/models`); if (r.ok) list = await r.json(); } catch { /* offline */ } }
    setModels(list);
  };
  useEffect(() => { sync(pid, syncN === 0 ? initModel : ""); }, [pid, syncN]); // eslint-disable-line react-hooks/exhaustive-deps

  const p = providerInfo(pid), gw = pid === "litellm";
  const opts: [string, string][] = [["litellm", `服务器默认 · ${S.models.gatewayLabel || "LiteLLM 网关"}（已配置）`], ...S.models.providers.map((x: Dict) => [x.id, x.label + (x.configured ? " ✓" : "")] as [string, string])];

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setErr("");
    let m = model;
    if (pid !== "litellm" && (apiKey || baseUrl !== (providerInfo(pid)?.baseUrl || "") || !providerInfo(pid)?.configured)) {
      setBusy(true);
      const r = await jfetch(`/api/providers/${pid}`, "PUT", { apiKey, baseUrl, model });
      setBusy(false);
      if (!r.ok) { setErr(await errText(r, "连接失败")); return; }
      const info = await r.json();
      if (!m) { m = info.model; setModel(m); }
      await loadModels();
    }
    if (!m.trim()) { setErr("请选择或填写模型"); return; }
    closeModal("flex");
    setSel({ mode: "flex", provider: pid, model: m.trim() });
  };
  const remove = async () => {
    if (!confirm("移除该提供商的密钥？")) return;
    await fetch(`/api/providers/${pid}`, { method: "DELETE" });
    await loadModels(); setSyncN((n) => n + 1);
    if (currentSel().provider === pid) setSel(defaultSel());
  };

  return (
    <div id="flex-modal">
      <form className="flex-card" id="flex-form" autoComplete="off" onSubmit={save}>
        <button type="button" className="icon-btn flex-x" id="flex-close" onClick={() => closeModal("flex")}><Icon name="x" /></button>
        <div className="flex-logo"><Icon name="flex" /></div>
        <div className="flex-title">OpenManus Flex <span className="badge">Beta</span></div>
        <div className="flex-desc">使用你自己的 API 密钥和模型运行 OpenManus。第三方模型的性能可能有所不同。</div>
        <label>提供商<select name="provider" id="flex-provider" value={pid} onChange={(e) => { setPid(e.target.value); setSyncN((n) => n + 1); }}>
          {opts.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label id="flex-key-row" className={cx(gw && "hidden")}>API 密钥<input name="apiKey" type="password" placeholder={p?.keyHint ? `已保存（${p.keyHint}），留空则沿用` : "sk-..."} value={apiKey} onChange={(e) => setApiKey(e.target.value)} /></label>
        <label id="flex-base-row" className={cx((gw || (!["custom", "fireworks", "openrouter"].includes(pid) && !!p?.baseUrl)) && "hidden")}>Base URL<input name="baseUrl" placeholder="https://..." value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} /></label>
        <label>模型<input name="model" list="flex-models" placeholder="连接后从列表中选择，或直接填写" value={model} onChange={(e) => setModel(e.target.value)} />
          <datalist id="flex-models">{models.map((x) => <option key={x} value={x}></option>)}</datalist></label>
        <div className="sched-err" id="flex-err">{err}</div>
        <div className="flex-actions"><button type="button" className={cx("btn ghost", (gw || !p?.configured) && "hidden")} id="flex-remove" onClick={remove}>移除</button><span className="spacer"></span>
          <button type="button" className="btn ghost" id="flex-cancel" onClick={() => closeModal("flex")}>取消</button>
          <button type="submit" className="btn primary" id="flex-connect" disabled={busy}>{busy ? "连接中…" : gw || p?.configured ? "使用" : "连接"}</button></div>
      </form>
    </div>
  );
}
