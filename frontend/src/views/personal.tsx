// 个性化: profile and custom instructions, long-term knowledge, importing another assistant's memory.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { S, closeModal, openModal, render, useStore, type Dict } from "../store";
import { Icon, cx, errText, fmtDate, jfetch } from "../lib/util";
import { knowAction, loadPersonal, openPersonal, openSession } from "../actions";

const LIMITS = { nickname: 40, occupation: 60, about: 2000, instructions: 3000 };
type Profile = { nickname: string; occupation: string; about: string; instructions: string };
const fromState = (): Profile => ({
  nickname: S.personal.profile?.nickname || "", occupation: S.personal.profile?.occupation || "",
  about: S.personal.profile?.about || "", instructions: S.personal.instructions || "",
});

function ProfileForm({ hidden }: { hidden: boolean }) {
  const [v, setV] = useState<Profile>(fromState);
  const [saved, setSaved] = useState("");
  const dirty = useRef(false);
  // refill whenever the personalization data (re)loads, unless the user is in the middle of editing
  useEffect(() => { if (!dirty.current) setV(fromState()); }, [S.personal]);
  const set = (k: keyof Profile) => (e: { target: { value: string } }) => { dirty.current = true; setV({ ...v, [k]: e.target.value }); };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const body = { profile: { nickname: v.nickname, occupation: v.occupation, about: v.about }, instructions: v.instructions };
    const r = await jfetch("/api/personalization", "PUT", body);
    if (r.ok) {
      dirty.current = false;
      S.personal = await r.json(); render();
      setSaved("已保存"); setTimeout(() => setSaved(""), 1800);
    }
  };
  return (
    <form id="pers-profile" autoComplete="off" className={cx(hidden && "hidden")} onSubmit={save}>
      <div className="import-card"><span className="auto-ico"><Icon name="download" /></span>
        <div className="auto-main"><div className="auto-title">从其他 AI 导入记忆</div><div className="auto-when">使用其他 AI 助手记住的内容，自动填写你的个人资料和知识。</div></div>
        <button type="button" className="btn ghost sm" id="import-open" onClick={() => openModal("import")}>导入记忆</button></div>
      <label>昵称<input name="nickname" maxLength={LIMITS.nickname} placeholder="OpenManus 该如何称呼你" value={v.nickname} onChange={set("nickname")} /></label>
      <label>职业<input name="occupation" maxLength={LIMITS.occupation} placeholder="例如：产品经理、无人机算法工程师" value={v.occupation} onChange={set("occupation")} /></label>
      <label>更多关于你的信息<textarea name="about" rows={4} maxLength={LIMITS.about} placeholder="你的兴趣、价值观或偏好" value={v.about} onChange={set("about")} />
        <span className="count" data-count="about">{v.about.length} / {LIMITS.about}</span></label>
      <div className="muted small">OpenManus 会用这些信息为所有任务定制回复。</div>
      <label>自定义指令<textarea name="instructions" rows={6} maxLength={LIMITS.instructions} placeholder="希望 OpenManus 在每个任务中都遵守的要求，例如：先给结论再展开；报告使用中文；金额单位用亿元" value={v.instructions} onChange={set("instructions")} />
        <span className="count" data-count="instructions">{v.instructions.length} / {LIMITS.instructions}</span></label>
      <div className="cc-actions" style={{ padding: 0 }}><span className="muted" id="pers-saved">{saved}</span><span className="spacer"></span><button type="submit" className="btn primary">保存</button></div>
    </form>
  );
}

function KnowRow({ k }: { k: Dict }) {
  return (
    <div className={cx("auto-card", !(k.enabled && !k.pending) && "off")}>
      <div className="auto-top"><span className="auto-ico"><Icon name="brain" /></span>
        <div className="auto-main">
          <div className="auto-title">{k.title}{k.pending && <span className="lib-tag">待确认</span>}{k.source === "agent" ? <span className="lib-tag">任务中提议</span> : k.source === "import" ? <span className="lib-tag">导入</span> : null}</div>
          <div className="auto-when">{k.content}</div></div>
        {k.pending
          ? <><button className="btn ghost sm" onClick={() => knowAction("dismiss", k.id)}>忽略</button><button className="btn primary sm" onClick={() => knowAction("accept", k.id)}>记住</button></>
          : <button className={cx("switch", k.enabled && "on")} title={k.enabled ? "停用" : "启用"} onClick={() => knowAction("toggle", k.id)}><i></i></button>}
      </div>
      <div className="auto-foot">
        <div className="auto-runs">{k.sessionId && <a href={`#${k.sessionId}`} onClick={(e) => { e.preventDefault(); openSession(k.sessionId); }}><Icon name="message" />来源任务</a>}<span>{fmtDate(k.createdAt)}</span></div>
        <button className="icon-btn sm" title="编辑" onClick={() => knowAction("edit", k.id)}><Icon name="pencil" /></button>
        <button className="icon-btn sm" title="删除" onClick={() => knowAction("del", k.id)}><Icon name="trash" /></button>
      </div>
    </div>
  );
}

export function Personal() {
  const s = useStore();
  const list: Dict[] = s.personal.knowledge || [];
  const pend = list.filter((k) => k.pending).length;
  const tab = (t: string) => { S.persTab = t; render(); };
  return (
    <div id="personal">
      <div className="lib-inner">
        <div className="lib-head"><h2>个性化</h2></div>
        <div className="lib-tabs" id="pers-tabs">
          <button className={cx("lib-tab", s.persTab === "profile" && "on")} data-ptab="profile" onClick={() => tab("profile")}>个人资料</button>
          <button className={cx("lib-tab", s.persTab === "knowledge" && "on")} data-ptab="knowledge" onClick={() => tab("knowledge")}>知识{list.length ? <span>{list.length}</span> : null}{pend ? <i className="dot"></i> : null}</button>
        </div>
        <ProfileForm hidden={s.persTab !== "profile"} />
        <div id="pers-knowledge" className={cx(s.persTab !== "knowledge" && "hidden")}>
          <div className="lib-head" style={{ margin: "0 0 12px" }}><p className="auto-intro" style={{ margin: 0 }}>OpenManus 会在之后的任务中参考已启用的知识。任务中它也可能提议记住某些内容，由你决定是否接受。</p>
            <button className="btn primary sm" id="know-new" onClick={() => openModal("know")}>添加知识</button></div>
          <div id="know-list">
            {list.length ? [...list.filter((k) => k.pending), ...list.filter((k) => !k.pending)].map((k) => <KnowRow k={k} key={k.id} />)
              : <div className="lib-empty"><Icon name="brain" /><div>还没有知识</div><div className="muted">添加你希望 OpenManus 长期记住的事实和偏好</div></div>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ knowledge dialog ---
function KnowForm({ m }: { m: Dict }) {
  const k: Dict | undefined = m.know;
  const [title, setTitle] = useState(k?.title || "");
  const [content, setContent] = useState(k?.content || "");
  const [err, setErr] = useState("");
  const close = () => closeModal("know");
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const r = await jfetch(k ? `/api/knowledge/${k.id}` : "/api/knowledge", k ? "PATCH" : "POST", { title, content });
    if (!r.ok) { setErr(await errText(r, "保存失败")); return; }
    closeModal("know");
    await loadPersonal();
  };
  return (
    <div id="know-modal">
      <form className="sched-card" id="know-form" autoComplete="off" onSubmit={save}>
        <div className="viewer-head"><div className="viewer-title"><div id="know-form-title" style={{ fontSize: 16, fontWeight: 500 }}>{k ? "编辑知识" : "添加知识"}</div></div>
          <button type="button" className="icon-btn" id="know-close" onClick={close}><Icon name="x" /></button></div>
        <div className="sched-body">
          <label>标题<input name="title" maxLength={80} placeholder="例如：报告语言" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label>内容<textarea name="content" rows={4} maxLength={2000} placeholder="例如：所有报告默认使用中文，并在开头给出结论" required autoFocus value={content} onChange={(e) => setContent(e.target.value)} /></label>
          <div className="sched-err" id="know-err">{err}</div>
        </div>
        <div className="cc-actions"><button type="button" className="btn ghost" id="know-cancel" onClick={close}>取消</button><button type="submit" className="btn primary">保存</button></div>
      </form>
    </div>
  );
}
export function KnowModal() {
  const s = useStore();
  const m = s.modals.know;
  if (!m) return null;
  return <KnowForm key={m._k} m={m} />;
}

// ------------------------------------------------------------------ memory import ---
const IMPORT_PROMPT = "请列出你记住的关于我的所有信息：我的名字、职业、工作内容、兴趣，以及我对回答方式的偏好。逐条列出，不要遗漏，也不要编造。";

// Import another assistant's memory: the model extracts a profile and knowledge items; the user reviews them first.
function ImportBody() {
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<Dict | null>(null);
  const [checked, setChecked] = useState<boolean[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const promptRef = useRef<HTMLInputElement>(null);
  const close = () => closeModal("import");

  const run = async () => {
    if (draft) return apply();
    setErr(""); setBusy(true);
    const r = await jfetch("/api/personalization/import", "POST", { text });
    setBusy(false);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.detail || "解析失败"); return; }
    setDraft(j); setChecked(j.knowledge.map(() => true));
  };
  const apply = async () => {
    const j = draft!, cur = S.personal.profile || {};
    const profile: Dict = {};
    if (j.nickname && !cur.nickname) profile.nickname = j.nickname;
    if (j.occupation && !cur.occupation) profile.occupation = j.occupation;
    if (j.about && !cur.about) profile.about = j.about;
    if (Object.keys(profile).length) await jfetch("/api/personalization", "PUT", { profile });
    for (let i = 0; i < j.knowledge.length; i++) {
      if (!checked[i]) continue;
      await jfetch("/api/knowledge", "POST", { ...j.knowledge[i], source: "import" });
    }
    close();
    await openPersonal(Object.keys(profile).length ? "profile" : "knowledge");
  };
  const copy = async () => { try { await navigator.clipboard.writeText(IMPORT_PROMPT); setCopied(true); } catch { promptRef.current?.select(); } };

  const prof = draft ? ([["昵称", draft.nickname], ["职业", draft.occupation], ["关于你", draft.about]] as [string, string][]).filter(([, v]) => v) : [];
  return (
    <div id="import-modal">
      <div className="sched-card import-modal">
        <div className="viewer-head"><div className="viewer-title"><div style={{ fontSize: 16, fontWeight: 500 }}>从其他 AI 导入记忆</div></div>
          <button type="button" className="icon-btn" id="import-close" onClick={close}><Icon name="x" /></button></div>
        <div className="sched-body">
          <div className="share-desc">1. 把下面这段话发给你常用的 AI 助手（ChatGPT、Claude、豆包等）：</div>
          <div className="share-link"><input id="import-prompt" ref={promptRef} readOnly value={IMPORT_PROMPT} /><button className="btn ghost sm" id="import-copy" onClick={copy}>{copied ? "已复制" : "复制"}</button></div>
          <label>2. 把它的回答粘贴到这里<textarea id="import-text" rows={7} placeholder="粘贴 AI 助手的回答" autoFocus value={text}
            onChange={(e) => { setText(e.target.value); if (draft) setDraft(null); }} /></label>
          <div id="import-result">
            {draft && (
              <div className="import-review"><div className="mcp-label">将填入个人资料（只覆盖空白项）</div>
                {prof.length ? prof.map(([k, v]) => <div key={k}><b>{k}</b>：{v}</div>) : <div className="muted">没有识别到个人资料</div>}
                <div className="mcp-label">将添加 {draft.knowledge.length} 条知识</div>
                {draft.knowledge.map((k: Dict, i: number) => (
                  <label className="check" key={i}><input type="checkbox" checked={!!checked[i]} onChange={(e) => setChecked(checked.map((c, x) => (x === i ? e.target.checked : c)))} />{k.title}：{k.content}</label>
                ))}
              </div>
            )}
          </div>
          <div className="sched-err" id="import-err">{err}</div>
        </div>
        <div className="cc-actions"><button type="button" className="btn ghost" id="import-cancel" onClick={close}>取消</button>
          <button className="btn primary" id="import-run" disabled={busy} onClick={run}>{busy ? "解析中…" : draft ? "导入" : "解析"}</button></div>
      </div>
    </div>
  );
}
export function ImportModal() {
  const s = useStore();
  const m = s.modals.import;
  if (!m) return null;
  return <ImportBody key={m._k} />;
}
