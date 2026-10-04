#!/usr/bin/env bun
// UI-SHOWCASE screenshot pass: a throwaway hub (the same owner-marked demo
// data dir and port-0 backend scripts/screenshot.ts uses), the owner signed
// in, then /dev/ui opened at desktop and phone width and every scenario
// played once at Instant pace and captured. PNGs go to the directory given
// as the first argument (default docs/assets/screens/showcase), never
// hand-edited. Run: bun run scripts/screenshotShowcase.ts [outDir] [--only id,id]
import { chromium } from "playwright";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { createOwnedDemoDataDir, processStartTime, removeOwnedDemoDataDir, waitForBackendPort, type RunOwner } from "./screenshotRuntime";

const ROOT = join(import.meta.dir, "..");
const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const outDir = args.find((a) => !a.startsWith("--")) ?? join(ROOT, "docs", "assets", "screens", "showcase");
const VIEWPORTS = [{ name: "1440", width: 1440, height: 900 }, { name: "390", width: 390, height: 844 }];
mkdirSync(outDir, { recursive: true });

const build = Bun.spawnSync({ cmd: ["bun", "run", "build"], cwd: join(ROOT, "frontend"), stdout: "inherit", stderr: "inherit" });
if (build.exitCode !== 0) throw new Error("frontend build failed");

const owner: RunOwner = { pid: process.pid, startedAt: processStartTime(process.pid) ?? null, token: crypto.randomUUID() };
const dataDir = createOwnedDemoDataDir(ROOT, owner);
const backend = Bun.spawn({
  cmd: ["bun", "run", "src/index.ts"],
  cwd: join(ROOT, "backend"),
  env: { ...process.env, MAIPAI_TEST_ALLOW_MULTIPLE_HUBS: "1", PORT: "0", MAIPAI_DATA_DIR: dataDir, MAIPAI_WYOMING_PORT: "0", MAIPAI_SCREENSHOT_TEST_WYOMING_BIND_FAILURE: "1" },
  stdout: "pipe",
  stderr: "inherit",
});
try {
  const stdout = backend.stdout;
  if (!stdout || typeof stdout === "number") throw new Error("backend stdout pipe was not created");
  const base = `http://localhost:${await waitForBackendPort(stdout)}`;
  const setup = await fetch(`${base}/api/auth/setup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Oliver", secret: "correcthorsebattery" }) });
  if (!setup.ok) throw new Error(`setup failed: ${setup.status} ${await setup.text()}`);
  const session = setup.headers.get("set-cookie")?.split(";")[0]?.split("=")[1];
  if (!session) throw new Error("setup response carried no session cookie");
  const list = await fetch(`${base}/api/dev/ui-fixtures`, { headers: { Cookie: `session=${session}` } });
  const scenarios = ((await list.json()) as { fixtures: { id: string; title: string; description: string }[] }).fixtures.filter((f) => !only || only.includes(f.id));

  const browser = await chromium.launch(process.env.SHOWCASE_CHROMIUM ? { executablePath: process.env.SHOWCASE_CHROMIUM } : {});
  try {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
      await context.addCookies([{ name: "session", value: session, url: base }]);
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      for (const scenario of scenarios) {
        await page.goto(`${base}/dev/ui`, { waitUntil: "networkidle" });
        await page.getByLabel("Streaming pace").click();
        await page.getByRole("option", { name: "Instant" }).click();
        await page.getByRole("button", { name: new RegExp(`^${scenario.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.`) }).click();
        await page.waitForTimeout(1500);
        await page.screenshot({ path: join(outDir, `showcase-${scenario.id}-${viewport.name}.png`) });
        console.log(`captured ${scenario.id} @ ${viewport.name}`);
      }
      if (errors.length) console.log(`page errors @ ${viewport.name}:\n${errors.join("\n")}`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
} finally {
  backend.kill();
  await backend.exited;
  removeOwnedDemoDataDir(dataDir, owner.token);
}
