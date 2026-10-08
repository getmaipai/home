// SETTINGS-APPEARANCE-01: proves, in a real Chromium render against a
// throwaway seeded demo household (Sage, Marlow, Nova: persona roster names
// only), that
//   - every look (`ui.look`) changes the computed primary colour, in light
//     and in dark, and
//   - every profile accent (`Person.accent`) changes the computed colour of
//     the selected settings-nav pill to the kit's own swatch, in light and
//     in dark, with readable text on it.
// It writes one screenshot per look and per accent and theme to
// data-scratch/screenshots/appearance-*.png for a person to open and judge.
//
// Run: `bun run scripts/screenshotAppearance.ts` (builds the frontend first;
// `--skip-build` reuses frontend/dist). Headless only, nothing outside the
// repo and a temp data directory is touched.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { reserveFreePort } from "../backend/tests/fixtures/reserveFreePort";
import { waitForBackendPort } from "./screenshotRuntime";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "data-scratch", "screenshots");
const LOOKS = ["neutral", "stone", "zinc", "mauve", "olive", "mist", "taupe", "navy"] as const;
const ACCENTS = ["blue", "violet", "teal", "orange", "pink", "red"] as const;
const SCHEMES = ["light", "dark"] as const;
const PAGE = "/settings/profile/profile";

if (!process.argv.includes("--skip-build")) {
  const build = Bun.spawnSync({ cmd: ["bun", "run", "build"], cwd: join(ROOT, "frontend"), stdout: "inherit", stderr: "inherit" });
  if (build.exitCode !== 0) throw new Error("frontend build failed");
}
mkdirSync(OUT, { recursive: true });

const DATA = mkdtempSync(join(tmpdir(), "appearance-shots-"));
const backend = Bun.spawn({
  cmd: ["bun", "run", "src/index.ts"],
  cwd: join(ROOT, "backend"),
  env: { ...process.env, MAIPAI_TEST_ALLOW_MULTIPLE_HUBS: "1", MAIPAI_MDNS: "off", PORT: "0", MAIPAI_DATA_DIR: DATA, MAIPAI_KIWIX_PORT: String(reserveFreePort()), MAIPAI_WYOMING_PORT: "0" },
  stdout: "pipe",
  stderr: "inherit",
});

function fail(message: string): never {
  throw new Error(`appearance check failed: ${message}`);
}

/** Relative luminance contrast of two computed `rgb()`/`color()` strings,
 * read through a canvas so any CSS colour syntax resolves to sRGB. */
async function contrast(page: Page, a: string, b: string): Promise<number> {
  return page.evaluate(([x, y]) => {
    const ctx = document.createElement("canvas").getContext("2d", { colorSpace: "srgb" })!;
    const rgb = (c: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0]!, d[1]!, d[2]!];
    };
    const lum = (c: number[]) => {
      const [r, g, bl] = c.map((v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }) as [number, number, number];
      return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    };
    const [l1, l2] = [lum(rgb(x!)), lum(rgb(y!))];
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }, [a, b] as const);
}

try {
  const BASE = `http://localhost:${await waitForBackendPort(backend.stdout as ReadableStream<Uint8Array>)}`;
  const setup = await fetch(`${BASE}/api/auth/setup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Sage", secret: "correcthorsebattery" }) });
  if (!setup.ok) fail(`setup ${setup.status}`);
  const session = setup.headers.get("set-cookie")!.split(";")[0]!.split("=")[1]!;
  const H = { "Content-Type": "application/json", Cookie: `session=${session}` };
  for (const person of [{ displayName: "Marlow", role: "teen" }, { displayName: "Nova", role: "child" }]) {
    const res = await fetch(`${BASE}/api/people`, { method: "POST", headers: H, body: JSON.stringify(person) });
    if (!res.ok) fail(`seed ${person.displayName} ${res.status}`);
  }
  const people = (await (await fetch(`${BASE}/api/people`, { headers: H })).json()) as Array<{ id: string; display_name: string }>;
  const sage = people.find((p) => p.display_name === "Sage") ?? fail("no Sage");
  const setLook = async (look: string) => {
    const res = await fetch(`${BASE}/api/settings`, { method: "PUT", headers: H, body: JSON.stringify({ scope: `person:${sage.id}`, key: "ui.look", value: look }) });
    if (!res.ok) fail(`set look ${look} ${res.status}`);
  };
  const setAccent = async (accent: string | null) => {
    const res = await fetch(`${BASE}/api/people/${sage.id}`, { method: "PATCH", headers: H, body: JSON.stringify({ accent }) });
    if (!res.ok) fail(`set accent ${accent} ${res.status}`);
  };

  const browser = await chromium.launch();
  async function open(scheme: (typeof SCHEMES)[number]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: scheme });
    await context.addCookies([{ name: "session", value: session, url: BASE }]);
    const page = await context.newPage();
    await page.goto(`${BASE}${PAGE}`);
    await page.getByRole("button", { name: "Save" }).waitFor({ timeout: 15000 });
    await page.waitForTimeout(600);
    return { context, page };
  }
  /** Computed background of whatever is painted at a point (the selected
   * "Profile" pill in the settings nav), walking up to the first non-clear
   * ancestor. */
  const paintedAt = (page: Page) => page.evaluate(() => {
    let el: Element | null = document.elementFromPoint(200, 167);
    const text = el ? getComputedStyle(el).color : "";
    while (el) {
      const c = getComputedStyle(el).backgroundColor;
      if (c !== "rgba(0, 0, 0, 0)" && c !== "transparent") return { bg: c, text };
      el = el.parentElement;
    }
    return { bg: "none", text };
  });
  const primaryOf = (page: Page) => page.evaluate(() => {
    const save = [...document.querySelectorAll('[data-slot="button"]')].find((b) => b.textContent?.trim() === "Save")!;
    return { token: getComputedStyle(document.body).getPropertyValue("--primary").trim(), button: getComputedStyle(save).backgroundColor };
  });
  const swatchOf = (page: Page, name: string) => page.evaluate((n) => {
    const probe = document.createElement("div");
    probe.style.background = `var(--profile-accent-${n})`;
    probe.style.color = `var(--profile-accent-${n}-foreground)`;
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const out = { bg: cs.backgroundColor, fg: cs.color };
    probe.remove();
    return out;
  }, name);

  // Looks: each one must give a primary colour no other look has, per theme.
  await setAccent(null);
  for (const scheme of SCHEMES) {
    const seen = new Map<string, string>();
    for (const look of LOOKS) {
      await setLook(look);
      const { context, page } = await open(scheme);
      const cls = await page.evaluate(() => document.body.className);
      if (!cls.includes(`style-${look}`)) fail(`${look}/${scheme}: body class is "${cls}"`);
      const p = await primaryOf(page);
      const clash = seen.get(p.button);
      if (clash) fail(`${look}/${scheme}: Save button colour ${p.button} is the same as look ${clash}`);
      seen.set(p.button, look);
      console.log(`look ${look} ${scheme}: --primary ${p.token}, Save button ${p.button}`);
      await page.screenshot({ path: join(OUT, `appearance-look-${look}-${scheme}.png`) });
      await context.close();
    }
  }

  // Accents: the selected pill is tinted with the kit's swatch (its token resolves to the swatch exactly), with readable text.
  await setLook("neutral");
  for (const scheme of SCHEMES) {
    const base = await (async () => {
      await setAccent(null);
      const { context, page } = await open(scheme);
      const painted = await paintedAt(page);
      if (await page.evaluate(() => document.body.hasAttribute("data-accent"))) fail("body carries data-accent with no accent set");
      await page.screenshot({ path: join(OUT, `appearance-accent-none-${scheme}.png`) });
      await context.close();
      return painted;
    })();
    const seen = new Set<string>([base.bg]);
    for (const accent of ACCENTS) {
      await setAccent(accent);
      const { context, page } = await open(scheme);
      const attr = await page.evaluate(() => document.body.getAttribute("data-accent"));
      if (attr !== accent) fail(`${accent}/${scheme}: body data-accent is ${attr}`);
      const painted = await paintedAt(page);
      const swatch = await swatchOf(page, accent);
      const accentColour = await page.evaluate(() => { const p = document.createElement("div"); p.style.background = "var(--person-accent)"; document.body.appendChild(p); const c = getComputedStyle(p).backgroundColor; p.remove(); return c; });
      if (accentColour !== swatch.bg) fail(`${accent}/${scheme}: --person-accent paints ${accentColour}, kit swatch is ${swatch.bg}`);
      const token = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue("--person-accent").trim());
      if (!token) fail(`${accent}/${scheme}: --person-accent is empty on the body`);
      if (seen.has(painted.bg)) fail(`${accent}/${scheme}: pill colour ${painted.bg} repeats another accent or the no-accent colour`);
      seen.add(painted.bg);
      const ratio = await contrast(page, painted.text, painted.bg);
      if (ratio < 4.5) fail(`${accent}/${scheme}: pill text contrast ${ratio.toFixed(2)} is under 4.5`);
      console.log(`accent ${accent} ${scheme}: pill ${painted.bg}, text ${painted.text}, contrast ${ratio.toFixed(2)}`);
      await page.screenshot({ path: join(OUT, `appearance-accent-${accent}-${scheme}.png`) });
      await context.close();
    }
  }
  await setAccent(null);
  await browser.close();
  console.log("appearance check passed");
} finally {
  backend.kill();
  rmSync(DATA, { recursive: true, force: true });
}
