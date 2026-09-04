#!/usr/bin/env bun
// Generates docs/assets/hero.png: a real screenshot of the real app,
// driven by a real browser against a real backend, seeded with a demo
// household (persona-roster names only, never Jesse's real household -
// getmaipai/.github/CLAUDE.md > Privacy). Never hand-taken
// (getmaipai/.github/docs/STYLE.md > Platform screenshot pipeline). If
// this screenshot goes stale, fix this script and re-run it, never
// hand-edit the image.
//
// Scope for tonight, not the full platform pipeline (STYLE.md describes
// fixed viewports for phone/tablet/desktop/TV/Apple sizes, three themes,
// a vision-model pass reviewing every shot, and a manifest per shot -
// building all of that is its own slice, docs/dev.md): one viewport
// (desktop), one theme (dark, the only one this session verified live),
// one shot (the People page, not Chat - Chat's real reply on this dev
// machine is the stub model's "[stub model: no real model loaded...]"
// text, honest but not representative of the product's promise; People
// shows real, fully real UI with nothing dependent on a configured LLM).
import { chromium } from "playwright";
import { rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const PORT = 8799;
const ROOT = join(import.meta.dir, "..");
const DATA_DIR = join(ROOT, ".demo-data");
const BASE_URL = `http://localhost:${PORT}`;
const OUT_PATH = join(ROOT, "docs", "assets", "hero.png");

async function waitForHealth(timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return;
    } catch {
      // Backend not listening yet; keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("backend did not become healthy within " + timeoutMs + "ms");
}

async function main() {
  console.log("Building the frontend so the backend has something to serve...");
  const build = Bun.spawnSync({
    cmd: ["bun", "run", "build"],
    cwd: join(ROOT, "frontend"),
    stdout: "inherit",
    stderr: "inherit",
  });
  if (build.exitCode !== 0) throw new Error("frontend build failed");

  if (existsSync(DATA_DIR)) rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });

  console.log("Starting a throwaway backend on a temp data dir...");
  const backend = Bun.spawn({
    cmd: ["bun", "run", "src/index.ts"],
    cwd: join(ROOT, "backend"),
    env: { ...process.env, PORT: String(PORT), MAIPAI_DATA_DIR: DATA_DIR },
    stdout: "ignore",
    stderr: "inherit",
  });

  // Declared outside the try so `finally` can always close it - a code
  // review (2026-09-04) found the original only closed the browser on the
  // success path, leaving an orphaned headless Chromium process behind on
  // any error after launch (a slow render, a selector that never appears).
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await waitForHealth();

    // Seed through Bun's native fetch, not Playwright's own
    // context.request: playwright-core's APIRequestContext throws
    // ("cannot be parsed as a URL") on a Set-Cookie response under Bun's
    // runtime, a real Bun/Playwright interop bug, not anything about
    // this app. Extract the session cookie by hand and hand it to the
    // browser context instead.
    const setup = await fetch(`${BASE_URL}/api/auth/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Sage", secret: "correcthorsebattery" }),
    });
    if (!setup.ok) throw new Error(`seed setup failed: ${setup.status} ${await setup.text()}`);
    const setCookie = setup.headers.get("set-cookie");
    const sessionValue = setCookie?.split(";")[0]?.split("=")[1];
    if (!sessionValue) throw new Error("setup response carried no session cookie");

    for (const person of [
      { displayName: "Marlow", role: "teen" },
      { displayName: "Nova", role: "child" },
    ]) {
      const res = await fetch(`${BASE_URL}/api/people`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: `session=${sessionValue}` },
        body: JSON.stringify(person),
      });
      if (!res.ok) throw new Error(`seed person ${person.displayName} failed: ${res.status}`);
    }

    browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      colorScheme: "dark",
    });
    await context.addCookies([
      { name: "session", value: sessionValue, url: BASE_URL },
    ]);

    const page = await context.newPage();
    await page.goto(`${BASE_URL}/people`);
    // Real content, not a spinner: wait for the seeded roster to actually
    // render before capturing (getmaipai/.github/CLAUDE.md's screenshot
    // rule - a shot of a loading state is not a shot of the feature).
    // getByText("Household") is ambiguous (also matches "Loading
    // household" and the "Add to household" button); the section heading
    // is the one real element that only exists once real data has loaded.
    await page.getByRole("heading", { name: "Household" }).waitFor();
    await page.getByText("Nova", { exact: true }).waitFor();

    mkdirSync(join(ROOT, "docs", "assets"), { recursive: true });
    await page.screenshot({ path: OUT_PATH });
    console.log(`Wrote ${OUT_PATH}`);
  } finally {
    await browser?.close();
    backend.kill();
    await backend.exited;
    rmSync(DATA_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
