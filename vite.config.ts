import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Frontend build (CLAUDE.md §3.4 / §5 step 6). The React app lives in `web/`; the
 * pure engine + server it talks to live in `src/` and are imported via `@shared`.
 *
 * In dev, `/game/*` (the POST mint endpoint and the WebSocket upgrade) is proxied to
 * a local `wrangler dev` of the Worker so the whole stack runs free on localhost.
 * The static build lands in `dist/` for Cloudflare Pages.
 *
 * NOTE: test config lives in vitest.config.ts so the engine suite never pulls in the
 * React/Tailwind plugins or the web root.
 */
export default defineConfig({
  root: "web",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./src", import.meta.url)),
      "@": fileURLToPath(new URL("./web/src", import.meta.url)),
    },
  },
  server: {
    fs: { allow: [fileURLToPath(new URL(".", import.meta.url))] },
    proxy: {
      // Both POST /game (mint) and GET /game/:code (ws upgrade) go to the Worker.
      "/game": { target: "http://localhost:8787", ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: fileURLToPath(new URL("./dist", import.meta.url)),
    emptyOutDir: true,
  },
});
