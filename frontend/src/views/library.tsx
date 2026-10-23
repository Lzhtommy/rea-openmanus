// 资料库: every file kept outside the sandboxes (deliverables, files the agent wrote, uploads), across tasks.
import { S, closeModal, openModal, render, useStore, type Dict } from "../store";
import { FileIco, Icon, LIB_TABS, cx, fileKind, fmtDate, fmtSize } from "../lib/util";
import { openSession } from "../actions";
import { FileBody } from "../session/FileBody";

export function Library() {
  const s = useStore();
  const q = s.libQuery.trim().toLowerCase();
  const counts: Record<string, number> = Object.fromEntries(LIB_TABS.map(([k]) => [k, 0]));
  s.library.forEach((f) => { counts.all++; counts[fileKind(f.filename)]++; });
  const rows = s.library.filter((f) => (s.libFilter === "all" || fileKind(f.filename) === s.libFilter) &&
    (!q || f.filename.toLowerCase().includes(q) || String(f.sessionTitle).toLowerCase().includes(q)));
  return (
    <div id="library">
      <div className="lib-inner">
        <div className="lib-head"><h2>资料库</h2>
          <div className="lib-search"><span><Icon name="search" /></span>
            <input id="lib-search" placeholder="搜索文件" value={s.libQuery} onChange={(e) => { S.libQuery = e.target.value; render(); }} /></div></div>
        <div className="lib-tabs" id="lib-tabs">
          {LIB_TABS.map(([k, label]) => (
            <button key={k} className={cx("lib-tab", s.libFilter === k && "on")} onClick={() => { S.libFilter = k; render(); }}>{label}<span>{counts[k]}</span></button>
          ))}
        </div>
        <div id="lib-list">
          {rows.length ? rows.map((f) => {
            const tag = f.kinds.includes("deliverable") ? "交付" : f.kinds.includes("upload") ? "上传" : "生成";
            return (
              <div className="lib-row" key={s.library.indexOf(f)} onClick={() => openModal("viewer", { f })}>
                <FileIco name={f.filename} />
                <div className="lib-main">
                  <div className="lib-name">{f.filename}<span className="lib-tag">{tag}</span></div>
                  <div className="lib-sub">
                    <a href={`#${f.sessionId}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); openSession(f.sessionId); }}><Icon name="message" />{f.sessionTitle}</a>
                    <span>{fmtSize(f.size)}</span><span>{fmtDate(f.updatedAt)}</span>
                  </div>
                </div>
                <a className="icon-btn" href={f.url} download={f.filename} title="下载" onClick={(e) => e.stopPropagation()}><Icon name="download" /></a>
              </div>
            );
          }) : (
            <div className="lib-empty"><Icon name="folder" /><div>{s.library.length ? "没有匹配的文件" : "还没有文件"}</div><div className="muted">任务中生成、交付和上传的文件都会保存在这里</div></div>
          )}
        </div>
      </div>
    </div>
  );
}

function Viewer({ f }: { f: Dict }) {
  return (
    <div id="viewer" onClick={(e) => { if ((e.target as HTMLElement).id === "viewer") closeModal("viewer"); }}>
      <div className="viewer-card">
        <div className="viewer-head"><FileIco name={f.filename} id="viewer-ico" />
          <div className="viewer-title"><div id="viewer-name">{f.filename}</div><div id="viewer-sub">{`${f.sessionTitle} · ${fmtSize(f.size)} · ${fmtDate(f.updatedAt)}`}</div></div>
          <a className="icon-btn" id="viewer-dl" title="下载" href={f.url} download={f.filename}><Icon name="download" /></a>
          <button className="icon-btn" id="viewer-close" title="关闭" onClick={() => closeModal("viewer")}><Icon name="x" /></button></div>
        <div className="viewer-body" id="viewer-body">
          <FileBody f={{ url: f.url, name: f.filename, path: f.path }} loading={<div className="pc-empty" style={{ height: 200 }}><span className="shimmer">加载中</span></div>} />
        </div>
      </div>
    </div>
  );
}

export function ViewerModal() {
  const s = useStore();
  const m = s.modals.viewer;
  if (!m) return null;
  return <Viewer key={m._k} f={m.f} />;
}
