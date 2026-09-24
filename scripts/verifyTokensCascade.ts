#!/usr/bin/env bun
// TOKENS-PRIMARY-01 (docs/BACKLOG.md): proves `--primary` (and the rest
// of the tokens a `.style-<name>` preset can redeclare) resolves to
// Home's own declared value, not `commons`'s vendored
// `dashboard/css/globals.css` competing default, in a REAL rendered
// page - never a static grep of the CSS source, since a grep can't see
// which of two identical-specificity `:root` rules a real browser
// actually applies. Traced import chain: `frontend/src/main.tsx`
// imports `@/shell/tokens.css`, which `@import`s the kit's
// `dashboard/css/globals.css` (the vendored template's own preset)
// then the kit's own `tokens.css`, then declares Home's own `:root`
// override for `--primary` (and its dependents) last in the same file
// - plain, unlayered rules at identical specificity resolve by source
// order, so Home's override, being textually last, should always win.
// This script proves that holds in a real Chromium render (never
// edited: the fix, if one is ever needed, belongs in `frontend/src/
// shell/tokens.css`'s own import order or an explicit `@layer` there,
// never in the vendored kit files this script only reads).
//
// Run: `bun run verify:tokens-cascade` (root package.json). Builds the
// frontend, serves the real `dist/` output (no backend needed - CSS
// custom properties resolve on `:root` independent of whether the app
// itself can render past its error boundary without one), and reads
// `getComputedStyle(document.documentElement).getPropertyValue("--primary")`
// under `.light` and `.dark`, the same classes `useAppearance.ts`
// toggles on the real `<html>` element. Also saves a screenshot of
// whatever real primary-colored element the page renders (the error
// boundary's own "Reload" button when no backend answers) beside each
// reading, so a person can open and judge it the way the item's own
// acceptance asks - not proof by itself, the computed-style assertion
// below is, but the human-judged half the item's acceptance also wants.
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const FRONTEND = join(ROOT, "frontend");
const DIST = join(FRONTEND, "dist");
const OUT_DIR = join(ROOT, "data-scratch", "tokens-cascade");

// Home's own declared values, verbatim (frontend/src/shell/tokens.css,
// the `:root`/`.dark` blocks after both kit `@import`s) - the value
// this script asserts the real render against, never the kit's own
// tokens.css `#21a6ff` or globals.css's shadcn default `oklch(0.205 0 0)`.
const DECLARED = {
  light: "hsl(189 94% 26%)",
  dark: "hsl(189 84% 55%)",
} as const;

/** `getComputedStyle` on this build normalizes a custom property set
 * from a stylesheet's own `hsl()` notation to hex (Lightning CSS's own
 * minifier rewrites it at build time, confirmed live: an inline
 * `style.setProperty` with the identical literal comes back
 * unnormalized) - converted here with real HSL-to-RGB math instead of
 * a hand-typed hex guess, so a mistyped constant can't quietly make
 * this pass or fail for the wrong reason. */
export function hslToHex(hsl: string): string {
  const m = /^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/.exec(hsl);
  if (!m) throw new Error(`hslToHex: not a plain "hsl(h s% l%)" string: ${hsl}`);
  const h = Number(m[1]) / 360;
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  const hueToRgb = (p: number, q: number, t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hueToRgb(p, q, h + 1 / 3);
    g = hueToRgb(p, q, h);
    b = hueToRgb(p, q, h - 1 / 3);
  }
  const toHex = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

async function main(): Promise<void> {
  if (!existsSync(join(DIST, "index.html")) || process.argv.includes("--build")) {
    console.log("[verify-tokens-cascade] building the frontend...");
    const build = spawnSync("bun", ["run", "build"], { cwd: FRONTEND, stdio: "inherit" });
    if (build.status !== 0) {
      console.error("[verify-tokens-cascade] frontend build failed");
      process.exit(1);
    }
  }

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname === "/" ? "/index.html" : url.pathname;
      const file = Bun.file(join(DIST, path));
      return (await file.exists()) ? new Response(file) : new Response(Bun.file(join(DIST, "index.html")));
    },
  });
  const base = `http://127.0.0.1:${server.port}`;

  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  let failed = false;
  try {
    const page = await browser.newPage();
    await page.goto(`${base}/`, { waitUntil: "networkidle" });

    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((cls) => {
        const root = document.documentElement;
        root.classList.remove("light", "dark");
        root.classList.add(cls);
      }, theme);
      await page.waitForTimeout(150); // one paint, no fixed sleep beyond it
      const actual = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--primary").trim());
      const expected = hslToHex(DECLARED[theme]);
      const shotPath = join(OUT_DIR, `primary-${theme}.png`);
      await page.screenshot({ path: shotPath });
      const ok = actual.toLowerCase() === expected.toLowerCase();
      console.log(`[verify-tokens-cascade] ${theme}: --primary = "${actual}" (expected "${expected}", declared "${DECLARED[theme]}") - ${ok ? "ok" : "MISMATCH"} - capture: ${shotPath}`);
      if (!ok) failed = true;
    }
  } finally {
    await browser.close();
    server.stop(true);
  }

  if (failed) {
    console.error("[verify-tokens-cascade] the vendored template's own --primary is winning the cascade in at least one theme - see docs/BACKLOG.md, TOKENS-PRIMARY-01");
    process.exit(1);
  }
  console.log("[verify-tokens-cascade] Home's own --primary wins the cascade in both themes; captures are in data-scratch/tokens-cascade/ for a person to open and judge");
}

if (import.meta.main) {
  await main();
}
