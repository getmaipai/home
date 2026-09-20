import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { lingui } from "@lingui/vite-plugin";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import type { Plugin } from "vite";

// `@maipai/ui`'s own source files (subpath-imported directly, no dist
// build) use `@/kit/*` as an alias meaning THEIR OWN `shared/ui/src/*`
// (its own tsconfig.json), while Home's app code uses the SAME-LOOKING
// `@/kit/*` meaning Home's own residual `src/kit/*` (assistant-ui, the
// couple of pieces that stay Home-specific). `frontend/tsconfig.json`'s
// own `@/kit/*` paths carries the identical fallback for `tsc` (its own
// comment there has the fuller story, including a duplicate
// `@types/react` gotcha this same distinction had to route around); this
// plugin is Vite/Rolldown's side of the same fix, picking based on who's
// asking rather than a fixed target a plain `resolve.alias` entry could
// express.
//
// The shared-ui branch resolves through the bare `@maipai/ui/src/*`
// package specifier (`this.resolve`, going through normal node_modules
// resolution) rather than a raw filesystem path built from
// `fileURLToPath` straight into `../../shared/ui/src`: a raw path reaches
// the same file by a DIFFERENT id string than App.tsx's own direct
// `@maipai/ui/src/...` imports use, and Rolldown treats two different id
// strings for the same physical file as two different modules - each
// getting its own module-scope `createContext()` call, so `Shell`'s
// `SidebarProvider` and `AppSidebar`'s `useSidebar()` silently stopped
// sharing one context the moment either got split into a different
// chunk (found live: a lazy route crashing with "useSidebar must be
// used within a SidebarProvider" despite very much being inside one).
// Home's own residual kit has no such second resolution path to
// collide with, so it stays a direct filesystem lookup.
const homeKitDir = fileURLToPath(new URL("./src/kit", import.meta.url));
function resolveHomeKitFile(rest: string): string | null {
  for (const ext of [".tsx", ".ts"]) {
    const candidate = `${homeKitDir}/${rest}${ext}`;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
function kitAliasPlugin(): Plugin {
  return {
    name: "maipai-home-kit-alias",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!source.startsWith("@/kit/") || !importer) return null;
      const rest = source.slice("@/kit/".length);
      const fromSharedUi = importer.includes("/@maipai/ui/") || importer.includes("/@maipai+ui@");
      if (!fromSharedUi) return resolveHomeKitFile(rest);
      return this.resolve(`@maipai/ui/src/${rest}`, importer, { ...options, skipSelf: true });
    },
  };
}

// The backend has no CORS and a Strict-SameSite session cookie (see
// backend/src/middleware/auth.ts), so the dev server proxies /api instead
// of the browser talking cross-origin to :8787 directly: the browser then
// only ever sees one origin (this dev server's), matching how the built
// app is served in production (backend/src/app.ts's serveStatic, same
// process, same origin, no proxy needed there).
export default defineConfig({
  plugins: [
    kitAliasPlugin(),
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
    // service worker and its own registration script.
    //
    // `injectManifest`, not the default `generateSW`: `generateSW`'s own
    // `navigateFallback` option installs an implicit "serve this for
    // every navigation" route ahead of anything a config adds, which a
    // prior attempt at true network-first navigation (below) found by
    // inspecting the generated sw.js - a custom `runtimeCaching` navigate
    // rule never ran, because that implicit route always won first.
    // `injectManifest` hands the fetch handler to `src/sw.ts` directly
    // (this plugin's own job shrinks to injecting the precache manifest
    // and generating the client registration script), which is the only
    // way to express real network-first navigation with workbox's own
    // precaching still doing the rest (lane 4 item 2, 2026-09-13; see
    // `src/sw.ts`'s own header for the three rules it implements).
    VitePWA({
      registerType: "autoUpdate",
      manifest: false,
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectManifest: {
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
        // Lingui addition), not from anything wrong with the build.
        // Worked around then by raising this ceiling to 5 MiB; the real
        // fix (lane 10 item 2, docs/BACKLOG.md's "Real code-splitting
        // for the frontend shell chunk") is route-level `import()` for
        // every app but Home and Chat (App.tsx's `lazyNamed`), which
        // dropped the entry chunk to ~1.85 MiB - back under the
        // default, so the override was removed once nothing needed it.
        // Home adopting `@maipai/ui` crossed 2 MiB again at first
        // (2.17 MiB) - not from the kit's real surface after all, but
        // from `kitAliasPlugin`'s original resolution route duplicating
        // react/react-router-dom/@maipai/ui's own module instances across
        // chunk boundaries (its own comment above has the story); fixing
        // that resolution brought the entry chunk to ~1.83 MiB, under the
        // default again, so no override is needed this time either.
      },
    }),
  ],
  resolve: {
    // `@/kit/*` itself is handled by `kitAliasPlugin()` above (it needs
    // to pick a target per-importer, which a plain alias entry can't
    // express) - excluded here (the negative lookahead) rather than left
    // to "whichever runs first": Vite's own alias resolution matches
    // `@/kit/*` too (a `"@"` -> path entry matches anything starting
    // `@/`) and doesn't yield to a later plugin's `enforce: "pre"` under
    // Rolldown, so both handling `@/kit/*` unconditionally raced and
    // Vite's own alias won every time (found live building this fix).
    alias: [{ find: /^@\/(?!kit\/)/, replacement: `${fileURLToPath(new URL("./src", import.meta.url))}/` }],
    // `@maipai/ui`'s files resolve outside `frontend/`'s own tree (via
    // `kitAliasPlugin` above, and via the plain `node_modules/@maipai/ui`
    // symlink for its non-`@/kit` imports too) - a real react-in-a-lazy-
    // chunk crash ("Cannot read properties of null (reading
    // 'useContext')", PeoplePage's own async chunk bundling a second,
    // separate copy of react's runtime alongside the entry chunk's)
    // showed Rolldown's automatic chunk-splitting didn't always
    // recognize those two resolution paths as the SAME physical react
    // module once one of them crossed an async import() boundary.
    // `dedupe` is the documented fix for exactly this class of bug:
    // force one canonical instance regardless of which path resolved it.
    // `react-router-dom` needed the same fix right behind it: the
    // identical symptom one layer up (`useLocation()` throwing "may be
    // used only in the context of a <Router>" from inside `@maipai/ui`'s
    // own `AppSidebar`, which very much was inside one) - a second
    // package @maipai/ui also imports directly rather than as a peer.
    dedupe: ["react", "react-dom", "react-router-dom"],
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
