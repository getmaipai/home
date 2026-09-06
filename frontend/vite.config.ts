import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath } from "node:url";

// The backend has no CORS and a Strict-SameSite session cookie (see
// backend/src/middleware/auth.ts), so the dev server proxies /api instead
// of the browser talking cross-origin to :8787 directly: the browser then
// only ever sees one origin (this dev server's), matching how the built
// app is served in production (backend/src/app.ts's serveStatic, same
// process, same origin, no proxy needed there).
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // docs/UI.md > Responsive layout, PWA, tabs, icons: "an app-shell
    // service worker that caches only shell and kit, never household
    // data; an offline page." `manifest: false` because index.html already
    // links the hand-authored public/manifest.webmanifest (real icon
    // sizes, MaiPai's own theme colors) - this plugin owns only the
    // service worker and its own registration script. The default
    // `globPatterns` precache build output only (JS/CSS/fonts/icons), so
    // no `/api` response is ever added without a runtimeCaching rule this
    // config deliberately never adds - household data never enters the
    // cache. `navigateFallback` serves the offline page for any
    // navigation that can't reach the network, `navigateFallbackDenylist`
    // keeps that from swallowing a genuine API 404/500.
    VitePWA({
      registerType: "autoUpdate",
      manifest: false,
      workbox: {
        navigateFallback: "/offline.html",
        navigateFallbackDenylist: [/^\/api\//],
        // The onnxruntime-web runtime (copy-ort.mjs's public/ort/ files,
        // ~40 MB, plus its own bundled JS loader emitted as a hashed
        // `assets/ort.bundle.min-*.js` chunk - a code review found the
        // original two patterns caught the WASM binaries but missed this
        // one, so the loader itself still got eagerly precached) is a
        // lazily-loaded model dependency for wake-word detection, not part
        // of the shell: eagerly precaching tens of megabytes on first load
        // would itself violate "caches only shell and kit," just in the
        // direction of doing too much rather than too little. The normal
        // HTTP cache still serves it once fetched.
        globIgnores: ["**/*.wasm", "ort/**", "**/ort.bundle.min-*.js"],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    proxy: {
      "/api": {
        // Overridable so a parallel session's worktree (docs/plans/
        // session-b-ui.md: "own data directory and ports") can point this
        // dev server at its own backend instance instead of the shared
        // default.
        target: `http://localhost:${process.env.VITE_BACKEND_PORT ?? "8787"}`,
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
