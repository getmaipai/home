#!/usr/bin/env bun
// Standing demo preview on 8787: a seeded household (Sage) whose News comes from real public feeds, polled by the
// hub's own feed pipeline (real photos, favicons and full stories), in its own data directory outside the repo.
// Run `bun scripts/preview-demo.ts` to refresh: it rebuilds the web app from the current source, stops the demo
// hub, wipes the demo data, seeds it again and starts the hub. No setup walk-through.
// The real family's hub is never touched: this refuses to start if some other hub already holds 8787.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

// Optional checkout to run (a worktree with a fix to test); defaults to the checkout this script lives in.
// `--watch` keeps the demo current: after the refresh it rebuilds the web app when frontend source changes, and restarts
// the hub when backend source changes, so the URL always shows the latest code. It keeps the seeded data.
const positional = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const WATCH = process.argv.includes("--watch");
const ROOT = resolve(positional[0] ?? resolve(import.meta.dir, ".."));
console.log(`demo runs the code in ${ROOT}`);
const DEMO = join(homedir(), ".maipai", "preview-demo");
const HUB_PORT = 8787;
const DEMO_PIN = "0000";
const HUB_PID = join(DEMO, "hub.pid");
// The seed fetches the household's real feeds once, which takes a few minutes; the cap stops a hung network from blocking forever.
const SEED_TIMEOUT_MS = 15 * 60 * 1000;

function pidOf(file: string): number | null {
  if (!existsSync(file)) return null;
  const pid = Number(readFileSync(file, "utf8").trim());
  if (!Number.isInteger(pid) || pid <= 1) return null;
  try { process.kill(pid, 0); return pid; } catch { return null; }
}

function stop(file: string): void {
  const pid = pidOf(file);
  if (pid) process.kill(pid, "SIGTERM");
  rmSync(file, { force: true });
}

async function hubUp(): Promise<boolean> {
  try { return (await fetch(`http://localhost:${HUB_PORT}/api/health`)).status < 500; } catch { return false; }
}

async function waitFor(check: () => Promise<boolean>, what: string, seconds: number): Promise<void> {
  for (let i = 0; i < seconds; i++) {
    if (await check()) return;
    await Bun.sleep(1000);
  }
  throw new Error(`${what} did not come up within ${seconds}s; see ${join(DEMO, "hub.log")}`);
}

if (await hubUp() && !pidOf(HUB_PID)) {
  throw new Error(`another hub already holds port ${HUB_PORT}, so the demo cannot start. It was not touched. Stop that hub first, or leave the demo off.`);
}

// Rebuild the web app from the current source on every refresh, so screenshots and tests never run an old bundle.
const build = Bun.spawnSync({ cmd: ["bun", "run", "build"], cwd: join(ROOT, "frontend"), stdout: "inherit", stderr: "inherit" });
if (build.exitCode !== 0) throw new Error(`the frontend build failed with exit code ${build.exitCode}; the demo was not changed`);

stop(HUB_PID);
await waitFor(async () => !(await hubUp()), "the old demo hub stopping", 20);

rmSync(DEMO, { recursive: true, force: true });
mkdirSync(DEMO, { recursive: true });

// Seed with the hub's own code: the household's adult News boxes get the real feeds, then one real poll fills the shelf.
// The poll fetches the feeds over the network, so a seed that cannot reach them fails loudly instead of showing nothing.
const seedSource = `
    const { setHouseholdSettingValue } = await import("./src/lib/settings.ts");
    const { syncShelfFeeds } = await import("./src/lib/shelf/shelfFeeds.ts");
    const { pollDueFeeds } = await import("./src/lib/shelf/shelfPoller.ts");
    const { classifyPendingTopics } = await import("./src/lib/news/topicTagger.ts");
    const ticked = setHouseholdSettingValue("news.lists.adult", ["feeds-household"]);
    if (!ticked.ok) throw new Error("could not tick the household news list: " + ticked.error);
    syncShelfFeeds({ nowIso: new Date().toISOString() });
    // A poll pass takes at most 24 feeds (8 per host) and the live poller waits a minute between one host's feeds.
    // The seed pins its clock ahead so every household feed is due, and waits one second between feeds instead.
    // It repeats passes until no feed is left, so the first run fills the shelf without waiting a minute per feed.
    const clock = Date.now() + 3 * 60 * 60 * 1000;
    const deps = { now: () => clock, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 1000))) };
    let total = 0;
    for (;;) {
      const { polled } = await pollDueFeeds(deps, ["news"]);
      if (polled === 0) break;
      total += polled;
      console.log("polled " + total + " news feeds so far");
    }
    await classifyPendingTopics().catch((e) => console.log("topic step skipped: " + e));
    process.exit(0);`;
const seed = Bun.spawnSync({ cmd: ["bun", "-e", seedSource], cwd: join(ROOT, "backend"), env: { ...process.env, MAIPAI_DATA_DIR: DEMO }, stdout: "inherit", stderr: "inherit", timeout: SEED_TIMEOUT_MS });
if (seed.exitCode !== 0) throw new Error(`seeding the News feeds failed with exit code ${seed.exitCode}; check that this Mac can reach the feeds`);

function startHub(): void {
  const hub = Bun.spawn({
    cmd: ["bun", join(ROOT, "backend", "src", "index.ts")], cwd: ROOT, stdin: "ignore",
    stdout: Bun.file(join(DEMO, "hub.log")), stderr: Bun.file(join(DEMO, "hub.log")),
    env: { ...process.env, PORT: String(HUB_PORT), MAIPAI_DATA_DIR: DEMO, MAIPAI_HUB_LOCK_PATH: join(DEMO, "hub.lock"), MAIPAI_ALLOW_MAIN_CHECKOUT: "1" },
  });
  hub.unref();
  writeFileSync(HUB_PID, String(hub.pid));
}

startHub();
await waitFor(hubUp, "the demo hub", 60);

const setup = await fetch(`http://localhost:${HUB_PORT}/api/auth/setup`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ displayName: "Sage", secret: DEMO_PIN }),
});
if (!setup.ok) throw new Error(`demo setup failed: ${setup.status} ${await setup.text()}`);

const url = `http://localhost:${HUB_PORT}/`;
console.log(`demo preview ready: ${url} (household member Sage, PIN ${DEMO_PIN}, data in ${DEMO})`);
Bun.spawnSync({ cmd: ["open", url] });
if (!WATCH) process.exit(0);

// Watch mode: a cheap fingerprint of each source tree (file count, newest mtime, total mtime) changes on any edit.
function fingerprint(dir: string): string {
  let count = 0, newest = 0, total = 0;
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) { visit(path); continue; }
      const mtime = statSync(path).mtimeMs;
      count++; total += mtime; newest = Math.max(newest, mtime);
    }
  };
  if (existsSync(dir)) visit(dir);
  return `${count}:${newest}:${total}`;
}

const frontendSrc = join(ROOT, "frontend", "src");
const backendSrc = join(ROOT, "backend", "src");
let frontendSeen = fingerprint(frontendSrc);
let backendSeen = fingerprint(backendSrc);
console.log(`watching ${ROOT}: edits reload ${url} (Ctrl-C stops watching; the hub keeps running)`);
for (;;) {
  await Bun.sleep(3000);
  const frontendNow = fingerprint(frontendSrc);
  const backendNow = fingerprint(backendSrc);
  if (frontendNow === frontendSeen && backendNow === backendSeen) continue;
  const frontendChanged = frontendNow !== frontendSeen;
  frontendSeen = frontendNow;
  backendSeen = backendNow;
  console.log(`${new Date().toLocaleTimeString()} ${frontendChanged ? "frontend" : "backend"} changed: reloading`);
  if (frontendChanged) {
    const rebuild = Bun.spawnSync({ cmd: ["bun", "run", "build"], cwd: join(ROOT, "frontend"), stdout: "inherit", stderr: "inherit" });
    if (rebuild.exitCode !== 0) { console.log("frontend build failed; the hub keeps the last good build. Fix the error and save again."); continue; }
  }
  stop(HUB_PID);
  await waitFor(async () => !(await hubUp()), "the demo hub stopping", 20);
  startHub();
  await waitFor(hubUp, "the demo hub", 60);
  console.log(`${new Date().toLocaleTimeString()} reloaded ${url}`);
}
