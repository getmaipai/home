#!/usr/bin/env bun
// DOCS-DRIFT-01: which guide pages and screenshots does the code that changed
// since a release touch? Reads docs/site-fumadocs/docs-covers.json (the one
// place a page or picture names the code it describes). Run at release time,
// never on push; the release skill regenerates only what this lists.
//
//   bun scripts/docsDrift.ts                  # since the latest v* tag (else the baseline)
//   bun scripts/docsDrift.ts --since <ref>    # since any ref
//   bun scripts/docsDrift.ts --json           # machine-readable
//   bun scripts/docsDrift.ts --check          # exit 1 if a page or picture has no entry
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SITE = join(ROOT, "docs/site-fumadocs");

export interface Covers {
  baseline: string;
  ignore: string[];
  areas: Record<string, string[]>;
  pages: Record<string, { areas?: string[]; covers?: string[] }>;
  shots: Record<string, { areas?: string[]; covers?: string[] }>;
}

export interface Hit { id: string; files: string[] }

const matches = (patterns: string[], path: string) => patterns.some((p) => new Bun.Glob(p).match(path));

function globsFor(entry: { areas?: string[]; covers?: string[] }, covers: Covers): string[] {
  return [...(entry.areas ?? []).flatMap((a) => covers.areas[a] ?? []), ...(entry.covers ?? [])];
}

/** Entries whose declared code appears in `changed` (docs, tests and locales are ignored). */
export function affected(changed: string[], covers: Covers, section: "pages" | "shots"): Hit[] {
  const relevant = changed.filter((f) => !matches(covers.ignore, f));
  const hits: Hit[] = [];
  for (const [id, entry] of Object.entries(covers[section])) {
    const globs = globsFor(entry, covers);
    const files = relevant.filter((f) => matches(globs, f));
    if (files.length) hits.push({ id, files });
  }
  return hits;
}

/** The capture id `DOCS_SHOTS_ONLY` takes, or null when the picture comes from the general screenshot run. */
export function captureId(file: string): string | null {
  const m = /^docs-(.+)\.png$/.exec(file);
  return m ? m[1]! : null;
}

function mdxPages(): string[] {
  const base = join(SITE, "content/docs");
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".mdx")) out.push(relative(base, full).replace(/\.mdx$/, ""));
    }
  };
  walk(base);
  return out.sort();
}

/** Pages or pictures that exist but have no entry, and entries that point at nothing. */
export function coverageGaps(covers: Covers, pages: string[], shotIds: string[]): string[] {
  const gaps: string[] = [];
  for (const p of pages) if (!covers.pages[p]) gaps.push(`page "${p}" has no entry in docs-covers.json; add it with the areas it describes`);
  for (const p of Object.keys(covers.pages)) if (!pages.includes(p)) gaps.push(`docs-covers.json names page "${p}" which does not exist; remove the entry`);
  for (const s of shotIds) if (!covers.shots[s]) gaps.push(`picture "${s}" has no entry in docs-covers.json; add it with the areas it shows`);
  for (const s of Object.keys(covers.shots)) if (!shotIds.includes(s)) gaps.push(`docs-covers.json names picture "${s}" which is not in screenshots.json; remove the entry`);
  for (const [id, e] of [...Object.entries(covers.pages), ...Object.entries(covers.shots)]) {
    for (const a of e.areas ?? []) if (!covers.areas[a]) gaps.push(`"${id}" names the unknown area "${a}"`);
  }
  return gaps;
}

function git(...args: string[]): string {
  const r = Bun.spawnSync(["git", ...args], { cwd: ROOT });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.toString().trim()}`);
  return r.stdout.toString();
}

function latestRelease(): string | null {
  const tags = git("tag", "--list", "v[0-9]*", "--sort=-version:refname").split("\n").filter(Boolean);
  return tags[0] ?? null;
}

if (import.meta.main) {
  const covers = JSON.parse(readFileSync(join(SITE, "docs-covers.json"), "utf8")) as Covers;
  const shots = JSON.parse(readFileSync(join(SITE, "screenshots.json"), "utf8")) as Record<string, { file: string }>;
  const args = process.argv.slice(2);
  if (args.includes("--check")) {
    const gaps = coverageGaps(covers, mdxPages(), Object.keys(shots));
    for (const g of gaps) console.error(g);
    process.exit(gaps.length ? 1 : 0);
  }
  const sinceIdx = args.indexOf("--since");
  const since = sinceIdx >= 0 ? args[sinceIdx + 1]! : (latestRelease() ?? covers.baseline);
  const changed = git("diff", "--name-only", `${since}..HEAD`).split("\n").filter(Boolean);
  const pages = affected(changed, covers, "pages");
  const pics = affected(changed, covers, "shots").map((h) => ({ ...h, capture: captureId(shots[h.id]!.file) }));
  const only = [...new Set(pics.map((p) => p.capture).filter((c): c is string => !!c))];
  const fullRun = pics.filter((p) => !p.capture).map((p) => p.id);
  if (args.includes("--json")) {
    console.log(JSON.stringify({ since, changedFiles: changed.length, pages, pictures: pics, docsShotsOnly: only.join(","), fullRunPictures: fullRun }, null, 2));
  } else {
    console.log(`since ${since}: ${changed.length} files changed`);
    console.log(`\nPages to re-check (${pages.length}):`);
    for (const p of pages) console.log(`  ${p.id}  <- ${p.files.slice(0, 3).join(", ")}${p.files.length > 3 ? ` (+${p.files.length - 3})` : ""}`);
    console.log(`\nPictures to retake (${pics.length}):`);
    for (const p of pics) console.log(`  ${p.id}  (${p.capture ? `capture ${p.capture}` : "general screenshot run"})`);
    if (only.length) console.log(`\nRetake the docs pictures:\n  DOCS_SHOTS_ONLY=${only.join(",")} bun run scripts/screenshot.ts --docs-review`);
    if (fullRun.length) console.log(`These come from the general run, not --docs-review: ${fullRun.join(", ")}`);
  }
}
