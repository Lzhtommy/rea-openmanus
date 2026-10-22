---
name: web-development
description: MUST read before building any website, web page, web app, dashboard, or browser game.
---
# Web development

- Prefer a single self-contained static site (HTML + CSS + JS) unless the user needs a backend; it previews and ships most reliably.
- For React/Vue, scaffold with Vite (`npm create vite@latest app -- --template react -y`), install, then `npm run build` and serve `dist/` with `python3 -m http.server <port>` in a dedicated shell id.
- Use relative asset paths (`./assets/...`) so the site works behind the preview proxy path.
- Start the server, verify it with `curl -s localhost:<port> | head`, then call deploy_expose_port and open the URL in the browser to check rendering before delivering.
