import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// FILM-LINES-01: every reader of a shot's dialogue goes through shotLines/shotText (lib/films/lines.ts). This fails on any new direct read.
const root = join(import.meta.dir, "..", "src");
function walk(dir: string): string[] { return readdirSync(dir).flatMap((name) => { const path = join(dir, name); return statSync(path).isDirectory() ? walk(path) : path.endsWith(".ts") ? [path] : []; }); }

test("no source file reads shot.line outside the plan schema and the one reader", () => {
  const offenders: string[] = [];
  for (const file of [...walk(join(root, "lib", "films")), join(root, "lib", "media", "videoCreateApp.ts"), join(root, "routes", "mediaProductions.ts")]) {
    if (file.endsWith("/films/plan.ts") || file.endsWith("/films/lines.ts")) continue;
    let text = ""; try { text = readFileSync(file, "utf8"); } catch { continue; }
    text.split("\n").forEach((row, i) => { if (/\b(shot|planned|s)\.line\b/.test(row) || /\bshot\)?\.line\b/.test(row)) offenders.push(`${file.replace(root, "src")}:${i + 1}`); });
  }
  expect(offenders).toEqual([]);
});
