// The sidebar (navigation, projects, tasks, account) and the top bar (mode selector, task actions).
import { S, render, openModal, type Dict } from "./store";
import {
  THEMES, currentSel, deleteSession, goHome, loadProjects, openAgents, openAutomations, openComputerUse, openComputers,
  openCreations, openLibrary, openPersonal, openPlugins, openProject, openSession, openSkills, providerInfo, selLabel, setSel, setTheme,
} from "./actions";
import { Icon, cx, jfetch, shortModel, store } from "./lib/util";
import { openSettings } from "./views/settings";
import { openFlex } from "./views/flex";

/** Views that fill the main area without a task (no thread, no dock). */
export const isPageView = (v: string) => !["home", "session"].includes(v);

const collapse = (v: boolean) => { S.navCollapsed = v; store.set("nav-collapsed", v ? "1" : "0"); render(); };

function SessionList() {
  const q = S.filter.trim().toLowerCase();
  const list = S.sessions.filter((s) => !q || String(s.title).toLowerCase().includes(q));
  if (!list.length) return <div id="session-list"><div className="session-empty">{q ? "没有匹配的任务" : "暂无任务"}</div></div>;
  return (
    <div id="session-list">
      {list.map((s) => (
        <div className={cx("session-item", s.id === S.current && "active")} key={s.id} onClick={() => { if (s.id !== S.current) openSession(s.id); }}>
          <span className="s-ico">{s.status === "running" ? <Icon name="loader" cls="spin-i" style={{ animation: "spin 1s linear infinite" }} />
            : <Icon name={s.status === "error" ? "alert" : s.scheduleId ? "clock" : s.triggerId ? "zap" : "message"} />}</span>
          <span className="s-title">{s.title}</span>
          <button className="s-more" title="删除" onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}><Icon name="trash" /></button>
        </div>
      ))}
    </div>
  );
}

export function Nav() {
  const v = S.view;
  const nick = S.personal.profile?.nickname || S.me?.name;
  const newProject = async () => {
    const name = prompt("项目名称"); if (!name?.trim()) return;
    const r = await jfetch("/api/projects", "POST", { name });
    if (r.ok) { const p = await r.json(); await loadProjects(); openProject(p.id); }
  };
  const toggleSearch = () => { S.navSearch = !S.navSearch; if (!S.navSearch) S.filter = ""; render(); };
  const more = (fn: () => unknown) => { S.menus.more = false; fn(); };
  const themeIco = ({ auto: "auto", light: "sun", dark: "moon" } as Dict)[S.theme];
  return (
    <aside id="nav">
      <div className="nav-head">
        <a className="brand" href="#" id="brand" onClick={(e) => { e.preventDefault(); goHome(); }}><span className="brand-mark"><Icon name="logo" /></span><span className="brand-word">openmanus</span></a>
        <div className="nav-head-actions">
          <button className="icon-btn" id="search-btn" title="搜索任务" onClick={toggleSearch}><Icon name="search" /></button>
          <button className="icon-btn" id="nav-collapse" title="收起侧边栏" onClick={() => collapse(true)}><Icon name="panelLeft" /></button>
        </div>
      </div>
      <div className="nav-body">
        <button className="nav-item" id="new-task" onClick={goHome}><span className="nav-ico"><Icon name="newTask" /></span><span className="nav-label">新建任务</span><kbd>⌘K</kbd></button>
        <button className={cx("nav-item", v === "computers" && "active")} id="nav-pc" onClick={openComputers}><span className="nav-ico"><Icon name="monitor" /></span><span className="nav-label">电脑</span></button>
        <button className={cx("nav-item", v === "agents" && "active")} id="nav-agents" onClick={openAgents}><span className="nav-ico"><Icon name="users" /></span><span className="nav-label">Agent</span></button>
        <button className={cx("nav-item", v === "library" && "active")} id="nav-library" onClick={openLibrary}><span className="nav-ico"><Icon name="library" /></span><span className="nav-label">资料库</span></button>
        <button className={cx("nav-item", v === "creations" && "active")} id="nav-create" onClick={openCreations}><span className="nav-ico"><Icon name="sparkBox" /></span><span className="nav-label">创作</span></button>
        <button className={cx("nav-item", v === "automations" && "active")} id="nav-auto" onClick={() => openAutomations()}><span className="nav-ico"><Icon name="clock" /></span><span className="nav-label">自动化</span></button>
        <button className={cx("nav-item", (v === "connectors" || v === "plugins") && "active")} id="nav-conn" onClick={openPlugins}><span className="nav-ico"><Icon name="puzzle" /></span><span className="nav-label">插件</span></button>
        <div className="more-wrap"><button className={cx("nav-item", ["personal", "skills", "computeruse"].includes(v) && "active")} id="nav-more" onClick={() => { S.menus.more = !S.menus.more; render(); }}>
          <span className="nav-ico"><Icon name="more" /></span><span className="nav-label">更多</span></button>
          <div className={cx("more-menu", !S.menus.more && "hidden")} id="more-menu">
            <button className="mode-item" onClick={() => more(openComputerUse)}><span><Icon name="laptop" /></span>Computer Use</button>
            <button className="mode-item" onClick={() => more(() => openSkills())}><span><Icon name="spark" /></span>技能</button>
            <button className="mode-item" onClick={() => more(() => openPersonal())}><span><Icon name="user" /></span>个性化</button>
          </div></div>
        <div className={cx("nav-search", !S.navSearch && "hidden")} id="nav-search"><span><Icon name="search" /></span>
          <input id="search-input" placeholder="搜索任务" autoFocus defaultValue={S.filter} onChange={(e) => { S.filter = e.target.value; render(); }} key={String(S.navSearch)} /></div>
        <div className="nav-section">项目</div>
        <button className="nav-item" id="new-project" onClick={newProject}><span className="nav-ico"><Icon name="folderPlus" /></span><span className="nav-label">新项目</span></button>
        <div id="project-list">{S.projects.map((p) => (
          <div className={cx("session-item", v === "project" && S.projectId === p.id && "active")} key={p.id} onClick={() => openProject(p.id)}>
            <span className="s-ico"><Icon name="folder" /></span><span className="s-title">{p.name}</span></div>))}</div>
        <div className="nav-section">任务</div>
        <SessionList />
      </div>
      <div className="nav-foot">
        <div className="me" onClick={() => openSettings()}><span className="avatar">{(nick || "O").slice(0, 1).toUpperCase()}</span>
          <div className="me-text"><div className="me-name">{nick || "OpenManus"}</div><div className="me-sub" id="config-info">{S.cfg.model ? `${shortModel(S.cfg.model)} · ${S.cfg.sandbox} 沙箱` : ""}</div></div></div>
        <button className="icon-btn" id="theme-btn" title={({ auto: "主题：跟随系统", light: "主题：浅色", dark: "主题：深色" } as Dict)[S.theme]}
          onClick={() => setTheme(THEMES[(THEMES.indexOf(S.theme) + 1) % 3])}><Icon name={themeIco} /></button>
      </div>
    </aside>
  );
}

function ModeMenu() {
  if (!S.menus.mode) return <div className="mode-menu hidden" id="mode-menu"></div>;
  const cur = currentSel();
  const pick = (m: Dict) => {
    if (m.id !== "flex") return setSel({ mode: m.id });
    if (cur.mode === "flex") { S.menus.mode = false; render(); return; }
    const p = S.models.providers.find((x: Dict) => x.configured);
    if (p) setSel({ mode: "flex", provider: p.id, model: p.model }); else openFlex();
  };
  return (
    <div className="mode-menu" id="mode-menu">
      {S.models.modes.map((m: Dict) => {
        const on = cur.mode === m.id;
        const sub = m.id === "flex" && cur.mode === "flex" ? `${providerInfo(cur.provider)?.label || ""} · ${cur.model || ""}` : m.description;
        return (
          <div className={cx("mode-item", on && "on")} key={m.id} onClick={() => pick(m)}>
            <div className="mode-text"><div className="mode-name">{m.label}{m.badge && <span className="badge">{m.badge}</span>}</div>
              <div className="mode-desc">{sub}</div>{m.model && m.id !== "flex" && <div className="mode-model">{shortModel(m.model)}</div>}</div>
            {m.id === "flex" && <button className="mode-set" onClick={(e) => { e.stopPropagation(); openFlex(); }}>设置</button>}
            {on && <Icon name="check" />}
          </div>
        );
      })}
    </div>
  );
}

const PAGE_TITLES: Record<string, string> = { personal: "个性化", computeruse: "Computer Use", agents: "Agent", skills: "技能", plugins: "插件", creations: "创作", computers: "电脑", connectors: "连接器", automations: "自动化", library: "资料库" };
export function pageTitle() {
  if (S.view === "project") return S.projects.find((p) => p.id === S.projectId)?.name || "项目";
  if (isPageView(S.view)) return PAGE_TITLES[S.view];
  return S.view === "home" ? "OpenManus" : (S.title || "新任务");
}

export function Header() {
  const page = S.view === "home" || isPageView(S.view);
  const meta = S.current ? S.sessions.find((x) => x.id === S.current) : undefined;
  const crewLabel = meta?.teamId ? S.ags.teams.find((t: Dict) => t.id === meta.teamId)?.name : meta?.agentId ? S.ags.agents.find((a: Dict) => a.id === meta.agentId)?.name : "";
  const pcName = (meta?.computerId && (S.pcs.computers.find((c: Dict) => c.id === meta.computerId)?.name || "云电脑")) ||
    (meta?.deviceId && (S.devs.devices.find((d: Dict) => d.id === meta.deviceId)?.name || "本地计算机"));
  return (
    <header id="main-head">
      <div className="head-left">
        <button className="icon-btn only-collapsed" id="nav-expand" title="展开侧边栏" onClick={() => collapse(false)}><Icon name="panelLeft" /></button>
        <button className="icon-btn only-collapsed" id="new-task-2" title="新建任务" onClick={goHome}><Icon name="newTask" /></button>
        <div className="mode-wrap"><button className="mode-btn" id="mode-btn" onClick={() => { S.menus.mode = !S.menus.mode; render(); }}><span id="mode-label">{selLabel()}</span><span><Icon name="chevDown" /></span></button><ModeMenu /></div>
        <div id="session-title" className="session-title hidden">{pageTitle()}
          {crewLabel && <span className="lib-tag pc-chip"><Icon name="users" />{crewLabel}</span>}
          {pcName && <span className="lib-tag pc-chip"><Icon name="monitor" />{pcName}</span>}</div>
      </div>
      <div className="head-right">
        <button className={cx("icon-btn", page && "hidden")} id="share-btn" title="复制链接" onClick={() => openModal("share")}><Icon name="share" /></button>
        <button className={cx("icon-btn", page && "hidden")} id="delete-btn" title="删除任务" onClick={() => S.current && deleteSession(S.current)}><Icon name="trash" /></button>
        <button className={cx("icon-btn", (page || !S.current || !S.steps.length || (S.panel.open && !!S.current)) && "hidden")} id="panel-btn" title="OpenManus 的电脑"
          onClick={() => { S.panel.open = true; S.panel.userClosed = false; render(); }}><Icon name="panelRight" /></button>
      </div>
    </header>
  );
}
