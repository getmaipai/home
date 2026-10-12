import "./runTemp";
// EASE-OF-USE-01c: proves, in a real headless Chromium render against a throwaway seeded demo household
// (Sage, Marlow, Nova: persona roster names only), that choosing an ease preset on the person's own
// Appearance page
//   - sets the five data-ease-* attributes on <html> from spec/ease/presets.json,
//   - reports the main navigation rail's width at Large (--require-rail makes a rail that does not widen a failure), and
//   - never clips or scrolls sideways at a 320 px reflow width.
// It writes ease-<preset>-<phone|desktop>.png to data-scratch/screenshots for a person to open and judge.
//
// Run: `bun run scripts/screenshotEase.ts` (builds the frontend first; `--skip-build` reuses frontend/dist).
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { reserveFreePort } from "../backend/tests/fixtures/reserveFreePort";
import { waitForBackendPort } from "./screenshotRuntime";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "data-scratch", "screenshots");
const PAGE = "/settings/account/appearance";
const SIZES = { phone: { width: 375, height: 812 }, reflow: { width: 320, height: 640 }, desktop: { width: 1280, height: 900 } } as const;
const PRESETS = ["standard", "large"] as const;
const EXPECT = { standard: { text: "100", targets: "standard", contrast: "standard" }, large: { text: "140", targets: "large", contrast: "more" } } as const;

if (!process.argv.includes("--skip-build")) {
  const build = Bun.spawnSync({ cmd: ["bun", "run", "build"], cwd: join(ROOT, "frontend"), stdout: "inherit", stderr: "inherit" });
  if (build.exitCode !== 0) throw new Error("frontend build failed");
}
mkdirSync(OUT, { recursive: true });

const DATA = mkdtempSync(join(tmpdir(), "ease-shots-"));
const backend = Bun.spawn({
  cmd: ["bun", "run", "src/index.ts"],
  cwd: join(ROOT, "backend"),
  env: { ...process.env, MAIPAI_TEST_ALLOW_MULTIPLE_HUBS: "1", MAIPAI_MDNS: "off", PORT: "0", MAIPAI_DATA_DIR: DATA, MAIPAI_KIWIX_PORT: String(reserveFreePort()), MAIPAI_WYOMING_PORT: "0" },
  stdout: "pipe",
  stderr: "inherit",
});

function fail(message: string): never {
  throw new Error(`ease check failed: ${message}`);
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
  const setPreset = async (preset: string) => {
    const res = await fetch(`${BASE}/api/settings`, { method: "PUT", headers: H, body: JSON.stringify({ scope: `person:${sage.id}`, key: "ease.preset", value: preset }) });
    if (!res.ok) fail(`set preset ${preset} ${res.status}`);
  };

  const browser = await chromium.launch();
  const railWidth: Record<string, number> = {};
  for (const preset of PRESETS) {
    await setPreset(preset);
    for (const [name, viewport] of Object.entries(SIZES)) {
      const context = await browser.newContext({ viewport });
      await context.addCookies([{ name: "session", value: session, url: BASE }]);
      const page = await context.newPage();
      await page.goto(`${BASE}${PAGE}`);
      await page.getByText("Ease of use").first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(600);
      const attrs = await page.evaluate(() => ({
        text: document.documentElement.getAttribute("data-ease-text"),
        targets: document.documentElement.getAttribute("data-ease-targets"),
        contrast: document.documentElement.getAttribute("data-ease-contrast"),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        rail: document.querySelector('nav[aria-label="Primary navigation"]')?.getBoundingClientRect().width ?? 0,
      }));
      const want = EXPECT[preset];
      if (attrs.text !== want.text || attrs.targets !== want.targets || attrs.contrast !== want.contrast) fail(`${preset}/${name}: attributes ${JSON.stringify(attrs)}`);
      if (attrs.overflow > 0) fail(`${preset}/${name}: page scrolls sideways by ${attrs.overflow}px`);
      if (name === "desktop") railWidth[preset] = attrs.rail;
      console.log(`${preset} ${name}: ${JSON.stringify(attrs)}`);
      await page.screenshot({ path: join(OUT, `ease-${preset}-${name}.png`) });
      await context.close();
    }
  }
  // The rail follows the kit's --rail-width token. Pass --require-rail once the pinned kit ships the generated token blocks.
  const widened = railWidth.large! > railWidth.standard!;
  if (process.argv.includes("--require-rail") && !widened) fail(`the rail did not widen at Large (${railWidth.standard} -> ${railWidth.large})`);
  console.log(`rail at Standard ${railWidth.standard}px, at Large ${railWidth.large}px (${widened ? "widened" : "not widened"})`);
  await browser.close();
  console.log("ease check passed");
} finally {
  backend.kill();
  rmSync(DATA, { recursive: true, force: true });
}
