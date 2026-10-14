import "./runTemp";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { reserveFreePort } from "../backend/tests/fixtures/reserveFreePort";
import { waitForBackendPort } from "./screenshotRuntime";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "data-scratch", "screenshots", "companions-switch");
const DATA = mkdtempSync(join(tmpdir(), "companions-switch-shots-"));
const PROFILES = [
  { displayName: "Avery", role: "admin", secret: "adminpassword" },
  { displayName: "Jordan", role: "adult", secret: "adultpassword" },
  { displayName: "Marlow", role: "teen" },
  { displayName: "Robin", role: "child" },
  { displayName: "Guest", role: "guest", guestExpiresAt: new Date(Date.now() + 86_400_000).toISOString() },
] as const;

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

async function request<T>(base: string, cookie: string, path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, { method, headers: { Cookie: cookie, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  return await response.json() as T;
}

try {
  const base = `http://localhost:${await waitForBackendPort(backend.stdout as ReadableStream<Uint8Array>)}`;
  const setup = await fetch(`${base}/api/auth/setup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Sage", secret: "correcthorsebattery" }) });
  if (!setup.ok) throw new Error(`setup failed: ${setup.status} ${await setup.text()}`);
  const cookie = setup.headers.get("set-cookie")!.split(";")[0]!;
  const headers = { Cookie: cookie, "Content-Type": "application/json" };
  for (const profile of PROFILES) {
    const response = await fetch(`${base}/api/people`, { method: "POST", headers, body: JSON.stringify(profile) });
    if (!response.ok) throw new Error(`could not seed ${profile.displayName}: ${response.status} ${await response.text()}`);
  }
  const people = await request<Array<{ id: string; display_name: string }>>(base, cookie, "/api/people");
  const sage = people.find((entry) => entry.display_name === "Sage");
  const robin = people.find((entry) => entry.display_name === "Robin");
  if (!sage || !robin) throw new Error("seeded owner or child profile not found");
  await request(base, cookie, "/api/settings", "PUT", { scope: `person:${robin.id}`, key: "companions.allowed", value: false });

  const browser = await chromium.launch();
  try {
    for (const theme of ["light", "dark"] as const) {
      await request(base, cookie, "/api/settings", "PUT", { scope: `person:${sage.id}`, key: "ui.appearance", value: theme });
      for (const [size, viewport] of Object.entries({ desktop: { width: 1440, height: 960 }, phone: { width: 390, height: 844 } })) {
        const context = await browser.newContext({ viewport });
        await context.addCookies([{ name: "session", value: cookie.slice("session=".length), url: base }]);
        const page = await context.newPage();
        await page.goto(`${base}/users`);
        await page.getByRole("heading", { name: "Users" }).first().waitFor({ timeout: 15_000 });
        await page.getByRole("switch", { name: "AI companions" }).nth(people.length).waitFor({ timeout: 15_000 });
        const switches = await page.getByRole("switch", { name: "AI companions" }).count();
        if (switches !== people.length + 1) throw new Error(`${size}/${theme}: expected household plus ${people.length} profile switches, found ${switches}`);
        const viewportInfo = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, theme: document.documentElement.classList.contains("dark") ? "dark" : "light" }));
        if (viewportInfo.overflow > 0) throw new Error(`${size}/${theme}: horizontal overflow ${viewportInfo.overflow}px`);
        if (viewportInfo.theme !== theme) throw new Error(`${size}/${theme}: rendered theme was ${viewportInfo.theme}`);
        await page.screenshot({ path: join(OUT, `companions-${size}-${theme}.png`), fullPage: true });
        console.log(`${size}/${theme}: ${switches} switches, ${viewportInfo.overflow}px overflow`);
        await context.close();
      }
    }
  } finally { await browser.close(); }
  console.log(`captured 4 companions screenshots in ${OUT}`);
} finally {
  backend.kill();
  rmSync(DATA, { recursive: true, force: true });
}
