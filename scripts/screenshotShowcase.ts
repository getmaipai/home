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
import { assistantStreamBody, ASSISTANT_STREAM_HEADERS } from "../frontend/tests/assistantStreamBody";
import { createOwnedDemoDataDir, processStartTime, removeOwnedDemoDataDir, waitForBackendPort, type RunOwner } from "./screenshotRuntime";

const ROOT = join(import.meta.dir, "..");
const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const captureFailureRoles = args.includes("--failure-roles");
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
  let childSession: string | undefined;
  if (captureFailureRoles) {
    const created = await fetch(`${base}/api/people`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: `session=${session}` }, body: JSON.stringify({ displayName: "Nova", role: "child" }) });
    if (!created.ok) throw new Error(`child setup failed: ${created.status} ${await created.text()}`);
    const childId = (await created.json() as { id: string }).id;
    const selected = await fetch(`${base}/api/auth/select`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ personId: childId }) });
    if (!selected.ok) throw new Error(`child selection failed: ${selected.status} ${await selected.text()}`);
    childSession = selected.headers.get("set-cookie")?.split(";")[0]?.split("=")[1];
    if (!childSession) throw new Error("child selection response carried no session cookie");
  }
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
        if (captureFailureRoles && (scenario.id === "failure-admin-details" || scenario.id === "failure-too-much-text")) {
          const details = page.getByRole("button", { name: "Error details" });
          await details.click();
          const detailText = scenario.id === "failure-too-much-text" ? "exceed_context_size_error" : "The scripted screenshot engine returned a connection timeout.";
          await page.getByText(detailText, { exact: false }).waitFor({ state: "visible" });
          await page.waitForTimeout(500);
          await page.screenshot({ path: join(outDir, `showcase-${scenario.id}-${viewport.name}-admin-open.png`) });
          console.log(`captured admin error details @ ${viewport.name}`);
        }
      }
      if (captureFailureRoles) {
        const roleSessions = [{ role: "admin", session }, { role: "child", session: childSession! }];
        for (const { role, session: roleSession } of roleSessions) {
          const chatContext = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
          await chatContext.addCookies([{ name: "session", value: roleSession, url: base }]);
          const chat = await chatContext.newPage();
          await chat.route("**/api/health", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ engines: { chat: { availability: "ready" } } }) }));
          await chat.route("**/api/turn-error-detail/**", (route) => route.fulfill({ status: role === "admin" ? 200 : 403, contentType: "application/json", body: JSON.stringify({ turn_id: `capture-${role}`, tools: [], generations: [{ reason: "phrasing", error: "exceed_context_size_error: request exceeds the available context size", request_sent_ms: 245 }] }) }));
          await chat.route("**/api/turn/stream", async (route) => {
            const minor = role === "child";
            const value = {
              reply: { text: minor ? "That was too much for me to read at once. Try a shorter question." : "That was too much text for me to read in one go. Try a shorter question." },
              source: "plugin", conversation_id: "capture", turn_id: `capture-${role}`,
              safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() },
            };
            const body = await new Response(assistantStreamBody([{ type: "turn_meta", conversation_id: "capture", turn_id: `capture-${role}` }, { type: "done", value: { ...value, ...(role === "admin" ? { failed_generation: true } : {}) } }])).text();
            await route.fulfill({ status: 200, headers: ASSISTANT_STREAM_HEADERS, body });
          });
          await chat.goto(`${base}/chat`, { waitUntil: "networkidle" });
          await chat.getByLabel("Message input").fill("show me this failed reply");
          await chat.getByRole("button", { name: "Send message" }).click();
          await chat.getByText(role === "child" ? "That was too much for me to read at once. Try a shorter question." : "That was too much text for me to read in one go. Try a shorter question.", { exact: true }).waitFor({ state: "visible" });
          await chat.waitForTimeout(500);
          await chat.screenshot({ path: join(outDir, `failure-${role}-${viewport.name}-before-detail.png`) });
          if (role === "admin") {
            await chat.getByRole("button", { name: "Error details" }).click();
            await chat.getByText("exceed_context_size_error", { exact: false }).waitFor({ state: "visible" });
            await chat.waitForTimeout(500);
            await chat.screenshot({ path: join(outDir, `failure-${role}-${viewport.name}-after-detail.png`) });
          } else if (await chat.getByRole("button", { name: "Error details" }).count() !== 0) {
            throw new Error("child failure reply unexpectedly showed error details");
          }
          console.log(`captured ${role} live failure reply @ ${viewport.name}`);
          await chatContext.close();
        }
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
