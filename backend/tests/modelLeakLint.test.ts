import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// MODELPACK-HOME-LINT (rule E8, docs/design/RULES.md; record docs/design/model-packs-2026-11-17.md and the audit beside it).
// A model's own knowledge (names, limits, prompt wording, reference counts) lives in its pack on the Stack, never in Home. This
// scan lists every Home source file that still names a model, and it must match docs/design/model-leak-allowlist.json exactly:
// a new file naming a model fails, and so does an allowlist entry whose file no longer names one (delete the entry then). The
// allowlist may only shrink: ALLOWLIST_CEILING below is the entry count when the check was added and only ever goes down.
// Run it alone with `cd backend && bun run lint:no-model-names`.
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const ALLOWLIST_FILE = join(ROOT, "docs/design/model-leak-allowlist.json");
const SCAN_DIRS = ["backend/src", "frontend/src", "shared"];

/** Entry count at creation (2026-11-17). Lower it when MODELPACK-HOME rows delete entries; never raise it. */
export const ALLOWLIST_CEILING = 114;

/** Model brands, families and part ids. `llama` alone is not here: llama.cpp is the engine, not a model. */
export const MODEL_PATTERN = new RegExp(
  [
    "minimax", "h3[-_]swap", "(?<![<\\/,\\w])h3(?![\\w>,])", "h3_",
    "flux", "\\bltx", "\\bace[-_ ]?step", "ernie", "z[-_]?image",
    "qwen", "gemma", "pocket[-_ ]?tts", "chatterbox", "kyutai", "demucs", "kokoro", "parakeet", "sdxl",
  ].join("|"),
  "i",
);
/** Wan is matched with its case (the id `wan`, the name `Wan`), so the network word WAN is not a leak. */
const WAN_PATTERN = /\b(?:wan|Wan)(?:\b|[-_.]?2)/;
export const namesModel = (text: string): boolean => MODEL_PATTERN.test(text) || WAN_PATTERN.test(text);

type Verdict = "Stay" | "Label" | "Move" | "Deferred";
type Entry = { file: string; verdict: Verdict; reason: string; moveTo?: string };

function skip(rel: string): boolean {
  return /\.(test|spec)\.[tj]sx?$/.test(rel) || /(^|\/)(locales?|node_modules|tests)\//.test(rel) || /\.po$/.test(rel) || !/\.(tsx?|json|mjs)$/.test(rel);
}
function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "node_modules") walk(p, out); } else out.push(p);
  }
}
function leakingFiles(): string[] {
  const files: string[] = [];
  for (const d of SCAN_DIRS) walk(join(ROOT, d), files);
  return files.map((f) => relative(ROOT, f)).filter((r) => !skip(r)).filter((r) => namesModel(readFileSync(join(ROOT, r), "utf8"))).sort();
}
const allowlist = (): Entry[] => (JSON.parse(readFileSync(ALLOWLIST_FILE, "utf8")) as { files: Entry[] }).files;

describe("model leak lint (rule E8)", () => {
  test("no Home file names a model outside the allowlist", () => {
    const allowed = new Set(allowlist().map((e) => e.file));
    expect(leakingFiles().filter((f) => !allowed.has(f))).toEqual([]);
  });
  test("every allowlist entry still names a model (the list only shrinks)", () => {
    const leaking = new Set(leakingFiles());
    expect(allowlist().map((e) => e.file).filter((f) => !leaking.has(f))).toEqual([]);
  });
  test("the allowlist never grows", () => {
    const list = allowlist();
    expect(list.length).toBeLessThanOrEqual(ALLOWLIST_CEILING);
    expect(new Set(list.map((e) => e.file)).size).toBe(list.length);
  });
  test("each entry has a verdict and a reason, and a Move or Deferred entry names the row that removes it", () => {
    for (const e of allowlist()) {
      expect(["Stay", "Label", "Move", "Deferred"]).toContain(e.verdict);
      expect(e.reason.length).toBeGreaterThan(5);
      if (e.verdict === "Move" || e.verdict === "Deferred") expect(e.moveTo ?? "").toMatch(/^MODELPACK-/);
    }
  });
});
