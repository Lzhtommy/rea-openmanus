// 创作: sites, games and apps published from tasks, with versions and permanent URLs.
import { useState } from "react";
import { S, render, useStore, type Dict } from "../store";
import { Icon, copyText, cx, fmtDate, jfetch } from "../lib/util";
import { loadSites, openSession, prefill } from "../actions";

const CR_KINDS: Record<string, [string, string]> = { website: ["网站", "globe"], game: ["游戏", "gamepad"], app: ["移动应用", "phone"] };

export function Creations() {
  useStore();
  const [copied, setCopied] = useState<Record<string, boolean>>({});
  const n = (k: string) => S.sites.filter((x) => k === "all" || x.kind === k).length;
  const rows = S.sites.filter((x) => S.crTab === "all" || x.kind === S.crTab);
  const tabs: [string, string][] = [["all", "全部"], ...Object.entries(CR_KINDS).map(([k, [l]]) => [k, l] as [string, string])];
  const del = async (x: Dict) => {
    if (!confirm(`下线「${x.title}」？链接将失效，所有版本都会删除。`)) return;
    await fetch(`/api/sites/${x.id}`, { method: "DELETE" }); loadSites();
  };
  const version = async (x: Dict, v: string) => { await jfetch(`/api/sites/${x.id}`, "PATCH", { current: +v }); loadSites(); };
  return (
    <div id="creations">
      <div className="lib-inner wide">
        <div className="lib-head"><h2>创作</h2><button className="btn primary" id="cr-build" onClick={() => prefill("帮我做一个网站：")}>立即构建</button></div>
        <div className="lib-tabs" id="cr-tabs">
          {tabs.map(([k, l]) => <button key={k} className={cx("lib-tab", S.crTab === k && "on")} onClick={() => { S.crTab = k; render(); }}>{l}<span>{n(k)}</span></button>)}
        </div>
        <div id="cr-list">
          {rows.length ? <div className="cr-grid">{rows.map((x) => {
            const [label, ic] = CR_KINDS[x.kind] || CR_KINDS.website;
            const sess = S.sessions.find((y) => y.id === x.sessionId);
            return (
              <div className="cr-card" key={x.id}>
                <a className="cr-thumb" href={x.url} target="_blank">{x.thumbUrl ? <img src={`${x.thumbUrl}?v=${x.current}`} alt="" loading="lazy" /> : <Icon name={ic} />}</a>
                <div className="cr-body">
                  <div className="cr-title"><span className="grow">{x.title}</span><span className="lib-tag"><Icon name={ic} />{label}</span></div>
                  <div className="cr-url"><a href={x.url} target="_blank">{x.url.replace(/^https?:\/\//, "")}</a>
                    <button className="icon-btn sm" title="复制链接" onClick={async () => { if (await copyText(x.url)) setCopied((c) => ({ ...c, [x.id]: true })); }}><Icon name={copied[x.id] ? "check" : "copy"} /></button></div>
                  <div className="auto-foot">
                    <div className="auto-runs">{sess ? <a href={`#${x.sessionId}`} onClick={(e) => { e.preventDefault(); openSession(x.sessionId); }}><Icon name="message" />{sess.title}</a> : null}<span>更新于 {fmtDate(x.updatedAt)}</span></div>
                    {x.versions.length > 1
                      ? <select className="cr-ver" title="版本" value={x.current} onChange={(e) => version(x, e.target.value)}>
                        {[...x.versions].reverse().map((v: Dict) => <option value={v.n} key={v.n}>v{v.n} · {fmtDate(v.at)}</option>)}</select>
                      : <span className="lib-tag">v{x.current}</span>}
                    <button className="icon-btn sm" title="下线并删除" onClick={() => del(x)}><Icon name="trash" /></button>
                  </div>
                </div>
              </div>
            );
          })}</div>
            : <div className="lib-empty"><Icon name="sparkBox" /><div>还没有创作内容</div><div className="muted">让 OpenManus 做一个网站、小游戏或应用，发布后会出现在这里，并有一个固定的访问地址</div></div>}
        </div>
      </div>
    </div>
  );
}
