#!/usr/bin/env bun
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium, type Page } from "playwright";
import { waitForAnimationSettle } from "./animationSettle";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "data-scratch", "screenshots", "look-baseline");
function devHubUrl(): string {
  try { return execFileSync("bash", [join(ROOT, "scripts/dev.sh"), "url"], { cwd: ROOT, encoding: "utf8" }).trim(); }
  catch (error) { throw new Error(`Could not read the dev hub URL with scripts/dev.sh url: ${String(error)}`); }
}
type Route = { slug: string; path: string; auth: "sage" | "none" };
function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
export function captureFileName(slug: string, width: number, height: number, theme: "dark" | "light"): string {
  return `${slug}-${width}x${height}-${theme}.png`;
}
function routesFromInventory(): Route[] {
  const doc = readFileSync(join(ROOT, "docs/design/ROUTE-INVENTORY.md"), "utf8");
  const block = doc.match(/```json\s*([\s\S]*?)\s*```/);
  if (!block) throw new Error("Route inventory has no fenced JSON manifest");
  return JSON.parse(block[1]!) as Route[];
}
async function signInAsSage(page: Page): Promise<void> {
  await page.goto(`${page.url().replace(/\/$/, "")}/sign-in`);
  const result = await page.evaluate(async () => {
    const profilesResponse = await fetch("/api/auth/profiles");
    if (!profilesResponse.ok) throw new Error(`Profiles request failed: ${profilesResponse.status}`);
    const profiles = await profilesResponse.json() as Array<{ id: string; display_name: string }>;
    const sage = profiles.find((profile) => profile.display_name === "Sage");
    if (!sage) throw new Error("The dev hub does not have the seeded Sage profile");
    const response = await fetch("/api/auth/verify-secret", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personId: sage.id, secret: "correcthorsebattery" }),
    });
    if (!response.ok) throw new Error(`Sage sign-in failed: ${response.status}`);
    return response.json();
  });
  if (!result) throw new Error("Sage sign-in returned no session");
}
async function main(): Promise<void> {
  const base = argument("--base") ?? devHubUrl();
  const routes = routesFromInventory();
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}) });
  const report: Array<{ slug: string; path: string; captures: Array<{ width: number; height: number; theme: string; file: string; consoleErrors: string[]; blankFrame: boolean }> }> = [];
  try {
    for (const route of routes) {
      const captures = [];
      for (const size of [{ width: 1440, height: 900 }, { width: 402, height: 874 }]) {
        for (const theme of ["dark", "light"] as const) {
          const context = await browser.newContext({ viewport: size, colorScheme: theme, reducedMotion: "reduce" });
          const page = await context.newPage();
          const consoleErrors: string[] = [];
          page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
          page.on("pageerror", (error) => consoleErrors.push(error.message));
          await page.goto(base);
          if (route.auth === "sage") await signInAsSage(page);
          await page.goto(new URL(route.path, base).toString(), { waitUntil: "domcontentloaded" });
          const blankFrame = await page.evaluate(() => {
            const root = document.querySelector("#root") ?? document.body;
            return !(root.textContent?.trim() || root.querySelector("img, canvas, video, svg, input, button"));
          });
          await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => undefined);
          await page.waitForTimeout(900);
          await waitForAnimationSettle(() => page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === "running").length));
          const file = captureFileName(route.slug, size.width, size.height, theme);
          await page.screenshot({ path: join(OUT, file), fullPage: false });
          captures.push({ ...size, theme, file, consoleErrors, blankFrame });
          await context.close();
        }
      }
      report.push({ slug: route.slug, path: route.path, captures });
      console.log(`Captured ${route.path}`);
    }
  } finally {
    await browser.close();
  }
  writeFileSync(join(OUT, "report.json"), JSON.stringify({ base, routes: report }, null, 2) + "\n");
}

if (import.meta.main) await main();
