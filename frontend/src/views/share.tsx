// 分享任务: a revocable read-only replay link.
import { useEffect, useRef, useState } from "react";
import { S, render, useStore, closeModal, type Dict } from "../store";
import { Icon, cx } from "../lib/util";

const shareUrl = (token: string) => `${location.origin}${location.pathname}#share/${token}`;

export function ShareModal() {
  const s = useStore();
  const m = s.modals.share;
  if (!m) return null;
  return <ShareDialog key={m._k} />;
}

function ShareDialog() {
  const [token, setToken] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [round, setRound] = useState(0);
  const link = useRef<HTMLInputElement>(null);

  const show = (t: string) => { S.shareToken = t; render(); setToken(t); setCopied(false); };
  useEffect(() => {
    setErr(""); setToken(null);
    const meta = S.sessions.find((x: Dict) => x.id === S.current);
    if (meta?.shared || S.shareToken) {
      (async () => {
        const r = await fetch(`/api/sessions/${S.current}/share`, { method: "POST" }); // idempotent: returns the existing token
        if (r.ok) show((await r.json()).token);
      })();
    }
  }, [round]);

  const create = async () => {
    const r = await fetch(`/api/sessions/${S.current}/share`, { method: "POST" });
    if (!r.ok) { setErr("创建失败"); return; }
    show((await r.json()).token);
  };
  const revoke = async () => {
    if (!confirm("取消分享后，已发出的链接将立即失效。")) return;
    await fetch(`/api/sessions/${S.current}/share`, { method: "DELETE" });
    S.shareToken = null; render(); setRound((n) => n + 1);
  };
  const copy = async () => { try { await navigator.clipboard.writeText(shareUrl(token!)); setCopied(true); } catch { link.current?.select(); } };

  return (
    <div id="share-modal">
      <div className="sched-card share-card">
        <div className="viewer-head"><div className="viewer-title"><div style={{ fontSize: 16, fontWeight: 500 }}>分享任务</div></div>
          <button type="button" className="icon-btn" id="share-close" onClick={() => closeModal("share")}><Icon name="x" /></button></div>
        <div className="sched-body">
          <div className="share-desc" id="share-desc">创建链接后，任何拿到链接的人都能以只读方式回放这个任务的完整过程，包括步骤、电脑画面截图和交付的文件。</div>
          <div className={cx("share-link", !token && "hidden")} id="share-link-row"><input id="share-link" ref={link} readOnly value={token ? shareUrl(token) : ""} />
            <button className="btn primary sm" id="share-copy" onClick={copy}>{copied ? "已复制" : "复制"}</button></div>
          <div className="sched-err" id="share-err">{err}</div>
        </div>
        <div className="cc-actions"><button className={cx("btn ghost", !token && "hidden")} id="share-revoke" onClick={revoke}>取消分享</button><span className="spacer"></span>
          <button className={cx("btn primary", !!token && "hidden")} id="share-create" onClick={create}>创建链接</button></div>
      </div>
    </div>
  );
}
