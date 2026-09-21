/// <reference lib="webworker" />
// The app-shell service worker (docs/UI.md > Responsive layout, PWA, tabs,
// icons: "an app-shell service worker that caches only shell and kit,
// never household data; an offline page"). `injectManifest`, not
// `generateSW` (vite.config.ts's own plugin call): `generateSW`'s
// `navigateFallback` option installs an implicit "serve this for every
// navigation" route ahead of anything a config adds, which a prior attempt
// at this exact rule found by inspecting the generated output - a custom
// `runtimeCaching` navigate rule never ran, because that implicit route
// always won first. Writing the fetch handler directly, the way this file
// does, is the only way to make navigation genuinely network-first.
//
// Three rules, learned from the legacy hub's own `sw.js` v5 (getmaipai/
// home lane 4 item 2, 2026-09-13):
// - Navigations are network-first: try the network, and only on failure
//   serve the precached offline page. The precached `index.html` a
//   `navigateFallback`-style route would serve instead can reference
//   hashed chunks that are no longer all cached, which renders a blank
//   page offline - a real regression the legacy hub hit and fixed by
//   moving off cache-first for the shell (its own CACHE_VERSION v2 note).
// - Firefox is passed through entirely (no fetch interception at all):
//   its Local Network Access gate auto-allows a page's own requests to a
//   LAN host but blocks the identical request when a service worker makes
//   it, so every SW-routed fetch died with a NetworkError and a healthy
//   hub looked unreachable (legacy's own v5 note, same root cause here -
//   this hub is reached by a LAN hostname too). getmaipai/home#90: this
//   used to gate only the navigate listener below - `precacheAndRoute()`
//   registers its OWN 'fetch' listener unconditionally (confirmed against
//   the installed workbox-precaching source: its `addRoute()` always adds
//   a handler), so Firefox was still getting precache interception for
//   every JS/CSS/font/icon request even though this comment claimed
//   otherwise. Skipped entirely on Firefox now, below.
// - Everywhere else, the built JS/CSS/font/icon assets are precached and
//   served cache-first by `precacheAndRoute` below, unchanged from
//   workbox's own default - correct because Vite's filenames are content-
//   hashed (a cache hit is always the right bytes).
//
// getmaipai/home#90: every call that can register a 'fetch' listener -
// the navigate handler right below and `precacheAndRoute()` after it -
// lives inside the ONE `if (!PASSTHROUGH)` block below, not two separate
// gated call sites, so a future third registration (a background-sync
// listener, a runtime-caching route) either joins this block or is
// visibly, deliberately outside it - the exact "gated the first site,
// missed the second" shape that caused this bug can't quietly repeat.
// `cleanupOutdatedCaches()` stays OUTSIDE this block, unconditional: it
// only ever registers an 'activate' listener that deletes STALE
// `-precache-` caches, which matters most for a Firefox install that
// hit this exact bug before the fix shipped and is still carrying a
// real precache entry from when Firefox wrongly had one - gating it too
// would leave that leftover cache stuck forever with nothing left to
// delete it.
//
// Within the block: registered first, deliberately, before
// `precacheAndRoute` adds its own 'fetch' listener - a service worker
// with multiple 'fetch' listeners runs them in registration order, and
// only the first call to `respondWith()` on a given event wins. This
// listener claims navigations and returns without calling
// `respondWith()` for everything else, so workbox's own precache
// routing still handles every other request exactly as it would if
// this were its only listener. Zero 'fetch' listeners register at all
// when Firefox (matching "no fetch interception at all" two paragraphs
// up literally, not just in the callback's own behavior) - see
// `src/sw.test.ts`, which asserts that directly against the built
// worker module.
import { precacheAndRoute, cleanupOutdatedCaches, matchPrecache } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope;

const OFFLINE_URL = "/offline.html";
const PASSTHROUGH = /\bFirefox\//.test(self.navigator?.userAgent ?? "");

if (!PASSTHROUGH) {
  self.addEventListener("fetch", (event: FetchEvent) => {
    const req = event.request;
    if (req.method !== "GET" || req.mode !== "navigate") return;
    // `matchPrecache`, not a bare `caches.match(OFFLINE_URL)`: a precached
    // entry's real cache key carries a `?__WB_REVISION__=...` query param
    // workbox adds itself, so a plain string match against the clean URL
    // never finds it - found live (2026-09-13), killing the backend mid-
    // session and reloading: the fallback silently resolved to `undefined`
    // and `Response.error()` took its place, so a genuinely offline
    // navigation failed outright instead of showing the offline page.
    // `matchPrecache` resolves the real key the same way the precache
    // route itself does, so it can never drift from how entries are
    // actually stored.
    event.respondWith(fetch(req).catch(() => matchPrecache(OFFLINE_URL).then((res) => res ?? Response.error())));
  });

  // `self.__WB_MANIFEST` is injected at build time (vite-plugin-pwa's
  // `injectManifest` strategy) with every build output file this
  // config's own `globIgnores`/`maximumFileSizeToCacheInBytes` allow
  // through - deliberately excluding the onnxruntime-web WASM runtime
  // (a lazily loaded model dependency for wake-word detection, not part
  // of the shell): eagerly precaching tens of megabytes on first load
  // would itself violate "caches only shell and kit," just in the
  // direction of doing too much. The normal HTTP cache still serves it
  // once fetched.
  precacheAndRoute(self.__WB_MANIFEST);
}
cleanupOutdatedCaches();

// A new worker never waits (getmaipai/home#128, PWA-SW-01): install
// is followed by `skipWaiting()` unconditionally, so the build that
// was just fetched is the one that activates on the next load even
// when no client posts SKIP_WAITING (an older shell, a tab that
// never sends it). `pwaBoot.ts`'s reload-once guard then brings the
// tab onto it. The `message` handshake below stays for the client
// that does post.
self.addEventListener("install", () => {
  self.skipWaiting();
});

// The standard `registerType: "autoUpdate"` handshake (vite.config.ts):
// the client's registration script posts this the moment a new worker
// is found waiting, so it activates immediately instead of waiting for
// every open tab to close - `pwaBoot.ts`'s own `controllerchange`
// listener then reloads each tab once so it runs the code that matches
// what just got cached.
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
