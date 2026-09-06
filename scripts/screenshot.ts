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
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return;
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

    const axe = await new AxeBuilder({ page }).analyze();
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

    const failures = results.filter((r) => r.violations.length > 0 || r.overflow);
    if (failures.length > 0) {
      console.error(`\n${failures.length} page(s) failed the accessibility/overflow check:\n`);
      for (const f of failures) {
        console.error(`- ${f.route} @ ${f.viewport}/${f.theme}`);
        if (f.overflow) console.error(`    horizontal overflow (scrollWidth > clientWidth)`);
        for (const v of f.violations) console.error(`    ${v}`);
      }
      throw new Error("accessibility or overflow check failed");
    }

    console.log(`\n${results.length} page(s) checked, 0 violations, 0 overflow.`);
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
