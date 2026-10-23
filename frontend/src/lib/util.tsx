// Shared helpers, formatters, constants and tiny presentational components.
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { CSSProperties, ReactNode } from "react";
import { ICONS } from "./icons";
import type { Dict } from "../store";

// ------------------------------------------------------------------ icons ---
export function Icon({ name, cls = "", style }: { name: string; cls?: string; style?: CSSProperties }) {
  return <svg className={`i ${cls}`} style={style} viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[name] || "" }} />;
}

// ------------------------------------------------------------------ markdown ---
DOMPurify.addHook("afterSanitizeAttributes", (n) => {
  if (n.tagName === "A") { n.setAttribute("target", "_blank"); n.setAttribute("rel", "noopener"); }
});
const mdCache = new Map<string, string>();
/** Markdown to sanitized HTML (agent output and files are untrusted). */
export function md(s: unknown): string {
  const raw = String(s ?? "");
  const hit = mdCache.get(raw);
  if (hit !== undefined) return hit;
  // single "~" is a range ("261~1168 亿"), not strikethrough; drop YAML front matter of skill/report files
  const src = raw.replace(/^---\n[\s\S]*?\n---\n/, "").split(/(```[\s\S]*?```|`[^`\n]*`)/).map((part, i) => i % 2 ? part
    : part.replace(/(^|[^~])~(?!~)/g, "$1\\~")
      // bare URLs end at CJK punctuation / markdown emphasis (GFM autolinks would swallow "，**标题**")
      .replace(/(^|[^<(\[\w/])(https?:\/\/[^\s<>()\[\]，。；：、！？（）【】「」“”‘’*]+)/g, "$1<$2>")).join("");
  const html = DOMPurify.sanitize(marked.parse(src, { breaks: true, async: false }) as string, { ADD_ATTR: ["target"] });
  if (mdCache.size > 500) mdCache.clear();
  mdCache.set(raw, html);
  return html;
}
export function Prose({ text, style }: { text: unknown; style?: CSSProperties }) {
  return <div className="prose" style={style} dangerouslySetInnerHTML={{ __html: md(text) }} />;
}

// ------------------------------------------------------------------ formatting ---
export const basename = (p: unknown) => String(p || "").split("/").pop() || "";
export const ext = (p: unknown) => (basename(p).split(".").pop() || "").toLowerCase();
export const fmtDur = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); const m = Math.floor(s / 60); return m ? `${m}m ${s % 60}s` : `${s}s`; };
export const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
export const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
export const fmtDate = (sec: number) => new Date(sec * 1000).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
export const fmtTs = (sec: number) => (sec ? new Date(sec * 1000).toLocaleString("zh-CN", { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" }) : "—");
export const ago = (sec: number) => { const m = Math.round((Date.now() / 1000 - sec) / 60); return m < 1 ? "刚刚" : m < 60 ? `${m} 分钟前` : m < 1440 ? `${Math.round(m / 60)} 小时前` : fmtTs(sec); };
export const fmtNum = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n || 0));
export const shortModel = (m: unknown) => String(m).split("/").pop() || "";
export const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
export const linesToMap = (text: string, sep: string) => Object.fromEntries(text.split("\n").map((l) => l.trim()).filter(Boolean)
  .map((l) => { const i = l.indexOf(sep); return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : [l, ""]; }));
export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");

export const store = {
  get(k: string, d: string) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

/** POST/PUT/PATCH JSON. */
export const jfetch = (url: string, method: string, body?: unknown) =>
  fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
/** The API's error message (`detail`) or a fallback. */
export const errText = async (r: Response, fallback: string) => (await r.json().catch(() => ({}))).detail || fallback;
export const getJSON = async <T,>(url: string, fallback: T): Promise<T> => { try { return await (await fetch(url)).json(); } catch { return fallback; } };

// ------------------------------------------------------------------ tools & files ---
// tool category -> step icon, human label for "OpenManus 正在使用…"
export const TOOL: Record<string, { icon: string; use: string; round?: boolean }> = {
  terminal: { icon: "terminal", use: "终端" },
  browser: { icon: "compass", use: "浏览器", round: true },
  webpage_extract: { icon: "compass", use: "浏览器", round: true },
  text_editor: { icon: "pencil", use: "编辑器" },
  search: { icon: "search", use: "搜索" },
  search_image: { icon: "image", use: "图片搜索" },
  search_scholar: { icon: "book", use: "学术搜索" },
  map_reduce: { icon: "layers", use: "并行子任务" },
  deploy: { icon: "rocket", use: "部署服务" },
  schedule: { icon: "clock", use: "自动化" },
  mcp: { icon: "plug", use: "连接器" },
  knowledge: { icon: "brain", use: "知识" },
  agent: { icon: "users", use: "团队成员", round: true },
  slides: { icon: "presentation", use: "幻灯片" },
  media: { icon: "image", use: "生成工具" },
};
const ACTION_ZH: Record<string, string> = {
  "Executing command": "执行命令", "Checking terminal": "查看终端", Browsing: "浏览", Typing: "输入", Clicking: "点击",
  "Running JavaScript": "执行 JavaScript", "Reading file": "读取文件", "Editing file": "编辑文件", "Searching files": "搜索文件", "Creating scheduled task": "创建定时任务", "Searching tools": "搜索工具", "Using MCP": "调用工具", "Saving knowledge": "提议记住", "Searching images": "搜索图片", "Searching papers": "搜索论文",
  "Exporting slides": "渲染幻灯片", Delegating: "委派给", "Publishing site": "发布站点", "Generating image": "生成图片", "Generating speech": "生成语音", "Generating video": "生成视频",
  Searching: "搜索", "Reading webpage": "提取网页", "Running parallel sub-agents": "并行执行子任务", "Exposing port": "部署预览",
};
export const zh = (a: unknown) => ACTION_ZH[a as string] || (a as string) || "";
export const liveText = (t: string) => ({ Thinking: "思考中", Planning: "正在规划任务" } as Dict)[t] || t || "思考中";

export const TEXTY = new Set(["md", "markdown", "txt", "csv", "json", "py", "js", "ts", "html", "css", "yaml", "yml", "log", "sh"]);
export const IMG = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
export function fileIconCls(name: string): [string, string] {
  const e = ext(name);
  if (e === "pdf") return ["fileDoc", "pdf"];
  if (IMG.has(e)) return ["image", "img"];
  if (["csv", "xlsx", "xls"].includes(e)) return ["fileDoc", "sheet"];
  if (["pptx", "ppt", "key"].includes(e)) return ["presentation", "slides"];
  if (["mp4", "webm", "mov"].includes(e)) return ["film", "video"];
  if (["mp3", "wav", "m4a", "ogg"].includes(e)) return ["music", "audio"];
  if (["py", "js", "ts", "html", "css", "json", "sh"].includes(e)) return ["code", "code"];
  return ["fileDoc", ""];
}
/** The colored file-type icon used by file cards, the library and the viewer. */
export function FileIco({ name, id }: { name: string; id?: string }) {
  const [ic, cls] = fileIconCls(name);
  return <span className={cx("fc-ico", cls)} id={id}><Icon name={ic} /></span>;
}

// Manus' 资料库 categories
export const LIB_TABS: [string, string][] = [["all", "全部"], ["doc", "文本和 PDF"], ["slides", "幻灯片"], ["sheet", "表格"], ["image", "图片"], ["video", "视频"], ["audio", "音频"], ["other", "其他"]];
export function fileKind(name: string) {
  const e = ext(name);
  if (IMG.has(e)) return "image";
  if (["md", "markdown", "txt", "pdf", "docx", "doc", "rtf", "html"].includes(e)) return "doc";
  if (["pptx", "ppt", "key"].includes(e) || /slides?\.html$/i.test(name)) return "slides";
  if (["csv", "xlsx", "xls", "tsv", "numbers"].includes(e)) return "sheet";
  if (["mp4", "mov", "webm", "mkv", "avi"].includes(e)) return "video";
  if (["mp3", "wav", "m4a", "ogg", "flac", "aac"].includes(e)) return "audio";
  return "other";
}

// ------------------------------------------------------------------ shared bits ---
export const PC_ST: Record<string, [string, string]> = { running: ["ok", "运行中"], ready: ["ok", "运行中"], stopped: ["", "已关机"], starting: ["", "启动中"], setting_up: ["", "正在配置"], error: ["err", "出错"] };
export const SRC_ICO: Record<string, string> = { schedule: "clock", webhook: "webhook", condition: "zap", trigger: "zap" };
export const SK_SRC: Record<string, string> = { official: "官方", personal: "个人", github: "第三方" };

/** A status pill: `<span class="conn-st ok"><i></i>已连接</span>`. */
export function ConnSt({ cls, children, title }: { cls: string; children: ReactNode; title?: string }) {
  return <span className={cx("conn-st", cls)} title={title}><i></i>{children}</span>;
}
export function AgAvatar({ a }: { a: Dict }) {
  return <span className="ag-av" style={{ background: a.color || "#4b5563" }}>{a.icon || (a.name || "?").slice(0, 1)}</span>;
}
/** A spinning loader icon (`<span class="spin">…</span>`). */
export const Spin = () => <span className="spin"><Icon name="loader" /></span>;

/** Copy text; returns whether it worked. */
export async function copyText(text: string) { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } }
