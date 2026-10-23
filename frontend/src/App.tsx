// The app shell: sidebar, main area (one page view, or a task's thread with the composer dock),
// the computer panel, and the dialogs.
import { useEffect } from "react";
import { S, closeModal, render, useStore } from "./store";
import { goHome } from "./actions";
import { Header, Nav, isPageView, pageTitle } from "./Chrome";
import { Composer } from "./session/Composer";
import { Thread } from "./session/Thread";
import { ComputerPanel, Taskbar } from "./session/Panel";
import { Home, IdeasModal } from "./views/home";
import { Library, ViewerModal } from "./views/library";
import { Automations, SchedModal, TrigModal } from "./views/automations";
import { Agents, AgModal } from "./views/agents";
import { ComputerUse } from "./views/computeruse";
import { Computers, DevNewModal, PcNewModal, PcViewModal } from "./views/computers";
import { Creations } from "./views/creations";
import { Plugins, PluginModal } from "./views/plugins";
import { Connectors, ConnModal } from "./views/connectors";
import { Skills, SkillModal, SkillNewModal } from "./views/skills";
import { ImportModal, KnowModal, Personal } from "./views/personal";
import { Project } from "./views/project";
import { RecorderModal } from "./views/recorder";
import { SettingsModal } from "./views/settings";
import { FlexModal } from "./views/flex";
import { ShareModal } from "./views/share";
import { AuthScreen } from "./views/auth";

// A click outside an open popup menu closes it.
function onDocClick(e: MouseEvent) {
  const t = e.target as Element;
  const inside = (sel: string) => !!t.closest?.(sel);
  const m = S.menus, before = JSON.stringify(m) + S.planOpen;
  if (m.plus && !inside("#plus-menu, #plus-btn")) { m.plus = false; m.skillPick = false; m.targetPick = false; }
  if (m.mode && !inside("#mode-menu, #mode-btn")) m.mode = false;
  if (m.more && !inside(".more-wrap")) m.more = false;
  if (m.skCreate && !inside("#sk-create, #sk-create-menu")) m.skCreate = false;
  if (m.autoNew && !inside("#auto-new")) m.autoNew = false;
  if (S.planOpen && !inside("#taskbar")) S.planOpen = false;
  if (JSON.stringify(m) + S.planOpen !== before) render();
}

function onKey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); goHome(); }
  if (e.key === "Escape" && S.modals.viewer) { closeModal("viewer"); return; }
  if (e.key === "Escape" && S.panel.full) { S.panel.full = false; render(); }
}

export function App() {
  const s = useStore();
  const view = s.view;
  const page = isPageView(view);
  const panelOpen = s.panel.open && !!s.current;

  useEffect(() => {
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("click", onDocClick); document.removeEventListener("keydown", onKey); };
  }, []);
  useEffect(() => {
    const b = document.body.classList;
    b.toggle("pc-open", panelOpen);
    b.toggle("pc-full", panelOpen && s.panel.full);
    b.toggle("nav-collapsed", s.navCollapsed);
    b.toggle("share-mode", s.readonly);
    document.title = view === "home" ? "OpenManus" : `${pageTitle()} - OpenManus`;
  });

  const project = view === "project" ? s.projects.find((p) => p.id === s.projectId) : undefined;
  return (
    <>
      <div id="app">
        <Nav />
        <main id="main">
          <Header />
          {view === "home" && <Home composer={<Composer />} />}
          {view === "library" && <Library />}
          {view === "automations" && <Automations />}
          {view === "agents" && <Agents />}
          {view === "computeruse" && <ComputerUse />}
          {view === "computers" && <Computers />}
          {view === "creations" && <Creations />}
          {view === "plugins" && <Plugins />}
          {view === "connectors" && <Connectors />}
          {view === "skills" && <Skills />}
          {view === "personal" && <Personal />}
          {view === "project" && <Project composer={<Composer placeholder={project ? `在「${project.name}」中新建任务` : undefined} />} />}
          {!page && view !== "home" && <>
            <Thread />
            <div id="dock"><div id="dock-inner"><Taskbar /><div id="dock-slot"><Composer /></div>
              <div className="disclaimer">OpenManus 是 AI 智能体，可能会出错，请核实重要信息。</div></div></div>
          </>}
        </main>
        <ComputerPanel />
      </div>
      <SchedModal />
      <TrigModal />
      <FlexModal />
      <PcNewModal />
      <AuthScreen />
      <IdeasModal />
      <SettingsModal />
      <AgModal />
      <RecorderModal />
      <DevNewModal />
      <PcViewModal />
      <PluginModal />
      <ConnModal />
      <SkillModal />
      <SkillNewModal />
      <KnowModal />
      <ImportModal />
      <ShareModal />
      <ViewerModal />
    </>
  );
}
