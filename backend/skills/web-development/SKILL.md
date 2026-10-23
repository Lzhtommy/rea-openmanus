---
name: web-development
description: MUST read before building any website, web page, web app, dashboard, or browser game.
title: 网页开发
categories: 编程、设计
summary: 搭建网站、网页应用和小游戏：选型、相对路径、本地验证，再生成预览链接。
---
# Web development

- Prefer a single self-contained static site (HTML + CSS + JS) unless the user needs a backend; it previews and ships most reliably.
- For React/Vue, scaffold with Vite (`npm create vite@latest app -- --template react -y`), install, then `npm run build` and serve `dist/` with `python3 -m http.server <port>` in a dedicated shell id.
- Use relative asset paths (`./assets/...`) so the site works behind the preview proxy path.
- Start the server, verify it with `curl -s localhost:<port> | head`, then open http://localhost:<port>/ in the browser to check rendering.
- To deliver: for static sites, games and front-end apps, call deploy_publish on the folder with index.html (the build output, e.g. `dist/`); the URL is permanent and re-publishing updates it. Use deploy_expose_port only for a temporary preview of something that needs a running server.
- Keep everything the site needs inside that folder (no absolute paths, no files outside it). localStorage works on the published site.
