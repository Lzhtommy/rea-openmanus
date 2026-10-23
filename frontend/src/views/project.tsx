// 项目: shared instructions and files for a group of tasks.
import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useStore } from "../store";
import { FileIco, Icon, fmtSize, jfetch } from "../lib/util";
import { goHome, loadProjects, openSession } from "../actions";

/** A text field that follows the saved value unless it is being edited, and saves on blur when changed. */
function useSynced(saved: string) {
  const [v, setV] = useState(saved);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setV(saved); }, [saved]);
  const bind = {
    value: v,
    onChange: (e: { target: { value: string } }) => setV(e.target.value),
    onFocus: () => { focused.current = true; },
  };
  return { v, bind, blur: () => { focused.current = false; } };
}

export function Project({ composer }: { composer: ReactNode }) {
  const s = useStore();
  const p = s.projects.find((x) => x.id === s.projectId);
  const name = useSynced(p?.name || "");
  const instr = useSynced(p?.instructions || "");
  const [saved, setSaved] = useState("");

  const save = async (patch: Record<string, string>) => {
    const r = await jfetch(`/api/projects/${s.projectId}`, "PATCH", patch);
    if (r.ok) { setSaved("已保存"); setTimeout(() => setSaved(""), 1500); await loadProjects(); }
  };
  const del = async () => {
    if (!confirm("删除该项目？项目中的任务会保留。")) return;
    await fetch(`/api/projects/${s.projectId}`, { method: "DELETE" });
    await loadProjects(); goHome();
  };
  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const el = e.target, files = [...(el.files || [])];
    for (const f of files) { const fd = new FormData(); fd.append("file", f); await fetch(`/api/projects/${s.projectId}/files`, { method: "POST", body: fd }); }
    el.value = ""; await loadProjects();
  };
  const rmFile = async (n: string) => { await fetch(`/api/projects/${s.projectId}/files/${encodeURIComponent(n)}`, { method: "DELETE" }); await loadProjects(); };
  const tasks = p ? s.sessions.filter((x) => x.projectId === p.id) : [];

  return (
    <div id="project-view">
      <div className="lib-inner">
        <div className="proj-head"><span className="proj-ico"><Icon name="folder" /></span>
          <input id="proj-name" className="proj-name" {...name.bind} onBlur={() => { name.blur(); if (p && name.v !== p.name) save({ name: name.v }); }} />
          <button className="icon-btn" id="proj-del" title="删除项目" onClick={del}><Icon name="trash" /></button></div>
        <div id="proj-slot">{composer}</div>
        <div className="proj-grid">
          <div className="proj-box"><div className="proj-box-head">项目指令<span className="muted" id="proj-saved">{saved}</span></div>
            <textarea id="proj-instr" rows={5} placeholder="对这个项目中每个任务都适用的要求，例如：使用正式书面语、遵循附件中的品牌规范……"
              {...instr.bind} onBlur={() => { instr.blur(); if (p && instr.v !== (p.instructions || "")) save({ instructions: instr.v }); }} /></div>
          <div className="proj-box"><div className="proj-box-head">项目文件<label className="btn ghost sm">上传<input type="file" id="proj-upload" multiple hidden onChange={upload} /></label></div>
            <div id="proj-files">
              {p && (p.files.length ? p.files.map((f: { name: string; url: string; size: number }) => (
                <div className="proj-file" key={f.name}><FileIco name={f.name} /><a href={f.url} target="_blank">{f.name}</a><span className="muted">{fmtSize(f.size)}</span>
                  <button className="icon-btn sm" title="移除" onClick={() => rmFile(f.name)}><Icon name="x" /></button></div>
              )) : <div className="small-pad">上传的文件会在该项目的每个任务开始时复制到沙箱的 ~/project/ 目录</div>)}
            </div></div>
        </div>
        <div className="nav-section" style={{ paddingLeft: 0 }}>项目中的任务</div>
        <div id="proj-tasks">
          {p && (tasks.length ? tasks.map((x) => (
            <div className="session-item" key={x.id} onClick={() => openSession(x.id)}><span className="s-ico"><Icon name="message" /></span><span className="s-title">{x.title}</span></div>
          )) : <div className="small-pad">还没有任务，在上方输入框中分配一个</div>)}
        </div>
      </div>
    </div>
  );
}
