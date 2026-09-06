import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { lingui } from "@lingui/vite-plugin";
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
    // Session E step 8, i18n scaffolding: `.po` catalog compile-on-
    // import (no separate `lingui compile` step). Lingui's documented
    // Vite+React setup (lingui.dev/tutorials/setup-vite) also wires the
    // `<Trans>`/`t` MACRO transform through `@vitejs/plugin-react`'s own
    // `babel.plugins` option - that option no longer exists on the
    // version installed here (`@vitejs/plugin-react@6.1.1` moved its own
    // JSX transform to `oxc-transform-react` and dropped Babel
    // entirely, confirmed by reading its own `Options` type, which has
    // no `babel` property at all). Passing it anyway silently did
    // nothing: macros compiled to nothing, and every `<Trans>`/`t` call
    // fell through to the macro package's own runtime guard, which
    // throws ("executed outside the context of compilation") the moment
    // React actually renders one - found live, not from a lint error,
    // since nothing caught the silently-ignored option. Session E's own
    // strings use Lingui's plain runtime API instead (`<Trans id=
    // message=>` from `@lingui/react`, `i18n._()` from `@/i18n`), which
    // needs no Babel pass at all - `lingui extract` finds both forms
    // equally well (its own `js-lingui-explicit-id` marker in the
    // generated `.po` files). Re-enabling macros later needs either a
    // real Babel-based React plugin variant or `@lingui/swc-plugin`,
    // neither installed now.
    lingui(),
    // docs/UI.md > Responsive layout, PWA, tabs, icons: "an app-shell
    // service worker that caches only shell and kit, never household
    // data; an offline page." `manifest: false` because index.html already
    // links the hand-authored public/manifest.webmanifest (real icon
    // sizes, MaiPai's own theme colors) - this plugin owns only the
    // service worker and its own registration script. The default
    // `globPatterns` precache build output only (JS/CSS/fonts/icons), so
    // no `/api` response is ever added without a runtimeCaching rule this
    // config deliberately never adds - household data never enters the
    // cache.
    VitePWA({
      registerType: "autoUpdate",
      manifest: false,
      workbox: {
        // `navigateFallback` set to the real SPA shell, not offline.html:
        // that option serves its target for EVERY navigation not already
        // precached, unconditionally, regardless of whether the network
        // is reachable - it's workbox's generic "SPA shell" mechanism
        // (the standard fix for a client-side route the server never
        // heard of), not an offline-only one. Found live (2026-09-06,
        // Session E step 1's own wizard verification, pointed at
        // offline.html at the time): reloading on `/setup` served the
        // offline page even with the backend fully healthy, because
        // `/setup` simply isn't a precached URL - every deep route would
        // have hit this on reload, not just this one. `index.html` is
        // itself precached and served from Cache Storage, so this always
        // succeeds even genuinely offline: there is no SW-level "network
        // down" moment left to catch. A tried-and-abandoned custom
        // `runtimeCaching` NetworkOnly-with-offline-fallback rule sat
        // here briefly, matching on `request.mode === "navigate"` - dead
        // code found by inspecting the generated sw.js, not by belief:
        // `precacheAndRoute` registers its own implicit NavigationRoute
        // for `index.html` ahead of any explicit `registerRoute` call, so
        // that rule never actually ran. Detecting a genuinely unreachable
        // hub is therefore the app's own job once the shell has loaded
        // (a failed API call), not a service-worker one; offline.html
        // stays as a real, reachable, precached page for the one case
        // that IS a SW-level concern - opening the PWA before it has ever
        // successfully installed a service worker at all.
        navigateFallback: "index.html",
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
        // Workbox's own default ceiling (2 MiB) started refusing to
        // precache the main shell chunk once Wave 2's other sessions
        // merged in (Session E step 10's wrap-up merge, 2026-09-06): it
        // crossed 2 MiB from real app growth (entities/relationships/
        // grants, STT, the memory bench's own types, this step's own
        // Lingui addition), not from anything wrong with the build. The
        // shell chunk is exactly what this app-shell service worker
        // exists to cache in full (this file's own header comment); a
        // real code-splitting pass to shrink it is separate, tracked
        // work (docs/BACKLOG.md, "Real code-splitting for the frontend
        // shell chunk"), not something to paper over by silently
        // excluding the shell from precache.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    // Vite 6+ rejects requests whose Host header isn't localhost/an IP,
    // to stop DNS-rebinding attacks. Reaching this dev server by a
    // machine name (a Tailscale MagicDNS name, for instance) needs its
    // own opt-in, so it stays a runtime env var rather than a name
    // hardcoded into the repo.
    allowedHosts: process.env.VITE_ALLOWED_HOSTS?.split(",").map((h) => h.trim()) ?? undefined,
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
