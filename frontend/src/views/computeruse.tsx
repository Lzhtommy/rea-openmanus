// Computer Use: your own computer, your own Chrome, and the skill recorder.
import { S, render, useStore } from "../store";
import { Icon } from "../lib/util";
import { openComputers, openRecorder } from "../actions";
import { startPairing } from "./computers";

function pick(kind: string) {
  if (kind === "record") return openRecorder();
  openComputers().then(() => startPairing().then(() => { if (kind === "browser" && S.pairing) { S.pairing.myBrowser = true; render(); } }));
}

export function ComputerUse() {
  useStore();
  const card = (kind: string, ico: string, title: string, name: string, desc: string) => (
    <div className="sk-card" data-cu={kind} onClick={() => pick(kind)}>
      <div className="sk-top"><span className="auto-ico"><Icon name={ico} /></span><div className="sk-title">{title}<div className="sk-name">{name}</div></div></div>
      <div className="sk-desc">{desc}</div>
    </div>
  );
  return (
    <div id="computeruse">
      <div className="lib-inner wide">
        <div className="lib-head"><h2>Computer Use</h2></div>
        <p className="auto-intro">让 OpenManus 使用你自己的电脑和浏览器，并从你的操作中学习工作流程。</p>
        <div className="sk-grid">
          {card("device", "laptop", "此计算机上的 OpenManus", "连接设备", "让 OpenManus 在你的电脑上执行命令、处理本地文件。每一步操作都会先征求你的同意。")}
          {card("browser", "compass", "My Browser", "使用你自己的 Chrome", "让 OpenManus 在你自己的浏览器中工作，沿用你已登录的网站。")}
          {card("record", "record", "技能录制器", "录制 → 技能", "在浏览器里演示一遍工作流，OpenManus 把它整理成可重复使用的技能。")}
        </div>
      </div>
    </div>
  );
}
