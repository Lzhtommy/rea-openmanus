// The task input: attachments and run-location chips, the "+" menu, send / stop / queue.
import { useEffect, useLayoutEffect, useRef, type ChangeEvent, type KeyboardEvent } from "react";
import { S, render, ui, type Dict } from "../store";
import { Icon, PC_ST, cx } from "../lib/util";
import { crewName, ensureSession, loadComputers, loadSkills, openComputers, openSkills, skillTitle, submit } from "../actions";

/** Open the file picker of the composer's "添加文件". */
export function pickFiles() { document.getElementById("file-input")?.click(); }

function closePlus() { S.menus.plus = false; S.menus.skillPick = false; S.menus.targetPick = false; render(); }

function Chips() {
  const pc = S.target && (S.target.startsWith("dev:") ? S.devs.devices.find((d: Dict) => "dev:" + d.id === S.target) : S.pcs.computers.find((c: Dict) => c.id === S.target));
  return (
    <div id="attach-list">
      {S.crew && <span className="chip-file target"><Icon name="users" /><span>与「{crewName()}」一起</span><button type="button" onClick={() => { S.crew = null; render(); }}><Icon name="x" /></button></span>}
      {pc && <span className="chip-file target"><Icon name={S.target!.startsWith("dev:") ? "laptop" : "monitor"} /><span>在「{pc.name}」上运行</span><button type="button" onClick={() => { S.target = null; render(); }}><Icon name="x" /></button></span>}
      {S.pickedSkills.map((n) => <span className="chip-file skill" key={`s:${n}`}><Icon name="spark" /><span>{skillTitle(n)}</span><button type="button" onClick={() => { S.pickedSkills = S.pickedSkills.filter((x) => x !== n); render(); }}><Icon name="x" /></button></span>)}
      {S.attachments.map((a, i) => <span className="chip-file" key={`a:${i}`}><Icon name="paperclip" /><span>{a.name}</span><button type="button" onClick={() => { S.attachments.splice(i, 1); render(); }}><Icon name="x" /></button></span>)}
    </div>
  );
}

function SkillPick() {
  const list = S.skills.skills.filter((x: Dict) => x.enabled || S.pickedSkills.includes(x.name));
  return (
    <div className={cx("skill-pick", !S.menus.skillPick && "hidden")} id="skill-pick">
      {list.map((x: Dict) => (
        <label className="mode-item" key={x.name}>
          <input type="checkbox" checked={S.pickedSkills.includes(x.name)}
            onChange={(e) => { S.pickedSkills = e.target.checked ? [...S.pickedSkills, x.name] : S.pickedSkills.filter((n) => n !== x.name); render(); }} />
          <span className="grow">{x.title}<span className="muted"> {x.name}</span></span>
        </label>
      ))}
      <button type="button" className="mode-item muted" id="pick-manage" onClick={() => { closePlus(); openSkills("mine"); }}><Icon name="spark" />管理技能</button>
    </div>
  );
}

function TargetPick() {
  const pick = (v: string) => { S.target = v || null; render(); };
  return (
    <div className={cx("skill-pick", !S.menus.targetPick && "hidden")} id="target-pick">
      <label className="mode-item"><input type="radio" name="tgt" value="" checked={!S.target} onChange={() => pick("")} /><span className="grow">云沙箱<span className="muted"> 每个任务独立</span></span></label>
      {S.pcs.computers.map((c: Dict) => (
        <label className="mode-item" key={c.id}><input type="radio" name="tgt" value={c.id} checked={S.target === c.id} onChange={() => pick(c.id)} />
          <span className="grow">{c.name}<span className="muted"> 云电脑 · {(PC_ST[c.status] || [, ""])[1]}</span></span></label>
      ))}
      {S.devs.devices.map((d: Dict) => (
        <label className={cx("mode-item", !d.online && "muted")} key={d.id}><input type="radio" name="tgt" value={`dev:${d.id}`} checked={S.target === "dev:" + d.id} disabled={!d.online} onChange={() => pick(`dev:${d.id}`)} />
          <span className="grow">{d.name}<span className="muted"> 本地计算机 · {d.online ? "在线" : "离线"}</span></span></label>
      ))}
      <button type="button" className="mode-item muted" id="tgt-manage" onClick={() => { closePlus(); openComputers(); }}><Icon name="plus" />创建云电脑</button>
    </div>
  );
}

export function Composer({ placeholder }: { placeholder?: string }) {
  const input = useRef<HTMLTextAreaElement>(null);
  const busy = !!S.current && S.status === "running";
  const hasText = S.input.trim().length > 0;

  // grow with the text, up to 240px
  useLayoutEffect(() => {
    const i = input.current; if (!i) return;
    i.style.height = "auto"; i.style.height = Math.min(i.scrollHeight, 240) + "px";
  }, [S.input]);
  useEffect(() => {
    if (!ui.focusInput || !input.current) return;
    ui.focusInput = false;
    const i = input.current;
    i.focus();
    if (ui.caretEnd) { i.setSelectionRange(i.value.length, i.value.length); ui.caretEnd = false; }
  });

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (S.input.trim()) submit(S.input); }
  };
  const onFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const el = e.target, files = [...(el.files || [])];
    if (!files.length) return;
    const sid = await ensureSession();
    for (const f of files) {
      const fd = new FormData(); fd.append("file", f);
      const r = await fetch(`/api/sessions/${sid}/upload`, { method: "POST", body: fd });
      if (r.ok) { const j = await r.json(); S.attachments.push({ name: f.name, path: j.path }); } else alert(`上传失败：${await r.text()}`);
    }
    el.value = ""; S.menus.plus = false; render();
  };

  return (
    <form id="composer" autoComplete="off" onSubmit={(e) => { e.preventDefault(); submit(S.input); }}>
      <Chips />
      <textarea id="input" ref={input} rows={1} value={S.input}
        placeholder={placeholder || (S.current ? "向 OpenManus 发送消息" : "分配一个任务或提问任何问题")}
        onChange={(e) => { S.input = e.target.value; render(); }} onKeyDown={onKey} />
      <div className="composer-bar">
        <div className="more-wrap up">
          <button type="button" className="round-btn" id="plus-btn" title="添加"
            onClick={() => { S.menus.plus = !S.menus.plus; S.menus.skillPick = false; render(); }}><span><Icon name="plus" /></span></button>
          <div className={cx("more-menu up", !S.menus.plus && "hidden")} id="plus-menu">
            <label className="mode-item"><span><Icon name="paperclip" /></span>添加文件<input id="file-input" type="file" multiple hidden onChange={onFiles} /></label>
            <button type="button" className="mode-item" id="plus-skills" onClick={async () => { await loadSkills(); S.menus.skillPick = !S.menus.skillPick; render(); }}>
              <span><Icon name="spark" /></span>使用技能<span className="spacer"></span><span><Icon name="chevRight" /></span></button>
            <SkillPick />
            <button type="button" className="mode-item" id="plus-target" onClick={async () => { await loadComputers(); S.menus.targetPick = !S.menus.targetPick; render(); }}>
              <span><Icon name="monitor" /></span>运行位置<span className="spacer"></span><span><Icon name="chevRight" /></span></button>
            <TargetPick />
            <label className="mode-item"><span><Icon name="list" /></span>执行前确认计划<span className="spacer"></span>
              <input type="checkbox" id="opt-confirm-plan" checked={S.confirmPlan} onChange={(e) => { S.confirmPlan = e.target.checked; render(); }} /></label>
          </div>
        </div>
        <span className="spacer"></span>
        <button type="button" className={cx("btn ghost sm", !(busy && hasText) && "hidden")} id="queue-btn" title="当前任务完成后再执行这条消息" onClick={() => submit(S.input, true)}>排队</button>
        <button type="submit" className={cx("send-btn", busy && !hasText && "stop")} id="send-btn" disabled={!(hasText || busy)}
          title={busy && !hasText ? "停止" : busy ? "立即发送（插话）" : "发送"}><Icon name={busy && !hasText ? "stop" : "arrowUp"} /></button>
      </div>
    </form>
  );
}
