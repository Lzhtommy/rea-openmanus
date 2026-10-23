import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `npm run dev` serves the UI with hot reload and forwards the API (HTTP + WebSockets) to a running backend.
const backend = process.env.OPENMANUS_BACKEND || "http://127.0.0.1:8000";
const proxy = { target: backend, changeOrigin: false, ws: true };

export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": proxy, "/ws": proxy, "/preview": proxy, "/sites": proxy } },
  build: { outDir: "dist", emptyOutDir: true },
});
