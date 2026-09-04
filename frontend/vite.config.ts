import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

// The backend has no CORS and a Strict-SameSite session cookie (see
// backend/src/middleware/auth.ts), so the dev server proxies /api instead
// of the browser talking cross-origin to :8787 directly: the browser then
// only ever sees one origin (this dev server's), matching how the built
// app is served in production (backend/src/app.ts's serveStatic, same
// process, same origin, no proxy needed there).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
