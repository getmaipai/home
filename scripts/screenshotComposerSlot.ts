#!/usr/bin/env bun
// CHAT-COMPOSER-SLOT-01: captures the real /chat page as the owner on the
// seeded demo household, a new chat (empty) and an existing chat, at 1440 and
// 390 wide, with and without a composer notice, and measures the distance
// from the composer shell's bottom edge to the bottom of the page. The four
// distances per viewport must match (the one-line slot under the composer is
// always there). Run: bun run scripts/screenshotComposerSlot.ts <outDir>
import { chromium } from "playwright";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { composerNotice } from "../backend/src/lib/failureCopy";
import { assistantStreamBody, ASSISTANT_STREAM_HEADERS } from "../frontend/tests/assistantStreamBody";
import { createOwnedDemoDataDir, processStartTime, removeOwnedDemoDataDir, waitForBackendPort, type RunOwner } from "./screenshotRuntime";

const ROOT = join(import.meta.dir, "..");
const outDir = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? join(ROOT, "data-scratch", "composer-slot");
const VIEWPORTS = [{ name: "1440", width: 1440, height: 900 }, { name: "390", width: 390, height: 844 }];
mkdirSync(outDir, { recursive: true });
const build = Bun.spawnSync({ cmd: ["bun", "run", "build"], cwd: join(ROOT, "frontend"), stdout: "inherit", stderr: "inherit" });
if (build.exitCode !== 0) throw new Error("frontend build failed");

const health = (down: boolean) => down
  ? { engines: { chat: { kind: "failed", pid: null, alive: false, availability: "unavailable", reason: "failed_start", notice: composerNotice("unavailable") } } }
  : { engines: { chat: { kind: "none", pid: null, alive: null, availability: "ready" } } };

const owner: RunOwner = { pid: process.pid, startedAt: processStartTime(process.pid) ?? null, token: crypto.randomUUID() };
const dataDir = createOwnedDemoDataDir(ROOT, owner);
const backend = Bun.spawn({
  cmd: ["bun", "run", "src/index.ts"], cwd: join(ROOT, "backend"),
  env: { ...process.env, MAIPAI_TEST_ALLOW_MULTIPLE_HUBS: "1", PORT: "0", MAIPAI_DATA_DIR: dataDir, MAIPAI_WYOMING_PORT: "0", MAIPAI_SCREENSHOT_TEST_WYOMING_BIND_FAILURE: "1" },
  stdout: "pipe", stderr: "inherit",
});
const results: Record<string, unknown>[] = [];
try {
  const stdout = backend.stdout;
  if (!stdout || typeof stdout === "number") throw new Error("no backend stdout");
  const base = `http://localhost:${await waitForBackendPort(stdout)}`;
  const setup = await fetch(`${base}/api/auth/setup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Oliver", secret: "correcthorsebattery" }) });
  const session = setup.headers.get("set-cookie")?.split(";")[0]?.split("=")[1];
  if (!setup.ok || !session) throw new Error("setup failed");
  const browser = await chromium.launch(process.env.SHOWCASE_CHROMIUM ? { executablePath: process.env.SHOWCASE_CHROMIUM } : {});
  try {
    for (const viewport of VIEWPORTS) {
      for (const chat of ["new", "existing"] as const) {
        for (const notice of [false, true]) {
          const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, reducedMotion: "reduce" });
          await context.addCookies([{ name: "session", value: session, url: base }]);
          const page = await context.newPage();
          await page.route("**/api/health", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(health(notice)) }));
          await page.route("**/api/status/apps", async (route) => {
            const response = await route.fetch();
            const apps = (await response.json()) as Array<{ id: string; state: string; reason: string | null; paused?: boolean; needs?: Array<{ id: string; state: string }> }>;
            await route.fulfill({ response, json: apps.map((app) => app.id !== "chat" ? app : notice ? { ...app, state: "degraded", paused: true, reason: "Chat is paused." } : { ...app, state: "operational", paused: false, reason: null }) });
          });
          await page.route("**/api/turn/stream", async (route) => {
            const body = await new Response(assistantStreamBody([{ type: "turn_meta", conversation_id: "slot", turn_id: "slot-1" }, { type: "delta", text: "Saturday dinner: a simple soup and bread." }, { type: "done", value: { reply: { text: "Saturday dinner: a simple soup and bread." }, source: "plugin", conversation_id: "slot", turn_id: "slot-1", safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() } } }] as never)).text();
            await route.fulfill({ status: 200, headers: ASSISTANT_STREAM_HEADERS, body });
          });
          await page.goto(`${base}/chat`, { waitUntil: "networkidle" });
          const input = page.getByLabel("Message input");
          await input.waitFor({ state: "visible" });
          if (chat === "existing") {
            // Send while chat reads ready, then (for the notice case) flip health so the line appears.
            await page.unroute("**/api/health");
            await page.route("**/api/health", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(health(false)) }));
            await input.fill("What should we eat Saturday?");
            await page.getByRole("button", { name: "Send message" }).click();
            await page.getByText("Saturday dinner: a simple soup and bread.").first().waitFor({ state: "visible", timeout: 10_000 });
            if (notice) {
              await page.unroute("**/api/health");
              await page.route("**/api/health", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(health(true)) }));
              await page.evaluate(() => window.dispatchEvent(new Event("focus")));
              await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
            }
          }
          if (notice) await page.locator("[data-chat-notice]").first().waitFor({ state: "visible", timeout: 30_000 });
          await page.waitForTimeout(700);
          const m = await page.evaluate(() => {
            const shell = document.querySelector('[data-slot="aui_composer-shell"]')!.getBoundingClientRect();
            const slot = document.querySelector('[data-slot="aui_composer-notice"]')?.getBoundingClientRect();
            return { shellBottomToPageBottom: Math.round((window.innerHeight - shell.bottom) * 10) / 10, slotHeight: slot ? Math.round(slot.height * 10) / 10 : null, slotTop: slot ? Math.round(slot.top * 10) / 10 : null, shellBottom: Math.round(shell.bottom * 10) / 10 };
          });
          const file = `slot-${chat}-${notice ? "notice" : "empty"}-${viewport.name}.png`;
          await page.screenshot({ path: join(outDir, file) });
          results.push({ file, chat, notice, viewport: viewport.name, ...m });
          console.log(`captured ${file} ${JSON.stringify(m)}`);
          await context.close();
        }
      }
    }
    writeFileSync(join(outDir, "slot-measurements.json"), `${JSON.stringify(results, null, 2)}\n`);
  } finally { await browser.close(); }
} finally {
  backend.kill(); await backend.exited; removeOwnedDemoDataDir(dataDir, owner.token);
}
