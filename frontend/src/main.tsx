import { createRoot } from "react-dom/client";
import "./style.css";
import { S } from "./store";
import { App } from "./App";
import { connect } from "./events";
import {
  applyTheme, checkAuth, loadComputers, loadModels, loadPersonal, loadProjects, loadSkills, onHashChange, refreshSessions,
  routeInitial, showLogin, startTimers,
} from "./actions";
import { store } from "./lib/util";

// ---- sign-in: any 401 from the API shows the login screen
const rawFetch = window.fetch.bind(window);
window.fetch = async (...args: Parameters<typeof fetch>) => {
  const r = await rawFetch(...args);
  const url = String(args[0]);
  if (r.status === 401 && url.startsWith("/api/") && !url.startsWith("/api/auth/")) showLogin();
  return r;
};

createRoot(document.getElementById("root")!).render(<App />);

(async function init() {
  if (!(await checkAuth(rawFetch))) return;
  applyTheme(store.get("theme", "auto"));
  S.navCollapsed = store.get("nav-collapsed", "0") === "1";
  startTimers();
  connect();
  try {
    S.cfg = await (await fetch("/api/config")).json();
    await loadModels();
    await loadProjects();
    await loadPersonal();
    await loadSkills();
    loadComputers();
  } catch { /* backend not reachable yet */ }
  await refreshSessions();
  routeInitial();
  window.addEventListener("hashchange", onHashChange);
})();
