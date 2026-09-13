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
import { chromium, webkit, type Browser, type BrowserContext } from "playwright";
import { startStubLlmServer } from "../spec/llm/ts/stubServer";
import AxeBuilder from "@axe-core/playwright";
import { rmSync, mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";

const PORT = 8799;
const ROOT = join(import.meta.dir, "..");
const DATA_DIR = join(ROOT, ".demo-data");
const BASE_URL = `http://localhost:${PORT}`;
const useWebkit = process.argv.includes("--webkit");

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

const a11yOnly = process.argv.includes("--a11y-only");
// Focused review retains the same seeded data, readiness, and a11y checks.
const chatFocusReview = process.argv.includes("--chat-focus-review");
const chatReview = process.argv.includes("--chat-review") || chatFocusReview;
const settingsReview = process.argv.includes("--settings-review");

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
  { slug: "conversations", path: "/conversations" },
  { slug: "search", path: "/search" },
  { slug: "notifications", path: "/notifications" },
  { slug: "people", path: "/people" },
  { slug: "memory", path: "/memory" },
  { slug: "privacy", path: "/privacy" },
  { slug: "settings", path: "/settings" },
  { slug: "settings-models", path: "/settings/models" },
  { slug: "settings-backups", path: "/settings/backups" },
  { slug: "settings-voices", path: "/settings/voices" },
  { slug: "settings-commands", path: "/settings/commands" },
  // Added here 2026-09-06 alongside settings-devices: main's own commit
  // that shipped this page (the People/Users split) never updated this
  // file's own route list - this file's own comment above says "a route
  // added later without an entry here is a real gap," so closing it now
  // rather than leaving Users permanently unchecked by the matrix.
  { slug: "settings-users", path: "/settings/users" },
  { slug: "settings-devices", path: "/settings/devices" },
  { slug: "settings-repairs", path: "/settings/repairs" },
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

// The Home page's weather widget - "Your packages > Weather" (the
// widget grid, WidgetCardNode) - resolves its `place` input via
// `withHouseholdPlaceDefault()` (backend/src/lib/plugins.ts), straight
// from `household.home_place`, so this literal has to match
// `seedHousehold()`'s own PUT of that setting below (both point back to
// this one constant now, so there's only one place to change).
const WEATHER_HOUSEHOLD_PLACE = "Seattle, WA";

// The exact "place" the weather package's deterministic floor captures
// out of the Home page's OTHER weather touchpoint, its fixed question
// (`TodayCard`'s "Weather"), found live (2026-09-13) while chasing why
// that card still failed with a real `household.home_place` seeded:
// `weatherCardQuestion("Seattle, WA")` (backend/src/homeCardQuestions.ts)
// reads "What's the weather like in Seattle, WA today?", and
// weather/manifest.json's own routing pattern ("what's the weather like
// in *") has nothing after the `*` to anchor against, so
// `matchPattern()` (backend/src/lib/turnEngine.ts) captures everything
// to the end of the sentence - "Seattle, WA today", trailing "today" and
// all, not "Seattle, WA" - confirmed by calling that exact function
// against that exact question. Filed as getmaipai/home#98 (the same
// shape as #92, a literal pattern claiming more than its argument; out
// of this lane's scope to fix). Derived from `WEATHER_HOUSEHOLD_PLACE`
// rather than a second hand-typed literal (a code review, 2026-09-13,
// caught the first draft risking the two drifting apart), and kept as
// its OWN cache key below rather than folded into that one, so this
// fixture matches today's real, buggy capture; kept alongside the plain
// key, not instead of it, so the fixture still answers once #98 is
// fixed and the capture goes back to the plain place.
const WEATHER_CAPTURED_PLACE = `${WEATHER_HOUSEHOLD_PLACE} today`;

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
// (`WEATHER_CAPTURED_PLACE`, `WEATHER_HOUSEHOLD_PLACE`), so the weather
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
  const forecastUrl = "https://api.open-meteo.com/v1/forecast?latitude=47.60621&longitude=-122.33207&current=temperature_2m&temperature_unit=fahrenheit";
  const forecastValue = { current: { time: new Date().toISOString().slice(0, 16), temperature_2m: 57.3 } };

  const entries: Array<[string, unknown]> = [
    [`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${WEATHER_CAPTURED_PLACE}`, geocodeValue],
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
  // above (and, with " today" appended, its `WEATHER_CAPTURED_PLACE` too)
  // - change this and change those.
  const place = await fetch(`${BASE_URL}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: `session=${sessionValue}` },
    body: JSON.stringify({ scope: "household", key: "household.home_place", value: "Seattle, WA" }),
  });
  if (!place.ok) throw new Error(`seed household.home_place failed: ${place.status}`);

  return sessionValue;
}

const PAGE_VISIT_TIMEOUT_MS = chatReview ? 90000 : 30000;

async function newContext(browser: Browser, viewport: ViewportSpec, theme: "light" | "dark", sessionValue: string): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme: theme,
    userAgent: viewport.userAgent,
    isMobile: viewport.slug === "phone",
    hasTouch: viewport.slug === "phone",
  });
  await context.addCookies([{ name: "session", value: sessionValue, url: BASE_URL }]);
  return context;
}

interface RunResult {
  route: string;
  viewport: string;
  theme: string;
  violations: string[];
  overflow: boolean;
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
async function visitRoute(context: BrowserContext, route: RouteSpec, viewport: ViewportSpec, theme: string, saveScreenshot: boolean): Promise<RunResult> {
  const page = await context.newPage();
  page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
  try {
    await page.goto(`${BASE_URL}${route.path}`);
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 });
    // A spinner can legitimately appear mid-load before the page's own h1
    // exists at all (App.tsx's own "Loading MaiPai Home" gate); once the
    // h1 is there, any [role="status"] still around is stuck, not "still
    // loading" - the whole point of waiting for the real shell first.
    await page.locator('[role="status"]').first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});

    if (chatReview && route.slug === "chat") {
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
    const clippedStrips = await page.evaluate(() => {
      const strips = document.querySelectorAll(".overflow-x-auto");
      let clipped = 0;
      for (const strip of strips) {
        const stripBottom = strip.getBoundingClientRect().bottom;
        if (Array.from(strip.children).some((column) => column.getBoundingClientRect().bottom > stripBottom + 1)) clipped++;
      }
      return clipped;
    });
    if (clippedStrips > 0) throw new Error(`${clippedStrips} horizontally-scrollable row(s) are shorter than their own content, clipping what they hold (the WhoIsHere/MediaShelf 'overflow-x-auto computes overflow-y too' quirk)`);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );

    // Every animated element (message bubbles, action bars, ...) must be
    // settled before axe reads computed color/contrast, not after - see
    // settleAnimations' own comment for why this moved here and stopped
    // being chat-only.
    await settleAnimations(page);

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

    let screenshotFile: string | undefined;
    if (saveScreenshot) {
      mkdirSync(SCREENS_DIR, { recursive: true });
      screenshotFile = `${route.slug}-${viewport.slug}-${theme}.png`;
      await page.screenshot({ path: join(SCREENS_DIR, screenshotFile), fullPage: true });
    }

    return { route: route.slug, viewport: viewport.slug, theme, violations, overflow, screenshotFile };
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
  const firstUrl = page.url();
  if (!new URL(firstUrl).searchParams.get("conversation")) throw new Error("Chat did not persist its conversation id in the URL");
  await page.reload();
  await page.locator('[data-role="user"]').getByText("Help me plan a small garden", { exact: true }).waitFor();
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
  await page.reload();
  await page.getByText("And some herbs for cooking", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Show threads" }).click();
  const item = page.locator('[data-slot="aui_thread-list-item"]').filter({ has: page.getByRole("button", { name: "Help me plan a small garden", exact: true }) });
  await item.getByRole("button", { name: "More options" }).click();
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  await page.getByRole("textbox", { name: "Rename thread" }).fill("Garden plans");
  await page.getByRole("textbox", { name: "Rename thread" }).press("Enter");
  await page.getByRole("button", { name: "Garden plans", exact: true }).waitFor();
  await page.reload();
  await page.getByRole("button", { name: "Show threads" }).click();
  await page.getByRole("button", { name: "Garden plans", exact: true }).waitFor();
  await settleAnimations(page);
  await page.screenshot({ path: join(SCREENS_DIR, `chat-history-${viewport.slug}-${theme}.png`) });
  const other = page.locator('[data-slot="aui_thread-list-item"]').filter({ has: page.getByRole("button", { name: "Help me choose a book", exact: true }) }).last();
  await other.getByRole("button", { name: "More options" }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete chat", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.reload();
  await page.getByRole("button", { name: "Show threads" }).click();
  await page.getByRole("button", { name: "Garden plans", exact: true }).waitFor();
  if (await page.getByRole("button", { name: "Help me choose a book", exact: true }).count()) throw new Error("Deleted chat returned after reload");
  await page.getByRole("button", { name: "Hide threads" }).click();
  await page.getByText("And some herbs for cooking", { exact: true }).waitFor();
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

/** Reads the header's profile-switcher trigger's own computed
 * transition-duration (`ProfileSwitcher.tsx`'s own `Button`, a real,
 * always-mounted element on every signed-in route regardless of that
 * route's own body - its Popover content, unlike the trigger itself, is
 * the part that only mounts when opened) under the given `reducedMotion`
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
    const trigger = page.locator('button[aria-label*="switch profile or sign out"]');
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
  if (withFiles.length === 0) return;
  const manifestPath = join(SCREENS_DIR, "manifest.json");
  const existing: Record<string, ManifestEntry> = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf-8")) : {};
  const capturedAt = new Date().toISOString();
  for (const r of withFiles) {
    existing[r.screenshotFile] = { route: r.route, viewport: r.viewport, theme: r.theme, capturedAt, captureScript };
  }
  mkdirSync(SCREENS_DIR, { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(existing, null, 2) + "\n");
}

async function main() {
  console.log("Building the frontend so the backend has something to serve...");
  const build = Bun.spawnSync({
    cmd: ["bun", "run", "build"],
    cwd: join(ROOT, "frontend"),
    stdout: "inherit",
    stderr: "inherit",
  });
  if (build.exitCode !== 0) throw new Error("frontend build failed");

  if (existsSync(DATA_DIR)) rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
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
  const chatModel = startStubLlmServer(0, { scriptedChatReply: (request) => {
    const text = [...request.messages].reverse().find((message) => message.role === "user")?.content ?? "";
    if (text.includes("herbs")) return "Basil, parsley, and chives are useful kitchen herbs. Keep mint in its own pot so it does not spread.";
    if (text.includes("book")) return "What kind of story would you enjoy: a mystery, an adventure, or something funny?";
    if (text.includes("weather like")) return "It's a clear, mild day - around 62°F with a light breeze.";
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
  // Occupies REPAIR_SEED_PORT ourselves before the backend starts, so its
  // own Wyoming satellite server (backend/src/index.ts) fails to bind and
  // raises a real Repairs issue ("The Wyoming satellite server failed to
  // start") every run - the settings-repairs route otherwise renders an
  // empty list, and its severity Badge (a real color-contrast bug, found
  // live 2026-09-13 only because a DIFFERENT failure - an engine dying
  // under port contention - happened to raise one) went unexercised by
  // this matrix indefinitely. A real application failure, not a fake
  // database row: nothing about the fix below depends on this being the
  // SPECIFIC issue it happens to be, only that Repairs has at least one
  // open, real, severity-carrying issue on every run.
  const REPAIR_SEED_PORT = 18799;
  // `0.0.0.0`, matching wyomingServer.ts's own bind address exactly - a
  // loopback-only listener here (127.0.0.1) does NOT collide with the
  // backend's wildcard bind on the same port (confirmed live, macOS: the
  // Wyoming server bound successfully anyway, "MaiPai Home Wyoming
  // satellite server listening on tcp://0.0.0.0:18799", and no issue was
  // raised - two listeners on the same port but different specific
  // addresses coexist under BSD socket semantics unless both bind the
  // same wildcard address).
  const repairSeedListener = Bun.listen({ hostname: "0.0.0.0", port: REPAIR_SEED_PORT, socket: { data() {}, open() {} } });
  const backend = Bun.spawn({
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
    env: { ...process.env, PORT: String(PORT), MAIPAI_DATA_DIR: DATA_DIR, MAIPAI_WYOMING_PORT: String(REPAIR_SEED_PORT), MAIPAI_TTS_DISABLE_SPAWN: "1", MAIPAI_LLAMA_SERVER_URL: chatModel.url, MAIPAI_EMBED_SERVER_URL: chatModel.url },
    stdout: "ignore",
    stderr: "inherit",
  });

  // Declared outside the try so `finally` can always close it - a code
  // review (2026-09-04) found an earlier version only closed the browser
  // on the success path, leaving an orphaned headless Chromium process
  // behind on any error after launch (a slow render, a selector that
  // never appears).
  let browser: Browser | undefined;
  try {
    await waitForHealth();
    const sessionValue = await seedHousehold();

    const launchedBrowser = await (useWebkit ? webkit : chromium).launch();
    browser = launchedBrowser;

    if (!a11yOnly && !settingsReview && !chatReview) await captureHero(browser, sessionValue);

    const combos = a11yOnly || settingsReview || chatReview
      ? A11Y_ONLY_COMBOS
      : VIEWPORTS.flatMap((v) => THEMES.map((t) => ({ viewport: v.slug, theme: t })));

    // `chatReview` clears and rebuilds the one shared conversation
    // (`visitRoute`'s own `POST /api/conversations/clear` call, gated on
    // `chatReview && route.slug === "chat"`) against this run's single
    // seeded backend - its two combos (`A11Y_ONLY_COMBOS`) would race
    // each other's chat history if run concurrently, so this mode stays
    // sequential (pool size 1). Every other mode only ever reads.
    const poolSize = chatReview ? 1 : CONTEXT_POOL_SIZE;
    const comboResults = await runPool(combos, poolSize, async (combo): Promise<RunResult[]> => {
      const viewport = VIEWPORTS.find((v) => v.slug === combo.viewport);
      if (!viewport) throw new Error(`unknown viewport ${combo.viewport}`);
      const context = await newContext(launchedBrowser, viewport, combo.theme, sessionValue);
      const comboResult: RunResult[] = [];
      try {
        for (const route of (chatReview ? ROUTES.filter((entry) => entry.slug === "chat") : settingsReview ? ROUTES.filter((entry) => entry.slug === "settings" || entry.slug === "settings-models") : ROUTES)) {
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
              visitRoute(context, route, viewport, combo.theme, !a11yOnly),
              new Promise<RunResult>((_, reject) =>
                setTimeout(() => reject(new Error(`timed out after ${PAGE_VISIT_TIMEOUT_MS}ms`)), PAGE_VISIT_TIMEOUT_MS),
              ),
            ]).catch((err: unknown) => ({
              route: route.slug,
              viewport: viewport.slug,
              theme: combo.theme,
              violations: [`page visit failed: ${err instanceof Error ? err.message : String(err)}`],
              overflow: false,
            })),
          );
        }
      } finally {
        await context.close();
      }
      return comboResult;
    });
    const results: RunResult[] = comboResults.flat();

    console.log("checking prefers-reduced-motion...");
    const reducedMotionFailures = await checkReducedMotion(browser, sessionValue);
    console.log("checking for keyboard traps...");
    const keyboardTrapFailures = await checkKeyboardTrap(browser, sessionValue);

    const failures = results.filter((r) => r.violations.length > 0 || r.overflow);
    if (failures.length > 0 || reducedMotionFailures.length > 0 || keyboardTrapFailures.length > 0) {
      console.error(`\n${failures.length} page(s) failed the accessibility/overflow check:\n`);
      for (const f of failures) {
        console.error(`- ${f.route} @ ${f.viewport}/${f.theme}`);
        if (f.overflow) console.error(`    horizontal overflow (scrollWidth > clientWidth)`);
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

    console.log(`\n${results.length} page(s) checked, 0 violations, 0 overflow, reduced motion and keyboard-trap checks passed.`);
    if (!a11yOnly) {
      writeScreenshotManifest(results, `scripts/screenshot.ts ${process.argv.slice(2).join(" ")}`.trim());
      console.log(`Screenshots written to ${SCREENS_DIR}`);
    }
  } finally {
    await browser?.close();
    backend.kill();
    chatModel.stop();
    repairSeedListener.stop(true);
    await backend.exited;
    rmSync(DATA_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
