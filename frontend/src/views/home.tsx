// Home: greeting, the composer, Studio entry cards and the daily idea picks (首页).
import { useState, type ReactNode } from "react";
import { closeModal, openModal, useStore } from "../store";
import { Icon, cx } from "../lib/util";
import { goHome, useIdea } from "../actions";
import { pickFiles } from "../session/Composer";

interface StudioCard { title: string; sub: string; icon: string; prompt?: string; skills?: string[]; action?: string }
const STUDIO: StudioCard[] = [
  { title: "创建你的视频", sub: "脚本、分镜、配音与成片", icon: "film", prompt: "帮我制作一支 30 秒的短视频：", skills: [] },
  { title: "构建网站、应用和游戏", sub: "做好后发布成固定网址", icon: "gamepad", prompt: "帮我做一个网站：", skills: ["web-development"] },
  { title: "从本地文件开始", sub: "上传文档、表格或图片", icon: "upload", action: "upload" },
  { title: "创建幻灯片、图片", sub: "演示文稿、海报和配图", icon: "presentation", prompt: "帮我做一份幻灯片：", skills: ["slides"] },
];
// [category, title, prompt, skill]
const IDEAS: [string, string, string, string][] = [
  ["幻灯片", "把工作坊日程做成幻灯片", "把下面的工作坊日程做成一份 8 页左右的幻灯片，并导出 PDF 和 PPTX：", "slides"],
  ["幻灯片", "季度汇报 PPT", "根据我提供的数据做一份季度经营汇报幻灯片，突出结论和趋势图表：", "slides"],
  ["幻灯片", "产品发布会演示", "为一款新产品做发布会演示文稿，包含痛点、方案、功能亮点和定价：", "slides"],
  ["网站", "把产品规格变成发布网站", "把下面的产品规格做成一个精美的产品发布单页网站，并发布出来：", "web-development"],
  ["网站", "把简历做成个人网站", "把我的简历做成一个简洁专业的个人主页并发布：", "web-development"],
  ["网站", "活动报名页", "做一个活动报名落地页，包含活动介绍、日程、嘉宾和报名表单，并发布：", "web-development"],
  ["游戏", "网页版小游戏", "用 HTML/JS 做一个可以在浏览器里玩的小游戏（带计分和最高分记录），并发布：", "web-development"],
  ["游戏", "知识问答游戏", "做一个关于我指定主题的问答闯关小游戏，并发布：", "web-development"],
  ["应用", "个人预算应用", "做一个个人记账和预算应用（数据保存在浏览器里），并发布：", "web-development"],
  ["应用", "番茄钟专注工具", "做一个番茄钟专注应用，带任务列表和统计，并发布：", "web-development"],
  ["图片", "拍一组时尚大片", "生成一组 4 张风格统一的时尚大片：", ""],
  ["图片", "活动海报", "为下面的活动设计一张宣传海报：", ""],
  ["图片", "产品场景图", "为我的产品生成 3 张不同场景的宣传图：", ""],
  ["视频", "创作一支动漫短片", "构思并制作一支动漫风格的短片：先写剧本和分镜，再生成画面：", ""],
  ["视频", "美食广告", "为一家餐厅制作一支美食广告短片的脚本、分镜和画面：", ""],
  ["调研", "行业深度调研", "调研下面这个行业的现状、主要玩家、市场规模和趋势，输出一份带引用的报告：", "deep-research"],
  ["调研", "竞品对比分析", "对比分析下面几款产品的功能、定价和用户评价，做成表格和结论：", "deep-research"],
  ["数据", "数据分析与图表", "分析我上传的数据表，找出关键规律并做成图表和结论：", "data-analysis"],
  ["数据", "数据看板", "用我上传的数据做一个可交互的数据看板网页，并发布：", "data-analysis"],
  ["效率", "会议纪要整理", "把下面的会议记录整理成标准会议纪要（结论、决议、待办）：", ""],
];

function pickIdea(i: number) {
  const x = IDEAS[i];
  closeModal("ideas");
  useIdea(x[2], x[3] ? [x[3]] : []);
}
function Idea({ i }: { i: number }) {
  const [cat, title] = IDEAS[i];
  return <button className="idea" onClick={() => pickIdea(i)}><span className="lib-tag">{cat}</span><span>{title}</span></button>;
}

function studioClick(c: StudioCard) {
  if (c.action === "upload") { goHome(); pickFiles(); return; }
  useIdea(c.prompt || "", c.skills || []);
}

export function Home({ composer }: { composer: ReactNode }) {
  useStore();
  const day = Math.floor(Date.now() / 864e5), picks = [0, 3, 6, 10, 15, 17].map((k) => (k + day) % IDEAS.length);
  return (
    <div id="home">
      <div className="home-inner">
        <h1 className="greeting">你好<br /><span>我能为你做什么？</span></h1>
        <div id="home-slot">{composer}</div>
        <div className="studio" id="studio">
          {STUDIO.map((c, i) => (
            <button className="studio-card" key={i} onClick={() => studioClick(c)}>
              <span className="studio-ico"><Icon name={c.icon} /></span><span className="studio-t">{c.title}</span><span className="studio-s">{c.sub}</span>
            </button>
          ))}
        </div>
        <div className="ideas-head"><span>灵感</span><button className="btn ghost sm" id="ideas-all" onClick={() => openModal("ideas")}>查看全部</button></div>
        <div className="ideas" id="ideas">{picks.map((i, k) => <Idea i={i} key={k} />)}</div>
      </div>
    </div>
  );
}

function IdeasBody({ initial }: { initial: string }) {
  const [cat, setCat] = useState(initial);
  const cats = ["全部", ...new Set(IDEAS.map((x) => x[0]))];
  return (
    <div id="ideas-modal">
      <div className="sched-card ideas-card">
        <div className="viewer-head"><div className="viewer-title"><div style={{ fontSize: 16, fontWeight: 500 }}>全部创意</div></div>
          <button type="button" className="icon-btn" id="ideas-close" onClick={() => closeModal("ideas")}><Icon name="x" /></button></div>
        <div className="lib-tabs" id="ideas-tabs" style={{ padding: "10px 18px 0" }}>
          {cats.map((c) => <button key={c} className={cx("lib-tab", c === cat && "on")} onClick={() => setCat(c)}>{c}</button>)}
        </div>
        <div className="ideas grid" id="ideas-grid">
          {IDEAS.map((x, i) => [x, i] as const).filter(([x]) => cat === "全部" || x[0] === cat).map(([, i]) => <Idea i={i} key={i} />)}
        </div>
      </div>
    </div>
  );
}

export function IdeasModal() {
  const s = useStore();
  const m = s.modals.ideas;
  if (!m) return null;
  return <IdeasBody key={m._k} initial={m.cat || "全部"} />;
}
