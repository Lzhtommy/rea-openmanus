// Client state. One mutable object, like the original client, so the event model (turns, steps)
// can be updated in place as events stream in; `render()` batches a React update per frame.
// Components subscribe with `useStore()`; a turn re-renders only when its `rev` changes (`touch`).
import { useSyncExternalStore } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Dict = Record<string, any>;

export type Item =
  | { kind: "chat"; ev: Dict }
  | { kind: "stream"; id: string; text: string }
  | { kind: "group"; id: string; steps: string[] };

export interface Turn {
  id: string;
  user: Dict | null;
  start: number;
  end: number | null;
  status: string;
  items: Item[];
  suggestions: Dict[] | null;
  open: boolean | undefined;
  groupOpen: Record<string, boolean>;
  error: string;
  promos?: Dict[];
  planConfirm?: Dict[] | null;
  rev: number;
}

export interface Step extends Dict {
  actionId: string;
  turn: Turn;
  startTs: number;
}

export interface FileRef { url: string; name: string; path?: string }

export type View =
  | "home" | "session" | "library" | "automations" | "connectors" | "plugins" | "creations" | "computers"
  | "computeruse" | "agents" | "personal" | "skills" | "project";

export type ModalName =
  | "sched" | "trig" | "flex" | "pcnew" | "ideas" | "settings" | "ag" | "plug" | "conn" | "skill"
  | "skillNew" | "know" | "import" | "share" | "viewer";

export interface Panel { open: boolean; userClosed: boolean; sel: string | null; file: FileRef | null; full: boolean; takeover: boolean }

const freshPanel = (): Panel => ({ open: false, userClosed: false, sel: null, file: null, full: false, takeover: false });

export const S = {
  models: { modes: [], providers: [], gatewayModels: [] } as Dict, modelSel: null as Dict | null,
  conns: [] as Dict[], projects: [] as Dict[], projectId: null as string | null,
  view: "home" as View, library: [] as Dict[], libFilter: "all", libQuery: "", schedules: [] as Dict[],
  sessions: [] as Dict[], cfg: {} as Dict, current: null as string | null, ws: null as WebSocket | null,
  lastSeq: {} as Record<string, number>, replaying: false, filter: "",
  title: "", status: "idle", live: "", plan: [] as Dict[], planOpen: false,
  turns: [] as Turn[], steps: [] as Step[], stepIdx: {} as Record<string, number>, finalized: new Set<string>(),
  panel: freshPanel(),
  vnc: false, vncFailed: false,
  attachments: [] as { name: string; path: string }[], previews: {} as Record<string, Promise<string>>,
  personal: { profile: {}, instructions: "", knowledge: [] } as Dict, persTab: "profile",
  plugins: { plugins: [], categories: [] } as Dict, plugCat: "all", sites: [] as Dict[], crTab: "all",
  pcs: { computers: [], templates: [], unavailable: [], tasks: {}, cpus: [], memory: [] } as Dict,
  pcOpen: null as string | null, pcTab: "desktop", target: null as string | null,
  devs: { devices: [], tasks: {} } as Dict, pairing: null as Dict | null, rec: null as Dict | null,
  ags: { agents: [], teams: [] } as Dict, agTab: "agents", crew: null as string | null,
  triggers: [] as Dict[], activity: [] as Dict[], autoTab: "activity",
  skills: { skills: [], catalog: [], categories: [] } as Dict, skTab: "explore", skCat: "all", skSrc: "all",
  pickedSkills: [] as string[], skErr: "",
  // read-only share replay
  readonly: false, shareToken: null as string | null, shareData: null as Dict | null, shareMissing: false,
  clockNow: null as number | null, slideIdx: {} as Record<string, number>,
  // sign-in
  auth: null as Dict | null, me: null as Dict | null, authScreen: false,
  // composer and chrome
  input: "", confirmPlan: false,
  menus: { mode: false, plus: false, skillPick: false, targetPick: false, more: false, skCreate: false, autoNew: false },
  navSearch: false, navCollapsed: false, theme: "auto",
  // open dialogs: name -> the data it was opened with (`_k` remounts it on every open)
  modals: {} as Partial<Record<ModalName, Dict>>,
};
export type State = typeof S;

// ---- render scheduling
let version = 0;
let rafPending = false;
const listeners = new Set<() => void>();
/** Flags read by components after the next render. */
export const ui = { stickBottom: true, focusInput: false, caretEnd: false };

export function render(scrollEnd = false) {
  if (scrollEnd) ui.stickBottom = true;
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    version++;
    listeners.forEach((l) => l());
  });
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
/** Re-render the calling component on every store update; returns the state. */
export function useStore() {
  useSyncExternalStore(subscribe, () => version);
  return S;
}

/** Mark a turn for re-render (the original client's `S.dirty.add(t)`). */
export function touch(t: Turn | null | undefined) { if (t) t.rev++; }
/** Re-render every turn, e.g. when the selected step or the mode changes. */
export function touchAll() { S.turns.forEach(touch); render(); }

export function resetSessionState() {
  Object.assign(S, { title: "", status: "idle", live: "", plan: [], planOpen: false, turns: [], steps: [], stepIdx: {}, finalized: new Set(), vnc: false, vncFailed: false });
  S.panel = freshPanel();
}

// ---- dialogs
let modalSeq = 0;
export function openModal(name: ModalName, data: Dict = {}) { S.modals[name] = { ...data, _k: ++modalSeq }; render(); }
export function closeModal(name: ModalName) { delete S.modals[name]; render(); }

// ---- popup menus (one document click closes them, see App)
export type MenuName = keyof State["menus"];
export function setMenu(name: MenuName, open: boolean) { S.menus[name] = open; render(); }
