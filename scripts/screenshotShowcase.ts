#!/usr/bin/env bun
// UI-SHOWCASE screenshot pass: a throwaway hub (the same owner-marked demo
// data dir and port-0 backend scripts/screenshot.ts uses), the owner signed
// in, then /dev/ui opened at desktop and phone width and every scenario
// played once at Instant pace and captured. PNGs go to the directory given
// as the first argument (default docs/assets/screens/showcase), never
// hand-edited. Run: bun run scripts/screenshotShowcase.ts [outDir] [--only id,id]
// `--calm` (CHAT-CALM-ERRORS-01d) also opens the real /chat page as owner,
// adult, teen and child, in light and dark, with the hub's health and Chat
// status stubbed to "paused", and captures three causes: the engine paused
// with a draft typed, the engine stopping part way through a reply, and one
// reply failing while the engine is up. The composer line's and inline
// failure's heights are measured from the page and written to
// calm-heights.json beside the PNGs.
import { chromium, type Browser, type Page } from "playwright";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { composerNotice, failureLine, FAILURE_COPY } from "../backend/src/lib/failureCopy";
import { assistantStreamBody, ASSISTANT_STREAM_HEADERS } from "../frontend/tests/assistantStreamBody";
import { createOwnedDemoDataDir, processStartTime, removeOwnedDemoDataDir, waitForBackendPort, type RunOwner } from "./screenshotRuntime";

const ROOT = join(import.meta.dir, "..");
const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const captureFailureRoles = args.includes("--failure-roles");
const captureCalm = args.includes("--calm");
const outDir = args.find((a) => !a.startsWith("--")) ?? join(ROOT, "docs", "assets", "screens", "showcase");
const VIEWPORTS = [{ name: "1440", width: 1440, height: 900 }, { name: "390", width: 390, height: 844 }];
mkdirSync(outDir, { recursive: true });

const build = Bun.spawnSync({ cmd: ["bun", "run", "build"], cwd: join(ROOT, "frontend"), stdout: "inherit", stderr: "inherit" });
if (build.exitCode !== 0) throw new Error("frontend build failed");

// CHAT-CALM-ERRORS-01d: the three causes captured on the real chat page.
type CalmCause = "engine-paused" | "engine-died-mid-reply" | "reply-failed-engine-up";
const CALM_CAUSES: { id: CalmCause; roles: string[] }[] = [
  { id: "engine-paused", roles: ["owner", "adult", "teen", "child"] },
  { id: "engine-died-mid-reply", roles: ["owner", "child"] },
  { id: "reply-failed-engine-up", roles: ["owner", "child"] },
];
const calmHeights: Record<string, unknown>[] = [];

function chatHealth(down: boolean) {
  return down
    ? { engines: { chat: { kind: "failed", pid: null, alive: false, availability: "unavailable", reason: "failed_start", notice: composerNotice("unavailable") } } }
    : { engines: { chat: { kind: "none", pid: null, alive: null, availability: "ready" } } };
}

async function boxHeight(page: Page, selector: string): Promise<number | null> {
  const box = await page.locator(selector).first().boundingBox().catch(() => null);
  return box ? Math.round(box.height * 10) / 10 : null;
}

async function measureEveryLine(page: Page, minor: boolean): Promise<Record<string, number | null>> {
  const heights: Record<string, number | null> = {};
  for (const [kind, copy] of Object.entries(FAILURE_COPY)) {
    heights[kind] = await page.locator('[data-slot="error-state"]').first().evaluate((panel, line) => {
      const text = panel.querySelector("p");
      if (!text) return null;
      const shown = text.textContent;
      text.textContent = line;
      const height = Math.round(panel.getBoundingClientRect().height * 10) / 10;
      text.textContent = shown;
      return height;
    }, minor ? copy.minor : copy.adult).catch(() => null);
  }
  return heights;
}

/** One cause, one role, one viewport and theme on the real /chat page. The
 * hub's health and the Chat status app are stubbed to the cause's state (the
 * words come from backend failureCopy.ts); the turn stream is scripted. */
async function captureCalmCause(browser: Browser, base: string, roleSession: string, role: string, cause: CalmCause, viewport: { name: string; width: number; height: number }, theme: "light" | "dark") {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, colorScheme: theme, reducedMotion: "reduce" });
  await context.addCookies([{ name: "session", value: roleSession, url: base }]);
  const page = await context.newPage();
  let down = cause === "engine-paused";
  await page.route("**/api/health", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(chatHealth(down)) }));
  await page.route("**/api/status/apps", async (route) => {
    const response = await route.fetch();
    const apps = (await response.json()) as Array<{ id: string; state: string; reason: string | null; paused?: boolean; needs?: Array<{ id: string; state: string }> }>;
    const patched = apps.map((app) => app.id !== "chat"
      ? { ...app, state: "operational", reason: null, needs: app.needs?.map((need) => ({ ...need, state: "operational" })) }
      : down ? { ...app, state: "degraded", paused: true, reason: "Chat is paused.", needs: app.needs?.map((need) => need.id === "chat" ? { ...need, state: "degraded" } : { ...need, state: "operational" }) } : { ...app, state: "operational", paused: false, reason: null, needs: app.needs?.map((need) => ({ ...need, state: "operational" })) });
    await route.fulfill({ response, json: patched });
  });
  await page.route("**/api/turn/stream", async (route) => {
    const minor = role === "child";
    const meta = { type: "turn_meta", conversation_id: "capture-calm", turn_id: `capture-calm-${role}` };
    const events = cause === "engine-died-mid-reply"
      ? [meta, { type: "delta", text: "Here is a simple plan. Start with a soup, then" }, { type: "error", error: failureLine("stopped", minor), code: "engine_unavailable" }]
      : [meta, { type: "error", error: failureLine("busy", minor), code: "engine_unavailable" }];
    if (cause === "engine-died-mid-reply") down = true;
    const body = await new Response(assistantStreamBody(events as never)).text();
    await route.fulfill({ status: 200, headers: ASSISTANT_STREAM_HEADERS, body });
  });
  await page.goto(`${base}/chat`, { waitUntil: "networkidle" });
  const input = page.getByLabel("Message input");
  await input.waitFor({ state: "visible" });
  // An older build disables the field while chat is down; the "before"
  // capture shows that instead of failing on it.
  const typed = await input.fill("Can you help me plan dinner for Saturday?", { timeout: 3_000 }).then(() => true, () => false);
  if (!typed) console.log(`calm ${cause} ${role} @ ${viewport.name} ${theme}: the message field did not take text`);
  if (cause !== "engine-paused") await page.getByRole("button", { name: "Send message" }).click();
  const settled = cause === "reply-failed-engine-up" ? '[data-slot="error-state"]' : "[data-chat-notice]";
  await page.locator(settled).first().waitFor({ state: "visible", timeout: 8_000 }).catch(() => console.log(`calm ${cause} ${role} @ ${viewport.name} ${theme}: ${settled} never showed`));
  await page.waitForTimeout(600);
  const file = `calm-${cause}-${role}-${viewport.name}-${theme}.png`;
  await page.screenshot({ path: join(outDir, file) });
  const heights = {
    file, cause, role, viewport: viewport.name, theme,
    composer_notice_px: await boxHeight(page, '[data-slot="aui_composer-notice"]'),
    inline_failure_px: await boxHeight(page, '[data-slot="error-state"]'),
    send_disabled: await page.getByRole("button", { name: "Send message" }).first().isDisabled().catch(() => null),
    banner_present: (await page.getByText("MaiPai's AI isn't running right now").count()) > 0,
    // Every failure kind's line, measured in the same inline slot: the
    // shown line is swapped for each one in turn and the panel measured.
    inline_failure_px_by_kind: cause === "reply-failed-engine-up" ? await measureEveryLine(page, role === "child") : undefined,
  };
  console.log(`captured ${file} ${JSON.stringify(heights)}`);
  await context.close();
  return heights;
}

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
  const calmSessions: { role: string; session: string }[] = [];
  if (captureCalm) {
    calmSessions.push({ role: "owner", session });
    const people = [{ role: "adult", displayName: "Juniper", secret: "0000" }, { role: "teen", displayName: "Bramble" }, { role: "child", displayName: "Pippa" }];
    for (const person of people) {
      const created = await fetch(`${base}/api/people`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: `session=${session}` }, body: JSON.stringify(person) });
      if (!created.ok) throw new Error(`${person.role} setup failed: ${created.status} ${await created.text()}`);
      const personId = (await created.json() as { id: string }).id;
      const signedIn = person.secret
        ? await fetch(`${base}/api/auth/verify-secret`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ personId, secret: person.secret }) })
        : await fetch(`${base}/api/auth/select`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ personId }) });
      if (!signedIn.ok) throw new Error(`${person.role} sign-in failed: ${signedIn.status} ${await signedIn.text()}`);
      const cookie = signedIn.headers.get("set-cookie")?.split(";")[0]?.split("=")[1];
      if (!cookie) throw new Error(`${person.role} sign-in carried no session cookie`);
      calmSessions.push({ role: person.role, session: cookie });
    }
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
        if (captureFailureRoles && (scenario.id === "failure-admin-details" || scenario.id === "failure-too-much-text" || scenario.id === "failure-engine-stopped")) {
          const details = page.getByRole("button", { name: "Error details" });
          await details.click();
          const detailText = scenario.id === "failure-too-much-text" ? "exceed_context_size_error" : scenario.id === "failure-engine-stopped" ? "The chat engine was stopped, so the reply never started." : "The scripted screenshot engine returned a connection timeout.";
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
      if (captureCalm) {
        for (const theme of ["light", "dark"] as const) {
          for (const { role, session: roleSession } of calmSessions) {
            for (const cause of CALM_CAUSES) {
              if (!cause.roles.includes(role)) continue;
              calmHeights.push(await captureCalmCause(browser, base, roleSession, role, cause.id, viewport, theme));
            }
          }
        }
      }
    }
    if (captureCalm) writeFileSync(join(outDir, "calm-heights.json"), `${JSON.stringify(calmHeights, null, 2)}\n`);
  } finally {
    await browser.close();
  }
} finally {
  backend.kill();
  await backend.exited;
  removeOwnedDemoDataDir(dataDir, owner.token);
}
