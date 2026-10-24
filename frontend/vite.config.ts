import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { lingui } from "@lingui/vite-plugin";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
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
// `fileURLToPath` straight into `../../commons/ui/src`: a raw path reaches
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

// CHAT-SDK-01: the assistant-ui registry's own vendoring convention
// (ui/docs/dashboard-upstream.md's "elements" section) writes each
// Element's cross-file imports as `@/elements/*` (`thread.aui.tsx`
// importing `reasoning.tsx`, `reasoning.tsx` importing `@/elements/
// ui/collapsible`, and so on) - a SECOND `@/`-prefixed alias the
// vendored files use to mean their own tree, the same shape as
// `@/kit/*` above but for a different prefix and, so far, only ever
// asked for by the shared-ui side (Home has no `src/elements/` of its
// own to collide with - checked live, not assumed). Scoped to the
// shared-ui importer only, same as `kitAliasPlugin`: a bare `resolve.
// alias` entry for `@/elements/*` would just as happily "resolve" a
// future Home-authored `@/elements/*` import to the kit's tree instead
// of failing loudly, the same silent-collision risk `@/kit/*` already
// routes around. `@/components/*` (a sibling convention the registry's
// other flavors use, unused in this kit's own vendored tree today -
// tsconfig.json's own `paths` comment has why) deliberately has no
// entry here either: a review caught an earlier version handling it
// speculatively, which excluded it from the plain alias below without
// giving it anywhere real to resolve, so a future Home-authored `@/
// components/*` import would have hit neither this plugin nor that
// alias and failed opaquely instead of resolving to Home's own `src/
// components/*` the way it does today. Add both the prefix here and
// its own `paths` entry together, the day something actually vendors
// a file that needs it.
function kitElementsAliasPlugin(): Plugin {
  return {
    name: "maipai-home-kit-elements-alias",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!source.startsWith("@/elements/") || !importer) return null;
      const fromSharedUi = importer.includes("/@maipai/ui/") || importer.includes("/@maipai+ui@");
      if (!fromSharedUi) return null;
      const rest = source.slice("@/".length);
      return this.resolve(`@maipai/ui/src/${rest}`, importer, { ...options, skipSelf: true });
    },
  };
}

// Some kit Elements use the commons package's own `@/primitives/*` and
// `@/ui/*` aliases for shared primitives. Resolve those only for imports
// from the shared UI package, leaving Home's `@/` namespace local.
function kitSharedSourceAliasPlugin(): Plugin {
  return {
    name: "maipai-home-kit-shared-source-alias",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!source.startsWith("@/primitives/") && !source.startsWith("@/ui/")) return null;
      if (!importer) return null;
      const fromSharedUi = importer.includes("/@maipai/ui/") || importer.includes("/@maipai+ui@");
      if (!fromSharedUi) return null;
      const rest = source.slice("@/".length);
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
  optimizeDeps: {
    // @maipai/ui is a file: dependency (a linked package), which Vite leaves out of
    // pre-bundling, so its CommonJS dependencies (use-sync-external-store and friends)
    // reach the browser raw and fail as ESM. Pre-bundling the kit fixes the dev server;
    // vite build never had the problem (Rollup converts CommonJS).
    // This is every bare import of the kit's browser source. Regenerate from frontend/ with:
    // bun -e 'const fs=require("fs"),path=require("path"),p=JSON.parse(fs.readFileSync("package.json","utf8")),root=path.resolve(p.dependencies["@maipai/ui"].replace(/^file:/,""),"src"),files=[];function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name);if(e.isDirectory()){if(!["__tests__","test"].includes(e.name))walk(f)}else if(/\.tsx?$/.test(e.name)&&!(/\.test\.|\.spec\./.test(e.name)))files.push(f)}}walk(root);const s=new Set;for(const f of files)for(const m of fs.readFileSync(f,"utf8").matchAll(/(?:from\s*|import\s*\()\s*["\x27]([^"\x27]+)["\x27]/g)){const x=m[1];if(x.startsWith(".")||x.startsWith("/")||x.startsWith("@/")||x.startsWith("@maipai/")||x.startsWith("node:")||x.startsWith("bun:")||["react","react-dom","react/jsx-runtime","react-dom/client","axe-core","vitest","bun:test"].includes(x)||x.startsWith("@testing-library/")||(x==="cn"&&!fs.existsSync(path.resolve("node_modules/cn"))))continue;s.add(x)}console.log([...s].sort().join("\n"))'
    include: [
      "@maipai/ui > @assistant-ui/react",
      "@maipai/ui > @assistant-ui/react-markdown",
      "@maipai/ui > @assistant-ui/react-streamdown",
      "@maipai/ui > @base-ui/react",
      "@maipai/ui > @base-ui/react/accordion",
      "@maipai/ui > @base-ui/react/alert-dialog",
      "@maipai/ui > @base-ui/react/avatar",
      "@maipai/ui > @base-ui/react/button",
      "@maipai/ui > @base-ui/react/checkbox",
      "@maipai/ui > @base-ui/react/collapsible",
      "@maipai/ui > @base-ui/react/context-menu",
      "@maipai/ui > @base-ui/react/dialog",
      "@maipai/ui > @base-ui/react/direction-provider",
      "@maipai/ui > @base-ui/react/input",
      "@maipai/ui > @base-ui/react/menu",
      "@maipai/ui > @base-ui/react/menubar",
      "@maipai/ui > @base-ui/react/merge-props",
      "@maipai/ui > @base-ui/react/navigation-menu",
      "@maipai/ui > @base-ui/react/popover",
      "@maipai/ui > @base-ui/react/preview-card",
      "@maipai/ui > @base-ui/react/progress",
      "@maipai/ui > @base-ui/react/radio",
      "@maipai/ui > @base-ui/react/radio-group",
      "@maipai/ui > @base-ui/react/scroll-area",
      "@maipai/ui > @base-ui/react/select",
      "@maipai/ui > @base-ui/react/separator",
      "@maipai/ui > @base-ui/react/slider",
      "@maipai/ui > @base-ui/react/switch",
      "@maipai/ui > @base-ui/react/tabs",
      "@maipai/ui > @base-ui/react/toggle",
      "@maipai/ui > @base-ui/react/toggle-group",
      "@maipai/ui > @base-ui/react/tooltip",
      "@maipai/ui > @base-ui/react/use-render",
      "@maipai/ui > @dicebear/adventurer",
      "@maipai/ui > @dicebear/core",
      "@maipai/ui > @noriginmedia/norigin-spatial-navigation",
      "@maipai/ui > @tanstack/react-query",
      "@maipai/ui > @tanstack/react-table",
      "@maipai/ui > beautiful-mermaid",
      "@maipai/ui > class-variance-authority",
      "@maipai/ui > clsx",
      "@maipai/ui > cmdk",
      "@maipai/ui > embla-carousel-autoplay",
      "@maipai/ui > embla-carousel-react",
      "@maipai/ui > epubjs",
      "@maipai/ui > heat-graph",
      "@maipai/ui > input-otp",
      "@maipai/ui > lodash",
      "@maipai/ui > lucide-react",
      "@maipai/ui > media-chrome/react",
      "@maipai/ui > motion/react",
      "@maipai/ui > next-themes",
      "@maipai/ui > pdfjs-dist",
      "@maipai/ui > pdfjs-dist/build/pdf.worker.min.mjs?url",
      "@maipai/ui > qrcode.react",
      "@maipai/ui > radix-ui",
      "@maipai/ui > react-day-picker",
      "@maipai/ui > react-dom/server",
      "@maipai/ui > react-joyride",
      "@maipai/ui > react-resizable-panels",
      "@maipai/ui > react-router",
      "@maipai/ui > react-router-dom",
      "@maipai/ui > react-shiki",
      "@maipai/ui > recharts",
      "@maipai/ui > rehype-harden",
      "@maipai/ui > rehype-katex",
      "@maipai/ui > rehype-raw",
      "@maipai/ui > rehype-sanitize",
      "@maipai/ui > remark-gfm",
      "@maipai/ui > remark-math",
      "@maipai/ui > simplebar-react",
      "@maipai/ui > sonner",
      "@maipai/ui > streamdown",
      "@maipai/ui > tailwind-merge",
      "@maipai/ui > unified",
      "@maipai/ui > use-sync-external-store/shim",
      "@maipai/ui > use-sync-external-store/shim/with-selector",
      "@maipai/ui > usehooks-ts",
      "@maipai/ui > uuid",
      "@maipai/ui > vaul",
      "@maipai/ui > zod",
      "@maipai/ui > zustand/react/shallow",
      "@maipai/ui > zustand",
    ],
  },
  publicDir: "public",
  define: {
    __SETUP_PREVIEW__: JSON.stringify(process.env.VITE_SETUP_PREVIEW === "1"),
  },
  plugins: [
    kitAliasPlugin(),
    kitElementsAliasPlugin(),
    kitSharedSourceAliasPlugin(),
    ...(process.env.VITE_SETUP_PREVIEW === "1" ? [{
      name: "setup-preview-worker",
      configureServer(server: import("vite").ViteDevServer) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.split("?")[0] !== "/mockServiceWorker.js") return next();
          res.setHeader("content-type", "text/javascript; charset=utf-8");
          res.setHeader("Service-Worker-Allowed", "/");
          const workerPath = new URL("./.setup-preview/mockServiceWorker.js", import.meta.url);
          res.end(readFileSync(workerPath));
        });
      },
    }] : []),
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
        // ui-v0.5.69 brought the shared kit's DiceBear-backed Avatar
        // into the shell, requiring a 3 MiB ceiling. The chat quote
        // Elements bring Routes just over 3 MiB, so raise the ceiling
        // to 4 MiB until route-level code splitting removes the route
        // bundle from the precache. BUNDLE-SPLIT-01 (2026-10-17): the Routes
        // chunk had grown to 3.84 MB, within 8% of this ceiling, so most
        // pages now load on first visit (Routes.tsx) and `to-words` loads one
        // locale (alias below): Routes is 2.35 MB. The ceiling stays as is;
        // bundle.test.ts fails a build whose largest chunk passes 3 MiB.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
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
        // CHAT-RICH-01 (2026-09-24) crossed the default a third time:
        // katex/remark-math/rehype-katex (plus rehype-katex's own HTML-
        // parsing chain for its error fallback) landed inside Chat's own
        // eager chunk, pushing it to 3.06 MB - worked around then by
        // raising this ceiling to 4 MiB. CHAT-RICH-02 (same day) is the
        // real fix this file's own history above already named the shape
        // of: shiki, mermaid and math now load lazily (React.lazy behind
        // Suspense for the first two, a dynamic import gated on a raw-
        // text math scan for the third - commons/docs/dev.md's own
        // CHAT-RICH-02 entry), so none of the three sit in this chunk at
        // all any more. Entry chunk back to 1,047 KB (from 3.06 MB, and
        // within rounding of the pre-CHAT-RICH-01 1,041 KB baseline) -
        // under the default again, so the override is removed once
        // more, same as both times before.
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
    // CHAT-SDK-01: `elements/` joins `kit/`'s own exclusion here for the
    // identical reason its own comment already gives - Vite's plain
    // alias resolution matches `@/elements/*` too and doesn't yield to
    // `kitElementsAliasPlugin`'s `enforce: "pre"` resolveId hook under
    // Rolldown (found live: a real production build failed resolving
    // `@/elements/ui/collapsible` - "No such file or directory" against
    // Home's own `src/elements/ui/collapsible`, which doesn't exist -
    // the plugin never got a turn). `components/` stays OUT of this
    // exclusion (a review caught an earlier version adding it
    // speculatively): excluding a prefix here only makes sense once
    // something ahead of this alias - `kitElementsAliasPlugin` above -
    // actually claims it; until then, excluding it just strands a
    // future Home-authored `@/components/*` import with no path to
    // resolve at all, worse than today's real behavior (Home's own
    // `src/components/*`).
    alias: [
      // BUNDLE-SPLIT-01: `@maipai/spec`'s normalizeForSpeech imports `{ ToWords }` from the package root, which bundles
      // all 135 locales (621 KB of the shell chunk) for a function that only ever speaks en-US. The en-US entry point is
      // the same class and API with one locale. Home-side until commons imports `to-words/en-US` itself.
      { find: /^to-words$/, replacement: "to-words/en-US" },
      { find: /^@\/(?!kit\/|elements\/|primitives\/|ui\/)/, replacement: `${fileURLToPath(new URL("./src", import.meta.url))}/` },
    ],
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
        target: process.env.VITE_SETUP_PREVIEW === "1" ? "http://127.0.0.1:1" : `http://localhost:${process.env.VITE_BACKEND_PORT ?? "8787"}`,
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
