// MOBILE-LIVE-01: the phone-width smoke walk. Driven by `bun run screenshots
// --mobile-smoke` (scripts/screenshot.ts starts the seeded demo backend: a
// throwaway, owner-marked demo-data directory, persona names only, headless,
// its own port; it never touches the live hub on 8787 or Jesse's household).
//
// What it does, at 390x844 with touch and a phone user agent, using real taps:
//   1. Signs in through the real sign-in screen, as a demo person whose
//      credential is a 4-digit PIN (the numeric keypad path), then as the demo
//      owner whose credential is a password (the "Use a password instead"
//      path).
//   2. Opens every item in the main menu (the phone tab bar and its More
//      sheet), plus Chat, one at a time.
//   3. Fails the run on any console error, uncaught page exception, failed
//      same-origin request that is not a deliberate 4xx, or horizontal page
//      scroll, and saves a PNG per step under the output directory so a person
//      (or the agent that ran it) can open each one and judge it.
//
// Pure helpers (`findHorizontalOverflow`, `isIgnorableConsoleError`) are
// exported for scripts/mobileSmoke.test.ts.
import type { Browser, BrowserContext, ConsoleMessage, Page } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { networkInterfaces } from "node:os";

/** The address a phone on the tailnet or the home Wi-Fi really uses: plain
 * http on a non-loopback host, which a browser does NOT treat as a secure
 * context (no `crypto.randomUUID`, no `navigator.mediaDevices`, no
 * `navigator.clipboard`, no service worker). Every earlier capture ran on
 * `localhost`, which browsers treat as secure, so a crash that only exists on
 * an insecure origin could never show up. Override with
 * MAIPAI_MOBILE_SMOKE_HOST; null when this machine has no such address. */
export function phoneReachableHost(): string | null {
  const forced = process.env.MAIPAI_MOBILE_SMOKE_HOST;
  if (forced) return forced;
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === "IPv4" && !a.internal) return a.address;
  }
  return null;
}

export const PHONE_VIEWPORT = { width: 390, height: 844 } as const;
export const PHONE_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

export interface SmokeFinding {
  step: string;
  kind: "console-error" | "page-error" | "horizontal-scroll" | "step-failed";
  detail: string;
}

/** A page is wider than the phone when its document scrolls sideways. A 1px
 * tolerance absorbs sub-pixel rounding. */
export function findHorizontalOverflow(metrics: { scrollWidth: number; clientWidth: number }): string | null {
  if (metrics.scrollWidth > metrics.clientWidth + 1) {
    return `document is ${metrics.scrollWidth}px wide in a ${metrics.clientWidth}px window`;
  }
  return null;
}

/** Console noise that is not an app defect. Deliberately short: a new entry
 * needs a reason here. A 401 on /api/auth/me before sign-in is the app asking
 * "who am I?" and getting a correct "nobody yet". */
export function isIgnorableConsoleError(text: string, pageUrl: string): boolean {
  if (/Failed to load resource: the server responded with a status of 401/.test(text) && /\/sign-in|\/setup/.test(pageUrl)) return true;
  return false;
}

export interface MobileSmokeOptions {
  browser: Browser;
  baseUrl: string;
  outDir: string;
  /** The demo owner's password (seed). */
  ownerName: string;
  ownerSecret: string;
  /** A demo person created for the keypad path. */
  pinName: string;
  pin: string;
  log?: (line: string) => void;
}

export interface MobileSmokeResult {
  findings: SmokeFinding[];
  captures: string[];
}

async function newPhoneContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    viewport: { ...PHONE_VIEWPORT },
    userAgent: PHONE_USER_AGENT,
    isMobile: true,
    hasTouch: true,
    colorScheme: "light",
    reducedMotion: "reduce",
  });
}

export async function runMobileSmoke(opts: MobileSmokeOptions): Promise<MobileSmokeResult> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const host = phoneReachableHost();
  if (host) {
    const url = new URL(opts.baseUrl);
    url.hostname = host;
    opts = { ...opts, baseUrl: url.origin };
  }
  log(`mobile-smoke: driving ${opts.baseUrl} (${host ? "insecure plain-http origin, like a phone on the tailnet" : "localhost only: no phone-reachable address on this machine"})`);
  mkdirSync(opts.outDir, { recursive: true });
  const findings: SmokeFinding[] = [];
  const captures: string[] = [];
  let currentStep = "start";
  const recentFailures: string[] = [];

  const watch = (page: Page) => {
    page.on("console", (msg: ConsoleMessage) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      if (isIgnorableConsoleError(text, page.url())) return;
      findings.push({ step: currentStep, kind: "console-error", detail: `${text} @ ${page.url()} (recent failed requests: ${recentFailures.join("; ") || "none"})` });
    });
    page.on("response", (res) => {
      if (res.status() >= 400) recentFailures.push(`${res.status()} ${res.request().method()} ${new URL(res.url()).pathname}`);
      if (recentFailures.length > 8) recentFailures.shift();
    });
    page.on("pageerror", (err) => {
      findings.push({ step: currentStep, kind: "page-error", detail: `${err.message}\n${err.stack ?? ""}` });
    });
  };

  const capture = async (page: Page, name: string) => {
    const file = join(opts.outDir, `${name}.png`);
    await page.screenshot({ path: file });
    captures.push(file);
  };

  const checkOverflow = async (page: Page, step: string) => {
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    const problem = findHorizontalOverflow(metrics);
    if (problem) findings.push({ step, kind: "horizontal-scroll", detail: problem });
  };

  const walkMenu = async (page: Page, prefix: number) => {
    const entries = await readMenuEntries(page);
    log(`mobile-smoke: menu items found: ${entries.map((e) => `${e.label} (${e.href})`).join(", ") || "(none)"}`);
    if (entries.length === 0) findings.push({ step: "menu", kind: "step-failed", detail: "no menu items found at phone width" });
    for (const [index, entry] of entries.entries()) {
      const slug = entry.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";
      await step(page, `${prefix}-menu-${String(index).padStart(2, "0")}-${slug}`, async () => {
        await openMenuEntry(page, entry);
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.getByRole("heading", { level: 1 }).first().waitFor();
      });
    }
  };

  const step = async (page: Page, name: string, fn: () => Promise<void>) => {
    currentStep = name;
    log(`mobile-smoke: ${name}`);
    try {
      await fn();
      await page.waitForTimeout(400);
      await capture(page, name);
      await checkOverflow(page, name);
    } catch (error) {
      findings.push({ step: name, kind: "step-failed", detail: error instanceof Error ? error.message : String(error) });
      await capture(page, `${name}-FAILED`).catch(() => {});
    }
  };

  // 1a. PIN person: profile tap -> numeric keypad -> 4 digits auto-submit.
  const pinContext = await newPhoneContext(opts.browser);
  try {
    const page = await pinContext.newPage();
    page.setDefaultTimeout(15000);
    watch(page);
    await step(page, "01-sign-in-picker", async () => {
      await page.goto(`${opts.baseUrl}/sign-in`);
      const secure = await page.evaluate(() => window.isSecureContext);
      log(`mobile-smoke: isSecureContext=${secure}`);
      await page.getByRole("button", { name: opts.pinName }).waitFor();
    });
    await step(page, "02-sign-in-keypad", async () => {
      await page.getByRole("button", { name: opts.pinName }).tap();
      const pad = page.locator('[data-slot="input-otp"]');
      await pad.waitFor();
      const mode = await pad.getAttribute("inputmode");
      if (mode !== "numeric") throw new Error(`the sign-in credential field has inputmode=${mode}, not numeric`);
      if ((await page.locator('input[type="password"], input[type="text"]').count()) > 0) {
        throw new Error("a plain text or password box is showing instead of the numeric keypad");
      }
    });
    await step(page, "03-signed-in-with-pin", async () => {
      await page.keyboard.type(opts.pin, { delay: 60 });
      await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 15000 });
      await page.getByRole("heading", { level: 1 }).first().waitFor();
    });

    await walkMenu(page, 10);
  } finally {
    await pinContext.close();
  }

  // 1a-bis. Desktop width: the keypad is the only sign-in at every width, so
  // the same PIN path must show it (no text or password box) at 1280x800 and
  // accept the PIN typed on a hardware keyboard.
  const desktopContext = await opts.browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "light", reducedMotion: "reduce" });
  try {
    const page = await desktopContext.newPage();
    page.setDefaultTimeout(15000);
    watch(page);
    await step(page, "40-desktop-keypad", async () => {
      await page.goto(`${opts.baseUrl}/sign-in`);
      await page.getByRole("button", { name: opts.pinName }).click();
      const pad = page.locator('[data-slot="input-otp"]');
      await pad.waitFor();
      if ((await page.locator('input[type="password"], input[type="text"]').count()) > 0) {
        throw new Error("desktop: a plain text or password box is showing instead of the keypad");
      }
    });
    await step(page, "41-desktop-signed-in", async () => {
      await page.keyboard.type(opts.pin, { delay: 60 });
      await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 15000 });
      await page.getByRole("heading", { level: 1 }).first().waitFor();
    });
  } finally {
    await desktopContext.close();
  }

  // 1b. Owner password: profile tap -> keypad -> "Use a password instead".
  const ownerContext = await newPhoneContext(opts.browser);
  try {
    const page = await ownerContext.newPage();
    page.setDefaultTimeout(15000);
    watch(page);
    await step(page, "20-owner-password-fallback", async () => {
      await page.goto(`${opts.baseUrl}/sign-in`);
      await page.getByRole("button", { name: opts.ownerName }).tap();
      await page.locator('[data-slot="input-otp"]').waitFor();
      await page.getByRole("button", { name: /use a password instead/i }).tap();
      const field = page.locator('input[type="password"]');
      await field.waitFor();
      await field.fill(opts.ownerSecret);
      await page.getByRole("button", { name: /^sign in$/i }).tap();
      await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 15000 });
      await page.getByRole("heading", { level: 1 }).first().waitFor();
    });
    await walkMenu(page, 30);
  } finally {
    await ownerContext.close();
  }

  return { findings, captures };
}

export interface MenuEntry {
  label: string;
  href: string;
}

/** Every visible link in the main menu at phone width. Today that is the
 * permanent left rail (icon only: the label is the link's aria-label or
 * title); a tab bar or a More sheet, if the shell ever grows one back, is
 * picked up too because the walk reads any visible link inside a `nav` or the
 * sidebar and opens a More button's dialog when one exists. */
export async function readMenuEntries(page: Page): Promise<MenuEntry[]> {
  const read = () =>
    page.evaluate(() => {
      const out: Array<{ label: string; href: string }> = [];
      const seen = new Set<string>();
      for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>("nav a[href], [data-sidebar] a[href], [role=dialog] a[href]"))) {
        const rect = a.getBoundingClientRect();
        const style = getComputedStyle(a);
        if (rect.width === 0 || rect.height === 0 || style.visibility === "hidden" || style.display === "none") continue;
        const href = a.getAttribute("href") ?? "";
        if (!href.startsWith("/") || seen.has(href)) continue;
        const label = (a.getAttribute("aria-label") ?? a.textContent ?? a.getAttribute("title") ?? "").trim().split("\n")[0]?.trim() || href;
        seen.add(href);
        out.push({ label, href });
      }
      return out;
    });
  const entries = await read();
  const more = page.getByRole("button", { name: /^more$/i });
  if (await more.count()) {
    await more.first().tap();
    await page.waitForTimeout(400);
    for (const extra of await read()) if (!entries.some((e) => e.href === extra.href)) entries.push(extra);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  return entries;
}

export async function openMenuEntry(page: Page, entry: MenuEntry): Promise<void> {
  const link = page.locator(`a[href="${entry.href}"]`).filter({ visible: true }).first();
  if (await link.count()) {
    await link.tap();
    return;
  }
  await page.getByRole("button", { name: /^more$/i }).first().tap();
  await page.locator(`[role=dialog] a[href="${entry.href}"]`).first().tap();
}
