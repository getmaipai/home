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
import { chromium, type Browser, type BrowserContext } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const PORT = 8799;
const ROOT = join(import.meta.dir, "..");
const DATA_DIR = join(ROOT, ".demo-data");
const BASE_URL = `http://localhost:${PORT}`;
const SCREENS_DIR = join(ROOT, "docs", "assets", "screens");
const HERO_PATH = join(ROOT, "docs", "assets", "hero.png");

const a11yOnly = process.argv.includes("--a11y-only");

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
  return sessionValue;
}

const PAGE_VISIT_TIMEOUT_MS = 30000;

async function newContext(browser: Browser, viewport: ViewportSpec, theme: "light" | "dark", sessionValue: string): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme: theme,
    userAgent: viewport.userAgent,
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

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );

    // Explicit tags, not axe's own bare default run (session E step 7):
    // axe-core's default excludes newer WCAG 2.1/2.2 success criteria
    // unless a version ships them pre-enabled, which drifts silently
    // across @axe-core/playwright bumps. Naming every tag this app is
    // actually held to - WCAG 2.2 AA plus axe's own best-practice set -
    // means an upgrade can only add coverage, never quietly drop it.
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
      .analyze();
    const violations = axe.violations.map((v) => `${v.id} (${v.impact ?? "unknown"}): ${v.nodes.length} node(s) - ${v.help}`);

    if (saveScreenshot) {
      mkdirSync(SCREENS_DIR, { recursive: true });
      await page.screenshot({ path: join(SCREENS_DIR, `${route.slug}-${viewport.slug}-${theme}.png`), fullPage: true });
    }

    return { route: route.slug, viewport: viewport.slug, theme, violations, overflow };
  } finally {
    await page.close();
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
    mkdirSync(join(ROOT, "docs", "assets"), { recursive: true });
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
    const MAX_TAB_PRESSES = 60;
    const MAX_PERIOD = 10;
    const REPEATS_REQUIRED = 3;
    const visited: string[] = [];
    for (let i = 0; i < MAX_TAB_PRESSES; i++) {
      await page.keyboard.press("Tab");
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
            `keyboard trap suspected: focus repeated the same ${period}-element cycle ${REPEATS_REQUIRED} times in a row after ${visited.length} Tab presses (${cycle.join(" -> ")})`,
          ];
        }
      }
    }
    return [];
  } finally {
    await context.close();
  }
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

  console.log("Starting a throwaway backend on a temp data dir...");
  const backend = Bun.spawn({
    cmd: ["bun", "run", "src/index.ts"],
    cwd: join(ROOT, "backend"),
    env: { ...process.env, PORT: String(PORT), MAIPAI_DATA_DIR: DATA_DIR },
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

    browser = await chromium.launch();

    if (!a11yOnly) await captureHero(browser, sessionValue);

    const combos = a11yOnly
      ? A11Y_ONLY_COMBOS
      : VIEWPORTS.flatMap((v) => THEMES.map((t) => ({ viewport: v.slug, theme: t })));

    const results: RunResult[] = [];
    for (const combo of combos) {
      const viewport = VIEWPORTS.find((v) => v.slug === combo.viewport);
      if (!viewport) throw new Error(`unknown viewport ${combo.viewport}`);
      const context = await newContext(browser, viewport, combo.theme, sessionValue);
      try {
        for (const route of ROUTES) {
          console.log(`${route.slug} @ ${viewport.slug}/${combo.theme}...`);
          // A hard ceiling around the whole visit, not just Playwright's
          // own actions inside it: `AxeBuilder#analyze()` runs its
          // injected script via `page.evaluate`, which has no timeout of
          // its own, so a page that hangs mid-scan (found live: the home
          // page under real contention) would otherwise stall this loop,
          // and everything after it, forever. A timeout here is reported
          // as a failure for this one combo, never silently skipped.
          results.push(
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
    if (!a11yOnly) console.log(`Screenshots written to ${SCREENS_DIR}`);
  } finally {
    await browser?.close();
    backend.kill();
    await backend.exited;
    rmSync(DATA_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
