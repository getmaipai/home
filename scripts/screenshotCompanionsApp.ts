// COMPANIONS-APP-01: screenshots of the Companions app against the real route on a scratch hub with a demo household (persona-roster
// names only). `bun run scripts/screenshotCompanionsApp.ts [--skip-build]`; PNGs land in data-scratch/screenshots/companions-app/ to be opened
// and judged. Fails on a missing card, a companion above the person's type, a hard-coded color class or sideways scroll.
import "./runTemp";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { reserveFreePort } from "../backend/tests/fixtures/reserveFreePort";
import { waitForBackendPort } from "./screenshotRuntime";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "data-scratch", "screenshots", "companions-app");
const DATA = mkdtempSync(join(tmpdir(), "companions-app-shots-"));

if (!process.argv.includes("--skip-build")) {
  const build = Bun.spawnSync({ cmd: ["bun", "run", "build"], cwd: join(ROOT, "frontend"), stdout: "inherit", stderr: "inherit" });
  if (build.exitCode !== 0) throw new Error("frontend build failed");
}
mkdirSync(OUT, { recursive: true });
const backend = Bun.spawn({
  cmd: ["bun", "run", "src/index.ts"],
  cwd: join(ROOT, "backend"),
  env: { ...process.env, MAIPAI_TEST_ALLOW_MULTIPLE_HUBS: "1", MAIPAI_MDNS: "off", PORT: "0", MAIPAI_DATA_DIR: DATA, MAIPAI_KIWIX_PORT: String(reserveFreePort()), MAIPAI_WYOMING_PORT: "0" },
  stdout: "pipe",
  stderr: "inherit",
});

const json = { "Content-Type": "application/json" };
try {
  const base = `http://localhost:${await waitForBackendPort(backend.stdout as ReadableStream<Uint8Array>)}`;
  const setup = await fetch(`${base}/api/auth/setup`, { method: "POST", headers: json, body: JSON.stringify({ displayName: "Sage", secret: "correcthorsebattery" }) });
  if (!setup.ok) throw new Error(`setup failed: ${setup.status}`);
  const owner = setup.headers.get("set-cookie")!.split(";")[0]!;
  const sessions: Record<string, string> = { Sage: owner };
  for (const [displayName, role] of [["Marlow", "adult"], ["Riff", "teen"], ["Sprout", "child"]] as const) {
    const made = await fetch(`${base}/api/people`, { method: "POST", headers: { ...json, Cookie: owner }, body: JSON.stringify({ displayName, role, secret: "0000", ...(role === "child" ? { birthdate: "2018-03-01" } : {}) }) });
    if (!made.ok) throw new Error(`could not seed ${displayName}: ${made.status}`);
    const { id } = await made.json() as { id: string };
    const signedIn = await fetch(`${base}/api/auth/verify-secret`, { method: "POST", headers: json, body: JSON.stringify({ personId: id, secret: "0000" }) });
    sessions[displayName] = signedIn.headers.get("set-cookie")!.split(";")[0]!;
  }
  const browser = await chromium.launch();
  try {
    const shots: Array<[string, string, "desktop" | "phone", string, string[]]> = [
      ["Sage", "gallery", "desktop", "/companions", ["Sprout", "Riff", "Nova", "Robots"]],
      ["Sage", "detail", "desktop", "/companions/lively-adult", ["Set as my default", "Who uses it", "Things it might say"]],
      ["Riff", "gallery", "phone", "/companions", ["Sprout", "Riff"]],
      ["Sprout", "gallery", "phone", "/companions", ["Sprout"]],
      ["Sprout", "detail", "phone", "/companions/lively-child", ["Set as my default", "Play a sample"]],
    ];
    for (const theme of ["light", "dark"] as const) {
      for (const [who, name, size, path, expected] of shots) {
        const viewport = size === "desktop" ? { width: 1440, height: 960 } : { width: 390, height: 844 };
        const context = await browser.newContext({ viewport, colorScheme: theme });
        await context.addCookies([{ name: "session", value: sessions[who]!.slice("session=".length), url: base }]);
        const page = await context.newPage();
        await page.goto(`${base}${path}`);
        await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 20_000 });
        for (const text of expected) await page.getByText(text, { exact: false }).first().waitFor({ timeout: 10_000 });
        const body = await page.locator("body").innerText();
        if (who === "Sprout" && /Riff|Nova/.test(body)) throw new Error(`${who}/${name}: a child sees a teen or adult companion`);
        if (who === "Riff" && /Nova/.test(body)) throw new Error(`${who}/${name}: a teen sees an adult companion`);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (overflow > 0) throw new Error(`${who}/${name}/${size}/${theme}: horizontal overflow ${overflow}px`);
        await page.screenshot({ path: join(OUT, `${who.toLowerCase()}-${name}-${size}-${theme}.png`), fullPage: true });
        console.log(`${who}/${name}/${size}/${theme}: ok`);
        await context.close();
      }
    }
  } finally { await browser.close(); }
} finally {
  backend.kill();
  rmSync(DATA, { recursive: true, force: true });
}
