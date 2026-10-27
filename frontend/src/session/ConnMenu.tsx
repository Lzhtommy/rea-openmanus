// The composer's connector menu (Manus' 连接器 button): phone and mail, My Browser, MCP connectors switched
// on or off for this user's tasks, and catalog plugins still to connect.
import { useState } from "react";
import { S, openModal, render, type Dict } from "../store";
import { Icon, cx, jfetch } from "../lib/util";
import { loadComputers, loadConns, loadPersonal, loadPlugins, openPlugins } from "../actions";
import { PlugLogo } from "../views/plugins";
import { startPairing } from "../views/computers";

// Where the menu fits: above the button (like "+"), or below it when the composer sits near the top (home page).
let place = { up: true, max: 340 };

export async function openConnMenu() {
  const r = document.getElementById("conn-btn")?.getBoundingClientRect();
  if (r) {
    const above = r.top - 64, below = innerHeight - r.bottom - 24, chrome = 70;  // header / gutter; footer row + padding
    place = above >= 300 || above >= below ? { up: true, max: above - chrome } : { up: false, max: below - chrome };
  }
  S.menus.conn = !S.menus.conn; S.menus.plus = false; render();
  if (S.menus.conn) await Promise.all([loadConns(), loadPlugins(), loadPersonal(), loadComputers()]);
}

function closeConnMenu() { S.menus.conn = false; render(); }

/** Switch a connector on or off for this user's tasks (not for anyone else's). */
async function toggleMine(id: string, on: boolean) {
  const off = new Set<string>(S.personal.connectorsOff || []);
  if (on) off.delete(id); else off.add(id);
  S.personal = { ...S.personal, connectorsOff: [...off] }; render();
  const r = await jfetch("/api/personalization", "PUT", { connectorsOff: [...off] });
  if (r.ok) S.personal = await r.json(); else await loadPersonal();
  render();
}

function Logo({ c }: { c: Dict }) {
  const p = c.plugin && S.plugins.plugins.find((x: Dict) => x.id === c.plugin);
  return p ? <PlugLogo p={p} /> : <span className="plug-logo custom"><Icon name="plug" /></span>;
}

function Sub({ text, hint }: { text: string; hint: string }) {
  return <div className="cm-sub">{text ? <b>{text}</b> : <span className="muted">{hint}</span>}</div>;
}

export function ConnMenu() {
  const [sub, setSub] = useState<"phone" | "mail" | null>(null);
  const off: string[] = S.personal.connectorsOff || [];
  const browser = S.devs.devices.find((d: Dict) => d.myBrowser) || null;
  const browserOn = !!browser && S.target === `dev:${browser.id}`;
  const installed = new Set(S.conns.map((c: Dict) => c.plugin).filter(Boolean));
  const rest = S.plugins.plugins.filter((p: Dict) => !installed.has(p.id));
  const toggleSub = (k: "phone" | "mail") => setSub(sub === k ? null : k);

  return (
    <div className={cx("more-menu conn-menu", place.up && "up", !S.menus.conn && "hidden")} id="conn-menu">
      <div className="cm-list" style={{ maxHeight: Math.max(160, Math.min(340, place.max)) }}>
        <button type="button" className="mode-item" onClick={() => toggleSub("phone")}>
          <span><Icon name="phone" /></span>电话<span className="spacer"></span><span><Icon name={sub === "phone" ? "chevDown" : "chevRight"} /></span></button>
        {sub === "phone" && <Sub text={S.cfg.phone} hint="未配置：设置 MANUS_TWILIO_ACCOUNT_SID / AUTH_TOKEN / NUMBER 后，Agent 可以发短信和打电话（每次都需你确认）" />}
        <button type="button" className="mode-item" onClick={() => toggleSub("mail")}>
          <span><Icon name="mail" /></span>邮箱<span className="spacer"></span><span><Icon name={sub === "mail" ? "chevDown" : "chevRight"} /></span></button>
        {sub === "mail" && <Sub text={S.cfg.mail} hint="未配置：设置 MANUS_MAIL_IMAP_HOST / USER / PASSWORD / SMTP_HOST 后，Agent 可以收发邮件" />}

        <div className="mode-item" title={browser && !browser.online ? "设备离线" : "在你自己的 Chrome 里操作（保留登录状态）"}>
          <span><Icon name="globe" /></span>My Browser<span className="spacer"></span>
          {browser
            ? <button type="button" className={cx("switch", browserOn && "on")} disabled={!browser.online && !browserOn}
                onClick={() => { S.target = browserOn ? null : `dev:${browser.id}`; render(); }}><i></i></button>
            : <button type="button" className="cm-link" onClick={async () => { closeConnMenu(); await startPairing(); if (S.pairing) S.pairing.myBrowser = true; render(); }}>连接</button>}
        </div>

        {S.conns.map((c: Dict) => {
          const on = c.enabled && !off.includes(c.id);
          return (
            <div className="mode-item" key={c.id} title={!c.enabled ? "管理员已停用" : c.status === "error" ? c.error : `${c.tools.length} 个工具`}>
              <Logo c={c} /><span className="grow">{c.name}</span>
              {c.status === "error" && <span className="cm-tag err">连接失败</span>}
              {c.enabled
                ? <button type="button" className={cx("switch", on && "on")} onClick={() => toggleMine(c.id, !on)}><i></i></button>
                : <span className="cm-tag">已停用</span>}
            </div>
          );
        })}

        {rest.map((p: Dict) => (
          <div className="mode-item" key={p.id}>
            <PlugLogo p={p} /><span className="grow">{p.name}</span>
            <button type="button" className="cm-link" onClick={() => openModal("plug", { id: p.id })}>连接</button>
          </div>
        ))}
      </div>
      <button type="button" className="mode-item cm-foot" onClick={() => { closeConnMenu(); openPlugins(); }}>
        <span><Icon name="plus" /></span>添加连接器<span className="spacer"></span>
        <span className="cm-logos">{rest.slice(0, 2).map((p: Dict) => <PlugLogo key={p.id} p={p} />)}{rest.length > 2 && <span className="cm-more">+{rest.length - 2}</span>}</span>
      </button>
    </div>
  );
}
