// File previews shared by the computer panel and the library viewer.
import { useEffect, useState, type ReactNode } from "react";
import { S, type FileRef } from "../store";
import { Icon, IMG, Prose, TEXTY, cx, ext } from "../lib/util";

export function fetchText(url: string): Promise<string> {
  if (!(url in S.previews)) S.previews[url] = fetch(url).then((r) => (r.ok ? r.text() : "")).catch(() => "");
  return S.previews[url];
}

/** Line-numbered code; `diff` colors "+ " / "- " lines. */
export function CodeRows({ content, diff = false }: { content: unknown; diff?: boolean }) {
  return (
    <div className="code">
      {String(content || "").split("\n").map((l, i) => {
        const cls = diff ? (l.startsWith("+ ") ? "add" : l.startsWith("- ") ? "del" : "") : "";
        return [<span className="ln" key={`n${i}`}>{i + 1}</span>, <span className={cx("lc", cls)} key={`c${i}`}>{l || " "}</span>];
      })}
    </div>
  );
}

/** The body of a file preview; `loading` shows until a text file has been fetched. */
export function FileBody({ f, loading = null }: { f: FileRef; loading?: ReactNode }) {
  const e = ext(f.name);
  const texty = TEXTY.has(e);
  const [text, setText] = useState<{ url: string; text: string } | null>(null);
  useEffect(() => {
    if (!texty) return;
    let alive = true;
    fetchText(f.url).then((t) => { if (alive) setText({ url: f.url, text: t }); });
    return () => { alive = false; };
  }, [f.url, texty]);

  if (IMG.has(e)) return <img className="shot" src={f.url} alt="" />;
  if (e === "pdf") return <iframe className="preview-frame" style={{ height: "calc(100vh - 240px)" }} src={f.url} />;
  if (["mp4", "webm", "mov"].includes(e)) return <div className="media-view"><video className="media-player" src={f.url} controls /></div>;
  if (["mp3", "wav", "m4a", "ogg"].includes(e)) return <div className="media-view"><div className="audio-wrap"><Icon name="music" /><audio src={f.url} controls /></div></div>;
  if (!texty) return <div className="pc-empty" style={{ height: 300 }}><Icon name="fileDoc" /><span>该文件无法预览，<a href={f.url} download>点击下载</a></span></div>;
  if (!text || text.url !== f.url) return <>{loading}</>;
  if (e === "md" || e === "markdown") return <div className="page-md"><Prose text={text.text} /></div>;
  return <CodeRows content={text.text} />;
}
