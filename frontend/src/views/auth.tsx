// Sign-in screen: shown when accounts are enabled and nobody is signed in (or any API call returns 401).
import { useState, type FormEvent } from "react";
import { useStore } from "../store";
import { Icon, cx, errText, jfetch } from "../lib/util";

export function AuthScreen() {
  const s = useStore();
  const [err, setErr] = useState("");
  if (!s.authScreen) return null;
  const login = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await jfetch("/api/auth/login", "POST", { username: f.get("username"), password: f.get("password") });
    if (!r.ok) { setErr(await errText(r, "登录失败")); return; }
    location.reload();
  };
  return (
    <div id="auth-screen">
      <form className="auth-card" id="auth-form" autoComplete="on" onSubmit={login}>
        <div className="auth-brand"><span className="brand-mark"><Icon name="logo" /></span><span className="brand-word">openmanus</span></div>
        <h2 id="auth-title">登录</h2>
        <label>用户名<input name="username" autoComplete="username" required autoFocus /></label>
        <label>密码<input name="password" type="password" autoComplete="current-password" required /></label>
        <div className="sched-err" id="auth-err">{err}</div>
        <button className="btn primary" type="submit">登录</button>
        <a className={cx("btn ghost", !s.auth?.feishu && "hidden")} id="auth-feishu" href="/api/auth/feishu/login">使用飞书登录</a>
      </form>
    </div>
  );
}
