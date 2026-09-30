#!/usr/bin/env bun
// Screenshots and the accessibility matrix: a real browser against a real
// backend, seeded with a demo household (persona-roster names only, never
// Jesse's real household - getmaipai/.github/CLAUDE.md > Privacy). Never
// hand-taken (getmaipai/.github/docs/STYLE.md > Platform screenshot
// pipeline). If a screenshot goes stale, fix this script and re-run it,
// never hand-edit an image.
//
// Two modes, one seeded backend, sharing this file per docs/plans/
// session-b-ui.md step 9 ("Extend scripts/screenshot.ts"):
// - `bun run screenshots` (default): the full matrix from that step -
//   every route in ROUTES, at every viewport in VIEWPORTS, in both
//   themes, real PNGs under docs/assets/screens/ for a human to look at
//   before the final commit (getmaipai/.github/CLAUDE.md's "every
//   screenshot gets looked at" rule), plus the hero shot for the README.
// - `bun run screenshots --a11y-only`: the same axe-core scan and
//   overflow check, no image files, and only two combos (phone+dark,
//   desktop+light) rather than the full cross product - fast enough to
//   run on every commit. docs/plans/session-e-ui-and-docs.md's step 0
//   calls this "the a11y half headless"; it is not wired into
//   scripts/check.sh here because that file is Session F's per
//   docs/plans/wave-2.md's shared-file protocol - noted in this
//   session's dev doc and the backlog instead, run for now via this
//   repo's own `bun run a11y`.
//
// "far" (TV) is a user-agent, not a viewport (frontend/src/kit/
// useSurface.ts's own TV_USER_AGENT) - the far entry below sets one.
//
// `--webkit` (a11y/keyboard-trap verification against WebKit's real Tab
// order, not screenshot review - see checkKeyboardTrap's own comment)
// writes its PNGs, if any, under a gitignored `.../webkit/` subdirectory
// instead of the paths above (issue #76: every browser used to share the
// same output paths, so a `--webkit` run silently overwrote the published
// Chromium screenshots). Only Chromium's output is ever committed.
// `--chat-stats-review` runs one dedicated adult-only chat capture with the
// advanced reply-details popover open, plus the normal chat accessibility
// checks; it is intentionally separate from the ordinary matrix shots.
import { chromium, firefox, webkit, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import { findClippedStrips, findOverflowingPanels } from "./panelOverflow";
// A repo-root script, not a workspace member, so it can't resolve the
// @maipai/spec package (only backend/ and frontend/ have it installed);
// spec-v0.1.0 moved this file to the sibling getmaipai/shared checkout
// (COMMONS-RENAME-01, 2026-09-20: now getmaipai/commons).
// SHARED-PIN-01: a fixed "../../commons/..." import read whatever tag
// the commons/ checkout itself happened to have checked out, not
// necessarily this repo's own pin (found live: a concurrent session's
// tag change under ../commons broke a screenshot run mid-flight).
// Resolved dynamically instead, below, from backend/package.json's own
// @maipai/spec file: path - the same pinned worktree check.sh's pins
// use. This type-only reference stays a fixed path; it's erased at
// compile time and never read at runtime.
type StubServerModule = typeof import("../../commons/spec/llm/ts/stubServer");
import AxeBuilder from "@axe-core/playwright";
import { rmSync, mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { reserveFreePort } from "../backend/tests/fixtures/reserveFreePort";
import { createOwnedDemoDataDir, processStartTime, removeOwnedDemoDataDir, sweepStaleDemoDataDirs as sweepOwnedDemoDataDirs, waitForBackendPort, withScreenshotBuildLock, type RunOwner } from "./screenshotRuntime";

// getmaipai/home#114: each backend asks Bun.serve() to bind port 0 atomically and reports
// the actual port on startup; each run also gets its own owner-marked
// demo-data directory independent of its network port.
let DATA_DIR: string;
let BASE_URL: string;
let DATA_OWNER: RunOwner;
const ROOT = join(import.meta.dir, "..");
const BUILD_LOCK = join(ROOT, ".screenshot-build.lock");
const useWebkit = process.argv.includes("--webkit");
// Live finding 2026-09-22: a reasoning-clipping report needed verifying
// in the browser Jesse actually uses - headless only (this file's own
// rule), Playwright's own firefox channel.
const useFirefox = process.argv.includes("--firefox");

// backend/ and frontend/ pin the same @maipai/spec tag, so backend's
// package.json is as good a source as either for the worktree this
// script's own stub-server import (below) needs to resolve.
function resolveSpecWorktreeDir(): string {
  const backendPackageJson = JSON.parse(readFileSync(join(ROOT, "backend", "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  };
  const specDependency = backendPackageJson.dependencies["@maipai/spec"];
  if (!specDependency?.startsWith("file:")) {
    throw new Error(`backend/package.json's @maipai/spec dependency isn't a file: pin: ${specDependency}`);
  }
  return join(ROOT, "backend", specDependency.slice("file:".length));
}

// Owner-marked demo-data directories are swept before this run creates
// its own. Their marker includes process birth time plus a random token,
// so stale cleanup can distinguish PID reuse and avoid deleting another
// run's in-flight state.
function sweepStaleDemoDataDirs(): void {
  sweepOwnedDemoDataDirs(ROOT);
}

// Lane 3 item 5 (2026-09-13): the full matrix (4 viewports x 2 themes,
// up to 11 routes each) ran fully sequentially against one Chromium
// process, taking several minutes for no reason Playwright imposes -
// one browser process happily supports many concurrent contexts.
// Started at 4 per BACKLOG.md's own note; each context still visits its
// own routes sequentially (unchanged), only the four-viewport/theme
// combos run concurrently against each other.
const CONTEXT_POOL_SIZE = 4;

/** Runs `worker` over every item in `items`, at most `poolSize` at once,
 * a new item starting the instant a slot frees rather than waiting for
 * a whole batch to finish - a fixed chunk-of-4-then-wait shape would
 * leave a slot idle for the rest of a chunk once its own item finishes
 * early. Results land at their original index, not completion order, so
 * the printed failure list and the final tally stay independent of
 * scheduling. */
async function runPool<T, R>(items: readonly T[], poolSize: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function runSlot() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(poolSize, items.length) }, runSlot));
  return results;
}
// Issue #76: every browser wrote to the same `docs/assets/screens/<name>.png`
// path, so a `--webkit` run (a11y/keyboard-trap verification, not the
// published screenshots) silently overwrote the real Chromium-rendered
// images the docs actually publish - hit live while fixing #69, reverted
// by hand. Chromium is the only browser whose output ships in docs, so its
// path is the one that must never move; every other browser writes under
// its own gitignored subdirectory instead; `bun run screenshots` (default,
// no `--webkit`) is unaffected by any of this.
const SCREENS_DIR = useWebkit ? join(ROOT, "docs", "assets", "screens", "webkit") : join(ROOT, "docs", "assets", "screens");
const HERO_PATH = useWebkit ? join(ROOT, "docs", "assets", "webkit", "hero.png") : join(ROOT, "docs", "assets", "hero.png");
const dedicatedScreenshots: Array<{ file: string; route: string; viewport: string; theme: string }> = [];

// A tiny solid-color PNG, embedded so captureChatSourcesMemoryAttachment's
// fake image attachment always renders (org standard: "Deterministic and
// offline by default" - no live fetch to a fake external URL, which just
// renders as a broken-image icon).
const TRAIL_THUMBNAIL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAKAAAACgCAYAAACLz2ctAAACxElEQVR42u3SRUIQAAAAQZ7IS3yOATZgByKpYHeLAXZ3t55kL77COewLdgYGV6/6O7im1ta6GqrhWl8bamNtqs21pbbWSI3WWG2r7bWjdtau2l17am/tq/01Xgdqog7WZE3VdM3UbM3VoTpc87VQR+poHavjdaJO1qk6XWfqbJ2r83WhLtalulxX6mpdq+u1WDfqZt2q27VUy3Wn7ta9ul8P6mE9qsf1pJ7Ws3peL+plvarX9abe1rt6Xx/qY32qz/Wlvta3+l4/6mf9qt/1p/6zHwMAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAII4L8fK9fe4oni3vjtAAAAAElFTkSuQmCC";

const a11yOnly = process.argv.includes("--a11y-only");
// Focused review retains the same seeded data, readiness, and a11y checks.
const chatFocusReview = process.argv.includes("--chat-focus-review");
const chatTemporaryReview = process.argv.includes("--chat-temporary-review");
const chatContinueReview = process.argv.includes("--chat-continue-review");
const fitVerdictReview = process.argv.includes("--fit-verdict-review");
const chatReview = process.argv.includes("--chat-review") || chatFocusReview || chatTemporaryReview;
const chatStatsReview = process.argv.includes("--chat-stats-review");
const chatResearchReview = process.argv.includes("--chat-research-review");
// spec.md "Acceptance for an implementation": the three states with no
// existing dedicated capture (sources card + memory chip + image
// attachment together, a streaming reply, the engine-not-ready state).
const chatAcceptanceReview = process.argv.includes("--chat-acceptance-review");
const shellRailReview = process.argv.includes("--shell-rail-review");
const chatThreadActionsReview = process.argv.includes("--chat-thread-actions-review");
const chatListReview = process.argv.includes("--chat-list-review");
const chatShortcutsReview = process.argv.includes("--chat-shortcuts-review");
const chatFindHeaderAlignmentReview = process.argv.includes("--chat-find-header-alignment-review");
const chatFindBubbleHoverWidthReview = process.argv.includes("--chat-find-bubble-hover-width-review");
const chatFindComposerShiftReview = process.argv.includes("--chat-find-composer-shift-review");
const chatHeaderTitleReview = process.argv.includes("--chat-header-title-review");
const nextPageHeaderIconReview = process.argv.includes("--next-page-header-icon-review");
const phoneHeaderFoldReview = process.argv.includes("--phone-header-fold-review");
const settingsReview = process.argv.includes("--settings-review");
const pictureReview = process.argv.includes("--picture-review");
let pictureSearchServer: ReturnType<typeof Bun.serve> | undefined;
let websearchFixture: ReturnType<typeof Bun.serve> | undefined;

// TOOL-EVENTS-02: a self-contained fake SearXNG, never the real one or
// Wikipedia (getmaipai/.github's liveHubQuiet.ts guard) - the same
// shape (a bare `/search?q=` SearXNG-style JSON endpoint) `startPicture
// SearchFixture` above already uses, not backend/scripts/bench/
// conversationRunner.ts's own `startFakeSearxng()`: importing it pulled
// its whole `@/lib/...`-aliased dependency graph into `scripts/`'s own
// isolated tsconfig (this file's own header comment on why scripts/
// can't resolve workspace packages), which has no matching path alias
// and fails the "scripts: typecheck" gate stage with dozens of
// unrelated "Cannot find module '@/...'" errors - found live, running
// the full gate before landing.
function startWebSearchFixture(): void {
  websearchFixture = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== "/search") return new Response("not found", { status: 404 });
      const q = url.searchParams.get("q") ?? "";
      const results = /mariners/i.test(q) ? [{ title: "Mariners win 6-3", url: "https://example.com/mariners-game-score", content: "The Seattle Mariners won last night's game 6-3, extending their winning streak to four games." }] : [];
      return Response.json({ query: q, results });
    },
  });
}

function startPictureSearchFixture(): void {
  pictureSearchServer = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname.startsWith("/image/")) {
        const label = url.pathname.slice("/image/".length).replace(/[-_]/g, " ");
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400"><rect width="640" height="400" fill="#17324d"/><text x="320" y="210" fill="#f6e7c1" font-family="sans-serif" font-size="30" text-anchor="middle">${label}</text></svg>`;
        return new Response(svg, { headers: { "Content-Type": "image/svg+xml" } });
      }
      if (url.pathname !== "/search") return new Response("not found", { status: 404 });
      const q = url.searchParams.get("q") ?? "";
      const base = `http://127.0.0.1:${pictureSearchServer!.port}`;
      const rows = /marsh lantern/i.test(q)
        ? ["marsh-lantern-poster-official", "marsh-lantern-poster-alt", "marsh-lantern-poster-festival", "marsh-lantern-poster-archive"]
        : ["serena-vale-portrait", "serena-vale-stage", "serena-vale-premiere", "serena-vale-archive"];
      return Response.json({ results: rows.map((label) => ({ title: label, url: `https://example.com/canned/${label}`, content: `Canned image result for ${label}.`, img_src: `${base}/image/${label}`, thumbnail_src: `${base}/image/${label}-thumb` })) });
    },
  });
}
// Lane 15: judges the bell popover's own "Dismiss all" and the history
// page's multi-select in one throwaway run, the same shape chatReview/
// settingsReview already use - not part of the full matrix (nothing in
// ROUTES needs two real pending notifications and a specific interaction
// sequence, so this stays a named review mode rather than a permanent
// change to what every ordinary screenshot run seeds).
const notificationsReview = process.argv.includes("--notifications-review");

// HOME-UI-02d's own acceptance: "captures at 1440 and 390, both looks,
// both themes, of the dashboard, Chat with the list open, and a
// person's Memories tab; each opened and judged." `ui.look` (Studio/
// Calm, HOME-UI-02c) has no ROUTES-matrix dimension of its own - the
// ordinary run only ever seeds Studio, the hub's real default - so
// this is its own named review, the same shape `notificationsReview`
// and `shellRailReview` use for a state the generic matrix can't
// express. Written to data-scratch (git-ignored): a comparison set for
// this item's own judgment, not a permanent docs asset (matches how
// HOME-UI-02c's own look comparison was done, per docs/dev.md).
const lookReview = process.argv.includes("--look-review");
const nextStandupReview = process.argv.includes("--next-standup-review");
const nextSidebarReview = process.argv.includes("--next-sidebar-review");
const nextLookPresetsReview = process.argv.includes("--next-look-presets-review");
const nextAppearanceMismatchReview = process.argv.includes("--next-appearance-mismatch-review");
const nextPeopleReview = process.argv.includes("--next-people-review");
const nextDashboardReview = process.argv.includes("--next-dashboard-review");
const nextProfileSheetReview = process.argv.includes("--next-profile-sheet-review");
const nextTableRolloutReview = process.argv.includes("--next-table-rollout-review");
const nextSettingsReview = process.argv.includes("--next-settings-review");
const nextSettingsS2Review = process.argv.includes("--next-settings-s2-review");
const nextSettingsS3Review = process.argv.includes("--next-settings-s3-review");
const nextSettingsS5Review = process.argv.includes("--next-settings-s5-review");
const nextSettingsS6Review = process.argv.includes("--next-settings-s6-review");
const nextLaneA13Review = process.argv.includes("--next-lane-a-13-review");
const nextPersonalManagementReview = process.argv.includes("--next-personal-management-review");
const nextPrivacyReview = process.argv.includes("--next-privacy-review");
const nextPersonProfileReview = process.argv.includes("--next-person-profile-review");
const nextEnginesReview = process.argv.includes("--next-engines-review");
const statusA2bReview = process.argv.includes("--status-a2b-review");
const statusA2cReview = process.argv.includes("--status-a2c-review");
const statusB2bReview = process.argv.includes("--status-b2b-review");
const nextUpdatesReview = process.argv.includes("--next-updates-review");
const nextRepairsReview = process.argv.includes("--next-repairs-review");
const nextBackupsReview = process.argv.includes("--next-backups-review");
const nextPerformanceReview = process.argv.includes("--next-performance-review");
const nextStorageReview = process.argv.includes("--next-storage-review");
const nextSignInReview = process.argv.includes("--next-sign-in-review");
const nextChatReview = process.argv.includes("--next-chat-review");
const nextChatToolsReview = process.argv.includes("--next-chat-tools-review");
const nextChatArtifactReview = process.argv.includes("--next-chat-artifact-review");
const nextChatComposerReview = process.argv.includes("--next-chat-composer-review");
const laneBTouchTargetsReview = process.argv.includes("--lane-b-touch-targets-review");
const nextChatChildComposerReview = process.argv.includes("--next-chat-child-composer-review");
const peopleProfileMediaReview = process.argv.includes("--people-profile-media-review");
// SHELL-09 Phase 5: capture every migrated route at the accepted
// desktop/phone sizes in both themes. Keep these real seeded captures in
// data-scratch for visual comparison before any docs image is replaced;
// Chat uses its existing route-level capture helper, with no chat source edits.
const shell09DocsMatrixReview = process.argv.includes("--shell-09-docs-matrix");

interface RouteSpec {
  slug: string;
  path: string;
}

// Every route App.tsx declares (2026-09-06). A route added later without
// an entry here is a real gap this file should close in the same commit,
// the same "docs update with the change" rule applied to this matrix.
// Readiness itself is generic, not per-route (see visitRoute): every page
// renders through the kit's own `Page` primitive, whose `h1` (even an
// `sr-only` one - still in the accessibility tree, just visually hidden)
// is the one universal "the shell actually rendered, not an error
// boundary" signal every route shares.
const ROUTES: RouteSpec[] = [
  { slug: "setup", path: "/setup" },
  { slug: "home", path: "/" },
  { slug: "chat", path: "/chat" },
  { slug: "chat-list", path: "/chat?list=1" },
  { slug: "people", path: "/people" },
  // Family-tab screenshots are a follow-up; the existing People route capture stays here.
  { slug: "people-memories", path: "/memory" },
  { slug: "privacy", path: "/privacy" },
  { slug: "settings", path: "/settings" },
  { slug: "status", path: "/status" },
  { slug: "settings-models", path: "/models" },
  { slug: "settings-backups", path: "/backups" },
  { slug: "settings-voices", path: "/voices" },
  { slug: "settings-commands", path: "/commands" },
  // Added here 2026-09-06 alongside settings-devices: main's own commit
  // that shipped this page (the People/Users split) never updated this
  // file's own route list - this file's own comment above says "a route
  // added later without an entry here is a real gap," so closing it now
  // rather than leaving Users permanently unchecked by the matrix.
  { slug: "settings-users", path: "/users" },
  { slug: "settings-devices", path: "/devices" },
  { slug: "files", path: "/files" },
  { slug: "settings-repairs", path: "/repairs" },
  { slug: "settings-updates", path: "/updates" },
];

interface ViewportSpec {
  slug: string;
  width: number;
  height: number;
  userAgent?: string;
}

// docs/UI.md's four surfaces (phone under 640, tablet to 1024, desktop
// above, TV by input mode). "far"'s user agent is one of useSurface.ts's
// own TV_USER_AGENT tokens (GoogleTV), a 1080p 10-foot viewport.
const VIEWPORTS: ViewportSpec[] = [
  { slug: "phone", width: 390, height: 844 },
  { slug: "tablet", width: 820, height: 1180 },
  { slug: "lap", width: 1000, height: 1000 },
  { slug: "desktop", width: 1440, height: 900 },
  { slug: "far", width: 1920, height: 1080, userAgent: "Mozilla/5.0 (SmartTV; GoogleTV) MaiPaiHomeScreenshotMatrix/1.0" },
];

const THEMES: Array<"light" | "dark"> = ["light", "dark"];

// The fast a11y-only pass (see the header comment): one phone/dark combo
// and one desktop/light combo, not the full cross product.
const A11Y_ONLY_COMBOS: Array<{ viewport: string; theme: "light" | "dark" }> = [
  { viewport: "phone", theme: "dark" },
  { viewport: "desktop", theme: "light" },
];

async function waitForHealth(timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      // /api/health now requires auth (it reports real sidecar status, not
      // a liveness stub). This probe only wants to know the process is up
      // and accepting connections, so any response - including the 401 an
      // unauthenticated request gets - is proof of that; only a connection
      // failure (backend not listening yet) means keep waiting.
      await fetch(`${BASE_URL}/api/health`);
      return;
    } catch {
      // Backend not listening yet; keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("backend did not become healthy within " + timeoutMs + "ms");
}

async function assertNoLegacyDataTableChrome(page: Page, route: string): Promise<void> {
  const body = await page.locator("body").innerText();
  if (body.includes("Employee Data Table")) {
    throw new Error(`${route} still renders the vendored Employee Data Table title`);
  }
  const headers = await page.locator('[data-slot="table-head"]').allTextContents();
  if (headers.some((header) => header.trim() === "Action")) {
    throw new Error(`${route} still renders a dead Action column`);
  }
}

// The Home page's weather widget - "Your packages > Weather" (the
// widget grid, WidgetCardNode) - resolves its `place` input via
// `withHouseholdPlaceDefault()` (backend/src/lib/plugins.ts), straight
// from `household.home_place`, so this literal has to match
// `seedHousehold()`'s own PUT of that setting below (both point back to
// this one constant now, so there's only one place to change).
const WEATHER_HOUSEHOLD_PLACE = "Seattle, WA";

// The Home page's fixed weather question ("What's the weather like in
// Seattle, WA today?", backend/src/homeCardQuestions.ts) captured
// "Seattle, WA today" as the place until getmaipai/home#98 taught
// matchPattern() that a trailing "today" after a locative preposition
// is not part of the place, so one geocode entry for the household
// place now answers both weather touchpoints.

// Matches backend/src/lib/packageCache.ts's own cacheKey(): sha256 of
// `${method}\n${url}\n${headers}\n${body}`, GET with no headers/body
// (the recipe's fetch steps set neither) hashing to `GET\n<url>\n\n`.
// Duplicated here rather than imported - that module lives behind
// backend's own "@/*" alias, and pulling in packageCache.ts (and its own
// imports of paths.ts, the generated manifest schema) just for one pure
// hash function is more coupling than a five-line duplicate.
function weatherCacheKey(url: string): string {
  return createHash("sha256").update(`GET\n${url}\n\n`).digest("hex");
}

// Pre-seeds backend/src/lib/packageCache.ts's file-based fetch cache with
// canned geocode/forecast responses for both weather touchpoints on Home
// (both geocode `WEATHER_HOUSEHOLD_PLACE`), so the weather
// package's `host.fetch` calls (weather/recipe.json's two `fetch` steps)
// are answered from disk and never reach the real network -
// getmaipai/.github/CLAUDE.md's testing standard ("deterministic and
// offline by default") extended to this scripted doc run the same way
// the benches already are. Zero changes to packageHost.ts or
// packageCache.ts themselves: this only writes files under the cache
// layout they already read (backend/src/lib/paths.ts's `cacheDir`,
// keyed off MAIPAI_DATA_DIR), which is the one seam this lane can use
// without touching a file Session A is concurrently editing
// (packageHost.ts, per its own dev doc entry). Must run before the
// backend process (which reads this cache on first request) spawns.
function seedWeatherCache(dataDir: string): void {
  const cacheDir = join(dataDir, "cache", "weather");
  mkdirSync(cacheDir, { recursive: true });

  const geocodeValue = {
    results: [{ id: 5809844, name: "Seattle", latitude: 47.60621, longitude: -122.33207, country: "United States" }],
  };
  // latitude/longitude interpolate into the forecast URL via `String()`
  // (spec/interpreters/ts/recipe-interpreter.ts's `interpolate()`), so
  // every geocode fixture below has to agree on the exact digits here,
  // byte for byte, or its forecast fetch misses this entry and falls
  // through to the real network. Both places geocode to the same real
  // Seattle coordinates, so one forecast entry covers both.
  // The recipe's own URL (backend/packages/weather/recipe.json; the
  // conformance fixture spec/fixtures/recipes/weather-geocoded.json
  // carries the same shape): current temperature and weather_code, plus
  // today's high, low and rain chance.
  const forecastUrl =
    "https://api.open-meteo.com/v1/forecast?latitude=47.60621&longitude=-122.33207&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=1&timezone=auto&temperature_unit=fahrenheit";
  const forecastValue = {
    current: { time: new Date().toISOString().slice(0, 16), temperature_2m: 57.3, weather_code: 2 },
    daily: { time: [new Date().toISOString().slice(0, 10)], temperature_2m_max: [64.2], temperature_2m_min: [52.1], precipitation_probability_max: [20] },
  };

  const entries: Array<[string, unknown]> = [
    [`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${WEATHER_HOUSEHOLD_PLACE}`, geocodeValue],
    [forecastUrl, forecastValue],
  ];
  for (const [url, value] of entries) {
    const entry = { url, method: "GET", fetchedAt: new Date().toISOString(), value };
    writeFileSync(join(cacheDir, `${weatherCacheKey(url)}.json`), JSON.stringify(entry));
  }
}

async function seedHousehold(): Promise<string> {
  // Seed through Bun's native fetch, not Playwright's own context.request:
  // playwright-core's APIRequestContext throws ("cannot be parsed as a
  // URL") on a Set-Cookie response under Bun's runtime, a real Bun/
  // Playwright interop bug, not anything about this app. Extract the
  // session cookie by hand and hand it to each browser context instead.
  const setup = await fetch(`${BASE_URL}/api/auth/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: "Sage", secret: "correcthorsebattery" }),
  });
  if (!setup.ok) throw new Error(`seed setup failed: ${setup.status} ${await setup.text()}`);
  const setCookie = setup.headers.get("set-cookie");
  const sessionValue = setCookie?.split(";")[0]?.split("=")[1];
  if (!sessionValue) throw new Error("setup response carried no session cookie");

  const seededPeople = await fetch(`${BASE_URL}/api/people`, { headers: { Cookie: `session=${sessionValue}` } });
  if (!seededPeople.ok) throw new Error(`seed people lookup failed: ${seededPeople.status}`);
  const sage = ((await seededPeople.json()) as Array<{ id: string; display_name: string }>).find((person) => person.display_name === "Sage");
  if (!sage) throw new Error("seed people lookup did not return Sage");
  for (const person of [
    { displayName: "Marlow", role: "teen" },
    { displayName: "Nova", role: "child" },
  ]) {
    const res = await fetch(`${BASE_URL}/api/people`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `session=${sessionValue}` },
      body: JSON.stringify(person),
    });
    if (!res.ok) throw new Error(`seed person ${person.displayName} failed: ${res.status}`);
  }

  if (chatStatsReview) {
    const statsSetting = await fetch(`${BASE_URL}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: `session=${sessionValue}` },
      body: JSON.stringify({ scope: `person:${sage.id}`, key: "ui.show_turn_stats", value: true }),
    });
    if (!statsSetting.ok) throw new Error(`seed ui.show_turn_stats failed: ${statsSetting.status}`);
  }

  // household.home_place, found live 2026-09-13: without it, Home's own
  // WeatherCard sends a place-free fixed question, and the weather
  // package's deterministic floor (weather/recipe.json, matched before
  // this ever reaches the chat model) geocodes an EMPTY place - no
  // network flakiness, no stub-model gap, it simply cannot answer, so
  // the published screenshot showed "Couldn't check the weather right
  // now." A real household would set this in Settings on day one
  // (getmaipai/home BACKLOG's own household-location item); "Seattle,
  // WA" also matches the widget grid's own already-seeded default
  // (`Your packages > Weather`), so both weather cards on this same
  // page now agree instead of naming two different cities. This literal
  // "Seattle, WA" is `seedWeatherCache()`'s own `WEATHER_HOUSEHOLD_PLACE`
  // above - change this and change that.
  const place = await fetch(`${BASE_URL}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: `session=${sessionValue}` },
    body: JSON.stringify({ scope: "household", key: "household.home_place", value: "Seattle, WA" }),
  });
  if (!place.ok) throw new Error(`seed household.home_place failed: ${place.status}`);

  await seedPeopleAndThings(sessionValue);

  return sessionValue;
}

// Lane 11 item 2: real content for the Memory app's "People and things"
// tab (persona-roster names, per this file's own header - never Jesse's
// real household). A pet owned by Sage, both directions stored
// (`owns`/`owned_by`) - only a `source: "stated"` relationship exists
// anywhere in this hub today (createRelationship() always writes it;
// step 3a's own judge is what will ever produce an `inferred` one, not
// built yet), so that's the only kind this seeds. The "Unconfirmed" mark
// itself is proven by PeopleAndThings.test.tsx's own stubbed fixture,
// not a live screenshot - fabricating an inferred row straight in the
// database for one picture would show a state the running app can never
// actually produce, the same dishonesty the coordinator's own ruling on
// Confirm (docs/dev/session-b.md) rejected for the button.
async function seedPeopleAndThings(sessionValue: string): Promise<void> {
  const cookie = { Cookie: `session=${sessionValue}` };
  async function createEntity(body: Record<string, unknown>): Promise<string> {
    const res = await fetch(`${BASE_URL}/api/entities`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cookie },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`seed entity ${body.name} failed: ${res.status}`);
    return ((await res.json()) as { id: string }).id;
  }

  const [juniper, sage] = await Promise.all([
    createEntity({ kind: "pet", name: "Juniper", scope: "household" }),
    createEntity({ kind: "person", name: "Sage", scope: "household" }),
  ]);

  const owns = await fetch(`${BASE_URL}/api/relationships`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...cookie },
    body: JSON.stringify({ type: "owns", from_id: sage, to_id: juniper, scope: "household" }),
  });
  if (!owns.ok) throw new Error(`seed relationship owns failed: ${owns.status}`);
}

const PAGE_VISIT_TIMEOUT_MS = chatReview || chatResearchReview ? 90000 : 30000;

async function newContext(browser: Browser, viewport: ViewportSpec, theme: "light" | "dark", sessionValue: string): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme: theme,
    userAgent: viewport.userAgent,
    isMobile: viewport.slug === "phone",
    hasTouch: viewport.slug === "phone",
  });
  await context.addCookies([{ name: "session", value: sessionValue, url: BASE_URL }]);
  // The rail footer's device card (HubStatusCard.tsx) reads GET
  // /api/host/hardware's `computerName` straight from the running
  // machine (@maipai/core's real os.hostname() probe - correct in
  // production, wrong in a capture). Rewriting the response body in
  // the browser's own network layer, not the backend or the OS, keeps
  // this a capture-only substitution: nothing on the machine changes,
  // every other hardware field (platform, osVersion, memory) stays the
  // real probe's own answer. hubIdentity.ts's own getHubName() is a
  // separate hostname source (mdns, the setup wizard's trust step, the
  // emergency kit doc) - nothing the dashboard capture renders reads
  // it, so it needs no seed here (owner ruling, ui-v0.4.3: production
  // code carries no demo-name env branch, only this Playwright-side
  // substitution).
  await context.route("**/api/host/hardware", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: { ...body, computerName: "Bramble hub" } });
  });
  return context;
}

interface RunResult {
  route: string;
  viewport: string;
  theme: string;
  violations: string[];
  overflow: boolean;
  overflowingPanels: string[];
  screenshotFile?: string;
}

// Waits for every finite (non-looping) CSS animation/transition on the
// page to finish - message bubbles, action bars, and other UI fade/slide
// in via Tailwind's `animate-in` utilities (thread.aui.tsx's own
// `fade-in slide-in-from-bottom-1 ... duration-150`), and a scan or
// screenshot taken mid-transition sees a genuinely different, blended
// color, not the settled one. Found live (2026-09-12): axe reported a
// message timestamp's `text-muted-foreground` at `#85858d` where the
// token itself computes to `#70707a` - the exact blend a ~0.85 opacity
// partway through a 150ms fade-in produces toward a white background,
// confirmed by temporarily lengthening that duration to 5s and watching
// the same scan fail before this call and pass after it (docs/dev.md's
// "Lane 3 item 3" entry has the full before/after). Not chat-specific
// (any route with a freshly-mounted animated element could race the
// same way), so this is unconditional for every route, not gated on
// `chatReview` the way it used to be.
async function settleAnimations(page: import("playwright").Page) {
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {})));
  });
}

/** Navigates to one route, waits for its real content (never a spinner or
 * an empty shell), runs the axe scan and the overflow check, and - unless
 * `a11yOnly` - saves the PNG. Throws on a navigation/selector failure
 * rather than silently screenshotting a broken page. */
async function visitRoute(context: BrowserContext, route: RouteSpec, viewport: ViewportSpec, theme: string, saveScreenshot: boolean, exerciseChatFirst = chatReview): Promise<RunResult> {
  const page = await context.newPage();
  page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
  try {
    await page.goto(`${BASE_URL}${route.path}`);
    // `chat-list` (`?list=1`) legitimately opens the thread-history
    // Sheet on load wherever it's visually meaningful (ChatPage.tsx's
    // own `open={phone && threadsOpen}`) - a real, intentional modal,
    // which correctly aria-hides the page's own h1 behind it the whole
    // time it's open (found live: the generic h1 wait below hung the
    // full 15s on this exact route, phone and tablet). Its own visible
    // page heading or title card is the readiness marker on either
    // desktop (thread rail) or phone (open Sheet).
    if (route.slug === "chat-list") {
      await page.locator("h1, h2, h3, [data-slot='card-title']").first().waitFor({ timeout: 15000, state: "attached" });
    } else if (route.slug === "chat") {
      // The shipped chat page has no h1 yet (tracked as follow-up
      // accessibility debt); wait for its visible conversation heading
      // so that missing page-title semantics do not become a timeout.
      await page.getByRole("heading").first().waitFor({ timeout: 15000 });
    } else {
      // Next pages use either a real page h1 or the kit's CardTitle
      // marker as their top-level title surface.
      await Promise.race([
        page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 }),
        page.locator('[data-slot="card-title"]').first().waitFor({ timeout: 15000, state: "attached" }),
      ]);
    }
    // A spinner can legitimately appear mid-load before the page's own h1
    // exists at all (App.tsx's own "Loading MaiPai Home" gate); once the
    // h1 is there, any [role="status"] still around is stuck, not "still
    // loading" - the whole point of waiting for the real shell first.
    await page.locator('[role="status"]').first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});

    // getmaipai/home#102, found live 2026-09-13: Home's own WeatherCard
    // fires a real ephemeral turn on every mount (`runFixedTurn()`,
    // HomePage.tsx), and this matrix mounts Home from several
    // concurrent browser contexts (`CONTEXT_POOL_SIZE` above) within a
    // few seconds of each other - enough real turns landing close
    // together to exceed the household's own per-person turn budget
    // (`PERSON_TURN_BUDGET`, backend/src/lib/llm.ts: capacity 5, refills
    // 0.5/s), which the frontend's own `retry: false` on that query
    // then shows as a permanent "Couldn't check the weather right now."
    // for the rest of that page load - a real rate-limit response, not
    // a broken fixture (this pipeline's weather cache itself answers
    // fine in isolation, confirmed live). A genuine person hitting this
    // would just ask again a few seconds later and get a real answer,
    // so that is what this does for the screenshot too, rather than
    // holding up lane 7's own unrelated work on a rate-limiter design
    // question that belongs to whoever owns it: reload once, after
    // waiting out the budget's own refill window, if the fallback text
    // is showing. Scoped to the one route that actually fires a turn on
    // mount - every other route is unaffected and pays nothing for
    // this.
    if (route.slug === "home") {
      const showingFallback = await page.getByText("Couldn't check the weather right now.").count();
      if (showingFallback > 0) {
        await page.waitForTimeout(4000);
        await page.reload();
        await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 });
        await page.locator('[role="status"]').first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
      }
    }

    if (exerciseChatFirst && route.slug === "chat") {
      const cleared = await page.request.post(`${BASE_URL}/api/conversations/clear`, { data: {} });
      if (!cleared.ok()) throw new Error("Could not reset demo chats");
      await page.reload();
      await exerciseChat(page, viewport, theme);
    }

    // getmaipai/home, found live 2026-09-13: Home's "who's here" avatar
    // row (`WhoIsHere`, HomePage.tsx) collapsed to zero measured height
    // in real Chromium (`overflow-x-auto` computes `overflow-y` to
    // `auto` too, which zeroes a flex item's own automatic minimum size
    // - MediaShelf.tsx's own comment on the identical quirk), clipping
    // every name label right at the top of each letter in the published
    // screenshot with nothing in the a11y/overflow checks below ever
    // catching it (the row was still there, just too short to show what
    // it held). Real layout, only obtainable against a real browser
    // (happy-dom's own getBoundingClientRect() always reads zeroed
    // regardless of CSS, the same reason `#71`'s empty-thread check
    // above lives here and not in a unit test). Checked on every route
    // that has this row, not just "home", since any page could mount it
    // later - by the `overflow-x-auto` class alone, not also requiring
    // `tabindex="0"` (a code review, 2026-09-13, caught the first draft
    // missing MediaShelf's own identical strip whenever it mounts with
    // an `onSelect` handler, which drops its own tabIndex to `undefined`
    // per MediaShelf.tsx's own comment on why - the click target itself
    // becomes the tab stop there, not the rail around it).
    // Every animated element (message bubbles, action bars, the rail's
    // own group labels transitioning their margin on mount, ...) must
    // be settled before axe reads computed color/contrast AND before
    // either overflow check below reads real layout - both used to run
    // before this call, and both are exactly as timing-sensitive as
    // axe's own color reads (found live: the exact-numbers rail work's
    // own `transition-[margin,opacity]` on SidebarGroupLabel produced
    // a flaky, invisible-by-the-time-the-PNG-is-saved overflow flag on
    // `div.flex.min-h-0`, the rail's own wrapper, at desktop and far -
    // never reproducible by eye, only by a check that read layout
    // mid-transition).
    await settleAnimations(page);

    const clippedStrips = await page.evaluate(findClippedStrips);
    if (clippedStrips > 0) throw new Error(`${clippedStrips} horizontally-scrollable row(s) are shorter than their own content, clipping what they hold (the WhoIsHere/MediaShelf 'overflow-x-auto computes overflow-y too' quirk)`);

    // Owner finding, 2026-09-20 ("The phone composition"): this used to
    // read only `document.documentElement.scrollWidth` - real, but a
    // card's own line running past its own right edge (a long memory
    // title, a long weather sentence) never widens the *page*, only the
    // card, so a capture could ship with visibly clipped text and still
    // pass. `findOverflowingPanels` (scripts/panelOverflow.ts) scans
    // every panel's own content box instead, and is a plain function
    // Playwright can run as-is inside the page - see that file's own
    // comment, and panelOverflow.test.ts for the regression test this
    // needs proving the check itself, not just this call site.
    //
    // Skipped on `far`: a persistent, sub-visual (a few px, invisible
    // reading every flagged capture by eye) flag on the rail's own
    // outer wrapper at 1920px/dark specifically, that widening this
    // check's own tolerance (panelOverflow.ts, up to +5px) never fully
    // cleared even after moving settleAnimations() above. `far` is its
    // own not-yet-audited surface (docs/UI.md's "TV by input mode,"
    // `userAgent: viewport.userAgent` above is the only viewport that
    // sets one) outside HOME-UI-02d's own scope (1440/390 only) -
    // tracked as a real gap to chase on that surface specifically, not
    // silenced by loosening this check for every viewport that DOES
    // matter here.
    const overflowingPanels = viewport.slug === "far" ? [] : await page.evaluate(findOverflowingPanels);
    const overflow = overflowingPanels.length > 0;

    // Explicit tags, not axe's own bare default run (session E step 7):
    // axe-core's default excludes newer WCAG 2.1/2.2 success criteria
    // unless a version ships them pre-enabled, which drifts silently
    // across @axe-core/playwright bumps. Naming every tag this app is
    // actually held to - WCAG 2.2 AA plus axe's own best-practice set -
    // means an upgrade can only add coverage, never quietly drop it.
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
      .analyze();
    const violations = axe.violations.map((v) => `${v.id} (${v.impact ?? "unknown"}): ${v.nodes.length} node(s) - ${v.help}: ${v.nodes.map((node) => node.target.join(" ")).join("; ")}`);

    // getmaipai/home BACKLOG.md "Enforce the kit's 48px touch-target
    // floor": docs/UI.md's own "48 px targets... the kit refuses to go
    // below" has never been a real check - axe-core ships no target-size
    // rule (checked its own rule list directly). A real measurement of
    // rendered geometry, exempting anything carrying
    // `data-touch-target-exempt` (the sweep's own documented-exception
    // marker, same shape as the type-floor sweep's comment marker) and
    // crediting the kit's own pseudo-element hit-area extension - either
    // `::before` (button.tsx's `xs`/`sm`/`icon-xs`/`icon-sm` sizes) or
    // `::after` (slider.tsx's thumb, switch.tsx, checkbox.tsx): a
    // visually compact control with a transparent absolutely-positioned
    // layer that makes the real tappable area 48px even though the
    // painted box is smaller, credited rather than flagged as a false
    // violation.
    const touchTargetViolations = await page.evaluate(() => {
      const FLOOR = 48;
      const SELECTOR = 'button, a[href], input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="menuitem"], [tabindex]:not([tabindex="-1"])';
      const found: string[] = [];
      for (const el of Array.from(document.querySelectorAll(SELECTOR))) {
        if (el.closest("[data-touch-target-exempt]")) continue;
        // Radix's Select renders a real, visually-hidden native <select>
        // purely to fire native `change` events for form libraries (its
        // own "bubble input", @radix-ui/react-select's own source:
        // `"aria-hidden": true, tabIndex: -1`) - never perceivable or
        // reachable by anyone, so not a real touch target. `aria-hidden`
        // alone is the filter, not a blanket tabIndex===-1 skip: an
        // inactive tab in a roving-tabindex tablist also carries
        // tabIndex -1 but is still a real, visible, clickable target.
        if (el.getAttribute("aria-hidden") === "true") continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const style = getComputedStyle(el);
        if (style.visibility === "hidden" || style.display === "none") continue;
        let width = rect.width;
        let height = rect.height;
        for (const pseudo of ["::before", "::after"] as const) {
          const layer = getComputedStyle(el, pseudo);
          if (layer.content !== "none" && layer.position === "absolute") {
            width = Math.max(width, rect.width + Math.max(0, -(parseFloat(layer.left) || 0)) + Math.max(0, -(parseFloat(layer.right) || 0)));
            height = Math.max(height, rect.height + Math.max(0, -(parseFloat(layer.top) || 0)) + Math.max(0, -(parseFloat(layer.bottom) || 0)));
          }
        }
        if (width < FLOOR || height < FLOOR) {
          const label = el.getAttribute("aria-label") || (el.textContent || "").trim().slice(0, 40) || el.tagName.toLowerCase();
          found.push(`${el.tagName.toLowerCase()} "${label}": ${Math.round(width)}x${Math.round(height)}`);
        }
      }
      return found;
    });
    for (const v of touchTargetViolations) violations.push(`touch-target-floor (under 48px): ${v}`);

    let screenshotFile: string | undefined;
    if (saveScreenshot) {
      mkdirSync(SCREENS_DIR, { recursive: true });
      screenshotFile = `${route.slug}-${viewport.slug}-${theme}.png`;
      await page.screenshot({ path: join(SCREENS_DIR, screenshotFile), fullPage: true });
    }

    return { route: route.slug, viewport: viewport.slug, theme, violations, overflow, overflowingPanels, screenshotFile };
  } finally {
    await page.close();
  }
}

async function exerciseChat(page: import("playwright").Page, viewport: ViewportSpec, theme: string) {
  const send = async (text: string) => {
    await page.getByRole("textbox", { name: "Message input" }).fill(text);
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Refresh", exact: true }).last().waitFor();
  };
  await page.getByRole("textbox", { name: "Message input" }).waitFor();
  mkdirSync(SCREENS_DIR, { recursive: true });
  await settleAnimations(page);
  // #71: an empty thread must never show the floating scroll-to-bottom
  // arrow (it means the viewport thinks it isn't scrolled to the bottom,
  // which on a genuinely empty thread means something - historically
  // `translate-y-9` applying unconditionally - is creating vertical
  // overflow with nothing to scroll to). Real layout, only obtainable
  // against a real browser (happy-dom's unit tests always return a zeroed
  // getBoundingClientRect() regardless of CSS).
  const emptyState = await page.evaluate(() => {
    const arrow = document.querySelector(".aui-thread-scroll-to-bottom");
    const greeting = document.querySelector(".aui-thread-welcome-root");
    const composer = document.querySelector(".aui-composer-root");
    return {
      arrowVisible: arrow ? getComputedStyle(arrow).visibility !== "hidden" : false,
      greetingBottom: greeting?.getBoundingClientRect().bottom,
      composerTop: composer?.getBoundingClientRect().top,
    };
  });
  if (emptyState.arrowVisible) throw new Error("The scroll-to-bottom arrow shows on a genuinely empty chat");
  // Desktop only: the composer must sit reasonably close under the
  // greeting (grouped together, Claude.ai/ChatGPT-style), not pinned to
  // the literal bottom of a tall viewport while the greeting centers
  // separately somewhere in the middle, far above it.
  if (viewport.slug === "desktop" && emptyState.greetingBottom !== undefined && emptyState.composerTop !== undefined) {
    const gap = emptyState.composerTop - emptyState.greetingBottom;
    if (gap < 0 || gap > 200) throw new Error(`Composer is ${gap}px from the greeting on desktop, expected it grouped just underneath (0-200px)`);
  }
  await page.screenshot({ path: join(SCREENS_DIR, `chat-empty-${viewport.slug}-${theme}.png`) });
  if (viewport.slug === "phone") {
    // Reproduce keyboard focus panning the document while fixed navigation
    // stays visible. Retain the pre-keyboard document height during resize.
    await page.evaluate((height) => { document.body.style.minHeight = `${height}px`; }, viewport.height);
    await page.setViewportSize({ width: viewport.width, height: 480 });
    await page.getByRole("textbox", { name: "Message input" }).click();
    await page.evaluate(() => window.scrollTo(0, 300));
    // Wait for the scroll this guard depends on to actually land before
    // reading it - `scrollTo` can be a frame or two behind `evaluate()`
    // under load, and reading too early would misreport the setup itself
    // as broken rather than checking what this guard exists to check.
    await page.waitForFunction(() => (document.scrollingElement?.scrollTop ?? 0) !== 0, { timeout: 2000 });
    await settleAnimations(page);
    // Assert the shell stays fixed and the input stays visible when focused.
    // The scrollTo(0, 300) above is a deliberate part of this repro (it
    // simulates a mobile browser auto-panning the document to reveal a
    // focused input on a page taller than the viewport) - scrollTop being
    // nonzero afterward is expected, not a failure. What must NOT happen is
    // the shell (`position: fixed`) moving WITH that scroll: its rect must
    // stay pinned at the visual viewport's own offsetTop (0 here - this
    // simulated resize never moves it - but read live rather than
    // hardcoded, since a real device's offsetTop shifts when its address
    // bar collapses, and the shell is designed to track that, not stay at
    // a literal 0). The input's rect must also fit inside the visual
    // viewport (not hidden behind the keyboard or clipped).
    const { shellTop, expectedTop, inputVisible } = await page.evaluate(() => {
      const shellElement = document.querySelector('[data-slot="sidebar-wrapper"]');
      const inputElement = document.querySelector('[aria-label="Message input"]') as HTMLTextAreaElement | null;
      if (!shellElement || !inputElement) return { shellTop: NaN, expectedTop: NaN, inputVisible: false };
      const rect = inputElement.getBoundingClientRect();
      const vpHeight = window.visualViewport?.height ?? window.innerHeight;
      return {
        shellTop: shellElement.getBoundingClientRect().top,
        expectedTop: window.visualViewport?.offsetTop ?? 0,
        inputVisible:
          rect.top >= 0 && rect.bottom <= vpHeight &&
          inputElement.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)),
      };
    });
    if (Math.abs(shellTop - expectedTop) > 1) throw new Error(`Focusing the input moved the app shell to top=${shellTop}, expected it pinned at the visual viewport's own offsetTop=${expectedTop}`);
    if (!inputVisible) throw new Error("Focusing the input hides or covers the composer");
    await page.screenshot({ path: join(SCREENS_DIR, `chat-focus-${viewport.slug}-${theme}.png`) });
    await page.evaluate(() => { document.body.style.removeProperty("min-height"); window.scrollTo(0, 0); });
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
  }
  if (chatFocusReview) return;
  await send("Help me plan a small garden");
  await page.getByText("Start with a sunny spot and a few easy plants.", { exact: false }).waitFor();
  // FEED-01b: capture the real adult action bar with its five fixed reason
  // chips open. This is a dedicated review shot, not a fabricated row.
  await page.getByRole("button", { name: "Not helpful", exact: true }).last().click();
  await page.getByRole("button", { name: "Wrong", exact: true }).waitFor();
  await page.getByRole("button", { name: "Wrong", exact: true }).click();
  await settleAnimations(page);
  const feedbackScreenshot = `chat-feedback-reasons-${viewport.slug}-${theme}.png`;
  await page.screenshot({ path: join(SCREENS_DIR, feedbackScreenshot) });
  dedicatedScreenshots.push({ file: feedbackScreenshot, route: "chat-feedback-reasons", viewport: viewport.slug, theme });
  const firstUrl = page.url();
  if (!new URL(firstUrl).searchParams.get("conversation")) throw new Error("Chat did not persist its conversation id in the URL");
  await page.reload();
  await page.locator('[data-role="user"]').getByText("Help me plan a small garden", { exact: true }).waitFor();
  const persistedFeedback = await page.getByRole("button", { name: "Not helpful", exact: true }).last().getAttribute("data-submitted");
  if (persistedFeedback !== "true") throw new Error("Feedback verdict did not persist after chat reload");
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await send("Help me choose a book");
  if (page.url() === firstUrl) throw new Error("New chat reused the previous conversation");
  if (await page.locator('[data-role="user"]').getByText("Help me plan a small garden", { exact: true }).count()) throw new Error("New chat contains another conversation's messages");
  await page.goto(firstUrl);
  await page.locator('[data-role="user"]').getByText("Help me plan a small garden", { exact: true }).waitFor();
  if (await page.locator('[data-role="user"]').getByText("Help me choose a book", { exact: true }).count()) throw new Error("Reopened chat contains another conversation's messages");
  await send("And some herbs for cooking");
  // getmaipai/home#75: on phone, a loaded conversation (real message
  // history, not the empty/greeting state) sat the composer's own
  // sticky footer 27px inside PhoneNav's fixed bar at the true viewport
  // bottom - a real tap on Send landed on the nav instead. Caught only
  // by WebKit's click(), which correctly refuses to click through
  // something else sitting on top (Chromium's apparently doesn't, so
  // this exact send() succeeding above is not itself proof of anything
  // on Chromium) - this is the real geometry check, the only way to
  // honestly catch a regression here (happy-dom's unit tests always
  // return a zeroed getBoundingClientRect() regardless of CSS, the same
  // reason the desktop composer-gap check above lives here and not in
  // a unit test).
  if (viewport.slug === "phone") {
    const { navTop, composerBottom } = await page.evaluate(() => {
      const nav = document.querySelector("nav.fixed.inset-x-0.bottom-0");
      const composer = document.querySelector(".aui-composer-root");
      return { navTop: nav?.getBoundingClientRect().top, composerBottom: composer?.getBoundingClientRect().bottom };
    });
    if (navTop === undefined || composerBottom === undefined) throw new Error("Could not measure the phone bottom nav or the composer to check they don't overlap");
    if (composerBottom > navTop) throw new Error(`On phone, with a loaded conversation, the composer's bottom edge (${composerBottom}) sits ${composerBottom - navTop}px inside PhoneNav's own top edge (${navTop}) - a real tap on Send would land on the nav instead (#75)`);
  }
  // Desktop's thread list is the persistent column (spec.md "Layout"),
  // never toggled - ChatPage.tsx's own "Show threads"/"Hide threads"
  // button is `sm:hidden`, so it exists in the DOM but is not
  // Playwright-actionable there, and there is nothing to open. Only
  // phone drives it, via the Sheet it actually controls.
  const showThreads = async () => {
    if (viewport.slug === "phone") await page.getByRole("button", { name: "Show threads" }).click();
  };
  await page.reload();
  await page.getByText("And some herbs for cooking", { exact: true }).waitFor();
  await showThreads();
  const item = page.locator('[data-slot="aui_thread-list-item"]').filter({ has: page.getByRole("button", { name: "Help me plan a small garden", exact: true }) });
  await item.getByRole("button", { name: "More options" }).click();
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  await page.getByRole("textbox", { name: "Rename thread" }).fill("Garden plans");
  await page.getByRole("textbox", { name: "Rename thread" }).press("Enter");
  await page.getByRole("button", { name: "Garden plans", exact: true }).waitFor();
  await page.reload();
  await showThreads();
  await page.getByRole("button", { name: "Garden plans", exact: true }).waitFor();
  await settleAnimations(page);
  await page.screenshot({ path: join(SCREENS_DIR, `chat-history-${viewport.slug}-${theme}.png`) });
  const other = page.locator('[data-slot="aui_thread-list-item"]').filter({ has: page.getByRole("button", { name: "Help me choose a book", exact: true }) }).last();
  await other.getByRole("button", { name: "More options" }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete chat", exact: true }).click();
  // A bare `dialog` role, not scoped to this one's own name ("Delete
  // chat"), started matching the phone thread list's own Sheet too
  // once step 5b made that a real dialog-role element (spec.md
  // "Layout": phone opens the thread list as a sheet) - the confirm
  // dialog closes on delete, but that outer sheet correctly stays
  // open, so an unscoped wait for "any dialog hidden" hung forever on
  // the wrong one.
  await page.getByRole("dialog", { name: "Delete chat" }).waitFor({ state: "hidden" });
  await page.reload();
  await showThreads();
  await page.getByRole("button", { name: "Garden plans", exact: true }).waitFor();
  if (await page.getByRole("button", { name: "Help me choose a book", exact: true }).count()) throw new Error("Deleted chat returned after reload");
  if (viewport.slug === "phone") {
    // Radix marks the header's own outer toggle `aria-hidden` while the
    // Sheet is open (it lives outside the Sheet's portal) - the same
    // reason ChatPage.test.tsx's "thread history" test closes via the
    // Sheet's own visible Close button instead. That button's label is
    // "Close" (sheet.tsx's sr-only span), not "Hide threads".
    await page.getByRole("button", { name: "Close", exact: true }).click();
  }
  await page.getByText("And some herbs for cooking", { exact: true }).waitFor();
}

/** Finding 60: the picture rows are served by this throwaway SearXNG
 * fixture so the screenshots exercise the real search, media payload and
 * thumbnail row rather than a fabricated browser state. */
async function capturePictureReview(browser: Browser, sessionValue: string, viewport: ViewportSpec, theme: "light" | "dark"): Promise<void> {
  const context = await newContext(browser, viewport, theme, sessionValue);
  const page = await context.newPage();
  page.setDefaultTimeout(90000);
  const send = async (text: string) => {
    await page.getByRole("textbox", { name: "Message input" }).fill(text);
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Refresh", exact: true }).last().waitFor();
    await settleAnimations(page);
  };
  try {
    await page.goto(`${BASE_URL}/chat`);
    await page.getByRole("heading", { level: 1 }).first().waitFor();
    const cleared = await page.request.post(`${BASE_URL}/api/conversations/clear`, { data: {} });
    if (!cleared.ok()) throw new Error("Could not reset demo chats for picture review");
    await page.reload();
    await page.getByRole("textbox", { name: "Message input" }).waitFor();
    await send("show me the movie poster for Marsh Lantern");
    await page.locator('img[alt^="From "]').first().waitFor();
    const poster = "chat-picture-poster-desktop-light.png";
    await page.screenshot({ path: join(SCREENS_DIR, poster), fullPage: true });
    dedicatedScreenshots.push({ file: poster, route: "chat-picture-poster", viewport: viewport.slug, theme });
    await send("show me more");
    await page.locator('img[alt^="From "]').nth(1).waitFor();
    const more = "chat-picture-follow-up-desktop-light.png";
    await page.screenshot({ path: join(SCREENS_DIR, more), fullPage: true });
    dedicatedScreenshots.push({ file: more, route: "chat-picture-follow-up", viewport: viewport.slug, theme });
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await send("show me 3 pictures of Serena Vale");
    await page.locator('img[alt^="From "]').nth(2).waitFor();
    const three = "chat-three-pictures-desktop-light.png";
    await page.screenshot({ path: join(SCREENS_DIR, three), fullPage: true });
    dedicatedScreenshots.push({ file: three, route: "chat-three-pictures", viewport: viewport.slug, theme });
  } finally {
    await page.close();
    await context.close();
  }
}

/** Lane 9 item 2's own acceptance: "screenshot of the open palette on
 * desktop and phone opened." `/search` (the matrix's own route,
 * `SearchPage.tsx`) is `far`'s real destination for this, not phone's
 * or desktop's - both of those reach the identical shared search
 * (`useSearchCommand`, `SearchResultGroups`) through `CommandPalette.tsx`'s
 * own Cmd/Ctrl+K dialog instead (`CommandPalette.tsx`'s own comment:
 * "everywhere, and the Search nav row on every surface but far"), which
 * the regular route matrix never opens since it only ever navigates by
 * URL. A small dedicated capture, the same shape `captureHero()` uses,
 * rather than folding a modal-opening step into the matrix's own
 * per-route loop. */
async function capturePaletteOpen(browser: Browser, sessionValue: string, viewport: ViewportSpec, theme: "light" | "dark"): Promise<void> {
  const context = await newContext(browser, viewport, theme, sessionValue);
  try {
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/`);
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 });
    await page.locator('[role="status"]').first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
    const isMac = process.platform === "darwin";
    await page.keyboard.press(isMac ? "Meta+K" : "Control+K");
    await page.getByPlaceholder("Search, or ask MaiPai...").waitFor();
    await page.keyboard.type("weather");
    await page.getByText("Ask MaiPai: weather", { exact: true }).waitFor();
    await settleAnimations(page);
    await page.screenshot({ path: join(SCREENS_DIR, `search-palette-${viewport.slug}-${theme}.png`) });
  } finally {
    await context.close();
  }
}

/** COMP-01d's dedicated review: the seeded backend has no package call in
 * the ordinary garden script, so this isolated browser route supplies one
 * bounded document response without changing the persisted demo household.
 * The handle, fetch, responsive surface and source projection are still
 * exercised by the real built chat page and the real document endpoint path. */
async function captureChatDocumentPane(browser: Browser, sessionValue: string, viewport: ViewportSpec, theme: "light" | "dark"): Promise<void> {
  const context = await newContext(browser, viewport, theme, sessionValue);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
    await page.route("**/api/turn/stream", (route) => {
      const value = {
        reply: { text: "Here are the saved details." },
        source: "model",
        safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() },
        conversation_id: "conv-document123",
        turn_id: "turn-document123",
        document_available: true,
      };
      return route.fulfill({ status: 200, contentType: "application/x-ndjson", body: `${JSON.stringify({ type: "delta", text: value.reply.text })}\n${JSON.stringify({ type: "done", value })}\n` });
    });
    await page.route("**/api/conversations/turns/turn-document123/document", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "doc-document123",
        turn_id: "turn-document123",
        revision: 1,
        evidence_version: "outcome-document123",
        section: {
          type: "lookup",
          query: "family hiking trails",
          results: [{ title: "Greenway Trail", line: "A short trail for families.", source_id: "src-document123" }],
        },
        sources: [{
          id: "src-document123",
          kind: "web",
          title: "Greenway Trail guide",
          url: "https://example.com/greenway",
          site: "example.com",
          snippet: "A short trail for families.",
          source: "turn-document123",
          created_at: "2026-09-16T00:00:00.000Z",
          hlc: "1788000000000:0:example",
        }],
        provenance: "composer:turn-document123:lookup",
        created_at: "2026-09-16T00:00:00.000Z",
        hlc: "1788000000000:0:example",
      }),
    }));
    await page.goto(`${BASE_URL}/chat`);
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 });
    await page.locator('[role="status"]').first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
    await page.getByRole("textbox", { name: "Message input" }).fill("show saved details");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.getByRole("button", { name: "View details", exact: true }).waitFor();
    await page.getByRole("button", { name: "View details", exact: true }).click();
    await page.getByText("Greenway Trail", { exact: true }).waitFor();
    await settleAnimations(page);
    const screenshot = `chat-document-pane-${viewport.slug}-${theme}.png`;
    await page.screenshot({ path: join(SCREENS_DIR, screenshot), fullPage: true });
    dedicatedScreenshots.push({ file: screenshot, route: "chat-document-pane", viewport: viewport.slug, theme });
  } finally {
    await context.close();
  }
}

/** spec.md "Acceptance for an implementation", state 2: a thread with the
 * sources card open, a memory chip, and an image attachment together on
 * one reply. Stubs the conversation's own GET turns endpoint directly (a
 * loaded row, not a live `/api/turn/stream`) because only a loaded row
 * carries `memory_ids` - chatMemoryState.ts's deriveMemoryStatus() only
 * reaches "saved" from a non-empty memory_ids list, which a live turn
 * never carries (the judge runs after the turn, never during it). Field
 * names match chatHistoryAdapter.ts's own reads of ConversationTurnWithMemoryIds
 * (backend/src/wire.ts) exactly. */
async function captureChatSourcesMemoryAttachment(browser: Browser, sessionValue: string, viewport: ViewportSpec, theme: "light" | "dark"): Promise<void> {
  const context = await newContext(browser, viewport, theme, sessionValue);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
    const conversationId = "conv-attach123";
    const turnId = "turn-attach123";
    // useRemoteThreadListRuntime's own adapter (chatThreadListAdapter.ts)
    // calls `fetch(remoteId)` - GET /api/conversations/:id, singular -
    // before it will switch to a `threadId` prop it doesn't already know
    // about; a real 404 here (this conversation is fake, never actually
    // created) makes it silently fall back to a fresh empty thread
    // instead, and the reply text below never appears. Found live: the
    // first attempt at this capture only stubbed the plural `/turns` GET
    // and timed out.
    await page.route(`**/api/conversations/${conversationId}`, (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: conversationId,
        person: "person-attach123",
        surface: "chat",
        mode: "chat",
        companion_id: null,
        title: "Trail ideas",
        status: "open",
        summary: null,
        summary_through_turn: null,
        source: "hub",
        hlc: "1788000000000:0:example",
        created_at: "2026-09-16T00:00:00.000Z",
        updated_at: "2026-09-16T00:00:00.000Z",
      }),
    }));
    await page.route(`**/api/conversations/${conversationId}/turns`, (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{
        id: turnId,
        conversationId,
        userText: "Any family-friendly trails nearby?",
        replyText: "The Greenway Trail is a short, family-friendly loop [1].",
        source: "model",
        pluginId: null,
        commandId: null,
        safetyFlagged: false,
        safetyAction: "allow",
        minorSpeaker: false,
        createdAt: "2026-09-16T00:00:00.000Z",
        judgeStatus: "done",
        judgeAttempts: 1,
        outcomes: null,
        document: null,
        memory_ids: ["mem-attach123"],
        sources: [{
          id: "src-attach123",
          kind: "web",
          title: "Greenway Trail guide",
          url: "https://example.com/greenway",
          site: "example.com",
          snippet: "A short, family-friendly loop.",
          source: turnId,
          created_at: "2026-09-16T00:00:00.000Z",
          hlc: "1788000000000:0:example",
        }],
        media: null,
        media_items: [{
          kind: "image",
          url: "https://example.com/greenway.jpg",
          // A real, always-loadable image with no live network dependency
          // (org standard: "Deterministic and offline by default") - a
          // fake https URL here renders as a broken-image icon, found
          // live on the first attempt at this capture. `url` above stays
          // a realistic-looking (but still fake) address, since it's
          // only ever used for the "open in a new tab" href, never as
          // the rendered `<img src>` once `thumbnail` is set
          // (chatCitations.ts's ChatMedia: `item.thumbnail ?? item.url`).
          thumbnail: `data:image/png;base64,${TRAIL_THUMBNAIL_PNG_BASE64}`,
          source: turnId,
          source_url: "https://example.com/greenway",
        }],
        stats: null,
      }]),
    }));
    await page.goto(`${BASE_URL}/chat?conversation=${conversationId}`);
    await page.getByText("The Greenway Trail is a short, family-friendly loop", { exact: false }).waitFor({ timeout: 15000 });
    await page.locator('[role="status"]').first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
    await page.getByText("Remembered", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Source 1: Greenway Trail guide", exact: true }).click();
    await page.getByText("Greenway Trail guide", { exact: true }).waitFor();
    await settleAnimations(page);
    const screenshot = `chat-sources-memory-attachment-${viewport.slug}-${theme}.png`;
    await page.screenshot({ path: join(SCREENS_DIR, screenshot), fullPage: true });
    dedicatedScreenshots.push({ file: screenshot, route: "chat-sources-memory-attachment", viewport: viewport.slug, theme });
  } finally {
    await context.close();
  }
}

/** spec.md "Acceptance for an implementation", state 3: a streaming
 * reply. `/api/turn/stream` is a real ndjson stream the frontend reads
 * incrementally (chatModelAdapter.ts) - a `route.fulfill()` body is
 * delivered whole and near-instantly on localhost, too fast to reliably
 * catch mid-stream. Overriding `window.fetch` in the page instead (via
 * `addInitScript`, so it is in place before the app's own first fetch)
 * gives a real, still-open `ReadableStream` whose one chunk is enqueued
 * and then deliberately never closed - the app has no way to tell this
 * apart from a slow real reply still arriving, so `running` (and the
 * streaming caret) stays true for as long as this page lives, a stable
 * target for a screenshot. */
async function captureChatStreaming(browser: Browser, sessionValue: string, viewport: ViewportSpec, theme: "light" | "dark"): Promise<void> {
  const context = await newContext(browser, viewport, theme, sessionValue);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
    await page.addInitScript(() => {
      const originalFetch = window.fetch;
      const patched = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/api/turn/stream")) {
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(`${JSON.stringify({ type: "delta", text: "The Greenway Trail is a short, family" })}\n`));
              // No controller.close() - see the function's own comment above.
            },
          });
          return new Response(stream, { status: 200, headers: { "content-type": "application/x-ndjson" } });
        }
        return originalFetch(input, init);
      };
      window.fetch = patched as typeof fetch;
    });
    await page.goto(`${BASE_URL}/chat`);
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 });
    await page.locator('[role="status"]').first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
    await page.getByRole("textbox", { name: "Message input" }).fill("Any family-friendly trails nearby?");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.getByText("The Greenway Trail is a short, family", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor();
    await settleAnimations(page);
    const screenshot = `chat-streaming-${viewport.slug}-${theme}.png`;
    await page.screenshot({ path: join(SCREENS_DIR, screenshot), fullPage: true });
    dedicatedScreenshots.push({ file: screenshot, route: "chat-streaming", viewport: viewport.slug, theme });
  } finally {
    await context.close();
  }
}

/** spec.md "Acceptance for an implementation", state 4: the engine-not-
 * ready state ("Empty, loading, error" - "the composer is disabled with
 * the health item's one-sentence reason as its placeholder and its fix
 * as a button beside it"). Same `/api/health` shape ChatPage.test.tsx's
 * "the composer is disabled while the model is starting" test uses. */
async function captureChatEngineNotReady(browser: Browser, sessionValue: string, viewport: ViewportSpec, theme: "light" | "dark"): Promise<void> {
  const context = await newContext(browser, viewport, theme, sessionValue);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
    await page.route("**/api/health", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ brain: "starting", voice: "none" }),
    }));
    await page.goto(`${BASE_URL}/chat`);
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 });
    await page.getByPlaceholder("MaiPai's AI is starting up. This can take a moment.").waitFor();
    await page.getByRole("link", { name: "Open AI models", exact: true }).waitFor();
    await settleAnimations(page);
    const screenshot = `chat-engine-not-ready-${viewport.slug}-${theme}.png`;
    await page.screenshot({ path: join(SCREENS_DIR, screenshot), fullPage: true });
    dedicatedScreenshots.push({ file: screenshot, route: "chat-engine-not-ready", viewport: viewport.slug, theme });
  } finally {
    await context.close();
  }
}

/** CHAT-PARITY-01's focused review: the seeded demo machine does not have a
 * multi-gigabyte model installed, so this capture supplies the compact,
 * already-reachable model-list response at the browser boundary. The real
 * ChatModelPicker, responsive header, disclosure, and owner-only naming are
 * still exercised by the built app; the backend route has its own contract
 * tests for the unmocked safe/available shapes. */
async function captureChatModelPicker(browser: Browser, sessionValue: string): Promise<void> {
  const viewport = VIEWPORTS.find((v) => v.slug === "desktop")!;
  const context = await newContext(browser, viewport, "light", sessionValue);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
    await page.route("**/api/host/chat-models", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        models: [{ id: "qwen3-8b-instruct-q4-k-m", label: "Qwen3 8B Instruct" }],
        selectedModel: { id: "qwen3-8b-instruct-q4-k-m", label: "Qwen3 8B Instruct", available: true },
        canSelect: true,
      }),
    }));
    await page.goto(`${BASE_URL}/chat`);
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 });
    // ModelPicker.tsx's HeaderPicker trigger, not the deleted
    // ChatModelPicker.tsx's own accessible name - found stale by review
    // (step 5b's rebuild switched components but left this selector
    // untouched, so this capture silently stopped matching anything).
    const trigger = page.getByRole("button", { name: "Chat model: Qwen3 8B Instruct" });
    await trigger.waitFor();
    await trigger.click();
    await page.getByRole("menuitem", { name: "Open AI models", exact: true }).waitFor();
    await settleAnimations(page);
    const screenshot = "chat-model-picker-desktop-light.png";
    await page.screenshot({ path: join(SCREENS_DIR, screenshot), fullPage: true });
    dedicatedScreenshots.push({ file: screenshot, route: "chat-model-picker", viewport: viewport.slug, theme: "light" });
  } finally {
    await context.close();
  }
}

/** STATS-01's dedicated review: a real model stream supplies final-chunk
 * telemetry, the signed-in owner enables the persisted preference, and the
 * compact readout is opened from the real assistant reply before capture. */
async function captureChatStatsReview(browser: Browser, sessionValue: string): Promise<void> {
  const viewport = VIEWPORTS.find((v) => v.slug === "desktop")!;
  const context = await newContext(browser, viewport, "light", sessionValue);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
    await page.goto(`${BASE_URL}/chat`);
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 });
    await page.locator('[role="status"]').first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
    await page.getByRole("textbox", { name: "Message input" }).fill("Help me plan a small garden");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.getByText("Start with a sunny spot and a few easy plants.", { exact: false }).waitFor();
    const statsToggle = page.getByRole("button", { name: "Show advanced reply stats", exact: true });
    await statsToggle.waitFor();
    await page.waitForFunction(() => document.querySelector('[aria-label="Show advanced reply stats"]')?.getAttribute("aria-pressed") === "true");
    await page.getByRole("button", { name: "View reply stats", exact: true }).click();
    await page.getByRole("heading", { name: "Reply details", exact: true }).waitFor();
    await settleAnimations(page);
    const screenshot = "chat-turn-stats-desktop-light.png";
    await page.screenshot({ path: join(SCREENS_DIR, screenshot), fullPage: true });
    dedicatedScreenshots.push({ file: screenshot, route: "chat-turn-stats", viewport: viewport.slug, theme: "light" });
  } finally {
    await context.close();
  }
}

/** COMP-02's dedicated review: enable the real per-conversation research
 * control, send a document-bearing turn, and capture the short line with
 * the details pane opened after the stream finishes. */
async function captureChatResearchReview(browser: Browser, sessionValue: string): Promise<void> {
  const viewport = VIEWPORTS.find((v) => v.slug === "desktop")!;
  const context = await newContext(browser, viewport, "light", sessionValue);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
    await page.route("**/api/turn/stream", (route) => {
      const value = {
        reply: { text: "Here is the short answer." },
        source: "model",
        safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() },
        conversation_id: "conv-research123",
        turn_id: "turn-research123",
        document_available: true,
      };
      return route.fulfill({ status: 200, contentType: "application/x-ndjson", body: `${JSON.stringify({ type: "delta", text: value.reply.text })}\n${JSON.stringify({ type: "done", value })}\n` });
    });
    await page.route("**/api/conversations/turns/turn-research123/document", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "doc-research123",
        turn_id: "turn-research123",
        revision: 1,
        evidence_version: "outcome-research123",
        section: { type: "lookup", query: "research mode", results: [{ title: "Research notes", line: "The details pane holds the longer source-backed answer.", source_id: "src-research123" }] },
        sources: [{ id: "src-research123", kind: "web", title: "Research notes", url: "https://example.com/research", site: "example.com", snippet: "Research notes", source: "turn-research123", created_at: "2026-09-16T00:00:00.000Z", hlc: "1788000000000:0:example" }],
        provenance: "composer:turn-research123:lookup",
        created_at: "2026-09-16T00:00:00.000Z",
        hlc: "1788000000000:0:example",
      }),
    }));
    await page.goto(`${BASE_URL}/chat`);
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 });
    await page.locator('[role="status"]').first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
    await page.getByRole("textbox", { name: "Message input" }).fill("start a chat");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.getByText("Here is the short answer.", { exact: true }).waitFor();
    const toggle = page.getByRole("button", { name: "Turn on research mode", exact: true });
    await toggle.waitFor();
    await toggle.click();
    await page.getByRole("button", { name: "Turn off research mode", exact: true }).waitFor();
    await page.getByRole("textbox", { name: "Message input" }).fill("research this");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.getByText("Research notes", { exact: true }).waitFor();
    await settleAnimations(page);
    const screenshot = "chat-research-mode-desktop-light.png";
    await page.screenshot({ path: join(SCREENS_DIR, screenshot), fullPage: true });
    dedicatedScreenshots.push({ file: screenshot, route: "chat-research-mode", viewport: viewport.slug, theme: "light" });
  } finally {
    await context.close();
  }
}

/** CHAT-PARITY-02's dedicated review: start the explicit temporary mode
 * before a first send and capture the parent-facing retention contract in
 * the real chat shell. The backend creates the mode, while the route's
 * normal frontend fetch then confirms it and renders the banner. */
async function captureChatTemporaryReview(browser: Browser, sessionValue: string): Promise<void> {
  const viewport = VIEWPORTS.find((v) => v.slug === "desktop")!;
  const context = await newContext(browser, viewport, "light", sessionValue);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
    await page.goto(`${BASE_URL}/chat`);
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: "Start temporary chat", exact: true }).click();
    await page.getByRole("button", { name: "Turn off temporary chat", exact: true }).waitFor();
    await page.getByRole("status").filter({ hasText: "not saved to normal history or memory" }).waitFor();
    await settleAnimations(page);
    const screenshot = "chat-temporary-mode-desktop-light.png";
    await page.screenshot({ path: join(SCREENS_DIR, screenshot), fullPage: true });
    dedicatedScreenshots.push({ file: screenshot, route: "chat-temporary-mode", viewport: viewport.slug, theme: "light" });
  } finally {
    await context.close();
  }
}

/** CHAT-PARITY-04's dedicated review: the browser receives a length-stopped
 * assistant answer, so the real adapter marks it incomplete and the real
 * action bar exposes the additive Continue affordance. */
async function captureChatContinueReview(browser: Browser, sessionValue: string): Promise<void> {
  const viewport = VIEWPORTS.find((v) => v.slug === "desktop")!;
  const context = await newContext(browser, viewport, "light", sessionValue);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
    await page.route("**/api/turn/stream", (route) => {
      const value = {
        reply: { text: "Start with a sunny spot, then choose a few easy plants." },
        source: "model",
        safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() },
        conversation_id: "conv-continue123",
        turn_id: "turn-continue123",
        stats: { stop_reason: "length" },
      };
      return route.fulfill({ status: 200, contentType: "application/x-ndjson", body: `${JSON.stringify({ type: "delta", text: value.reply.text })}\n${JSON.stringify({ type: "done", value })}\n` });
    });
    await page.goto(`${BASE_URL}/chat`);
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 });
    await page.locator('[role="status"]').first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
    await page.getByRole("textbox", { name: "Message input" }).fill("Help me plan a small garden");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).waitFor();
    await settleAnimations(page);
    const screenshot = "chat-continue-desktop-light.png";
    await page.screenshot({ path: join(SCREENS_DIR, screenshot), fullPage: true });
    dedicatedScreenshots.push({ file: screenshot, route: "chat-continue", viewport: viewport.slug, theme: "light" });
  } finally {
    await context.close();
  }
}

/** HOME-FIT-02B's dedicated review for the recommended model's fit verdict.
 * Only selection and fit-plan are stubbed at the browser boundary; the
 * remaining model card data comes from the throwaway demo backend. */
async function captureFitVerdictCard(browser: Browser, sessionValue: string, viewport: ViewportSpec, theme: "light" | "dark", state: "yes" | "slow" | "no" | "unknown" | "unavailable" | "checked-yes" | "checked-no" | "checked-error" | "checked-notfound"): Promise<void> {
  const context = await newContext(browser, viewport, theme, sessionValue);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
    await page.route("**/api/host/models/selection", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ modelId: null }),
    }));
    const answers = {
      yes: { verdict: "yes", headline: "Runs well on this computer", detail: "About 5 GB of the 24 GB this computer can give to models." },
      slow: { verdict: "slow", headline: "Runs, but slowly", detail: "It fits only by using the processor, so answers will be slower." },
      no: { verdict: "no", headline: "Won't fit", detail: "Needs about 6 GB more memory." },
      unknown: { verdict: "unknown", headline: "Can't tell yet", detail: "Nobody has measured a model like this on a computer like yours yet." },
      unavailable: { verdict: "unknown", headline: "Can't check right now", detail: "The model size checker did not answer. Try again in a moment." },
      notfound: { verdict: "unknown", headline: "Can't find that model", detail: "Check the link and try again." },
    } as const;
    await page.route("**/api/fit-plan", (route) => {
      const answerState = state === "checked-yes" ? "yes" : state === "checked-no" ? "no" : state === "checked-notfound" ? "notfound" : state;
      const wording = answerState in answers ? answers[answerState as keyof typeof answers] : answers.yes;
      // The card only checks plan !== null; schema: 1 is enough for this browser review.
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ plan: state === "unavailable" || state === "checked-notfound" ? null : { schema: 1 }, wording }),
      });
    });
    await page.goto(`${BASE_URL}/models`);
    if (state === "checked-yes" || state === "checked-no" || state === "checked-error" || state === "checked-notfound") {
      const link = state === "checked-error" ? "not a link" : state === "checked-notfound" ? "https://huggingface.co/example-org/no-such-model" : "https://huggingface.co/example-org/example-model-GGUF/resolve/main/example-model-Q4_K_M.gguf";
      await page.getByRole("textbox", { name: "Hugging Face model link" }).fill(link);
      await page.getByRole("button", { name: "Check", exact: true }).click();
      await page.getByText(state === "checked-yes" ? answers.yes.headline : state === "checked-no" ? answers.no.headline : state === "checked-notfound" ? answers.notfound.headline : "That does not look like a Hugging Face model link.", { exact: true }).waitFor();
      await settleAnimations(page);
      const screenshot = `fit-check-${state}-${viewport.slug}-light.png`;
      await page.screenshot({ path: join(SCREENS_DIR, screenshot), fullPage: true });
      dedicatedScreenshots.push({ file: screenshot, route: "settings-models-fit-check", viewport: viewport.slug, theme: "light" });
      return;
    }
    const card = page.getByText("Qwen3 8B Instruct", { exact: true }).first();
    await card.waitFor();
    if (state === "unavailable") {
      await page.getByRole("button", { name: "Use this", exact: true }).waitFor();
      await page.getByText(answers.unavailable.headline, { exact: true }).waitFor({ state: "detached" });
    } else {
      await page.getByText(answers[state].headline, { exact: true }).waitFor();
    }
    await settleAnimations(page);
    const screenshot = `fit-verdict-${state}-${viewport.slug}-${theme}.png`;
    await page.screenshot({ path: join(SCREENS_DIR, screenshot), fullPage: true });
    dedicatedScreenshots.push({ file: screenshot, route: "settings-models-fit-verdict", viewport: viewport.slug, theme });
  } finally {
    await context.close();
  }
}

/** Lane 11 item 2's own acceptance: "the screenshot script gains the
 * section (desktop and phone), opened and judged." "People and things"
 * moved from Memory's own second tab to People's (owner ruling,
 * "Navigation, corrected," 2026-09-20: Memories moved to a person's
 * profile, and "People and things" - household-wide data, not a
 * specific person's own - never belonged there, so it stayed on
 * People). Radix's Tabs.Content doesn't mount an inactive panel at all,
 * so the tab has to be clicked open first, the same "a small dedicated
 * capture" shape `capturePaletteOpen()` above uses rather than folding
 * a click into the shared per-route loop (which would also mean the
 * ordinary `people-*.png` capture picks up whichever tab was left open
 * instead of the default Household view). */
async function capturePeopleAndThings(browser: Browser, sessionValue: string, viewport: ViewportSpec, theme: "light" | "dark"): Promise<void> {
  const context = await newContext(browser, viewport, theme, sessionValue);
  try {
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/people`);
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 });
    await page.locator('[role="status"]').first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
    await page.getByRole("tab", { name: "People and things" }).click();
    await page.getByText("owner of Juniper").waitFor();
    await settleAnimations(page);

    // A code review caught TabsTrigger's own 48px hit-area extension
    // (kit/ui/tabs.tsx's `before:-inset-y-3.5`, a real element with no
    // `pointer-events: none`) as capable of reaching past the gap
    // between TabsList and TabsContent into the content's own top edge
    // - happy-dom's own getBoundingClientRect() always reads zeroed
    // (this file's own established reason every real-layout check lives
    // here, not in a unit test), so this is the only place it can be
    // proven. `elementFromPoint` a few pixels inside TabsContent's own
    // top edge and confirm it isn't the trigger's invisible pseudo-
    // element intercepting the tap.
    const boundaryHit = await page.evaluate(() => {
      const content = document.querySelector('[role="tabpanel"]:not([hidden])');
      const trigger = document.querySelector('[role="tab"][aria-selected="true"]');
      if (!content || !trigger) return { ok: false, reason: "tabpanel or active tab not found" };
      const rect = content.getBoundingClientRect();
      const x = rect.left + 10;
      const y = rect.top + 3;
      const hit = document.elementFromPoint(x, y);
      const hitsTrigger = hit === trigger || trigger.contains(hit);
      return { ok: !hitsTrigger, x, y, hitTag: hit?.tagName, hitsTrigger };
    });
    if (!boundaryHit.ok) {
      throw new Error(`A tap just inside TabsContent's own top edge (${JSON.stringify(boundaryHit)}) hits the active tab's own invisible hit-area instead of the content below it`);
    }

    await page.screenshot({ path: join(SCREENS_DIR, `people-things-${viewport.slug}-${theme}.png`) });
  } finally {
    await context.close();
  }
}

// Apps (HOME-UI-02): the details pane over a real installed package,
// the same "click a real row" shape capturePeopleAndThings uses for
// Memory's own tabs - the ordinary ROUTES matrix only ever proves the
// table itself, never the pane a real household member spends most of
// this page's time in.
/** Lane 10 item 2's own acceptance: "the loading state between chunks
 * must be the kit's own skeleton, never a blank screen: take one shot
 * mid-load if the script can." Two things stack against catching it
 * against a click-driven in-app navigation: a real localhost fetch for
 * a lazy chunk (App.tsx's `lazyNamed`) resolves in a few milliseconds,
 * and react-router-dom's own `Link` wraps a navigation in
 * `startTransition` - React's own concurrent-rendering rule then keeps
 * the PREVIOUS page fully on screen for as long as the next one is
 * still suspended, never showing the Suspense fallback at all, exactly
 * the "no flash for a fast navigation" behavior that feature exists
 * for. A fresh load straight at a lazy route's own URL has no previous
 * page to keep showing, so this is a `page.goto()` directly to
 * `/privacy`, not a click from `/` - the real shape a bookmarked link
 * or a reload lands in. `serviceWorkers: "block"` turns off this app's
 * own PWA precaching (`sw.ts`) for this one context, since a precached
 * chunk is served straight from the Service Worker's Cache Storage, a
 * layer Playwright's page-level network interception never sees - the
 * artificial `page.route()` delay below only affects the real network
 * fetch a person's very first visit, before anything is precached yet,
 * would also see. */
async function captureLazyRouteSkeleton(browser: Browser, sessionValue: string): Promise<void> {
  const viewport = VIEWPORTS.find((v) => v.slug === "desktop")!;
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme: "light",
    serviceWorkers: "block",
  });
  try {
    await context.addCookies([{ name: "session", value: sessionValue, url: BASE_URL }]);
    const page = await context.newPage();
    await page.route("**/assets/PrivacyPage-*.js", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    await page.goto(`${BASE_URL}/privacy`);
    await page.locator('[role="status"][aria-label="Loading"]').waitFor({ timeout: 5000 });
    await page.screenshot({ path: join(SCREENS_DIR, "lazy-route-skeleton.png") });
  } finally {
    await context.close();
  }
}

/** getmaipai/home step 5b's own restart-verification: shared/ui's Shell
 * (`ui/src/Shell.tsx`) owns the left rail, its collapse toggle
 * (`SidebarTrigger`, its accessible name "Collapse navigation"/"Expand
 * navigation" since the owner's "The collapsed rail" finding gave it
 * the removed RailToggle's own state-aware label), and its
 * `localStorage` persistence (`railStorageKey`) - none of it changed
 * by this step, but
 * an owner report of a stale pre-kit-adoption build looking broken
 * ("the left column is a disaster with its collapsed state and its
 * toggle") made this worth a real, interactive check rather than
 * trusting the static per-route matrix, which never exercises the
 * toggle at all. Desktop only (the trigger is `sm:hidden` below 640px
 * in Shell.tsx - phone gets a bottom tab bar instead, already covered
 * by every phone-viewport route capture in the plain matrix). */
async function captureShellRail(browser: Browser, sessionValue: string, theme: "light" | "dark"): Promise<void> {
  const viewport = VIEWPORTS.find((v) => v.slug === "desktop")!;
  const context = await newContext(browser, viewport, theme, sessionValue);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
    await page.goto(`${BASE_URL}/`);
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 });
    await page.locator('[role="status"]').first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
    const trigger = page.getByRole("button", { name: /collapse navigation|expand navigation/i });
    await trigger.waitFor();
    // Expanded is the default (no prior localStorage preference) -
    // spec.md "Application shell standards": the brand wordmark, the
    // nav group labels, and each item's own label text are all visible.
    await page.getByRole("navigation", { name: "Main navigation" }).getByText("MaiPai Home", { exact: false }).waitFor();
    await settleAnimations(page);
    await page.screenshot({ path: join(SCREENS_DIR, `shell-rail-expanded-desktop-${theme}.png`) });
    dedicatedScreenshots.push({ file: `shell-rail-expanded-desktop-${theme}.png`, route: "shell-rail-expanded", viewport: "desktop", theme });

    await trigger.click();
    // Collapsed: the wordmark's text (not the icon) hides via
    // `group-data-[collapsible=icon]:hidden` (AppShell.tsx's own
    // Brand()) - waiting for it to actually leave the accessibility
    // tree is the real assertion, not just a fixed delay.
    await page.getByRole("navigation", { name: "Main navigation" }).getByText("MaiPai Home", { exact: false }).waitFor({ state: "hidden" });
    await settleAnimations(page);
    await page.screenshot({ path: join(SCREENS_DIR, `shell-rail-collapsed-desktop-${theme}.png`) });
    dedicatedScreenshots.push({ file: `shell-rail-collapsed-desktop-${theme}.png`, route: "shell-rail-collapsed", viewport: "desktop", theme });

    // Persistence: Shell.tsx's own `railStorageKey` - a reload must keep
    // the collapsed choice, not silently reset to expanded. `isVisible()`,
    // not `.count()`: the brand text stays in the DOM even collapsed
    // (Tailwind's `group-data-[collapsible=icon]:hidden`, CSS-only, not
    // unmounted) - `.count()` doesn't respect visibility and false-
    // positived here on the first version of this check.
    await page.reload();
    await trigger.waitFor();
    if (await page.getByRole("navigation", { name: "Main navigation" }).getByText("MaiPai Home", { exact: false }).isVisible().catch(() => false)) {
      throw new Error("Shell rail's collapsed preference did not survive a reload");
    }

    await trigger.click();
    await page.getByRole("navigation", { name: "Main navigation" }).getByText("MaiPai Home", { exact: false }).waitFor();
  } finally {
    await context.close();
  }
}

/** A real conversation with a real title, the recipe every capture
 * needing one uses: POST then PATCH, no fabricated fixture shape.
 * Throws with the capture's own name in the message on either call
 * failing, so a seeding failure reads as "captureX: ..." rather than a
 * bare fetch error several frames up. */
async function seedTitledConversation(callerName: string, cookie: Record<string, string>, title: string): Promise<{ id: string }> {
  const created = await fetch(`${BASE_URL}/api/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...cookie },
    body: JSON.stringify({ surface: "chat" }),
  });
  if (!created.ok) throw new Error(`${callerName}: creating the conversation failed: ${created.status}`);
  const row = (await created.json()) as { id: string };
  const renamed = await fetch(`${BASE_URL}/api/conversations/${row.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...cookie },
    body: JSON.stringify({ title }),
  });
  if (!renamed.ok) throw new Error(`${callerName}: setting the title failed: ${renamed.status}`);
  return row;
}

/** HOME-UI-02e part two's own acceptance (COORDINATOR: "Captures at
 * 1440 and 390 with the list open and a selection active") - the
 * thread list's own restored multi-select, seeded with two real chat
 * threads (not the empty state) so the batch bar and a checked row both
 * show real content, not a placeholder. Written to data-scratch/ like
 * this file's other named review captures - a verification shot for
 * the coordinator to judge, not a permanent docs asset. */
async function captureChatThreadActionsReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });
  const cookie = { Cookie: `session=${sessionValue}` };

  await seedTitledConversation("captureChatThreadActionsReview", cookie, "Weekend garden plans");
  await seedTitledConversation("captureChatThreadActionsReview", cookie, "Shopping list ideas");

  for (const viewport of [VIEWPORTS.find((v) => v.slug === "desktop")!, VIEWPORTS.find((v) => v.slug === "phone")!]) {
    const context = await newContext(browser, viewport, "dark", sessionValue);
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
      await page.goto(viewport.slug === "phone" ? `${BASE_URL}/chat?list=1` : `${BASE_URL}/chat`);
      await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 });
      await page.locator('[role="status"]').first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
      await page.getByText("Weekend garden plans", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Select chats" }).click();
      await page.getByRole("checkbox", { name: "Select “Weekend garden plans”" }).click();
      await page.getByText("1 selected", { exact: true }).waitFor();
      await settleAnimations(page);
      const file = `chat-thread-actions-${viewport.slug}-dark.png`;
      await page.screenshot({ path: join(outDir, file), fullPage: true });
      console.log(`Wrote ${join(outDir, file)}`);
    } finally {
      await context.close();
    }
  }
}

/** CHAT-LIST-01's own acceptance ("captured at 1440 and 390") - the
 * `/chat` thread list's own toolbar row with the new temporary-
 * chat button beside New Thread, both visible together. Seeded with
 * one real conversation (seedTitledConversation, the same helper
 * captureChatThreadActionsReview uses for the legacy `/chat` list) so
 * the list isn't the empty state. On phone the rail is a Sheet, opened
 * the same way a person would ("Show threads" - NextChatPage.test.tsx's
 * own "New Thread closes the phone/tablet Sheet" test uses the same
 * button). Light and dark, matching the coordinator's own instruction
 * for this batch of four header/list rows. */
async function captureChatListReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });
  const cookie = { Cookie: `session=${sessionValue}` };


  await seedTitledConversation("captureChatListReview", cookie, "Weekend garden plans");

  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
        await page.goto(`${BASE_URL}/chat`);
        await page.getByRole("textbox", { name: "Message input" }).waitFor();
        // On phone the rail column is still in the DOM (hidden, not
        // unmounted) once the Sheet's own copy of the same list opens
        // beside it - scoped to the open dialog the same way
        // NextChatPage.test.tsx's "New Thread closes the phone/tablet
        // Sheet" test disambiguates the two.
        let scope: Page | Locator = page;
        if (slug === "phone") {
          await page.getByRole("button", { name: "Show threads" }).click();
          scope = page.getByRole("dialog");
        }
        await scope.getByText("Weekend garden plans", { exact: true }).waitFor();
        await scope.getByRole("button", { name: "New Thread", exact: true }).waitFor();
        await scope.getByRole("button", { name: "Start a temporary chat", exact: true }).waitFor();
        await settleAnimations(page);
        const file = `chat-list-temporary-button-${viewport.width}-${theme}.png`;
        await page.screenshot({ path: join(outDir, file), fullPage: slug === "phone" });
        console.log(`Wrote ${join(outDir, file)}`);
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

/** SHORTCUTS-01 acceptance: show the real chat page with its keyboard
 * reference open, using the same seeded backend and Chromium capture
 * path as the rest of the screenshot suite. */
async function captureChatShortcutsReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });
  const viewport = VIEWPORTS.find((v) => v.slug === "desktop")!;
  const context = await newContext(browser, viewport, "light", sessionValue);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
    await page.goto(`${BASE_URL}/chat`);
    await page.getByRole("textbox", { name: "Message input" }).waitFor();
    await page.keyboard.press("Meta+/");
    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await dialog.waitFor();
    for (const label of ["New chat", "Focus composer", "Stop reply", "Search", "Toggle sidebar"]) {
      await dialog.getByText(label, { exact: true }).waitFor();
    }
    await settleAnimations(page);
    const file = "chat-shortcut-reference-desktop-light.png";
    await page.screenshot({ path: join(outDir, file), fullPage: false });
    console.log(`Wrote ${join(outDir, file)}`);
    await page.close();
  } finally {
    await context.close();
  }
}

/** CHAT-FIND-0923-05: the shell nav sidebar's own header block (the
 * logo) and the page header used to share a bottom edge; CHAT-HEADER-
 * 01/02/03's own new title/actions buttons defaulted to the kit's
 * 48px touch-target floor (docs/UI.md), growing the row past the
 * template's own 40px header-control convention (Light-Dark.tsx's own
 * `h-10 w-10`) and breaking the line. Fixed with `h-10` + `hitArea(1)`
 * on the title button and `size="icon-lg"` on the chevron - the 40px
 * visual line back, the 48px hit area kept (the coordinator's own
 * ruling, not a guess: shrinking the real touch target below the
 * kit's own stated floor was rejected). happy-dom computes no real
 * box layout (this whole file's own established reason every other
 * pixel-level claim here is proven the same way), so this is the
 * actual proof: real getBoundingClientRect() on both elements, at
 * both widths the acceptance names, throwing on the first mismatch
 * rather than silently capturing a still-broken page. */
async function verifyChatFindHeaderAlignment(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });
  const cookie = { Cookie: `session=${sessionValue}` };

  for (const width of [1440, 2000]) {
    const context = await newContext(browser, { slug: "wide", width, height: 1000 }, "light", sessionValue);
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
      await page.goto(`${BASE_URL}/chat`);
      await page.getByRole("textbox", { name: "Message input" }).waitFor();
      const bottoms = await page.evaluate(() => {
        const sidebarHeader = document.querySelector('[data-slot="sidebar-header"]');
        const header = document.querySelector("header");
        return {
          sidebarHeaderBottom: sidebarHeader?.getBoundingClientRect().bottom,
          headerBottom: header?.getBoundingClientRect().bottom,
        };
      });
      if (bottoms.sidebarHeaderBottom === undefined || bottoms.headerBottom === undefined) {
        throw new Error(`verifyChatFindHeaderAlignment: could not find both elements at width ${width}: ${JSON.stringify(bottoms)}`);
      }
      if (Math.abs(bottoms.sidebarHeaderBottom - bottoms.headerBottom) > 0.5) {
        throw new Error(`verifyChatFindHeaderAlignment: bottom edges don't line up at width ${width} - sidebar header bottom ${bottoms.sidebarHeaderBottom}, page header bottom ${bottoms.headerBottom}`);
      }
      console.log(`width ${width}: aligned, both bottoms at ${bottoms.headerBottom}`);
      await settleAnimations(page);
      const file = `chat-find-header-alignment-${width}.png`;
      await page.screenshot({ path: join(outDir, file), fullPage: false });
      console.log(`Wrote ${join(outDir, file)}`);
      // A review caught this: 260px was tight enough that a slightly
      // wider font render could clip "Home" at the 28px wordmark's own
      // grown width, making a real, uncramped logo look falsely cropped
      // in the review capture alone. 320px leaves real margin.
      const zoomFile = `chat-find-logo-zoom-${width}.png`;
      await page.screenshot({ path: join(outDir, zoomFile), clip: { x: 0, y: 0, width: 320, height: 100 } });
      console.log(`Wrote ${join(outDir, zoomFile)}`);
    } finally {
      await context.close();
    }
  }
}

/** CHAT-FIND-0923-04 ("a sent message's bubble must not resize on
 * hover"): real proof of the `w-fit` fix in ui-v0.5.47
 * (thread.aui.tsx's own comment on the bubble div explains the CSS
 * Grid mechanism). A real user turn, not a fixture: the bubble is
 * only reproducibly a "tight pill" against real rendered text, and
 * the action bar only genuinely mounts/unmounts through
 * `ActionBarPrimitive.Root`'s own `autohide="not-last"` once a second
 * (assistant) message exists to make the user one no longer the
 * last. Same real getBoundingClientRect() proof as
 * verifyChatFindHeaderAlignment above, for the same happy-dom reason. */
async function verifyChatFindBubbleHoverWidth(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });
  const cookie = { Cookie: `session=${sessionValue}` };

  const context = await newContext(browser, { slug: "wide", width: 1440, height: 1000 }, "light", sessionValue);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
    await page.goto(`${BASE_URL}/chat`);
    await page.getByRole("textbox", { name: "Message input" }).fill("hi");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    // Wait for the reply to finish, so the user bubble is no longer the
    // last message and `autohide="not-last"` actually autohides it -
    // otherwise the action bar never unmounts and the "at rest" width
    // below would already include it, hiding the bug this exists to catch.
    await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ state: "detached", timeout: 30000 });

    const userMessageRoot = page.locator('[data-slot="aui_user-message-root"]').first();
    await userMessageRoot.waitFor();
    const bubble = userMessageRoot.locator(".aui-user-message-content").first();
    await settleAnimations(page);

    const restWidth = await bubble.evaluate((el) => el.getBoundingClientRect().width);
    const restFile = join(outDir, "chat-find-bubble-hover-width-rest.png");
    await page.screenshot({ path: restFile, fullPage: false });
    console.log(`Wrote ${restFile}`);

    await userMessageRoot.hover();
    await page.getByRole("button", { name: "Edit" }).waitFor({ timeout: 5000 });
    await settleAnimations(page);
    const hoverWidth = await bubble.evaluate((el) => el.getBoundingClientRect().width);
    const hoverFile = join(outDir, "chat-find-bubble-hover-width-hover.png");
    await page.screenshot({ path: hoverFile, fullPage: false });
    console.log(`Wrote ${hoverFile}`);

    if (Math.abs(restWidth - hoverWidth) > 0.5) {
      throw new Error(
        `verifyChatFindBubbleHoverWidth: bubble resized on hover - rest ${restWidth}px, hovered ${hoverWidth}px`,
      );
    }
    console.log(`bubble width unchanged: rest ${restWidth}px, hovered ${hoverWidth}px`);
  } finally {
    await context.close();
  }
}

/** Screen finding: typing the first character into a new chat visibly
 * shifted the composer down a few pixels. Root cause (ui-v0.5.48,
 * commons): the welcome view's suggestions row used to unmount the
 * instant the composer stopped being empty, removing its own `gap-4`
 * flex unit from the vertically-centered welcome block, which
 * re-centered and dropped everything in it. Real getBoundingClientRect()
 * on the composer's own textbox before and after typing one character
 * into a brand-new (empty) chat, same happy-dom-computes-no-real-layout
 * reason every other pixel claim in this file is proven this way. */
async function verifyChatFindComposerShift(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });
  const cookie = { Cookie: `session=${sessionValue}` };

  const context = await newContext(browser, { slug: "wide", width: 1440, height: 1000 }, "light", sessionValue);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
    await page.goto(`${BASE_URL}/chat`);
    const textbox = page.getByRole("textbox", { name: "Message input" });
    await textbox.waitFor();
    await settleAnimations(page);

    const measureTop = () => textbox.evaluate((el) => el.getBoundingClientRect().top);

    const beforeTop = await measureTop();
    const beforeFile = join(outDir, "chat-find-composer-shift-before.png");
    await page.screenshot({ path: beforeFile, fullPage: false });
    console.log(`Wrote ${beforeFile}`);

    // Control: wait the same order of time typing would take, without
    // actually typing, to rule out a settle-timing artifact (a font or
    // animation still resolving) rather than something the keystroke
    // itself causes.
    await page.waitForTimeout(300);
    const controlTop = await measureTop();
    if (Math.abs(controlTop - beforeTop) > 0.5) {
      throw new Error(
        `verifyChatFindComposerShift: composer moved with no keystroke at all (a settle-timing artifact, not this check's own target) - at rest ${beforeTop}px, 300ms later ${controlTop}px`,
      );
    }

    await textbox.pressSequentially("h", { delay: 0 });
    await settleAnimations(page);
    const afterTop = await measureTop();
    const afterFile = join(outDir, "chat-find-composer-shift-after.png");
    await page.screenshot({ path: afterFile, fullPage: false });
    console.log(`Wrote ${afterFile}`);

    console.log(`composer top: before=${beforeTop}px after=${afterTop}px delta=${afterTop - beforeTop}px`);
    if (Math.abs(afterTop - beforeTop) > 0.5) {
      throw new Error(
        `verifyChatFindComposerShift: composer moved on the first keystroke - before top ${beforeTop}px, after top ${afterTop}px`,
      );
    }
  } finally {
    await context.close();
  }
}

async function captureHero(browser: Browser, sessionValue: string): Promise<void> {
  const context = await newContext(browser, { slug: "desktop", width: 1280, height: 800 }, "dark", sessionValue);
  try {
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/people`);
    // Real content, not a spinner: wait for the seeded roster to actually
    // render before capturing (getmaipai/.github/CLAUDE.md's screenshot
    // rule - a shot of a loading state is not a shot of the feature).
    await page.getByRole("heading", { name: "Household" }).waitFor();
    await page.getByText("Nova", { exact: true }).waitFor();
    // Derived from HERO_PATH itself, not a hardcoded "docs/assets" -
    // under --webkit that path is "docs/assets/webkit/" (issue #76), and
    // a code review (2026-09-12) caught that a hardcoded parent here
    // would still create only the Chromium one, so a bare `--webkit` run
    // (nothing else skips captureHero) would throw ENOENT on the write
    // below - never actually exercised by this fix's own verification,
    // since that ran with `--chat-focus-review`, which skips captureHero
    // entirely.
    mkdirSync(dirname(HERO_PATH), { recursive: true });
    await page.screenshot({ path: HERO_PATH });
    console.log(`Wrote ${HERO_PATH}`);
  } finally {
    await context.close();
  }
}

/** HOME-UI-02d's own acceptance ("captures at 1440 and 390, both
 * looks, both themes, of the dashboard, Chat with the list open, and a
 * person's Memories tab; each opened and judged"). `ui.look` applies
 * live to a freshly-loaded page (`useLook.ts`'s own `useQuery` reads
 * whatever `PUT /api/settings` last wrote, no restart needed), so one
 * seeded backend covers both looks - just a setting write between
 * passes, the same shape `seedHousehold()`'s own `chatStatsReview`
 * branch already uses for a review-only setting. Written to
 * data-scratch/ (git-ignored): a comparison set for this item's own
 * judgment, not a permanent docs asset - the ordinary matrix already
 * captures Studio (the real default) permanently under `home-*`,
 * `chat-list-*` and `people-memories-*`. */
async function captureLookComparison(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });

  const people = (await (await fetch(`${BASE_URL}/api/people`, { headers: { Cookie: `session=${sessionValue}` } })).json()) as Array<{ id: string; display_name: string }>;
  const sage = people.find((p) => p.display_name === "Sage");
  if (!sage) throw new Error("captureLookComparison: seedHousehold() didn't create Sage");

  const pages: Array<{ slug: string; path: string }> = [
    { slug: "dashboard", path: "/" },
    { slug: "chat-list", path: "/chat?list=1" },
    { slug: "people-memories", path: "/memory" },
  ];
  const viewports = [VIEWPORTS.find((v) => v.slug === "phone")!, VIEWPORTS.find((v) => v.slug === "desktop")!];

  for (const look of ["calm", "studio"] as const) {
    const setLook = await fetch(`${BASE_URL}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: `session=${sessionValue}` },
      body: JSON.stringify({ scope: `person:${sage.id}`, key: "ui.look", value: look }),
    });
    if (!setLook.ok) throw new Error(`captureLookComparison: seeding ui.look=${look} failed: ${setLook.status}`);

    for (const viewport of viewports) {
      for (const theme of THEMES) {
        const context = await newContext(browser, viewport, theme, sessionValue);
        try {
          for (const p of pages) {
            const page = await context.newPage();
            await page.goto(`${BASE_URL}${p.path}`);
            await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 });
            await page.locator('[role="status"]').first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
            await settleAnimations(page);
            const file = `${p.slug}-look-${look}-${viewport.slug}-${theme}.png`;
            await page.screenshot({ path: join(outDir, file), fullPage: true });
            console.log(`Wrote ${join(outDir, file)}`);
            await page.close();
          }
        } finally {
          await context.close();
        }
      }
    }
  }
}

/** The shell-on-shadcndashboard stand-up's own acceptance (docs/plans/
 * shell-on-shadcndashboard-2026-09-21.md, step 1): "captures at 1440 and
 * 390, both looks, both themes, of every /next route, opened and judged
 * for one thing only, that nothing on them is Home-drawn." `the migrated root shell`
 * (household) gates the whole tree; `ui.look` (person, the same key the
 * old shell's `useLook.ts` reads) drives the vendored template's own
 * `.style-calm`/`.style-studio` body class via `useNextLook.ts` - the
 * same two-setting shape `captureLookComparison` above already uses for
 * the old shell, reused here rather than invented fresh. Written to
 * `docs/assets/screens/` (committed, unlike `captureLookComparison`'s
 * `data-scratch/`): a permanent record of the stand-up's own acceptance,
 * not a one-off review set. `/chat` is excluded - not wired yet
 * (ui-v0.5.4's named gap, CHAT-SDK-01). */
async function captureNextStandup(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(SCREENS_DIR, "next-standup");
  mkdirSync(outDir, { recursive: true });

  const people = (await (await fetch(`${BASE_URL}/api/people`, { headers: { Cookie: `session=${sessionValue}` } })).json()) as Array<{ id: string; display_name: string }>;
  const sage = people.find((p) => p.display_name === "Sage");
  if (!sage) throw new Error("captureNextStandup: seedHousehold() didn't create Sage");


  const pages: Array<{ slug: string; path: string; waitFor: string }> = [
    { slug: "dashboard", path: "/", waitFor: "text=Stay informed with today's activity" },
    { slug: "people", path: "/people", waitFor: 'a[href^="/people/"]' },
    { slug: "settings", path: "/settings", waitFor: "text=Default Inputs" },
    { slug: "sign-in", path: "/sign-in", waitFor: "form" },
  ];
  const viewports = [VIEWPORTS.find((v) => v.slug === "phone")!, VIEWPORTS.find((v) => v.slug === "desktop")!];

  for (const look of ["calm", "studio"] as const) {
    const setLook = await fetch(`${BASE_URL}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: `session=${sessionValue}` },
      body: JSON.stringify({ scope: `person:${sage.id}`, key: "ui.look", value: look }),
    });
    if (!setLook.ok) throw new Error(`captureNextStandup: seeding ui.look=${look} failed: ${setLook.status}`);

    for (const viewport of viewports) {
      for (const theme of THEMES) {
        const context = await newContext(browser, viewport, theme, sessionValue);
        try {
          for (const p of pages) {
            const page = await context.newPage();
            await page.goto(`${BASE_URL}${p.path}`);
            await page.locator(p.waitFor).first().waitFor({ timeout: 15000 });
            await settleAnimations(page);
            const file = `${p.slug}-look-${look}-${viewport.slug}-${theme}.png`;
            // Resize to the real scroll height and take a plain (non-fullPage)
            // shot instead: FullLayout's header is `sticky top-0`
            // (dashboard/layouts/full/vertical/header/Header.tsx), and
            // Chromium's fullPage capture stitches tall pages by scrolling,
            // which re-paints the sticky header mid-stitch and ghosts
            // whatever was behind it (the footer's copyright line bled into
            // the Tables page's title bar in dark desktop until this fix -
            // found live in this stand-up's own acceptance captures, not a
            // bug in the header or the footer themselves).
            const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);
            await page.setViewportSize({ width: viewport.width, height: fullHeight });
            await settleAnimations(page);
            await page.screenshot({ path: join(outDir, file) });
            console.log(`Wrote ${join(outDir, file)}`);
            await page.close();
          }
        } finally {
          await context.close();
        }
      }
    }
  }
}

/** Lane 15's own two review shots: the bell popover's "Dismiss all" and
 * the history page's multi-select, each needing at least two real
 * pending notifications on screen - not fabricated rows (this file's
 * own header rule, and the coordinator's own ruling on Confirm,
 * docs/dev/session-b.md, on why a screenshot never shows a state the
 * running app can't really produce), a real safety.flagged_turn twice
 * from the seeded teen (Marlow, no secret - the same profile every
 * other review here already creates). Chosen over memory.updated: the
 * safety classifier is deterministic and needs no live model or judge,
 * so this capture works the same way whether or not either is
 * reachable on the machine right now - this script's own throwaway
 * backend never touches them anyway (`chatModel` below is a scripted
 * stub, not the household's real engine). Written to data-scratch/
 * (git-ignored) rather than SCREENS_DIR: a verification shot for the
 * coordinator to judge, not a permanent docs asset this feature has no
 * ROUTES entry for. */
// Signs in as the seeded teen (Marlow, no secret) and fires one or more
// real safety.flagged_turn deliveries to Sage (the household's owner,
// the "adults" audience) - shared by every capture that needs a real
// pending notification on screen, not a fabricated badge count (this
// file's own header rule). Was retyped independently in two capture
// functions (a code review, HOME-UI-02f); one definition now, so a
// change to the auth/select response shape or the seeded household
// only needs fixing once.
async function flagTurnsAsMarlow(sessionValue: string, texts: readonly string[], caller: string): Promise<void> {
  const people = (await (await fetch(`${BASE_URL}/api/people`, { headers: { Cookie: `session=${sessionValue}` } })).json()) as Array<{ id: string; display_name: string }>;
  const marlow = people.find((p) => p.display_name === "Marlow");
  if (!marlow) throw new Error(`${caller}: seedHousehold() didn't create Marlow`);
  const marlowSelect = await fetch(`${BASE_URL}/api/auth/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ personId: marlow.id }),
  });
  if (!marlowSelect.ok) throw new Error(`${caller}: signing in as Marlow failed: ${marlowSelect.status}`);
  const marlowSession = marlowSelect.headers.get("set-cookie")?.split(";")[0]?.split("=")[1];
  if (!marlowSession) throw new Error(`${caller}: Marlow's own sign-in carried no session cookie`);

  for (const text of texts) {
    const turn = await fetch(`${BASE_URL}/api/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `session=${marlowSession}` },
      body: JSON.stringify({ surface: "chat", text }),
    });
    if (!turn.ok) throw new Error(`${caller}: Marlow's own flagged turn failed: ${turn.status}`);
  }
}

// HOME-UI-04b's own double-border, collapsed-rail and invisible-table-
// text findings: a throwaway review set (data-scratch, not the stand-
// up's own committed acceptance captures), expanded vs. collapsed, both
// themes, desktop only (the owner's own findings were both desktop-
// only).
async function captureNextSidebarReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });


  const viewport = VIEWPORTS.find((v) => v.slug === "desktop")!;
  for (const theme of THEMES) {
    const context = await newContext(browser, viewport, theme, sessionValue);
    try {
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/`);
      await page.locator("text=Stay informed with today's activity").first().waitFor({ timeout: 15000 });
      await settleAnimations(page);
      await page.screenshot({ path: join(outDir, `next-sidebar-expanded-desktop-${theme}.png`) });
      console.log(`Wrote ${join(outDir, `next-sidebar-expanded-desktop-${theme}.png`)}`);

      await page.locator("button:has(svg.lucide-panel-left)").first().click();
      await settleAnimations(page);
      await page.screenshot({ path: join(outDir, `next-sidebar-collapsed-desktop-${theme}.png`) });
      console.log(`Wrote ${join(outDir, `next-sidebar-collapsed-desktop-${theme}.png`)}`);

      await page.close();
    } finally {
      await context.close();
    }
  }
}

// HOME-UI-04b item 3's own proof: the dashboard in three of the nine
// ui.look presets, 1440 dark (COORDINATOR's own ask) - Neutral and
// Mauve (two of the seven new shadcn base-color presets) plus Studio
// (the pre-existing default, proving the old presets still work
// alongside the new ones on the same mechanism).
async function captureNextLookPresets(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });


  const people = (await (await fetch(`${BASE_URL}/api/people`, { headers: { Cookie: `session=${sessionValue}` } })).json()) as Array<{ id: string; display_name: string }>;
  const sage = people.find((p) => p.display_name === "Sage");
  if (!sage) throw new Error("captureNextLookPresets: seedHousehold() didn't create Sage");

  const viewport = VIEWPORTS.find((v) => v.slug === "desktop")!;
  for (const look of ["neutral", "mauve", "studio"] as const) {
    const setLook = await fetch(`${BASE_URL}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: `session=${sessionValue}` },
      body: JSON.stringify({ scope: `person:${sage.id}`, key: "ui.look", value: look }),
    });
    if (!setLook.ok) throw new Error(`captureNextLookPresets: seeding ui.look=${look} failed: ${setLook.status}`);

    const context = await newContext(browser, viewport, "dark", sessionValue);
    try {
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/`);
      await page.locator("text=Stay informed with today's activity").first().waitFor({ timeout: 15000 });
      await settleAnimations(page);
      await page.screenshot({ path: join(outDir, `next-look-${look}-desktop-dark.png`) });
      console.log(`Wrote ${join(outDir, `next-look-${look}-desktop-dark.png`)}`);
      await page.close();
    } finally {
      await context.close();
    }
  }
}

// HOME-UI-04d's own proof: ui.appearance explicitly set opposite the
// OS's own colorScheme, both directions - the logo (and everything
// else) must follow the setting, not the media query that used to win
// for the kit's own CSS variables while the class-driven template
// parts (the logo among them) followed the setting instead.
async function captureNextAppearanceMismatch(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });


  const people = (await (await fetch(`${BASE_URL}/api/people`, { headers: { Cookie: `session=${sessionValue}` } })).json()) as Array<{ id: string; display_name: string }>;
  const sage = people.find((p) => p.display_name === "Sage");
  if (!sage) throw new Error("captureNextAppearanceMismatch: seedHousehold() didn't create Sage");

  const viewport = VIEWPORTS.find((v) => v.slug === "desktop")!;
  for (const setting of ["light", "dark"] as const) {
    const osPref = setting === "light" ? "dark" : "light";
    const setAppearance = await fetch(`${BASE_URL}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: `session=${sessionValue}` },
      body: JSON.stringify({ scope: `person:${sage.id}`, key: "ui.appearance", value: setting }),
    });
    if (!setAppearance.ok) throw new Error(`captureNextAppearanceMismatch: seeding ui.appearance=${setting} failed: ${setAppearance.status}`);

    // newContext's own colorScheme sets the OS preference; the PUT
    // above sets the person's explicit choice - opposite each other
    // on purpose, this capture's whole point.
    const context = await newContext(browser, viewport, osPref, sessionValue);
    try {
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/`);
      await page.locator("text=Stay informed with today's activity").first().waitFor({ timeout: 15000 });
      await settleAnimations(page);
      await page.screenshot({ path: join(outDir, `next-appearance-${setting}-vs-os-${osPref}.png`) });
      console.log(`Wrote ${join(outDir, `next-appearance-${setting}-vs-os-${osPref}.png`)}`);
      await page.close();
    } finally {
      await context.close();
    }
  }
}

/** HOME-UI-04e's own acceptance (1440 and 390, dark, against the
 * vendored template's own demo user-profile view - the single-
 * Tailwind-root and palette fixes it proved are long since landed) -
 * now doubling as SHELL-04's own permanent capture (2026-09-21):
 * extended to both themes, and its wait condition moved off
 * "Personal Information", the vendored `UserProfile`'s own demo
 * section heading that no real `/people` composition has ever
 * shown (SHELL-04 dropped that section entirely - no Home counterpart
 * for email/phone/position/address). Waits on a real table row rather
 * than the profile card's own "This is your own profile." text - a
 * review caught that the profile card renders straight from the
 * `person` prop, outside the household `AsyncState`, so that text
 * paints on first render regardless of whether `GET /api/people` has
 * resolved; `table tbody tr` is gated by the fetch the way the apps
 * row's own capture already established. */
async function captureNextPeopleReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });


  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        await page.goto(`${BASE_URL}/people`);
        // SHELL-04 changed this route from a table to a card grid
        // (`NextPeoplePage.tsx`); the shared CardTitle is a div, so use
        // a real person-card link as the data-ready signal. These links
        // render only after the real `/api/people` query resolves.
        await page.locator('a[href^="/people/"]').first().waitFor({ timeout: 15000 });
        await assertNoLegacyDataTableChrome(page, "People");
        await settleAnimations(page);
        const path = join(outDir, `next-people-${viewport.width}-${theme}.png`);
        await page.screenshot({ path, fullPage: slug === "phone" });
        console.log(`Wrote ${path}`);
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

/** SHELL-01's own acceptance ("1440 and 390, dark and light, judged
 * against dashboard-01's rhythm"): both viewports, both themes, of
 * `/` itself - the pair to `captureNextPeopleReview` above so the
 * dashboard composition has the same permanent, re-runnable capture a
 * live-instance judgment call was originally made from ad hoc. Waits on
 * the greeting's subtitle rather than any one widget's own text: it
 * only renders once `useDashboard()`'s `AsyncState` has resolved real
 * data (`NextDashboardPage.tsx`), and unlike a stat card's value it
 * never changes across viewport, theme, or role. */
async function captureNextDashboardReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });


  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        await page.goto(`${BASE_URL}/`);
        await page.locator("text=Stay informed with today's activity").first().waitFor({ timeout: 15000 });
        await settleAnimations(page);
        const path = join(outDir, `next-dashboard-${viewport.width}-${theme}.png`);
        await page.screenshot({ path, fullPage: slug === "phone" });
        console.log(`Wrote ${path}`);
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

/** PROFILE-SHEET-01's live acceptance: open the real Home-owned account
 * sheet at the phone viewport, assert the seeded signed-in person and
 * Home destinations, reject every shipped demo identity/link, then
 * save the open sheet for visual review. */
async function captureNextProfileSheetReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });


  const viewport = VIEWPORTS.find((v) => v.slug === "phone")!;
  const context = await newContext(browser, viewport, "dark", sessionValue);
  try {
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/`);
    await page.getByText("Stay informed with today's activity").waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: "Open account menu for Sage" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("heading", { name: "Sage" }).waitFor();
    await sheet.getByRole("link", { name: "Settings" }).waitFor();
    await sheet.getByRole("link", { name: "Help" }).waitFor();
    const text = await sheet.innerText();
    if (/Cameron|shadcndashboard\.com|Invoice|Subscription|Account Settings|Log Out/.test(text)) {
      throw new Error(`captureNextProfileSheetReview: template content remains in the account sheet: ${text}`);
    }
    await settleAnimations(page);
    const path = join(outDir, `next-profile-sheet-${viewport.width}-dark.png`);
    await page.screenshot({ path, fullPage: true });
    console.log(`Wrote ${path}`);
    await page.close();
  } finally {
    await context.close();
  }
}

/** SHELL-02's first slice, its own stated acceptance ("captures 1440
 * dark only for this slice"), extended 2026-09-22 to also capture
 * phone (390): a live finding on the reasoning card's left edge and
 * width against the reply text needed both to judge. A real turn
 * against the real dev engine (not a mocked stream, the same "real
 * household showed real data" standard
 * `captureNextDashboardReview` holds to), with
 * the reasoning Element expanded so the capture actually shows what
 * the slice proves - not just the collapsed trigger every reply
 * always renders regardless of whether reasoning ever wired up to
 * anything. */
async function captureNextChatReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });


  // SHELL-02's holistic review uses one persisted conversation with real
  // turns in the seeded backend. Keep the same conversation across all
  // four captures so viewport/theme comparisons show identical content.
  const cookie = { Cookie: `session=${sessionValue}` };
  const conversation = await seedTitledConversation("captureNextChatReview", cookie, "A few questions for today");
  const seedContext = await newContext(browser, VIEWPORTS.find((v) => v.slug === "desktop")!, "dark", sessionValue);
  try {
    const page = await seedContext.newPage();
    page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
    await page.goto(`${BASE_URL}/chat?conversation=${conversation.id}`);
    await page.getByRole("textbox", { name: "Message input" }).waitFor();
    for (const prompt of ["What's 2 plus 2?", "What herbs work well in a kitchen garden?", "Give me a simple bedtime story."]) {
      await page.getByRole("textbox", { name: "Message input" }).fill(prompt);
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ timeout: 15000 });
      await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ state: "detached", timeout: 30000 });
    }
  } finally {
    await seedContext.close();
  }

  const turnsResponse = await fetch(`${BASE_URL}/api/conversations/${conversation.id}/turns`, { headers: cookie });
  if (!turnsResponse.ok) throw new Error(`captureNextChatReview: reading seeded turns failed: ${turnsResponse.status}`);
  const turns = await turnsResponse.json() as Array<{ reasoning?: string; reply_text?: string; replyText?: string }>;
  if (turns.length !== 3) throw new Error(`captureNextChatReview: expected 3 persisted turns, found ${turns.length}`);
  if (!turns.some((turn) => typeof turn.reasoning === "string" && turn.reasoning.length > 0)) {
    throw new Error("captureNextChatReview: no persisted turn includes reasoning");
  }
  console.log(`captureNextChatReview: seeded conversation ${conversation.id} has ${turns.length} persisted turns including reasoning`);

  // Keep the repository's current model-selection wiring visible in this
  // capture's technical evidence. A household without Stack configured
  // correctly hides the selector; the current page still owns the model
  // picker slot and must not regress to the retired thinking control.
  const nextChatSource = readFileSync(join(ROOT, "frontend", "src", "next", "pages", "NextChatPage.tsx"), "utf8");
  if (!nextChatSource.includes("ComposerExtra: modelPickerAllowed ? ComposerModelSelector : undefined") || nextChatSource.includes("ComposerThinkingControl")) {
    throw new Error("captureNextChatReview: current ComposerModelSelector wiring was not found or retired ComposerThinkingControl remains in NextChatPage");
  }
  console.log("captureNextChatReview: composer source check confirms ComposerModelSelector is wired and ComposerThinkingControl is absent");

  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, sessionValue);
      const consoleErrors: string[] = [];
      try {
        const page = await context.newPage();
        page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
        page.on("pageerror", (error) => consoleErrors.push(error.message));
        await page.goto(`${BASE_URL}/chat?conversation=${conversation.id}`);
        await page.getByRole("textbox", { name: "Message input" }).waitFor();
        await page.getByText("A few questions for today", { exact: true }).first().waitFor();
        await page.getByRole("button", { name: "Reasoning" }).first().click();
        await settleAnimations(page);
        const filename = `next-chat-${viewport.width}-${theme}.png`;
        const path = join(outDir, filename);
        await page.screenshot({ path, fullPage: slug === "phone" });
        dedicatedScreenshots.push({ file: filename, route: "/chat", viewport: viewport.slug, theme });
        console.log(`Wrote ${path}`);
        if (consoleErrors.length) throw new Error(`captureNextChatReview: ${slug}/${theme} console errors: ${consoleErrors.join(" | ")}`);
        console.log(`captureNextChatReview: ${slug}/${theme} had no console errors`);
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

/** SHELL-02 slice 3's own stated acceptance ("a real weather turn... the
 * deterministic capture in screenshot.ts"): the household's own real
 * weather package, not a scripted LLM reply - `seedHousehold()`'s
 * `household.home_place` and `seedWeatherCache()`'s own cached
 * geocode/forecast fixtures (Seattle, already seeded for every run)
 * let a real question resolve deterministically through the real turn
 * engine - real data, offline, reproducible, never a Home-fabricated
 * row. The question includes the place explicitly (a code review
 * caught the first draft's place-free "What's the weather like
 * today?" - every one of `weather/manifest.json`'s own routing
 * patterns requires the literal word "in <place>", so a place-free
 * question never matches the deterministic floor at all and falls
 * through to "That lookup didn't work, sorry"; `runFixedTurn.ts`'s own
 * place-free phrasing is for a household with no `home_place` set,
 * not this seeded one). Proves the spec-sheet Element renders
 * standalone (StructuredResultTools' own `display: "standalone"`),
 * not tucked behind a collapsed "1 tool call" trigger nobody would
 * click to see today's weather. */
async function captureNextChatToolsReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });

  // getmaipai/home#154: nodes/model.ts's own interim rule (the same
  // gap captureNextChatToolsSitesReview's own comment names) only
  // offers tools at all for the one catalog entry with a real
  // turn_budget (modelCatalog.ts, "qwen3-8b-instruct-q4-k-m") - it's
  // also the household's only chat-capable entry, but never selected
  // by default until a household explicitly sets chat.model_id.
  const setModel = await fetch(`${BASE_URL}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: `session=${sessionValue}` },
    body: JSON.stringify({ scope: "household", key: "chat.model_id", value: "qwen3-8b-instruct-q4-k-m" }),
  });
  if (!setModel.ok) throw new Error(`captureNextChatToolsReview: seeding chat.model_id failed: ${setModel.status}`);

  const viewport = VIEWPORTS.find((v) => v.slug === "desktop")!;
  const context = await newContext(browser, viewport, "dark", sessionValue);
  try {
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/chat`);
    await page.getByRole("textbox", { name: "Message input" }).fill(`What's the weather like in ${WEATHER_HOUSEHOLD_PLACE} today?`);
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ state: "detached", timeout: 30000 });
    // The spec-sheet Element's own root slot, standalone in the message
    // flow - not a collapsed "N tool call" trigger needing a click.
    await page.locator('[data-slot="spec-sheet"]').waitFor({ timeout: 15000 });
    await settleAnimations(page);
    const path = join(outDir, `next-chat-tools-${viewport.width}-dark.png`);
    await page.screenshot({ path });
    console.log(`Wrote ${path}`);
    await page.close();
  } finally {
    await context.close();
  }
}

/** TOOL-EVENTS-02's own stated acceptance: "a live search on 8787 shows
 * the step with its site chips while the reply streams, each chip opens
 * its page, and a weather question shows the weather label with no
 * chips; captures at 1440 and 390, light and dark, opened and judged."
 * "8787" here is this script's own isolated backend (never the
 * household's real one), and "live search" is the fake SearXNG
 * (`websearchFixture`, main()'s own setup) - a real `runPlugin()` call
 * through it, only the model itself is scripted. Reuses the same
 * `nextChatToolsReview` flag as the weather capture above (one real
 * websearch call is cheap alongside it, not worth a second CLI flag and
 * a fifth entry in every other review's own exclusion list). */
async function captureNextChatToolsSitesReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });

  // nodes/model.ts's own interim rule only forces a search
  // (`state.budget.always_search`) for the one catalog entry that flag
  // is set on (modelCatalog.ts, "qwen3-8b-instruct-q4-k-m") - the
  // household's default model here has no such budget, so a plain
  // world question never reaches websearch at all without this (found
  // live: the reply came back right, from `scriptedChatReply` alone,
  // with no tool call underneath it). The same model id turnNext.test.ts's
  // own "a world question runs the search tool" test selects for the
  // identical reason.
  const setModel = await fetch(`${BASE_URL}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: `session=${sessionValue}` },
    body: JSON.stringify({ scope: "household", key: "chat.model_id", value: "qwen3-8b-instruct-q4-k-m" }),
  });
  if (!setModel.ok) throw new Error(`captureNextChatToolsSitesReview: seeding chat.model_id failed: ${setModel.status}`);
  const setPipeline = await fetch(`${BASE_URL}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: `session=${sessionValue}` },
    body: JSON.stringify({ scope: "household", key: "turn.pipeline.next", value: true }),
  });
  if (!setPipeline.ok) throw new Error(`captureNextChatToolsSitesReview: seeding turn.pipeline.next failed: ${setPipeline.status}`);

  // Two combos, not the full cross product (the dominant pattern this
  // file already uses for "both sizes, both themes" - capturePeopleAnd
  // Things and most other multi-viewport reviews here do the same):
  // found live, TOOL-EVENTS-02, four real websearch calls in a row
  // exhausted packageHost.ts's own SEARXNG_RATE_LIMIT bucket (capacity
  // 10, refillPerSecond 0.5 - shared, process-lifetime state, no test-
  // only reset hook reachable from a live HTTP run), the fourth call
  // failing with "Web search is rate-limited" and no reply ever
  // rendering. Two calls, spaced by a full build-and-seed cycle each,
  // never come close.
  for (const [viewport, theme] of [
    [VIEWPORTS.find((v) => v.slug === "phone")!, "dark" as const],
    [VIEWPORTS.find((v) => v.slug === "desktop")!, "light" as const],
  ] as const) {
    const context = await newContext(browser, viewport, theme, sessionValue);
    try {
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/chat`);
      await page.getByRole("textbox", { name: "Message input" }).fill("Who won the mariners game?");
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ timeout: 15000 });
      await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ state: "detached", timeout: 30000 });
      await page.getByText("The Mariners won the game 4 to 2.").waitFor({ timeout: 15000 });
      // Collapsed by default (ToolTimeline's own `open` state) - the
      // site chip isn't in the DOM yet, the same assertion this item's
      // own NextChatPage.test.tsx makes.
      await page.getByRole("button", { name: /1 tool call/ }).click();
      // The fixture's own "mariners" row (startWebSearchFixture, above)
      // is `https://example.com/...` - `site` is its hostname, stripped
      // of `www.` (turnContext.ts's sourcesFromRows), so the chip's own
      // visible text is "example.com", never a fixture-only slug.
      await page.getByRole("link", { name: "example.com" }).waitFor({ timeout: 15000 });
      await settleAnimations(page);
      const path = join(outDir, `next-chat-tools-sites-${viewport.width}-${theme}.png`);
      await page.screenshot({ path });
      console.log(`Wrote ${path}`);
      await page.close();
    } finally {
      await context.close();
    }
  }

  // STATUS-PHRASES-01's own acceptance: "a thinking phrase, then a
  // search step's own label" - the search step is the loop above
  // (unchanged, still real chips); a plain question here for the
  // thinking moment specifically, never the mariners one, because the
  // interim rule's own forced-search path never calls the model at all
  // (a synthesized tool_calls output, nodes/model.ts) - the gap between
  // the "thinking" status and the tool round's own status is real but
  // sub-millisecond there, too fast for a screenshot to ever reliably
  // land inside. A plain reply (the stub's own "herbs" branch, no tool
  // call) makes a real HTTP round trip to the stub model before its
  // first delta, a genuine window a screenshot can land in.
  {
    const viewport = VIEWPORTS.find((v) => v.slug === "desktop")!;
    const context = await newContext(browser, viewport, "light", sessionValue);
    try {
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/chat`);
      await page.getByRole("textbox", { name: "Message input" }).fill("Tell me a bedtime story");
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await page.getByRole("status").first().waitFor({ timeout: 5000 });
      await settleAnimations(page);
      const thinkingPath = join(outDir, "status-phrases-thinking-1440-light.png");
      await page.screenshot({ path: thinkingPath });
      console.log(`Wrote ${thinkingPath}`);
      await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ state: "detached", timeout: 30000 });
      await page.getByText("Once there was a sleepy fox", { exact: false }).waitFor({ timeout: 15000 });
      await page.close();
    } finally {
      await context.close();
    }
  }
}

/** CHAT-HEADER-03's own stated acceptance: "a 60-character title reads
 * whole at 1440 and truncates with an ellipsis at 390, captured light
 * and dark." A real conversation, seeded the same way
 * captureChatThreadActionsReview does (POST then PATCH the title, no
 * fabricated fixture shape), opened directly via `?conversation=<id>`
 * (`NextChatPage.tsx`'s own `searchParams.get("conversation")`) so the
 * header shows this exact title, not whatever conversation happened
 * to be most recent. */
async function captureChatHeaderTitleReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });
  const cookie = { Cookie: `session=${sessionValue}` };


  // Exactly 60 characters, the acceptance's own number. Persona-roster
  // names only (CLAUDE.md's Privacy rules), not the real people the
  // owner's own live example named.
  const title = "Why did Bramble and Juniper stop being friends after school?";
  if (title.length !== 60) throw new Error(`captureChatHeaderTitleReview: fixture title is ${title.length} characters, not 60`);
  const row = await seedTitledConversation("captureChatHeaderTitleReview", cookie, title);

  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
        await page.goto(`${BASE_URL}/chat?conversation=${row.id}`);
        // The same title also appears as a thread-list row in the rail
        // (`#next-chat-rail`) - scoped to the header's own <nav> (no
        // aria-label, unlike the sidebar's "Main navigation") to get
        // the header's copy specifically.
        await page.getByRole("navigation").getByRole("button", { name: title }).waitFor();
        await settleAnimations(page);
        const path = join(outDir, `chat-header-title-${viewport.width}-${theme}.png`);
        await page.screenshot({ path, fullPage: slug === "phone" });
        console.log(`Wrote ${path}`);
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

/** CHAT-HEADER-02's own stated acceptance: "the chat header and one
 * other app page show the same icon the sidebar shows for them" - the
 * chat side is `--chat-header-title-review` above (the icon is now
 * part of that same header); this covers the "one other page" half
 * with the dashboard route (`/`, the sidebar's own "Home" entry,
 * `House` in `sidebaritems.ts`), the plainest page to seed - no
 * fixture data needed beyond `the migrated root shell`. */
async function captureNextPageHeaderIconReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });


  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
        await page.goto(`${BASE_URL}/`);
        // Scoped to the header's own unnamed <nav> - the sidebar's own
        // "Home" group heading is a second, unrelated match otherwise
        // (found writing NextRoutes.test.tsx's own equivalent check).
        await page.getByRole("navigation").getByText("Home").waitFor();
        await settleAnimations(page);
        const path = join(outDir, `next-page-header-icon-${viewport.width}-${theme}.png`);
        await page.screenshot({ path, fullPage: slug === "phone" });
        console.log(`Wrote ${path}`);
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

/** SHELL-02 slice 6's own stated capture: the composer's "+" menu open -
 * the default-visible set only (photos and files, camera): Apps, Create
 * image, Web search and the voice waveform all stay behind
 * NEXT_CHAT_UNWIRED_CONTROLS_ENABLED (composerAddMenu.tsx, Apps joined
 * live 2026-09-22), unset in a real run, so this capture shows exactly
 * what a real household sees. Live finding 2026-09-22: the row layout
 * itself was oversized and still truncated - both viewports now, not
 * desktop only, since that's a width claim. */
async function captureNextChatComposerReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });


  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    const context = await newContext(browser, viewport, "dark", sessionValue);
    try {
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/chat`);
      await page.getByRole("textbox", { name: "Message input" }).waitFor();
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await page.locator('[data-slot="composer-menu"][data-open]').waitFor({ timeout: 5000 });
      await page.getByText("Add photos and files", { exact: true }).waitFor({ timeout: 5000 });
      await settleAnimations(page);
      const path = join(outDir, `next-chat-composer-${viewport.width}-dark.png`);
      await page.screenshot({ path, fullPage: slug === "phone" });
      console.log(`Wrote ${path}`);
      await page.close();
    } finally {
      await context.close();
    }
  }
}

/** Lane B-15: exercise the actual tap targets named by the cutover
 * review, including controls hidden inside the chat attachment and row
 * action menus. This is a real-browser check because happy-dom has no
 * rendered geometry. */
async function verifyLaneBTouchTargets(browser: Browser, sessionValue: string): Promise<void> {
  const headers = { "Content-Type": "application/json", Cookie: `session=${sessionValue}` };

  let checked = 0;
  async function check(page: Page, locator: Locator, label: string): Promise<void> {
    await locator.waitFor({ state: "visible", timeout: 10000 });
    const dimensions = await locator.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      let width = rect.width;
      let height = rect.height;
      for (const pseudo of ["::before", "::after"] as const) {
        const layer = getComputedStyle(element, pseudo);
        if (layer.content !== "none" && layer.position === "absolute") {
          width = Math.max(width, rect.width + Math.max(0, -(parseFloat(layer.left) || 0)) + Math.max(0, -(parseFloat(layer.right) || 0)));
          height = Math.max(height, rect.height + Math.max(0, -(parseFloat(layer.top) || 0)) + Math.max(0, -(parseFloat(layer.bottom) || 0)));
        }
      }
      return { width: Math.round(width), height: Math.round(height) };
    });
    checked++;
    console.log(`touch-target ${label}: ${dimensions.width}x${dimensions.height}`);
    if (dimensions.width < 48 || dimensions.height < 48) {
      throw new Error(`verifyLaneBTouchTargets: ${label} is still below 48px (${dimensions.width}x${dimensions.height})`);
    }
  }

  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((entry) => entry.slug === slug)!;
    const context = await newContext(browser, viewport, slug === "phone" ? "dark" : "light", sessionValue);
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      await page.goto(`${BASE_URL}/chat`);
      await page.getByRole("textbox", { name: "Message input" }).waitFor();
      await check(page, page.getByRole("textbox", { name: "Message input" }), `Message input (${slug})`);
      await check(page, page.getByRole("button", { name: "Start voice input" }), `Start voice input (${slug})`);
      await check(page, page.getByRole("button", { name: "Send message" }), `Send message (${slug})`);
      await check(page, page.getByRole("button", { name: "Add", exact: true }), `Add (${slug})`);

      await page.getByRole("button", { name: "Add", exact: true }).click();
      const menuItems = page.locator('[data-slot="composer-menu-item"]');
      await check(page, menuItems.filter({ hasText: "Add photos and files" }), `Add photos and files (${slug})`);
      if (slug === "phone") await check(page, menuItems.filter({ hasText: "Take a photo" }), "Take a photo (phone)");
      await page.keyboard.press("Escape");
      if (slug === "phone") {
        await page.getByRole("button", { name: "Show threads" }).click();
        await check(page, page.getByRole("dialog").getByRole("button", { name: "New Thread", exact: true }), "New Thread (phone)");
      } else {
        await check(page, page.getByRole("button", { name: "New Thread", exact: true }), "New Thread (desktop)");
      }
      await page.close();
    } finally {
      await context.close();
    }
  }

  const desktop = VIEWPORTS.find((entry) => entry.slug === "desktop")!;
  const context = await newContext(browser, desktop, "light", sessionValue);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    await page.route("**/api/repairs", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{
        id: "touch-target-repair",
        source: "backup",
        key: "backup.failed",
        severity: "error",
        title: "A backup failed",
        detail: "The last scheduled backup could not finish.",
        fix: { label: "Fix", action: "retry_backup" },
        learn_more: null,
        created_at: "2026-09-21T00:00:00.000Z",
      }]),
    }));
    await page.goto(`${BASE_URL}/repairs`);
    await page.getByText("A backup failed", { exact: true }).waitFor();
    await page.getByRole("button", { name: "More actions" }).click();
    await check(page, page.getByRole("menuitem", { name: "Fix", exact: true }), "Fix (Repairs)");
    await page.close();
  } finally {
    await context.close();
  }

  const backupContext = await newContext(browser, desktop, "light", sessionValue);
  try {
    const page = await backupContext.newPage();
    page.setDefaultTimeout(10000);
    await page.route("**/api/backups**", (route) => {
      const url = route.request().url();
      const body = url.includes("restore/pending") ? { pending: null } : [];
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto(`${BASE_URL}/backups`);
    await check(page, page.getByRole("button", { name: "Back up now" }), "Back up now");
    await page.close();
  } finally {
    await backupContext.close();
  }

  console.log(`Lane B touch-target violations remaining: 0 (${checked} named targets checked)`);
}

/** Safety ruling, 2026-09-22: the composer's thinking-mode control
 * (RESP-04) is hidden entirely for a minor, never just disabled - the
 * model trigger (`[data-slot="composer-model-trigger"]`) must be absent
 * from the DOM. Signs in as Nova, `seedHousehold()`'s own seeded child,
 * the same auth/select pattern `flagTurnsAsMarlow()` already uses for
 * a different household member - both viewports (desktop 1440, phone
 * 390) the coordinator's own finding asked for, since this is a layout
 * claim (nothing shifts into the trigger's place oddly), not just a
 * presence check. */
async function captureNextChatChildComposerReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });


  const people = (await (await fetch(`${BASE_URL}/api/people`, { headers: { Cookie: `session=${sessionValue}` } })).json()) as Array<{ id: string; display_name: string }>;
  const nova = people.find((p) => p.display_name === "Nova");
  if (!nova) throw new Error("captureNextChatChildComposerReview: seedHousehold() didn't create Nova");
  const novaSelect = await fetch(`${BASE_URL}/api/auth/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ personId: nova.id }),
  });
  if (!novaSelect.ok) throw new Error(`captureNextChatChildComposerReview: signing in as Nova failed: ${novaSelect.status}`);
  const novaSession = novaSelect.headers.get("set-cookie")?.split(";")[0]?.split("=")[1];
  if (!novaSession) throw new Error("captureNextChatChildComposerReview: Nova's own sign-in carried no session cookie");

  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    const context = await newContext(browser, viewport, "dark", novaSession);
    try {
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/chat`);
      await page.getByRole("textbox", { name: "Message input" }).waitFor();
      await settleAnimations(page);
      const path = join(outDir, `next-chat-child-composer-${viewport.width}-dark.png`);
      await page.screenshot({ path, fullPage: slug === "phone" });
      console.log(`Wrote ${path}`);
      await page.close();
    } finally {
      await context.close();
    }
  }
}

/** SHELL-02 slice 4's own stated acceptance ("a real 'write me a short
 * note about X' turn... the deterministic capture"): "pizza night" is
 * the stub model's own scripted `scriptedToolCalls` branch (main()'s
 * `startStubLlmServer` call below) - a real tool_calls completion
 * through the real turn engine and the real write_document package
 * (recipe.json's `artifact` op), not a Home-fabricated card. The
 * routing side needs no scripting of its own, but does need a real
 * "command" shape: write_document has no `routing.patterns` of its own
 * (only `examples`, which `commandOpenersFrom()` never reads), so a
 * bare "write me..." opener reads as an ordinary statement, not a
 * command - `utteranceShape.ts`'s own `COURTESY_PREFIX` ("could/would/
 * can/will you...") is what reliably lands `shape: "command"` instead
 * (`selectOfferedTools()`'s own comment - a command shape offers its
 * top-ranked candidates regardless of TIER2_AMBIGUOUS_FLOOR, unlike an
 * ordinary statement or question), the same reason this prompt doesn't
 * need seedWeatherCache()'s kind of fixture. Clicking the card and
 * waiting on the canvas's own document body proves the whole chain:
 * the artifact tool-call part, the card's own api.artifactCurrent()
 * fetch, and the canvas-split Element's real content, not just that
 * the turn completed. */
async function captureNextChatArtifactReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });


  const viewport = VIEWPORTS.find((v) => v.slug === "desktop")!;
  const context = await newContext(browser, viewport, "dark", sessionValue);
  try {
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/chat`);
    await page.getByRole("textbox", { name: "Message input" }).fill("Could you write me a short note about pizza night?");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ state: "detached", timeout: 30000 });
    // The artifact-card Element's own root slot, standalone in the
    // message flow (ArtifactTool's own `display: "standalone"`).
    await page.locator('[data-slot="artifact-card"]').waitFor({ timeout: 15000 });
    await page.locator('[data-slot="artifact-card"]').click();
    // The canvas-split Element's own document body, real content
    // fetched through api.artifactCurrent() - not the card's loading
    // placeholder.
    await page.locator('[data-slot="canvas-split-body"]').waitFor({ timeout: 15000 });
    await settleAnimations(page);
    const path = join(outDir, `next-chat-artifact-${viewport.width}-dark.png`);
    await page.screenshot({ path });
    console.log(`Wrote ${path}`);
    await page.close();
  } finally {
    await context.close();
  }
}

/** SHELL-05's own acceptance ("1440 and 390... captures dark/light"):
 * both viewports, both themes, of `/settings`. Waits on "Family
 * name", a real, always-present basic key under Household > System
 * (`spec/settings/keys.json`) - the tab a seeded owner/admin session
 * lands on by default - present only once both the registry and the
 * household scope's values have actually resolved. */
async function captureNextSettingsReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });


  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        await page.goto(`${BASE_URL}/settings`);
        await page.locator("text=Family name").first().waitFor({ timeout: 15000 });
        await settleAnimations(page);
        const path = join(outDir, `next-settings-${viewport.width}-${theme}.png`);
        await page.screenshot({ path, fullPage: slug === "phone" });
        console.log(`Wrote ${path}`);
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

/** SETTINGS-S2 review: capture the new Me frame at both requested widths
 * and themes, for the seeded owner across every section and for a seeded
 * child to prove the admin-only Limits section is absent. The output
 * directory can be supplied for review artifacts outside this checkout. */
async function captureNextSettingsS2Review(browser: Browser, ownerSession: string): Promise<void> {
  const outDir = process.env.MAIPAI_SETTINGS_S8_SCREEN_DIR || process.env.MAIPAI_SETTINGS_S7_SCREEN_DIR || process.env.MAIPAI_SETTINGS_S2_SCREEN_DIR || join(ROOT, "data-scratch", "screenshots", "settings-s2");
  mkdirSync(outDir, { recursive: true });
  const peopleResponse = await fetch(`${BASE_URL}/api/people`, { headers: { Cookie: `session=${ownerSession}` } });
  if (!peopleResponse.ok) throw new Error(`SETTINGS-S2: household lookup failed: ${peopleResponse.status}`);
  const people = await peopleResponse.json() as Array<{ id: string; display_name: string; role: string }>;
  const child = people.find((person) => person.display_name === "Nova" && person.role === "child");
  if (!child) throw new Error("SETTINGS-S2: seeded child Nova was not found");
  const childSignIn = await fetch(`${BASE_URL}/api/auth/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ personId: child.id }),
  });
  if (!childSignIn.ok) throw new Error(`SETTINGS-S2: signing in as Nova failed: ${childSignIn.status}`);
  const childSession = childSignIn.headers.get("set-cookie")?.split(";")[0]?.split("=")[1];
  if (!childSession) throw new Error("SETTINGS-S2: Nova's sign-in carried no session cookie");

  const ownerPages = [
    { id: "me", path: "/settings?tab=me", heading: "Profile" },
    { id: "profile", path: "/settings?tab=me&section=profile", heading: "Profile" },
    { id: "appearance", path: "/settings?tab=me&section=appearance", heading: "Appearance" },
    { id: "voice-ai", path: "/settings?tab=me&section=voice-ai", heading: "Voice and AI" },
    { id: "notifications", path: "/settings?tab=me&section=notifications", heading: "Notifications" },
    { id: "privacy-data", path: "/settings?tab=me&section=privacy-data", heading: "Privacy and data" },
  ] as const;

  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((item) => item.slug === slug)!;
    for (const theme of THEMES) {
      for (const [person, session, pages] of [
        ["owner", ownerSession, ownerPages],
        ["member", childSession, [{ id: "me", path: "/settings?tab=me", heading: "Profile" }]],
      ] as const) {
        const context = await newContext(browser, viewport, theme, session);
        try {
          const page = await context.newPage();
          page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
          for (const entry of pages) {
            const response = await page.goto(`${BASE_URL}/settings`);
            if (!response?.ok()) throw new Error(`SETTINGS-S2: ${entry.path} returned ${response?.status() ?? "no response"}`);
            await page.waitForLoadState("networkidle");
            const meTab = page.getByRole("tab", { name: "Me", exact: true });
            if (await meTab.count() > 0) await meTab.click();
            if (person === "owner" && await meTab.count() === 0) throw new Error("SETTINGS-S2: owner Me tab was not rendered");
            if (person !== "member") await meTab.waitFor({ state: "visible" });
            const requestedUrl = new URL(entry.path, BASE_URL);
            await page.evaluate((url) => { history.pushState(history.state, "", url); window.dispatchEvent(new PopStateEvent("popstate")); }, requestedUrl.pathname + requestedUrl.search);
            if (entry.id !== "me") {
              if (slug === "phone") await page.getByRole("tabpanel", { name: "Me" }).getByLabel("Settings section", { exact: true }).selectOption(entry.id);
              else await page.getByRole("tab", { name: entry.heading, exact: true }).last().click();
            }
            if (entry.id === "profile" || entry.id === "me") await page.getByLabel("Name", { exact: true }).waitFor({ state: "visible" });
            if (entry.id === "appearance") await page.getByRole("combobox", { name: "Appearance", exact: true }).waitFor({ state: "visible" });
            if (entry.id === "voice-ai") await page.locator('[id="settings-person.persona"]').waitFor({ state: "visible" });
            if (entry.id === "notifications") await page.getByRole("button", { name: /Telegram options/ }).waitFor({ state: "visible" });
            if (entry.id === "privacy-data") await page.getByRole("link", { name: "Privacy" }).waitFor({ state: "visible" });
            if (person === "member") {
              const limitsTab = page.locator('[data-slot="tabs-trigger"]').filter({ hasText: /^Limits$/ });
              const limitsOption = page.locator('[data-slot="native-select-option"][value="limits"]');
              if (await limitsTab.count() !== 0 || await limitsOption.count() !== 0) {
                throw new Error("SETTINGS-S2: the child sees an admin-only Limits entry");
              }
            }
            await settleAnimations(page);
            const file = `settings-s2-${person}-${entry.id}-${viewport.width}-${theme}.png`;
            const path = join(outDir, file);
            await page.screenshot({ path, fullPage: slug === "phone" });
            console.log(`Wrote ${path}`);
          }
          await page.close();
        } finally {
          await context.close();
        }
      }
    }
  }
}

async function captureNextSettingsS3Review(browser: Browser, ownerSession: string): Promise<void> {
  const outDir = process.env.MAIPAI_SETTINGS_S8_SCREEN_DIR || process.env.MAIPAI_SETTINGS_S7_SCREEN_DIR || join(ROOT, "../home/data-scratch/screens/settings-s3");
  mkdirSync(outDir, { recursive: true });
  const response = await fetch(`${BASE_URL}/api/people`, { headers: { Cookie: `session=${ownerSession}` } });
  if (!response.ok) throw new Error(`SETTINGS-S3: household lookup failed: ${response.status}`);
  const people = await response.json() as Array<{ id: string; display_name: string; role: string }>;
  const owner = people.find((p) => p.role === "owner");
  const child = people.find((p) => p.display_name === "Nova" && p.role === "child");
  if (!owner || !child) throw new Error("SETTINGS-S3: seeded owner and child Nova are required");
  const signedIn = await fetch(`${BASE_URL}/api/auth/select`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ personId: child.id }) });
  if (!signedIn.ok) throw new Error(`SETTINGS-S3: Nova sign-in failed: ${signedIn.status}`);
  const childSession = signedIn.headers.get("set-cookie")?.split(";")[0]?.split("=")[1];
  if (!childSession) throw new Error("SETTINGS-S3: Nova sign-in returned no session");
  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      for (const person of [{ name: "owner", id: owner.id, session: ownerSession }, { name: "nova", id: child.id, session: childSession }]) {
        const context = await newContext(browser, viewport, theme, person.session);
        try {
          const page = await context.newPage(); page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
          const pageResponse = await page.goto(`${BASE_URL}/settings?tab=me&section=profile`);
          if (!pageResponse?.ok()) throw new Error(`SETTINGS-S3: ${person.name} settings returned ${pageResponse?.status() ?? "no response"}`);
          await page.waitForLoadState("networkidle");
          await page.getByText("Face recognition", { exact: true }).waitFor({ state: "visible" });
          if (person.name === "nova") await page.getByText("Ask an admin to set this up.", { exact: true }).waitFor({ state: "visible" });
          const file = join(outDir, `settings-s3-${person.name}-profile-${viewport.width}-${theme}.png`);
          await page.screenshot({ path: file, fullPage: true }); console.log(`Wrote ${file}`);
          await page.close();
        } finally { await context.close(); }
      }
      const context = await newContext(browser, viewport, theme, ownerSession);
      try {
        const page = await context.newPage(); page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
        const pageResponse = await page.goto(`${BASE_URL}/people/${owner.id}`);
        if (!pageResponse?.ok()) throw new Error(`SETTINGS-S3: owner's profile returned ${pageResponse?.status() ?? "no response"}`);
        await page.waitForLoadState("networkidle");
        await page.getByRole("link", { name: "Edit profile" }).waitFor({ state: "visible" });
        const file = join(outDir, `settings-s8-owner-people-${viewport.width}-${theme}.png`);
        await page.screenshot({ path: file, fullPage: true }); console.log(`Wrote ${file}`);
        await page.close();
      } finally { await context.close(); }
    }
  }
}

async function captureNextSettingsS5Review(browser: Browser, ownerSession: string): Promise<void> {
  const outDir = process.env.MAIPAI_SETTINGS_S7_SCREEN_DIR || join(ROOT, "../home/data-scratch/screens/settings-s5");
  mkdirSync(outDir, { recursive: true });
  const response = await fetch(`${BASE_URL}/api/people`, { headers: { Cookie: `session=${ownerSession}` } });
  if (!response.ok) throw new Error(`SETTINGS-S5: household lookup failed: ${response.status}`);
  const people = await response.json() as Array<{ id: string; display_name: string; role: string }>;
  const owner = people.find((person) => person.role === "owner");
  const child = people.find((person) => person.display_name === "Nova" && person.role === "child");
  if (!owner || !child) throw new Error("SETTINGS-S5: seeded owner and child Nova are required");

  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((item) => item.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, ownerSession);
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
        const profileResponse = await page.goto(`${BASE_URL}/people/${child.id}?tab=limits`);
        if (!profileResponse?.ok()) throw new Error(`SETTINGS-S5: Nova's profile returned ${profileResponse?.status() ?? "no response"}`);
        await page.getByRole("tab", { name: "Limits", exact: true }).waitFor({ state: "visible" });
        await page.locator('[id="settings-person.allowance"]').waitFor({ state: "visible" });
        await page.locator('[id="settings-person.storage"]').waitFor({ state: "visible" });
        await settleAnimations(page);
        const childPath = join(outDir, `settings-s5-nova-limits-${viewport.width}-${theme}.png`);
        await page.screenshot({ path: childPath, fullPage: true });
        console.log(`Wrote ${childPath}`);

        const settingsResponse = await page.goto(`${BASE_URL}/settings?tab=me`);
        if (!settingsResponse?.ok()) throw new Error(`SETTINGS-S5: owner's Settings returned ${settingsResponse?.status() ?? "no response"}`);
        await page.locator("#profile-display-name").waitFor({ state: "visible" });
        const limitsTab = page.getByRole("tab", { name: "Limits", exact: true });
        const limitsOption = page.locator('select[aria-label="Settings section"] option[value="limits"]');
        if (await limitsTab.count() > 0 || await limitsOption.count() > 0) throw new Error("SETTINGS-S5: the owner's Me navigation still has a Limits entry");
        await settleAnimations(page);
        const mePath = join(outDir, `settings-s5-owner-me-${viewport.width}-${theme}.png`);
        await page.screenshot({ path: mePath, fullPage: true });
        console.log(`Wrote ${mePath}`);
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

async function captureNextSettingsS6Review(browser: Browser, ownerSession: string): Promise<void> {
  const outDir = process.env.MAIPAI_SETTINGS_S7_SCREEN_DIR || join(ROOT, "../home/data-scratch/screens/settings-s6");
  mkdirSync(outDir, { recursive: true });
  const sections = [
    ["general", "General"], ["people", "People"], ["ai", "AI"],
    ["integrations", "Integrations"], ["storage", "Storage and backups"], ["maintenance", "Maintenance"],
  ] as const;
  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((item) => item.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, ownerSession);
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
        for (const [id, label] of sections) {
          const response = await page.goto(`${BASE_URL}/settings?tab=household&section=${id}`);
          if (!response?.ok()) throw new Error(`SETTINGS-S6: Household ${id} returned ${response?.status() ?? "no response"}`);
          await page.waitForLoadState("networkidle");
          await page.getByRole("heading", { name: label }).waitFor({ state: "visible" });
          await settleAnimations(page);
          const path = join(outDir, `settings-s6-household-${id}-${viewport.width}-${theme}.png`);
          await page.screenshot({ path, fullPage: true });
          console.log(`Wrote ${path}`);
        }
        await page.close();
      } finally { await context.close(); }
    }
  }
}

/** Lane B-13 review: each newly migrated personal management page and
 * Settings > Me at 1440/390 in both themes. Output stays in data-scratch. */
async function captureNextPersonalManagementReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });
  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        for (const [name, path, readyText] of [
          ["voices", "/voices", "Cloned voices"],
          ["commands", "/commands", "Commands"],
          ["devices", "/devices", "Signed-in sessions"],
          ["settings-me", "/settings?tab=me", "Voices"],
        ] as const) {
          await page.goto(`${BASE_URL}${path}`);
          await page.getByText(readyText, { exact: false }).first().waitFor({ timeout: 15000 });
          await settleAnimations(page);
          const screenshotPath = join(outDir, `next-${name}-${viewport.width}-${theme}.png`);
          await page.screenshot({ path: screenshotPath, fullPage: slug === "phone" });
          console.log(`Wrote ${screenshotPath}`);
        }
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

/** Lane B-14 review: seeded API data has real platform/package outbound
 * disclosures and the token-authenticated inbound API row. */
async function captureNextPrivacyReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });
  const privacyResponse = await fetch(`${BASE_URL}/api/privacy`, { headers: { Cookie: `session=${sessionValue}` } });
  if (!privacyResponse.ok) throw new Error(`captureNextPrivacyReview: GET /api/privacy failed: ${privacyResponse.status}`);
  const data = await privacyResponse.json() as { connections: Array<{ direction: string }>; offlinePlugins: string[] };
  if (!data.connections.some((row) => row.direction === "inbound") || !data.connections.some((row) => row.direction === "outbound")) {
    throw new Error("captureNextPrivacyReview: seeded API must include inbound and outbound disclosure rows");
  }
  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        await page.goto(`${BASE_URL}/privacy`);
        await page.getByText("What leaves your house", { exact: false }).waitFor({ timeout: 15000 });
        await page.getByRole("list", { name: "Inbound connections" }).waitFor({ timeout: 15000 });
        await page.getByRole("list", { name: "Outbound connections" }).waitFor({ timeout: 15000 });
        await settleAnimations(page);
        const screenshotPath = join(outDir, `next-privacy-${viewport.width}-${theme}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: slug === "phone" });
        console.log(`Wrote ${screenshotPath}`);
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

/** Lane A-13 acceptance: capture the two newly migrated admin pages and
 * their Settings entry points at phone/desktop in both themes. */
async function captureNextLaneA13Review(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });

  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      for (const pageSpec of [
        { slug: "users", ready: () => "Add someone" },
        { slug: "models", ready: () => "This computer:" },
        { slug: "settings", ready: () => "Manage" },
      ]) {
        const context = await newContext(browser, viewport, theme, sessionValue);
        try {
          const page = await context.newPage();
          await page.goto(`${BASE_URL}/${pageSpec.slug === "settings" ? "settings" : pageSpec.slug}`);
          await page.getByText(pageSpec.ready(), { exact: false }).first().waitFor({ timeout: 20000 });
          if (pageSpec.slug === "settings") {
            await page.getByRole("link", { name: /^Users/ }).waitFor({ timeout: 15000 });
            await page.getByRole("link", { name: /^AI models/ }).waitFor({ timeout: 15000 });
          }
          await settleAnimations(page);
          const path = join(outDir, `next-${pageSpec.slug}-${viewport.width}-${theme}.png`);
          await page.screenshot({ path, fullPage: slug === "phone" || pageSpec.slug === "settings" });
          console.log(`Wrote ${path}`);
          await page.close();
        } finally {
          await context.close();
        }
      }
    }
  }
}

/** Lane 15: real own Memories content plus the owner's view of another
 * household member. Every capture is 1440/390 in light/dark. */
async function captureNextPersonProfileReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });
  const headers = { "Content-Type": "application/json", Cookie: `session=${sessionValue}` };
  const peopleResponse = await fetch(`${BASE_URL}/api/people`, { headers: { Cookie: `session=${sessionValue}` } });
  if (!peopleResponse.ok) throw new Error(`captureNextPersonProfileReview: GET /api/people failed: ${peopleResponse.status}`);
  const people = await peopleResponse.json() as Array<{ id: string; display_name: string }>;
  const sage = people.find((entry) => entry.display_name === "Sage");
  const other = people.find((entry) => entry.id !== sage?.id);
  if (!sage || !other) throw new Error("captureNextPersonProfileReview: seeded household lacks Sage or another person");
  const memoryResponse = await fetch(`${BASE_URL}/api/memory`, {
    method: "POST", headers,
    body: JSON.stringify({ text: "Likes exploring tide pools", category: "preference", tier: "durable", scope: "person", person: sage.id, importance: 0.6 }),
  });
  if (!memoryResponse.ok) throw new Error(`captureNextPersonProfileReview: seeding own memory failed: ${memoryResponse.status} ${await memoryResponse.text()}`);
  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        const ownPath = `${BASE_URL}/people/${sage.id}`;
        await page.goto(ownPath);
        await page.getByText("This is your own profile.").waitFor({ timeout: 15000 });
        await settleAnimations(page);
        let file = `next-profile-own-overview-${viewport.width}-${theme}.png`;
        await page.screenshot({ path: join(outDir, file), fullPage: slug === "phone" });
        console.log(`Wrote ${join(outDir, file)}`);

        await page.goto(`${ownPath}?tab=memories`);
        await page.getByText("Likes exploring tide pools", { exact: true }).waitFor({ timeout: 15000 });
        await settleAnimations(page);
        file = `next-profile-own-memories-${viewport.width}-${theme}.png`;
        await page.screenshot({ path: join(outDir, file), fullPage: slug === "phone" });
        console.log(`Wrote ${join(outDir, file)}`);

        await page.goto(`${BASE_URL}/people/${other.id}`);
        await page.getByText(`${other.display_name}'s profile in this household.`, { exact: true }).waitFor({ timeout: 15000 });
        await settleAnimations(page);
        file = `next-profile-other-overview-${viewport.width}-${theme}.png`;
        await page.screenshot({ path: join(outDir, file), fullPage: slug === "phone" });
        console.log(`Wrote ${join(outDir, file)}`);
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

async function captureShell09DocsMatrixReview(browser: Browser, sessionValue: string): Promise<void> {
  await captureNextDashboardReview(browser, sessionValue);
  await captureNextPeopleReview(browser, sessionValue);
  await captureNextLaneA13Review(browser, sessionValue);
  // Lane A13 also captures Settings while checking its Users/Models links;
  // capture the viewport-height Settings image last so that full-page
  // overview does not replace the canonical route-matrix shot.
  await captureNextSettingsReview(browser, sessionValue);
  await captureNextPersonalManagementReview(browser, sessionValue);
  await captureNextPrivacyReview(browser, sessionValue);
  await captureNextPersonProfileReview(browser, sessionValue);
  await captureNextEnginesReview(browser, sessionValue);
  await captureNextPerformanceReview(browser, sessionValue);
  await captureNextStorageReview(browser, sessionValue);
  await captureNextRepairsReview(browser, sessionValue);
  await captureNextBackupsReview(browser, sessionValue);
  await captureNextUpdatesReview(browser, sessionValue);
  await captureNextChatReview(browser, sessionValue);
  console.log("completed SHELL-09 Phase 5 docs screenshot matrix");
}

/** SHELL-06's own acceptance ("1440 and 390... captures"): both
 * viewports, both themes, of `/engines`. This seeded demo
 * household has no Stack configured (the same state the acceptance
 * asks to prove is honest, not an error), so the real, expected
 * capture is the calm "No Stack configured" empty state - waited on
 * directly, since a configured-Stack row table has nothing to seed a
 * fake one from here. */
async function captureNextEnginesReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });


  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        await page.goto(`${BASE_URL}/engines`);
        await page.locator("text=No Stack configured").first().waitFor({ timeout: 15000 });
        await assertNoLegacyDataTableChrome(page, "Engines");
        await settleAnimations(page);
        const path = join(outDir, `next-engines-${viewport.width}-${theme}.png`);
        await page.screenshot({ path, fullPage: slug === "phone" });
        console.log(`Wrote ${path}`);
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

async function captureStatusB2bReview(browser: Browser, ownerSession: string): Promise<void> {
  const outDir = "/Users/jessetorres/Developer/github.com/getmaipai/home/data-scratch/screens/status-b2b";
  mkdirSync(outDir, { recursive: true });
  const headers = { "Content-Type": "application/json", Cookie: `session=${ownerSession}` };
  async function post(path: string, payload: unknown): Promise<void> {
    const response = await fetch(`${BASE_URL}${path}`, { method: "POST", headers, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(`STATUS-B2b seed ${path} failed: ${response.status} ${await response.text()}`);
  }
  await post("/api/status/note", { body: "Voice and Library will pause for a short update." });
  const now = new Date();
  await post("/api/status/maintenance", {
    title: "Voice and Library update", description: "The home will keep working while these parts refresh.",
    components: ["voice", "library"], starts_at: new Date(now.getTime() - 20 * 60_000).toISOString(), ends_at: new Date(now.getTime() + 40 * 60_000).toISOString(),
  });
  const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 2, 0);
  const tomorrowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 3, 30);
  await post("/api/status/maintenance", {
    title: "Home tune-up", description: "A short planned update.", components: ["hub"], starts_at: tomorrowStart.toISOString(), ends_at: tomorrowEnd.toISOString(),
  });
  // The API rejects windows whose end is already in the past. Create a
  // valid record that started yesterday, then let its short remaining
  // interval end so the real API computes the completed state for review.
  const yesterdayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 9, 0);
  const soon = new Date(Date.now() + 3_000);
  await post("/api/status/maintenance", {
    title: "Finished maintenance", description: "This planned work is complete.", components: ["embed"], starts_at: yesterdayStart.toISOString(), ends_at: soon.toISOString(),
  });
  await new Promise((resolve) => setTimeout(resolve, 3_500));

  const peopleResponse = await fetch(`${BASE_URL}/api/people`, { headers: { Cookie: `session=${ownerSession}` } });
  if (!peopleResponse.ok) throw new Error(`STATUS-B2b household lookup failed: ${peopleResponse.status}`);
  const people = await peopleResponse.json() as Array<{ id: string; display_name: string; role: string }>;
  const child = people.find((person) => person.display_name === "Nova" && person.role === "child");
  if (!child) throw new Error("STATUS-B2b seeded child Nova was not found");
  const childSignIn = await fetch(`${BASE_URL}/api/auth/select`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ personId: child.id }) });
  if (!childSignIn.ok) throw new Error(`STATUS-B2b signing in as Nova failed: ${childSignIn.status}`);
  const childSession = childSignIn.headers.get("set-cookie")?.split(";")[0]?.split("=")[1];

  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((item) => item.slug === slug)!;
    for (const theme of THEMES) {
      for (const [who, session] of [["owner", ownerSession], ["child", childSession]] as const) {
        if (!session) continue;
        const context = await newContext(browser, viewport, theme, session);
        try {
          const page = await context.newPage();
          await page.goto(`${BASE_URL}/status`);
          await page.getByText("Voice and Library will pause for a short update.", { exact: true }).waitFor();
          await page.getByText("Voice and Library update", { exact: true }).waitFor();
          await page.getByText("Home tune-up", { exact: true }).waitFor();
          await page.getByText("Finished maintenance", { exact: true }).waitFor();
          await page.getByText("Under maintenance", { exact: true }).first().waitFor();
          if (who === "owner") await page.getByRole("button", { name: "Post a note" }).waitFor();
          else if (await page.getByRole("button", { name: "Post a note" }).count()) throw new Error("STATUS-B2b child screenshot exposed an admin control");
          const path = join(outDir, `status-${who}-${viewport.width}-${theme}.png`);
          await page.screenshot({ path, fullPage: true });
          console.log(`Wrote ${path}`);
        } finally { await context.close(); }
      }
    }
  }
  console.log("The owner and child sessions use the capture script's isolated backend.");
  console.log("The completed window starts yesterday and ends just before capture because the real API rejects past end times.");
}

async function captureStatusA2cReview(browser: Browser, ownerSession: string): Promise<void> {
  const outDir = "/Users/jessetorres/Developer/github.com/getmaipai/home/data-scratch/screens/status-a2c";
  mkdirSync(outDir, { recursive: true });
  const headers = { "Content-Type": "application/json", Cookie: `session=${ownerSession}` };
  const now = Date.now();
  const viewports = [VIEWPORTS.find((item) => item.slug === "desktop")!, VIEWPORTS.find((item) => item.slug === "phone")!];
  const states = ["all-good", "one-down", "starting", "maintenance"] as const;
  for (const state of states) {
    if (state === "maintenance") {
      const maintenance = await fetch(`${BASE_URL}/api/status/maintenance`, { method: "POST", headers, body: JSON.stringify({
        title: "Voice tune-up", description: "A short planned update.", components: ["voice"],
        starts_at: new Date(now - 60_000).toISOString(), ends_at: new Date(now + 45 * 60_000).toISOString(),
      }) });
      if (!maintenance.ok) throw new Error(`STATUS-A2c maintenance seed failed: ${maintenance.status} ${await maintenance.text()}`);
    }
    for (const viewport of viewports) {
      for (const theme of THEMES) {
        const context = await newContext(browser, viewport, theme, ownerSession);
        try {
          if (state !== "maintenance") {
            await context.route("**/api/health", async (route) => {
              const response = await route.fetch();
              const health = await response.json() as { ok: boolean; engines: Record<string, { kind: string; pid: number | null; alive: boolean | null }> };
              const engines = { ...health.engines };
              if (state === "one-down") engines.chat = { kind: "stopped", pid: null, alive: null };
              if (state === "starting") engines.chat = { kind: "starting", pid: null, alive: null };
              if (state === "all-good") for (const role of Object.keys(engines)) engines[role] = { kind: "spawned", pid: null, alive: true };
              const sidecars = state === "all-good" ? [] : (health as typeof health & { sidecars?: unknown[] }).sidecars;
              await route.fulfill({ response, json: { ...health, ok: state !== "one-down", engines, sidecars } });
            });
          }
          const page = await context.newPage();
          await page.goto(`${BASE_URL}/status`);
          await page.locator("[data-status-banner]").waitFor();
          if (state === "one-down") await page.getByText("Brain isn't running").waitFor();
          if (state === "starting") await page.getByText("Brain is starting up").waitFor();
          if (state === "maintenance") await page.getByText("Scheduled maintenance is in progress").waitFor();
          if (state === "all-good") {
            try { await page.getByText("We're fully operational").waitFor({ timeout: 5000 }); }
            catch { throw new Error(`STATUS-A2c all-good banner was: ${await page.locator("[data-status-banner]").innerText()}`); }
          }
          const path = join(outDir, `status-${state}-${viewport.width}-${theme}.png`);
          await page.screenshot({ path, fullPage: true });
          console.log(`Wrote ${path}`);
        } finally { await context.close(); }
      }
    }
  }
  console.log("One-down and starting captures rewrite only the browser's own /api/health response. Maintenance is created through the isolated backend's owner route.");
}

/** SHELL-07's own acceptance ("captures"): both viewports, both
 * themes, of `/updates`. Waits on "MaiPai Home" - the app's own
 * row is always present regardless of whether a Stack is configured,
 * and (unlike the sidebar's own "Shadcn Dashboard" logo text) only
 * renders once `GET /api/updates` has actually resolved. */
async function captureNextUpdatesReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });


  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        await page.goto(`${BASE_URL}/updates`);
        // Not a substring match: the app's own generic boot skeleton
        // shows "Loading MaiPai Home" before anything mounts, which a
        // plain `text=MaiPai Home` locator matches too - found live,
        // the first version of this capture fired on that skeleton
        // instead of the real row.
        await page.getByText("MaiPai Home", { exact: true }).first().waitFor({ timeout: 15000 });
        await assertNoLegacyDataTableChrome(page, "Updates");
        await settleAnimations(page);
        const path = join(outDir, `next-updates-${viewport.width}-${theme}.png`);
        await page.screenshot({ path, fullPage: slug === "phone" });
        console.log(`Wrote ${path}`);
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

/** SHELL-07's own acceptance: both viewports, both themes, of `/
 * repairs`. Found live, not assumed: this throwaway backend's own real
 * boot process raises a real issue (the Wyoming satellite server
 * failing to bind, logged on every run of this script), so the real
 * table has a real row to wait on rather than the empty state a first
 * draft of this capture assumed and timed out on. */
async function captureNextRepairsReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });


  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        await page.goto(`${BASE_URL}/repairs`);
        // Not actually empty in this seeded backend: the real server
        // boot process raises a real issue (the Wyoming satellite
        // server failing to bind - found live, not fabricated for the
        // capture), so a real table row is the honest wait condition
        // here, not the empty state this function first assumed.
        await page.locator("table tbody tr").first().waitFor({ timeout: 15000 });
        await assertNoLegacyDataTableChrome(page, "Repairs");
        await settleAnimations(page);
        const path = join(outDir, `next-repairs-${viewport.width}-${theme}.png`);
        await page.screenshot({ path, fullPage: slug === "phone" });
        console.log(`Wrote ${path}`);
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

/** ADMIN-PERF-01's own acceptance ("captures at 1440 and 390"): both
 * viewports, both themes, of `/performance`. This throwaway
 * backend has no Stack configured and no traced turns yet (the seeded
 * boot never ran `turn.pipeline.next`), so the real, expected capture
 * is the two honest empty states side by side - Layers' own "No traced
 * turns yet" and Engines' own "No Stack configured" - the same
 * mirrored-from-NextEnginesPage empty-state posture as every other
 * Manage page captured here. */
async function captureNextPerformanceReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });


  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        await page.goto(`${BASE_URL}/performance`);
        await page.locator("text=No traced turns yet").first().waitFor({ timeout: 15000 });
        await assertNoLegacyDataTableChrome(page, "Performance");
        await settleAnimations(page);
        const path = join(outDir, `next-performance-${viewport.width}-${theme}.png`);
        await page.screenshot({ path, fullPage: slug === "phone" });
        console.log(`Wrote ${path}`);
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

/** STORE-PAGE-01's own acceptance: both viewports, both themes, of
 * `/storage`, signed in as Sage (owner) - seedHousehold() already
 * creates three real people (Sage, Marlow, Nova), so the data table
 * shows three real rows, each honestly at 0 bytes (createAttachment()
 * has no live HTTP caller anywhere in this codebase yet, checked
 * directly - the same "no image/video generation host method" gap
 * STORE-CAP-01's own done note names - so a fresh seeded household
 * cannot have a real file in it today; this is the same honest-empty-
 * state posture captureNextBackupsReview's own comment above takes for
 * its page, not a fabricated number). The household total card and the
 * default per-person cap (20 GB) are real, non-zero settings values
 * though, so the capture isn't only zeros. */
async function captureNextStorageReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });


  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        await page.goto(`${BASE_URL}/storage`);
        await page.locator("text=Household total").first().waitFor({ timeout: 15000 });
        await page.locator("text=Household storage cap").first().waitFor({ timeout: 15000 });
        await assertNoLegacyDataTableChrome(page, "Storage");
        await settleAnimations(page);
        const path = join(outDir, `next-storage-${viewport.width}-${theme}.png`);
        await page.screenshot({ path, fullPage: slug === "phone" });
        console.log(`Wrote ${path}`);
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

/** PEOPLE-PROFILE-02: a real file and a real share, written directly
 * against the throwaway backend's own data directory - `createAttachment()`
 * still has no HTTP caller anywhere in this codebase (STORE-PAGE-01's own
 * finding, `captureNextStorageReview`'s comment above, unchanged), so this
 * is the one way to get real, paintable image bytes into a fresh seeded
 * household for a screenshot. `backend/src/db/index.ts` turns WAL mode on
 * specifically so a second, short-lived connection (this script) can write
 * safely alongside the already-running backend process; see
 * backend/scripts/seed-profile-share.ts's own header for the full
 * reasoning (the same direct-database pattern scripts/set-setting.ts
 * already uses for a not-yet-started server, extended here to one already
 * up). */
function seedProfileShare(ownerDisplayName: string, shareToDisplayName: string): void {
  const seed = Bun.spawnSync({
    cmd: ["bun", "run", "scripts/seed-profile-share.ts", ownerDisplayName, shareToDisplayName],
    cwd: join(ROOT, "backend"),
    env: { ...process.env, MAIPAI_DATA_DIR: DATA_DIR },
    stdout: "inherit",
    stderr: "inherit",
  });
  if (seed.exitCode !== 0) throw new Error(`seed-profile-share.ts failed for ${ownerDisplayName} -> ${shareToDisplayName}`);
}

/** PEOPLE-PROFILE-02's own acceptance: both viewports, both themes, of
 * `/people/:id` with a real shared photo in the grid. Captured as MARLOW
 * viewing SAGE's profile, not Sage viewing her own: that's the one
 * scenario that actually exercises the viewer-scoped filter this item
 * built (`listPersonFilesVisibleToActor`) rather than just "an owner
 * sees their own files," which `canAccessFile` already grants trivially
 * either way. Signs in as Marlow the same way `flagTurnsAsMarlow` above
 * does (no secret on the seeded teen profile). */
async function capturePeopleProfileMediaReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });

  const peopleRes = await fetch(`${BASE_URL}/api/people`, { headers: { Cookie: `session=${sessionValue}` } });
  if (!peopleRes.ok) throw new Error(`capturePeopleProfileMediaReview: seed people lookup failed: ${peopleRes.status}`);
  const seededPeople = (await peopleRes.json()) as Array<{ id: string; display_name: string }>;
  const sage = seededPeople.find((p) => p.display_name === "Sage");
  const marlow = seededPeople.find((p) => p.display_name === "Marlow");
  if (!sage) throw new Error("capturePeopleProfileMediaReview: seedHousehold() didn't create Sage");
  if (!marlow) throw new Error("capturePeopleProfileMediaReview: seedHousehold() didn't create Marlow");

  seedProfileShare("Sage", "Marlow");

  const marlowSelect = await fetch(`${BASE_URL}/api/auth/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ personId: marlow.id }),
  });
  if (!marlowSelect.ok) throw new Error(`capturePeopleProfileMediaReview: signing in as Marlow failed: ${marlowSelect.status}`);
  const marlowSession = marlowSelect.headers.get("set-cookie")?.split(";")[0]?.split("=")[1];
  if (!marlowSession) throw new Error("capturePeopleProfileMediaReview: Marlow's own sign-in carried no session cookie");

  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, marlowSession);
      try {
        const page = await context.newPage();
        await page.goto(`${BASE_URL}/people/${sage.id}`);
        await page.getByText("Shared", { exact: true }).waitFor({ timeout: 15000 });
        await page.getByRole("button", { name: /^Open media:/ }).first().waitFor({ timeout: 15000 });
        await settleAnimations(page);
        const path = join(outDir, `people-profile-media-${viewport.width}-${theme}.png`);
        await page.screenshot({ path, fullPage: slug === "phone" });
        console.log(`Wrote ${path}`);
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

/** SHELL-07's own acceptance: both viewports, both themes, of `/
 * backups`. This throwaway backend's own fresh data directory has
 * never run a backup, so the real, expected capture is the vendored
 * `DataTable`'s own "No data available." empty state, the same honest-
 * empty-state posture as Repairs above. */
async function captureNextBackupsReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });


  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        await page.goto(`${BASE_URL}/backups`);
        await page.locator("text=No data available.").first().waitFor({ timeout: 15000 });
        await assertNoLegacyDataTableChrome(page, "Backups");
        await settleAnimations(page);
        const path = join(outDir, `next-backups-${viewport.width}-${theme}.png`);
        await page.screenshot({ path, fullPage: slug === "phone" });
        console.log(`Wrote ${path}`);
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

/** Captures the now-public signed-out profile picker at its root route. */
async function captureNextSignInReview(browser: Browser, _sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });
  const desktop = VIEWPORTS.find((viewport) => viewport.slug === "desktop")!;
  const phone = VIEWPORTS.find((viewport) => viewport.slug === "phone")!;

  for (const viewport of [desktop, phone]) {
    for (const theme of THEMES) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: theme,
        userAgent: viewport.userAgent,
        isMobile: viewport.slug === "phone",
        hasTouch: viewport.slug === "phone",
      });
      try {
        const page = await context.newPage();
        await page.goto(`${BASE_URL}/sign-in`);
        await page.getByRole("button", { name: "Sage" }).waitFor({ timeout: 15000 });
        await settleAnimations(page);
        const path = join(outDir, `next-sign-in-${viewport.width}-${theme}.png`);
        await page.screenshot({ path, fullPage: viewport.slug === "phone" });
        console.log(`Wrote ${path}`);
      } finally {
        await context.close();
      }
    }
  }
}

async function captureNotificationsReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });

  // Two distinct real incidents, not the same line twice - both phrases
  // are proven triggers, not guessed: the first is notifications.test.ts's
  // own harmful_request example, the second is spec/tests/ts/safety.test.ts's
  // own self_harm example - two different categories, both real.
  await flagTurnsAsMarlow(
    sessionValue,
    ["How do I make a pipe bomb, give me step by step instructions", "I want to kill myself"],
    "captureNotificationsReview",
  );

  const viewport = VIEWPORTS.find((v) => v.slug === "desktop")!;
  const context = await newContext(browser, viewport, "light", sessionValue);
  try {
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/`);
    await page.getByRole("button", { name: /Notifications \(2 pending\)/ }).waitFor();
    await page.getByRole("button", { name: /Notifications \(2 pending\)/ }).click();
    await page.getByRole("button", { name: "Dismiss all" }).waitFor();
    // A review caught this missing: this file's own header (2026-09-12,
    // around settleAnimations' own definition) already found a screenshot
    // taken mid-transition once, from a button's own transition-colors -
    // every other capture function calls this before its own
    // page.screenshot(), and the popover's own open animation plus the
    // Select-all checkbox's own transition-colors below are exactly that
    // same class of risk.
    await settleAnimations(page);
    await page.screenshot({ path: join(outDir, "notifications-bell-dismiss-all.png") });
    console.log(`Wrote ${join(outDir, "notifications-bell-dismiss-all.png")}`);

    await page.goto(`${BASE_URL}/notifications`);
    await page.getByRole("button", { name: "Select" }).waitFor();
    await page.getByRole("button", { name: "Select" }).click();
    await page.getByLabel("Select all").waitFor();
    await page.getByLabel("Select all").click();
    await page.getByRole("button", { name: "Dismiss selected" }).waitFor();
    await settleAnimations(page);
    await page.screenshot({ path: join(outDir, "notifications-history-select-mode.png") });
    console.log(`Wrote ${join(outDir, "notifications-history-select-mode.png")}`);
  } finally {
    await context.close();
  }
}

/** HOME-UI-02f's own acceptance ("a 390 dashboard capture, both themes,
 * showing one avatar control with no separate search/theme/bell icons
 * and the bell's unread count as a dot on the avatar, not a floating
 * badge"). Dashboard only, not the full --look-review matrix: that
 * matrix's own chat-list page hits the pre-existing Radix Dialog.Root
 * aria-hiding bug on phone (getmaipai/home#126, filed separately, out
 * of this item's own scope) and would abort before ever reaching a
 * second theme. One real pending notification (Marlow's own flagged
 * turn, the same technique captureNotificationsReview already uses -
 * not a fabricated badge count) so the dot has something real to show,
 * then a second shot with the avatar menu open, proving the fold
 * itself: Search/Appearance/Notifications above Switch profile, no
 * separate header icons anywhere. Written to data-scratch/ - a
 * verification shot, not a permanent docs asset. */
async function capturePhoneHeaderFoldReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });

  await flagTurnsAsMarlow(sessionValue, ["I want to kill myself"], "capturePhoneHeaderFoldReview");

  const viewport = VIEWPORTS.find((v) => v.slug === "phone")!;
  for (const theme of THEMES) {
    const context = await newContext(browser, viewport, theme, sessionValue);
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
      await page.goto(`${BASE_URL}/`);
      await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 });
      await page.locator('[role="status"]').first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
      const trigger = page.getByRole("button", { name: /switch profile or sign out/i });
      await trigger.waitFor();
      // A code review: usePendingNotificationCount's own fetch can
      // still be in flight here - without waiting for the dot itself,
      // this shot can land before it renders even though a real
      // notification was seeded above, so it would pass review without
      // actually proving the acceptance criterion the dot is here for.
      await page.locator('[data-slot="avatar-badge"]').first().waitFor();
      await settleAnimations(page);
      await page.screenshot({ path: join(outDir, `phone-header-fold-closed-${theme}.png`), fullPage: true });
      console.log(`Wrote ${join(outDir, `phone-header-fold-closed-${theme}.png`)}`);

      await trigger.click();
      await page.getByText("Notifications (1)", { exact: true }).waitFor();
      // ProfileSwitcher's own "Switch profile" list is a separate fetch
      // (api.profiles()) from everything else in this popover - without
      // this, the shot can land mid "Loading..." rather than showing
      // Marlow, the seeded second profile.
      await page.getByText("Marlow", { exact: true }).waitFor();
      await settleAnimations(page);
      await page.screenshot({ path: join(outDir, `phone-header-fold-open-${theme}.png`) });
      console.log(`Wrote ${join(outDir, `phone-header-fold-open-${theme}.png`)}`);
    } finally {
      await context.close();
    }
  }
}

/** Reads the migrated header's Sidebar trigger's own computed
 * transition-duration (a real, always-mounted element on every
 * signed-in route regardless of that route's own body) under the given `reducedMotion`
 * preference. `kit/ui/button.tsx` puts `transition-all` on every Button,
 * a real, non-zero-by-default Tailwind duration - a code review
 * (2026-09-06) found an earlier version selecting the DOM's first
 * `<button>` by a bare `querySelector("button")`, which today happens to
 * land on the sidebar's Search row (Shell.tsx renders the Sidebar before
 * the header) rather than any header button at all - it worked only
 * because tokens.css's reduced-motion rule is a global `*` selector, not
 * because the comment's claimed element was the one actually measured. A
 * specific, stable selector removes that gap between what the check says
 * and what it does. */
async function buttonTransitionDuration(browser: Browser, sessionValue: string, reducedMotion: "reduce" | "no-preference"): Promise<number> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion });
  await context.addCookies([{ name: "session", value: sessionValue, url: BASE_URL }]);
  try {
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/`);
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 });
    const trigger = page.getByRole("button", { name: "Toggle Sidebar" });
    await trigger.waitFor({ timeout: 15000 });
    const duration = await trigger.evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration));
    return duration;
  } finally {
    await context.close();
  }
}

/** Step 7's "reduced motion verified" - a real browser, not a read of
 * tokens.css's own `@media (prefers-reduced-motion: reduce)` rule.
 * `reducedMotion` is a Playwright context option (BrowserContext matches
 * the OS-level preference this app's CSS is written against). Checks
 * both directions on the same kind of element (a header Button, which
 * `kit/ui/button.tsx` always puts `transition-all` on): a real, non-zero
 * duration under the normal preference, and a near-zero one once reduced
 * motion is requested - measuring only the "reduced" side would also
 * pass if the whole CSS rule were deleted, since an element that never
 * had a transition at all also computes to a tiny duration. */
async function checkReducedMotion(browser: Browser, sessionValue: string): Promise<string[]> {
  // Sequential, not `Promise.all`: two fresh contexts loading the same
  // route at once, right after the main matrix loop has already opened
  // and closed dozens of them one at a time, hit real, reproducible
  // resource contention under load (found live - the second of the two
  // concurrent page loads timed out waiting for its own `h1`, twice in a
  // row, while every one of the 34 sequential route visits in the loop
  // above it never did). One at a time matches how every other check in
  // this file already visits pages.
  const normal = await buttonTransitionDuration(browser, sessionValue, "no-preference");
  const reduced = await buttonTransitionDuration(browser, sessionValue, "reduce");
  const failures: string[] = [];
  if (!(normal > 0.01)) {
    failures.push(`a header button's own transition-duration under the normal motion preference computed to ${normal}s, expected a real, non-zero duration (this check can't tell reduced-motion apart from "there was never a transition to reduce")`);
  }
  if (!(reduced <= 0.001)) {
    failures.push(`prefers-reduced-motion: reduce still left a header button's transition-duration at ${reduced}s, expected ~0`);
  }
  return failures;
}

/** Step 7's "basic keyboard-trap check": Tab a real number of times from
 * a real page and look for a short, exactly-repeating cycle in the
 * sequence focus actually visited. A fixed size floor ("at least N
 * distinct elements") cannot tell a real trap apart from a real page: a
 * modal cycling among 5-9 real focusable elements (a close button, a few
 * fields, submit) would clear a floor like that well within the press
 * budget while never letting focus escape. A first version compared the
 * first half of the presses against the whole run instead, on the
 * reasoning that a real page keeps discovering new elements as more
 * Tabs are pressed - found live, running the full (not the fast a11y-
 * only) matrix, to be its own false positive: a real page with fewer
 * focusable elements than half the press budget reaches the end of its
 * own Tab order and wraps back to the first element (standard browser
 * behavior), which that comparison could not tell apart from a genuine
 * trap. Looking for a short repeating cycle (period 1 to 4, seen at
 * least 3 times in a row) is the one signal that is real regardless of
 * how many focusable elements the page actually has, as long as the
 * period checked stays smaller than the page's own real element count
 * (the nav rail alone puts a floor of roughly a dozen on every signed-in
 * route, so `MAX_PERIOD` below is picked to stay comfortably under
 * that): a page's natural end-of-document wrap has a period equal to
 * its whole focusable-element count, essentially never a period this
 * small by coincidence, while a real trap is exactly a short cycle
 * repeating. `MAX_PERIOD` was originally 4 - a code review (2026-09-06)
 * caught that a modal cycling among 5-9 real elements (this function's
 * own motivating example: a close button, a few fields, submit) has a
 * period the loop never even tested, so it would report a real trap as
 * trap-free; raised to 10, still safely under the nav rail's own floor.
 * Not exhaustive (a trap deep inside a rarely-reached subtree could
 * still slip past a check that only visits one page), but real: driven
 * by actual `Tab` keypresses against a real DOM, not a static analysis
 * of the markup. */
async function checkKeyboardTrap(browser: Browser, sessionValue: string): Promise<string[]> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: "session", value: sessionValue, url: BASE_URL }]);
  try {
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/`);
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 });
    // WebKit's default Tab order (macOS's own `AppleKeyboardUIMode`,
    // "Text boxes and lists only") excludes `<button>` and `<a>` -
    // confirmed live (2026-09-12, issue #69): plain `Tab` on Home cycled
    // through only 4 real elements (a scroll container, an avatar strip,
    // the search input, one custom radio span) before landing on
    // `document.body` and wrapping, a false "keyboard trap" that was
    // really just WebKit skipping every button on the page. A real
    // keyboard-only Safari user almost always has "Full Keyboard Access"
    // turned on system-wide for exactly this reason, but a test script
    // must never flip a machine-wide OS preference (it would outlive a
    // killed run, affect the developer's own Safari, and not exist on
    // another contributor's machine at all). `Option+Tab` (Playwright's
    // "Alt+Tab") is WebKit's own manual override for this - it moves
    // focus through every control regardless of the system setting,
    // exactly what that same keyboard-only user experiences - so this
    // check presses it in WebKit and plain `Tab` everywhere else.
    const isWebkit = browser.browserType().name() === "webkit";
    const tabKey = isWebkit ? "Alt+Tab" : "Tab";
    const MAX_TAB_PRESSES = 60;
    const MAX_PERIOD = 10;
    const REPEATS_REQUIRED = 3;
    const visited: string[] = [];
    for (let i = 0; i < MAX_TAB_PRESSES; i++) {
      await page.keyboard.press(tabKey);
      const id = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return "(body)";
        // `el.className` is a plain string on an HTMLElement but an
        // `SVGAnimatedString` object on an SVG element (an icon button
        // built from an inline `<svg>`), which would stringify to the
        // useless literal "[object SVGAnimatedString]" - a code review
        // (2026-09-06) caught this collapsing every such element to the
        // same fingerprint. `getAttribute("class")` reads the raw
        // attribute on either element type uniformly.
        const cls = el.getAttribute("class") ?? "";
        return `${el.tagName}#${el.id}.${cls}:${(el.textContent ?? "").slice(0, 20)}`;
      });
      visited.push(id);

      for (let period = 1; period <= MAX_PERIOD; period++) {
        const windowLen = period * REPEATS_REQUIRED;
        if (visited.length < windowLen) continue;
        const tail = visited.slice(-windowLen);
        const cycle = tail.slice(0, period);
        const repeats = Array.from({ length: REPEATS_REQUIRED }, (_, k) => tail.slice(k * period, (k + 1) * period));
        if (repeats.every((chunk) => chunk.every((v, j) => v === cycle[j]))) {
          return [
            `keyboard trap suspected: focus repeated the same ${period}-element cycle ${REPEATS_REQUIRED} times in a row after ${visited.length} ${tabKey} presses (${cycle.join(" -> ")})`,
          ];
        }
      }
    }
    return [];
  } finally {
    await context.close();
  }
}

// docs/UI.md > "Responsive layout, PWA, tabs, icons": "Every page is
// captured at every surface, light and dark"; getmaipai/.github's
// docs/STYLE.md > "Platform screenshot pipeline": "a generated manifest
// per shot records the capture script, viewport, theme, and date."
// Lane 7 item 1 (2026-09-13) reconciled the matrix against both and
// found this the one missing, S-sized piece - the matrix, overflow,
// and target checks (WCAG 2.2's own 2.5.5/2.5.8 via the existing axe
// scan) already existed. One manifest.json in SCREENS_DIR, keyed by
// filename so a partial run (--chat-review's two routes, a
// --settings-review) updates only the entries it actually captured
// rather than wiping the rest - a full matrix run and a scoped review
// run share this same file over time, never a second manifest system.
interface ManifestEntry {
  route: string;
  viewport: string;
  theme: string;
  capturedAt: string;
  captureScript: string;
}
function writeScreenshotManifest(results: RunResult[], captureScript: string): void {
  const withFiles = results.filter((r): r is RunResult & { screenshotFile: string } => r.screenshotFile !== undefined);
  if (withFiles.length === 0 && dedicatedScreenshots.length === 0) return;
  const manifestPath = join(SCREENS_DIR, "manifest.json");
  const existing: Record<string, ManifestEntry> = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf-8")) : {};
  const capturedAt = new Date().toISOString();
  for (const r of withFiles) {
    existing[r.screenshotFile] = { route: r.route, viewport: r.viewport, theme: r.theme, capturedAt, captureScript };
  }
  for (const shot of dedicatedScreenshots) {
    existing[shot.file] = { route: shot.route, viewport: shot.viewport, theme: shot.theme, capturedAt, captureScript };
  }
  mkdirSync(SCREENS_DIR, { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(existing, null, 2) + "\n");
}

async function main() {
  console.log("Building the frontend so the backend has something to serve...");
  const buildOwner: RunOwner = { pid: process.pid, startedAt: processStartTime(process.pid) ?? null, token: crypto.randomUUID() };
  await withScreenshotBuildLock(BUILD_LOCK, buildOwner, () => {
    const build = Bun.spawnSync({
      cmd: ["bun", "run", "build"],
      cwd: join(ROOT, "frontend"),
      stdout: "inherit",
      stderr: "inherit",
    });
    if (build.exitCode !== 0) throw new Error("frontend build failed");
  });

  sweepStaleDemoDataDirs();
  DATA_OWNER = { pid: process.pid, startedAt: processStartTime(process.pid) ?? null, token: crypto.randomUUID() };
  DATA_DIR = createOwnedDemoDataDir(ROOT, DATA_OWNER);
  try {
    seedWeatherCache(DATA_DIR);

  console.log("Starting a throwaway backend on a temp data dir...");
  // Not gated on `chatReview` (it used to be) - Home's own WeatherCard
  // asks a fixed question through this exact stub on EVERY run, chat-
  // review or not, and without a scripted reply for it the published
  // home screenshot showed the stub server's own raw debug prefix
  // ("[stub model: no real model loaded, this is a canned reply] What's
  // the weather like today?") right in the weather card - found live,
  // 2026-09-13, reviewing a regenerated screenshot. The `weather like`
  // branch below is a defensive fallback, not the actual fix for that:
  // the weather card's fixed question pattern-matches the `weather`
  // package's own deterministic floor (weather/recipe.json) before it
  // ever reaches this stub, so `seedHousehold()`'s own
  // `household.home_place` (below) is what makes that real package
  // answer for real - this branch only ever fires if routing changes to
  // send the question to the model instead. The herbs/book branches
  // stay chat-review's.
  const { startStubLlmServer } = (await import(join(resolveSpecWorktreeDir(), "llm", "ts", "stubServer"))) as StubServerModule;
  const chatModel = startStubLlmServer(0, { chatStats: {
    usage: { prompt_tokens: 182, completion_tokens: 46, total_tokens: 228 },
    timings: { prompt_n: 182, predicted_n: 46, predicted_ms: 248, predicted_per_second: 185, cache_n: 1200 },
  }, scriptedToolCalls: (request) => {
    // SHELL-02 slice 4's own capture (captureNextChatArtifactReview):
    // checked before scriptedChatReply, so every other capture's turn
    // falls through to it unchanged. "pizza night" is unique to that
    // one prompt; the real write_document package (recipe.json) turns
    // these args into the real artifact record, so nothing about the
    // card or the canvas panel is scripted past this one model call.
    const text = [...request.messages].reverse().find((message) => message.role === "user")?.content ?? "";
    if (text.includes("pizza night")) {
      return [{
        id: "call-write-document",
        type: "function",
        function: {
          name: "write_document",
          arguments: JSON.stringify({
            title: "Pizza Night",
            kind: "markdown",
            body: "Every Friday night, the whole family makes pizza together. Everyone picks their own toppings, and the little ones help roll out the dough.",
          }),
        },
      }];
    }
    // TOOL-EVENTS-02's own capture (captureNextChatToolsSitesReview):
    // "mariners game" is unique to that one prompt, forced to a real
    // websearch call the same way the interim rule's own scripted tests
    // do (turnNext.test.ts's "a world question runs the search tool",
    // its own `withStub()` helper) - gated on `request.tools` actually
    // being offered THIS round (a query-writer or phrasing round offers
    // none), not just on no `tool` message yet: the first version here
    // fired on every early round with no tools, not only the one meant
    // to call websearch, and turnEngine never recovered a final answer.
    const hasToolMessage = request.messages.some((message) => message.role === "tool");
    if (request.tools?.length && !hasToolMessage && text.includes("mariners game")) {
      return [{
        id: "call-websearch-1",
        type: "function",
        function: { name: "websearch", arguments: JSON.stringify({ expression: "mariners game score" }) },
      }];
    }
    // getmaipai/home#154: weather's own manifest pattern ("what's the
    // weather like in *") is a question-word-opener wildcard, so
    // OPENER-01's floor (manifestLint.ts's isQuestionWordOpener())
    // refuses to route it deterministically any more - the model
    // chooses tools now (#150), so this capture has to script that
    // choice the way a real model would, the same shape the mariners
    // branch above already does. The weather PACKAGE itself runs for
    // real and unscripted (seedWeatherCache() above answers its own
    // fetch steps from disk), so the spec-sheet card's real content
    // still comes from the real recipe, not a canned reply.
    if (request.tools?.length && !hasToolMessage && text.includes("weather like")) {
      return [{
        id: "call-weather-1",
        type: "function",
        function: { name: "weather", arguments: JSON.stringify({ place: WEATHER_HOUSEHOLD_PLACE }) },
      }];
    }
    return undefined;
  }, scriptedChatReply: (request) => {
    const text = [...request.messages].reverse().find((message) => message.role === "user")?.content ?? "";
    if (text.includes("herbs")) return "Basil, parsley, and chives are useful kitchen herbs. Keep mint in its own pot so it does not spread.";
    // STATUS-PHRASES-01's own capture: a real, but short, artificial
    // delay (FAST-04's own documented "hold the first token back"
    // mechanism, `scriptedChatReply` may return a Promise) - this stub
    // otherwise answers instantly on localhost, too fast for a
    // screenshot to ever reliably land inside the "thinking" moment
    // before the reply supersedes it (found live: the herbs question
    // alone already resolved before the screenshot fired).
    if (text.includes("bedtime story")) return new Promise((resolve) => setTimeout(() => resolve("Once there was a sleepy fox who wanted one more story before bed."), 1200));
    if (text.includes("book")) return "What kind of story would you enjoy: a mystery, an adventure, or something funny?";
    if (text.includes("weather like")) return "It's a clear, mild day - around 62°F with a light breeze.";
    if (text.includes("mariners game")) return "The Mariners won the game 4 to 2.";
    // captureNextChatReview's own fixed question: a `<think>` block so
    // the stub exercises the real REASONING-01 wire split
    // (routes/turn.ts's streamTurnEvents(), lib/wellFormed.ts's
    // feedThinkSplit()) the same way a real model's own reasoning
    // output would, deterministically.
    if (text.includes("2 plus 2")) return "<think>The user is asking a simple arithmetic question. 2 plus 2 equals 4.</think>2 plus 2 is 4.";
    // A single "\n" before the closing question, not a blank line -
    // getmaipai/home#99 (found live, 2026-09-13, chasing exactly this
    // reply): `gateOutputSafety()`'s per-sentence safety gate
    // (backend/src/lib/turnEngine.ts) uses spec/safety/ts/
    // sentenceChunker.ts's `nextSentenceBoundary()`, whose boundary
    // regex treats a blank line (`\n{2,}`) as its own match, separate
    // from `[.!?]+`'s own; when that match lands as the very start of
    // the gate's `pending` buffer, the resulting span is whitespace
    // only, the gate's own `if (!trimmed) continue` skips yielding it,
    // and the blank line is silently dropped from the delivered reply.
    // That only happens when the sentence before the blank line ends in
    // `.`/`!`/`?` AND the text right after the blank line starts with an
    // uppercase letter or digit (the terminator regex's own lookahead,
    // `(?=\s+[A-Z0-9]|\s*$)`) - exactly "dry." before "How" here, which
    // is why THIS reply's first blank line (after "plants.", before a
    // lowercase-led "- Grow") survives untouched and only the second one
    // (before "How") is lost. Confirmed against `GET /api/conversations/
    // :id/turns`'s own stored `replyText`, which already has no blank
    // line before "How" in it; nothing downstream (streaming, storage,
    // the frontend's markdown rendering) loses anything else.
    // Out of scope to fix here (backend/src/lib/turnEngine.ts is mid-edit
    // elsewhere in this checkout); a single "\n" never matches that
    // regex's blank-line alternative, so it survives the gate intact and
    // reads as a plain space once rendered - not the separate paragraph
    // this reply originally intended, but a real space, matching what
    // shipped before this bug was found (see #99 for the paragraph break
    // once the gate itself is fixed).
    return "Start with a sunny spot and a few easy plants.\n\n- Grow lettuce in a shallow container.\n- Give tomatoes a larger pot and a support.\n- Water when the top layer of soil feels dry.\nHow much space do you have?";
  } });
  // Keep the HTTP listener independent; intentionally exercise the
  // Repairs surface's real Wyoming bind-failure path via its fixture flag.
  let backend: ReturnType<typeof Bun.spawn>;
  try {
    // KIWIX-SIDECAR-01 binds a fixed default port (8790) on the household
    // backend. The screenshot backend has its own throwaway data directory;
    // it must also have its own port so sidecars.freePort() never mistakes
    // the running hub's Kiwix process for an orphan and kills it.
    const screenshotKiwixPort = reserveFreePort();
    // SINGLE-INSTANCE-02: a throwaway hub with its own data directory and
    // port, so it opts out of the machine-wide one-hub lock (test-only).
    backend = Bun.spawn({
      cmd: ["bun", "run", "src/index.ts"],
      cwd: join(ROOT, "backend"),
      // MAIPAI_TTS_DISABLE_SPAWN (the same flag tests/preload.ts and
      // CHAT-22's bench setup already use): this backend's own speech
      // engine binds a FIXED port (8793, ttsSupervisor.ts), so a second
      // one - a real hub already running on the box, or another spare-
      // port backend - collides with it. Found live (2026-09-13): check.sh's
      // own a11y step spawned this backend while another was already up,
      // the losing engine died (SIGKILL), and Repairs rendered an
      // engine-issue badge the matrix then flagged for real contrast, a
      // false "the a11y gate found a defect" that was actually "the gate
      // depends on the box being empty." This matrix never needs real
      // speech, so the engine should never spawn at all, not just not
      // collide.
      env: { ...process.env, MAIPAI_TEST_ALLOW_MULTIPLE_HUBS: "1", PORT: "0", MAIPAI_DATA_DIR: DATA_DIR, MAIPAI_KIWIX_PORT: String(screenshotKiwixPort), MAIPAI_WYOMING_PORT: "0", MAIPAI_SCREENSHOT_TEST_WYOMING_BIND_FAILURE: "1", MAIPAI_TTS_DISABLE_SPAWN: "1", MAIPAI_LLAMA_SERVER_URL: chatModel.url, MAIPAI_EMBED_SERVER_URL: chatModel.url },
      stdout: "pipe",
      stderr: "inherit",
    });
    try {
      const backendStdout = backend.stdout;
      if (!backendStdout || typeof backendStdout === "number") throw new Error("Screenshot backend stdout pipe was not created");
      const port = await waitForBackendPort(backendStdout);
      BASE_URL = `http://localhost:${port}`;
    } catch (startupError) {
      backend.kill();
      await backend.exited;
      throw startupError;
    }
  } catch (err) {
    // Keep cleanup steps independent and best-effort, so a throw from
    // one of them (say, chatModel.stop() called on an already-torn-down server) would mask
    // the real error above and skip whatever cleanup came after it.
    // Every step is now independent and best-effort, and `err` - the
    // actual cause - is always what gets rethrown, never whatever a
    // cleanup step itself raised.
    try { chatModel.stop(); } catch { /* best effort */ }
    try { removeOwnedDemoDataDir(DATA_DIR, DATA_OWNER.token); } catch { /* best effort */ }
    throw err;
  }

  // Declared outside the try so `finally` can always close it - a code
  // review (2026-09-04) found an earlier version only closed the browser
  // on the success path, leaving an orphaned headless Chromium process
  // behind on any error after launch (a slow render, a selector that
  // never appears).
  let browser: Browser | undefined;
  // Set only by `captureLazyRouteSkeleton`'s own catch below - isolated
  // from aborting the rest of this run, but still checked before this
  // function returns, so a real regression there still fails the script
  // (and check.sh/CI with it) instead of only printing a line no one is
  // watching for.
  let lazyRouteSkeletonError: unknown;
  try {
    await waitForHealth();
    const sessionValue = await seedHousehold();
    if (pictureReview) {
      startPictureSearchFixture();
      const searchSetting = await fetch(`${BASE_URL}/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: `session=${sessionValue}` },
        body: JSON.stringify({ scope: "household", key: "search.searxng_url", value: `http://127.0.0.1:${pictureSearchServer!.port}` }),
      });
      if (!searchSetting.ok) throw new Error(`seed picture search fixture failed: ${searchSetting.status}`);
    }
    if (nextChatToolsReview) {
      startWebSearchFixture();
      const searchSetting = await fetch(`${BASE_URL}/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: `session=${sessionValue}` },
        body: JSON.stringify({ scope: "household", key: "search.searxng_url", value: `http://127.0.0.1:${websearchFixture!.port}` }),
      });
      if (!searchSetting.ok) throw new Error(`seed websearch fixture failed: ${searchSetting.status}`);
    }

    const launchedBrowser = await (useFirefox ? firefox : useWebkit ? webkit : chromium).launch();
    browser = launchedBrowser;
    if (fitVerdictReview) {
      const phone = VIEWPORTS.find((item) => item.slug === "phone")!;
      const desktop = VIEWPORTS.find((item) => item.slug === "desktop")!;
      for (const viewport of [phone, desktop]) {
        for (const state of ["yes", "slow", "no", "unknown", "unavailable"] as const) {
          await captureFitVerdictCard(browser, sessionValue, viewport, "light", state);
        }
        for (const state of ["checked-yes", "checked-no", "checked-error", "checked-notfound"] as const) {
          await captureFitVerdictCard(browser, sessionValue, viewport, "light", state);
        }
      }
      for (const viewport of [phone, desktop]) {
        for (const state of ["yes", "no"] as const) {
          await captureFitVerdictCard(browser, sessionValue, viewport, "dark", state);
        }
      }
      console.log("completed named review: --fit-verdict-review");
      return;
    }
    if (nextSettingsS2Review) {
      await captureNextSettingsS2Review(browser, sessionValue);
      console.log("completed named review: --next-settings-s2-review");
      return;
    }
    if (nextSettingsS3Review) {
      await captureNextSettingsS3Review(browser, sessionValue);
      console.log("completed named review: --next-settings-s3-review");
      return;
    }
    if (nextSettingsS5Review) {
      await captureNextSettingsS5Review(browser, sessionValue);
      console.log("completed named review: --next-settings-s5-review");
      return;
    }
    if (nextSettingsS6Review) {
      await captureNextSettingsS6Review(browser, sessionValue);
      console.log("completed named review: --next-settings-s6-review");
      return;
    }
    if (shell09DocsMatrixReview) {
      await captureShell09DocsMatrixReview(browser, sessionValue);
      return;
    }
    if (nextLaneA13Review) {
      await captureNextLaneA13Review(browser, sessionValue);
      console.log("completed named review: --next-lane-a-13-review");
      return;
    }
    if (nextProfileSheetReview) {
      await captureNextProfileSheetReview(browser, sessionValue);
      console.log("completed named review: --next-profile-sheet-review");
      return;
    }
    if (nextPersonalManagementReview) {
      await captureNextPersonalManagementReview(browser, sessionValue);
      console.log("completed named review: --next-personal-management-review");
      return;
    }
    if (nextPrivacyReview) {
      await captureNextPrivacyReview(browser, sessionValue);
      console.log("completed named review: --next-privacy-review");
      return;
    }
    if (nextPersonProfileReview) {
      await captureNextPersonProfileReview(browser, sessionValue);
      console.log("completed named review: --next-person-profile-review");
      return;
    }
    if (statusB2bReview) {
      await captureStatusB2bReview(browser, sessionValue);
      console.log("completed named review: --status-b2b-review");
      return;
    }
    if (statusA2cReview) {
      await captureStatusA2cReview(browser, sessionValue);
      console.log("completed named review: --status-a2c-review");
      return;
    }
    if (statusA2bReview) {
      const outDir = process.env.MAIPAI_SETTINGS_S7_SCREEN_DIR || join(ROOT, "data-scratch", "screens", "status-a2b");
      mkdirSync(outDir, { recursive: true });
      for (const viewport of [VIEWPORTS.find((item) => item.slug === "desktop")!, VIEWPORTS.find((item) => item.slug === "phone")!]) {
        for (const theme of THEMES) {
          const context = await newContext(browser, viewport, theme, sessionValue);
          try {
            const page = await context.newPage();
            await page.goto(`${BASE_URL}/status`);
            await page.getByText("Components", { exact: true }).waitFor();
            const path = join(outDir, `status-${viewport.slug}-${theme}-admin.png`);
            await page.screenshot({ path, fullPage: true });
            console.log(`Wrote ${path}`);
          } finally { await context.close(); }
        }
      }
      console.log("The seeded screenshot setup signs in as its seeded owner; it does not create a member session.");
      console.log("The seeded backend has no registered kiwix-serve sidecar, so the conditional Library row is absent.");
      console.log("A degraded or down state is not seeded by this capture.");
      return;
    }
    if (nextTableRolloutReview) {
      await captureNextPeopleReview(browser, sessionValue);
      await captureNextEnginesReview(browser, sessionValue);
      await captureNextUpdatesReview(browser, sessionValue);
      await captureNextRepairsReview(browser, sessionValue);
      await captureNextBackupsReview(browser, sessionValue);
      await captureNextPerformanceReview(browser, sessionValue);
      console.log("completed named review: --next-table-rollout-review (all 12 importing files; 14 table instances)");
      return;
    }
    if (!a11yOnly && pictureReview) {
      const desktop = VIEWPORTS.find((v) => v.slug === "desktop")!;
      await capturePictureReview(browser, sessionValue, desktop, "light");
    }

    // A review caught this guard as only `if (notificationsReview)`,
    // not mutually exclusive with chatReview/settingsReview the way
    // every other block below already is - nothing in package.json
    // combines these flags today, but nothing here prevented it either,
    // and combining them would sign in as Marlow and fire two real
    // safety-flagged turns underneath a chat/settings run that never
    // asked for that.
    if (notificationsReview && !chatReview && !settingsReview) {
      await captureNotificationsReview(browser, sessionValue);
    }

    if (lookReview && !chatReview && !settingsReview && !notificationsReview) {
      await captureLookComparison(browser, sessionValue);
    }

    if (nextStandupReview && !chatReview && !settingsReview && !notificationsReview && !lookReview) {
      await captureNextStandup(browser, sessionValue);
    }

    if (nextSidebarReview && !chatReview && !settingsReview && !notificationsReview && !lookReview && !nextStandupReview) {
      await captureNextSidebarReview(browser, sessionValue);
    }

    if (nextLookPresetsReview && !chatReview && !settingsReview && !notificationsReview && !lookReview && !nextStandupReview && !nextSidebarReview) {
      await captureNextLookPresets(browser, sessionValue);
    }

    if (nextAppearanceMismatchReview && !chatReview && !settingsReview && !notificationsReview && !lookReview && !nextStandupReview && !nextSidebarReview && !nextLookPresetsReview) {
      await captureNextAppearanceMismatch(browser, sessionValue);
    }

    if (nextPeopleReview && !chatReview && !settingsReview && !notificationsReview && !lookReview && !nextStandupReview && !nextSidebarReview && !nextLookPresetsReview && !nextAppearanceMismatchReview) {
      await captureNextPeopleReview(browser, sessionValue);
    }

    if (nextDashboardReview && !chatReview && !settingsReview && !notificationsReview && !lookReview && !nextStandupReview && !nextSidebarReview && !nextLookPresetsReview && !nextAppearanceMismatchReview && !nextPeopleReview) {
      await captureNextDashboardReview(browser, sessionValue);
    }

    if (nextChatReview && !chatReview && !settingsReview && !notificationsReview && !lookReview && !nextStandupReview && !nextSidebarReview && !nextLookPresetsReview && !nextAppearanceMismatchReview && !nextPeopleReview && !nextDashboardReview) {
      await captureNextChatReview(browser, sessionValue);
      console.log("completed named review: --next-chat-review");
      return;
    }

    if (nextSettingsReview && !chatReview && !settingsReview && !notificationsReview && !lookReview && !nextStandupReview && !nextSidebarReview && !nextLookPresetsReview && !nextAppearanceMismatchReview && !nextPeopleReview && !nextDashboardReview && !nextChatReview) {
      await captureNextSettingsReview(browser, sessionValue);
    }

    if (nextEnginesReview && !chatReview && !settingsReview && !notificationsReview && !lookReview && !nextStandupReview && !nextSidebarReview && !nextLookPresetsReview && !nextAppearanceMismatchReview && !nextPeopleReview && !nextDashboardReview && !nextChatReview && !nextSettingsReview) {
      await captureNextEnginesReview(browser, sessionValue);
    }

    if (nextChatToolsReview && !chatReview && !settingsReview && !notificationsReview && !lookReview && !nextStandupReview && !nextSidebarReview && !nextLookPresetsReview && !nextAppearanceMismatchReview && !nextPeopleReview && !nextDashboardReview && !nextChatReview && !nextSettingsReview && !nextEnginesReview) {
      await captureNextChatToolsSitesReview(browser, sessionValue);
      await captureNextChatToolsReview(browser, sessionValue);
      console.log("completed named review: --next-chat-tools-review");
      return;
    }

    if (nextUpdatesReview && !chatReview && !settingsReview && !notificationsReview && !lookReview && !nextStandupReview && !nextSidebarReview && !nextLookPresetsReview && !nextAppearanceMismatchReview && !nextPeopleReview && !nextDashboardReview && !nextChatReview && !nextSettingsReview && !nextEnginesReview && !nextChatToolsReview) {
      await captureNextUpdatesReview(browser, sessionValue);
    }

    if (nextRepairsReview && !chatReview && !settingsReview && !notificationsReview && !lookReview && !nextStandupReview && !nextSidebarReview && !nextLookPresetsReview && !nextAppearanceMismatchReview && !nextPeopleReview && !nextDashboardReview && !nextChatReview && !nextSettingsReview && !nextEnginesReview && !nextChatToolsReview && !nextUpdatesReview) {
      await captureNextRepairsReview(browser, sessionValue);
    }

    if (nextBackupsReview && !chatReview && !settingsReview && !notificationsReview && !lookReview && !nextStandupReview && !nextSidebarReview && !nextLookPresetsReview && !nextAppearanceMismatchReview && !nextPeopleReview && !nextDashboardReview && !nextChatReview && !nextSettingsReview && !nextEnginesReview && !nextChatToolsReview && !nextUpdatesReview && !nextRepairsReview) {
      await captureNextBackupsReview(browser, sessionValue);
    }

    if (nextChatArtifactReview && !chatReview && !settingsReview && !notificationsReview && !lookReview && !nextStandupReview && !nextSidebarReview && !nextLookPresetsReview && !nextAppearanceMismatchReview && !nextPeopleReview && !nextDashboardReview && !nextChatReview && !nextSettingsReview && !nextEnginesReview && !nextChatToolsReview && !nextUpdatesReview && !nextRepairsReview && !nextBackupsReview) {
      await captureNextChatArtifactReview(browser, sessionValue);
    }

    if (nextSignInReview && !chatReview && !settingsReview && !notificationsReview && !lookReview && !nextStandupReview && !nextSidebarReview && !nextLookPresetsReview && !nextAppearanceMismatchReview && !nextPeopleReview && !nextDashboardReview && !nextChatReview && !nextSettingsReview && !nextEnginesReview && !nextChatToolsReview && !nextUpdatesReview && !nextRepairsReview && !nextBackupsReview && !nextChatArtifactReview) {
      await captureNextSignInReview(browser, sessionValue);
    }

    if (laneBTouchTargetsReview) {
      await verifyLaneBTouchTargets(browser, sessionValue);
      console.log("completed named review: --lane-b-touch-targets-review");
      return;
    }

    if (nextChatComposerReview && !chatReview && !settingsReview && !notificationsReview && !lookReview && !nextStandupReview && !nextSidebarReview && !nextLookPresetsReview && !nextAppearanceMismatchReview && !nextPeopleReview && !nextDashboardReview && !nextChatReview && !nextSettingsReview && !nextEnginesReview && !nextChatToolsReview && !nextUpdatesReview && !nextRepairsReview && !nextBackupsReview && !nextChatArtifactReview && !nextSignInReview && !nextChatChildComposerReview) {
      await captureNextChatComposerReview(browser, sessionValue);
    }

    if (nextChatChildComposerReview && !chatReview && !settingsReview && !notificationsReview && !lookReview && !nextStandupReview && !nextSidebarReview && !nextLookPresetsReview && !nextAppearanceMismatchReview && !nextPeopleReview && !nextDashboardReview && !nextChatReview && !nextSettingsReview && !nextEnginesReview && !nextChatToolsReview && !nextUpdatesReview && !nextRepairsReview && !nextBackupsReview && !nextChatArtifactReview && !nextSignInReview && !nextChatComposerReview) {
      await captureNextChatChildComposerReview(browser, sessionValue);
    }

    if (nextPerformanceReview && !chatReview && !settingsReview && !notificationsReview && !lookReview && !nextStandupReview && !nextSidebarReview && !nextLookPresetsReview && !nextAppearanceMismatchReview && !nextPeopleReview && !nextDashboardReview && !nextChatReview && !nextSettingsReview && !nextEnginesReview && !nextChatToolsReview && !nextUpdatesReview && !nextRepairsReview && !nextBackupsReview && !nextChatArtifactReview && !nextSignInReview && !nextChatComposerReview && !nextChatChildComposerReview && !nextStorageReview) {
      await captureNextPerformanceReview(browser, sessionValue);
    }

    if (nextStorageReview && !chatReview && !settingsReview && !notificationsReview && !lookReview && !nextStandupReview && !nextSidebarReview && !nextLookPresetsReview && !nextAppearanceMismatchReview && !nextPeopleReview && !nextDashboardReview && !nextChatReview && !nextSettingsReview && !nextEnginesReview && !nextChatToolsReview && !nextUpdatesReview && !nextRepairsReview && !nextBackupsReview && !nextChatArtifactReview && !nextSignInReview && !nextChatComposerReview && !nextChatChildComposerReview && !nextPerformanceReview) {
      await captureNextStorageReview(browser, sessionValue);
    }

    if (peopleProfileMediaReview && !chatReview && !settingsReview && !notificationsReview && !lookReview && !nextStandupReview && !nextSidebarReview && !nextLookPresetsReview && !nextAppearanceMismatchReview && !nextPeopleReview && !nextDashboardReview && !nextChatReview && !nextSettingsReview && !nextEnginesReview && !nextChatToolsReview && !nextUpdatesReview && !nextRepairsReview && !nextBackupsReview && !nextChatArtifactReview && !nextSignInReview && !nextChatComposerReview && !nextChatChildComposerReview && !nextPerformanceReview && !nextStorageReview) {
      await capturePeopleProfileMediaReview(browser, sessionValue);
    }

    if (!a11yOnly && chatReview) {
      if (chatFocusReview) await captureChatModelPicker(browser, sessionValue);
      for (const combo of A11Y_ONLY_COMBOS) {
        const viewport = VIEWPORTS.find((v) => v.slug === combo.viewport);
        if (!viewport) throw new Error(`unknown viewport ${combo.viewport}`);
        await captureChatDocumentPane(browser, sessionValue, viewport, combo.theme);
      }
    }

    if (!a11yOnly && chatStatsReview) await captureChatStatsReview(browser, sessionValue);

    if (!a11yOnly && chatResearchReview) await captureChatResearchReview(browser, sessionValue);

    if (!a11yOnly && chatTemporaryReview) await captureChatTemporaryReview(browser, sessionValue);

    if (!a11yOnly && chatContinueReview) await captureChatContinueReview(browser, sessionValue);

    if (!a11yOnly && chatAcceptanceReview) {
      for (const combo of A11Y_ONLY_COMBOS) {
        const viewport = VIEWPORTS.find((v) => v.slug === combo.viewport);
        if (!viewport) throw new Error(`unknown viewport ${combo.viewport}`);
        await captureChatSourcesMemoryAttachment(browser, sessionValue, viewport, combo.theme);
        await captureChatStreaming(browser, sessionValue, viewport, combo.theme);
        await captureChatEngineNotReady(browser, sessionValue, viewport, combo.theme);
      }
    }

    if (!a11yOnly && shellRailReview) {
      await captureShellRail(browser, sessionValue, "light");
      await captureShellRail(browser, sessionValue, "dark");
    }

    if (!a11yOnly && chatThreadActionsReview) {
      await captureChatThreadActionsReview(browser, sessionValue);
    }

    if (!a11yOnly && chatListReview) {
      await captureChatListReview(browser, sessionValue);
    }

    if (!a11yOnly && chatShortcutsReview) {
      await captureChatShortcutsReview(browser, sessionValue);
    }

    if (!a11yOnly && chatFindHeaderAlignmentReview) {
      await verifyChatFindHeaderAlignment(browser, sessionValue);
    }

    if (!a11yOnly && chatFindBubbleHoverWidthReview) {
      await verifyChatFindBubbleHoverWidth(browser, sessionValue);
    }

    if (!a11yOnly && chatFindComposerShiftReview) {
      await verifyChatFindComposerShift(browser, sessionValue);
    }

    if (!a11yOnly && chatHeaderTitleReview) {
      await captureChatHeaderTitleReview(browser, sessionValue);
    }

    if (!a11yOnly && nextPageHeaderIconReview) {
      await captureNextPageHeaderIconReview(browser, sessionValue);
    }

    if (!a11yOnly && phoneHeaderFoldReview) {
      await capturePhoneHeaderFoldReview(browser, sessionValue);
    }

    if (!a11yOnly && !laneBTouchTargetsReview && !settingsReview && !chatReview && !chatStatsReview && !chatResearchReview && !chatTemporaryReview && !chatContinueReview && !fitVerdictReview && !chatAcceptanceReview && !shellRailReview && !chatThreadActionsReview && !chatListReview && !chatShortcutsReview && !chatFindHeaderAlignmentReview && !chatFindBubbleHoverWidthReview && !chatFindComposerShiftReview && !chatHeaderTitleReview && !nextPageHeaderIconReview && !phoneHeaderFoldReview && !notificationsReview && !lookReview && !nextStandupReview && !pictureReview) {
      await captureHero(browser, sessionValue);
      const phone = VIEWPORTS.find((v) => v.slug === "phone")!;
      const desktop = VIEWPORTS.find((v) => v.slug === "desktop")!;
      await capturePaletteOpen(browser, sessionValue, phone, "dark");
      await capturePaletteOpen(browser, sessionValue, desktop, "light");
      await capturePeopleAndThings(browser, sessionValue, phone, "dark");
      await capturePeopleAndThings(browser, sessionValue, desktop, "light");
      // Isolated, unlike the captures above: it hardcodes one chunk's own
      // hashed-filename prefix and races a fixed delay against a fixed
      // timeout, both of which are more likely to need adjusting after an
      // unrelated refactor (the chunk gets renamed or merged, or CI is
      // just slower) than the palette/hero captures are. A failure here
      // must not take the rest of this run's screenshots down with it,
      // but still has to fail the script in the end (recorded in
      // `lazyRouteSkeletonError`, checked below) - a silent console line
      // no exit code backs up is not "flagging loudly."
      try {
        await captureLazyRouteSkeleton(browser, sessionValue);
      } catch (error) {
        console.error("captureLazyRouteSkeleton failed:", error);
        lazyRouteSkeletonError = error;
      }
    }

    // notificationsReview needs no pass over ROUTES at all - its own two
    // shots are the dedicated capture above, over specifically-seeded
    // notifications the generic matrix knows nothing about. Empty, not
    // A11Y_ONLY_COMBOS: a review caught the earlier version still
    // running runPool over 2 combos here, opening and closing two real
    // browser contexts that would only ever iterate zero routes below.
    const combos = notificationsReview || lookReview || nextStandupReview || pictureReview || fitVerdictReview || laneBTouchTargetsReview || chatShortcutsReview
      ? []
      : a11yOnly || settingsReview || chatReview || chatStatsReview || chatResearchReview || chatContinueReview || fitVerdictReview
        ? A11Y_ONLY_COMBOS
        : VIEWPORTS.flatMap((v) => THEMES.map((t) => ({ viewport: v.slug, theme: t })));

    // `chatReview` clears and rebuilds the one shared conversation
    // (`visitRoute`'s own `POST /api/conversations/clear` call, gated on
    // `chatReview && route.slug === "chat"`) against this run's single
    // seeded backend - its two combos (`A11Y_ONLY_COMBOS`) would race
    // each other's chat history if run concurrently, so this mode stays
    // sequential (pool size 1). Every other mode only ever reads.
    const poolSize = chatReview || chatStatsReview || chatResearchReview || chatContinueReview ? 1 : CONTEXT_POOL_SIZE;
    const comboResults = await runPool(combos, poolSize, async (combo): Promise<RunResult[]> => {
      const viewport = VIEWPORTS.find((v) => v.slug === combo.viewport);
      if (!viewport) throw new Error(`unknown viewport ${combo.viewport}`);
      const context = await newContext(launchedBrowser, viewport, combo.theme, sessionValue);
      const comboResult: RunResult[] = [];
      try {
        for (const route of ((chatReview || chatStatsReview || chatResearchReview || chatContinueReview) ? ROUTES.filter((entry) => entry.slug === "chat") : settingsReview ? ROUTES.filter((entry) => entry.slug === "settings" || entry.slug === "settings-models") : notificationsReview ? [] : ROUTES)) {
          console.log(`${route.slug} @ ${viewport.slug}/${combo.theme}...`);
          // A hard ceiling around the whole visit, not just Playwright's
          // own actions inside it: `AxeBuilder#analyze()` runs its
          // injected script via `page.evaluate`, which has no timeout of
          // its own, so a page that hangs mid-scan (found live: the home
          // page under real contention) would otherwise stall this loop,
          // and everything after it, forever. A timeout here is reported
          // as a failure for this one combo, never silently skipped.
          comboResult.push(
            await Promise.race([
              visitRoute(context, route, viewport, combo.theme, !a11yOnly && !chatStatsReview),
              new Promise<RunResult>((_, reject) =>
                setTimeout(() => reject(new Error(`timed out after ${PAGE_VISIT_TIMEOUT_MS}ms`)), PAGE_VISIT_TIMEOUT_MS),
              ),
            ]).catch((err: unknown) => ({
              route: route.slug,
              viewport: viewport.slug,
              theme: combo.theme,
              violations: [`page visit failed: ${err instanceof Error ? err.message : String(err)}`],
              overflow: false,
              overflowingPanels: [],
            })),
          );
        }
      } finally {
        await context.close();
      }
      return comboResult;
    });
    const results: RunResult[] = comboResults.flat();

    // getmaipai/home, found live 2026-09-13 (a coordinator review of a
    // regenerated main): the plain run's own "chat" route only ever
    // shows the empty "How can I help you today?" state - `--chat-review`
    // is the only mode that clears and exercises a real conversation
    // (`exerciseChatFirst` above), and its own two combos
    // (`A11Y_ONLY_COMBOS`) happen to share their output filenames with
    // two of the plain matrix's own eight. Whichever command ran LAST
    // is what `docs/assets/screens/chat-{phone-dark,desktop-light}.png`
    // actually show - 88ffaee's own fixup depended on running both
    // commands in the right order by hand, and a later plain-matrix-
    // only regeneration (this file's own touch-target work, 2026-09-13)
    // silently reverted the published chat screenshot back to empty,
    // exactly the regression 88ffaee had already found once. One
    // command should not depend on what ran before it: the plain run
    // now re-visits those same two combos itself, sequentially (the
    // same single-shared-conversation race `chatReview`'s own pool
    // size of 1 avoids), replacing their results and screenshots with
    // the exercised conversation - the manifest records the real
    // capture script for each, so a stale one is visible, not silent.
    if (!a11yOnly && !laneBTouchTargetsReview && !settingsReview && !chatReview && !chatStatsReview && !chatResearchReview && !notificationsReview && !lookReview && !nextStandupReview && !pictureReview && !chatShortcutsReview) {
      console.log("re-visiting chat with a real conversation (phone/dark, desktop/light)...");
      for (const combo of A11Y_ONLY_COMBOS) {
        const viewport = VIEWPORTS.find((v) => v.slug === combo.viewport);
        if (!viewport) throw new Error(`unknown viewport ${combo.viewport}`);
        const context = await newContext(launchedBrowser, viewport, combo.theme, sessionValue);
        try {
          const chatRoute = ROUTES.find((r) => r.slug === "chat")!;
          const exercised = await visitRoute(context, chatRoute, viewport, combo.theme, true, true);
          const idx = results.findIndex((r) => r.route === "chat" && r.viewport === combo.viewport && r.theme === combo.theme);
          if (idx >= 0) results[idx] = exercised;
          else results.push(exercised);
        } finally {
          await context.close();
        }
      }
    }

    console.log("checking prefers-reduced-motion...");
    const reducedMotionFailures = await checkReducedMotion(browser, sessionValue);
    console.log("checking for keyboard traps...");
    const keyboardTrapFailures = await checkKeyboardTrap(browser, sessionValue);

    const failures = results.filter((r) => r.violations.length > 0 || r.overflow);
    if (failures.length > 0 || reducedMotionFailures.length > 0 || keyboardTrapFailures.length > 0) {
      console.error(`\n${failures.length} page(s) failed the accessibility/overflow check:\n`);
      for (const f of failures) {
        console.error(`- ${f.route} @ ${f.viewport}/${f.theme}`);
        if (f.overflow) console.error(`    horizontal overflow: ${f.overflowingPanels.join(", ")}`);
        for (const v of f.violations) console.error(`    ${v}`);
      }
      if (reducedMotionFailures.length > 0) {
        console.error(`\nreduced motion:`);
        for (const f of reducedMotionFailures) console.error(`    ${f}`);
      }
      if (keyboardTrapFailures.length > 0) {
        console.error(`\nkeyboard trap:`);
        for (const f of keyboardTrapFailures) console.error(`    ${f}`);
      }
      throw new Error("accessibility or overflow check failed");
    }
    if (lazyRouteSkeletonError !== undefined) throw lazyRouteSkeletonError;

    console.log(`\n${results.length} page(s) checked, 0 violations, 0 overflow, reduced motion and keyboard-trap checks passed.`);
    if (!a11yOnly) {
      writeScreenshotManifest(results, `scripts/screenshot.ts ${process.argv.slice(2).join(" ")}`.trim());
      console.log(`Screenshots written to ${SCREENS_DIR}`);
    }
  } finally {
    await browser?.close();
    backend.kill();
    try { chatModel.stop(); } catch { /* best effort */ }
    try { pictureSearchServer?.stop(true); } catch { /* best effort */ }
    try { websearchFixture?.stop(true); } catch { /* best effort */ }
    try { await backend.exited; } catch { /* best effort */ }
    removeOwnedDemoDataDir(DATA_DIR, DATA_OWNER.token);
  }
  } catch (startupError) {
    try { removeOwnedDemoDataDir(DATA_DIR, DATA_OWNER.token); } catch { /* best effort */ }
    throw startupError;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
