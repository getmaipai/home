// Nothing in the research path is written for one kind of subject (owner ruling, 2026-11-01: "make sure nothing is hard-coded to one show
// or to TV shows, series, movies, etc"). This scans the research source files for topic words in code, prompts and comments; a justified
// generic use goes in researchNoTopicWords.allow.json with its reason. Test fixtures are not scanned (they may name any subject).
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import allow from "./researchNoTopicWords.allow.json";

const ROOT = join(import.meta.dir, "../../src/lib/turnMachine");
const files = [
  ...readdirSync(ROOT).filter((f) => /^(research|pageNotes|entityPin|backbone|contract)[A-Za-z]*\.ts$/.test(f)),
  ...readdirSync(join(ROOT, "nodes")).filter((f) => f.endsWith(".ts")).map((f) => `nodes/${f}`),
];

// Case-insensitive whole words that name a kind of entertainment work or its parts.
const BANNED = /\b(tv|television|series|seasons?|episodes?|movies?|films?|miniseries|franchise|reboot|network|casts?|sequels?|novels?|comics?|nbc|johnson)\b/gi;
// The single letter used as a title, and the noun "show" (the verb "shows" is ordinary English and is not banned).
const BANNED_CASE_SENSITIVE: [RegExp, string][] = [[/\bV\b/g, "V"], [/\b(?:a|the|its|their|weekly|one-season) shows?\b/gi, "the noun show"]];

interface Hit { file: string; line: number; word: string; text: string }
function scan(): Hit[] {
  const hits: Hit[] = [];
  for (const file of files) {
    readFileSync(join(ROOT, file), "utf8").split("\n").forEach((text, index) => {
      for (const m of text.matchAll(BANNED)) hits.push({ file, line: index + 1, word: m[0].toLowerCase(), text: text.trim().slice(0, 140) });
      for (const [re, name] of BANNED_CASE_SENSITIVE) for (const m of text.matchAll(re)) hits.push({ file, line: index + 1, word: name === "V" ? "V" : name, text: text.trim().slice(0, 140) });
    });
  }
  return hits;
}
const allowed = (hit: Hit): boolean => allow.allow.some((a) => a.file === hit.file && a.word === hit.word);

describe("no topic words in the research source", () => {
  test("the scan covers the research files and the turn nodes", () => {
    expect(files).toContain("research.ts");
    expect(files).toContain("researchPipeline.ts");
    expect(files).toContain("pageNotes.ts");
    expect(files).toContain("entityPin.ts");
    expect(files).toContain("backbone.ts");
    expect(files).toContain("nodes/model.ts");
    expect(files).toContain("nodes/tool.ts");
    expect(files).toContain("nodes/answer.ts");
  });

  test("no banned word appears outside the allowlist", () => {
    const bad = scan().filter((h) => !allowed(h));
    expect(bad.map((h) => `${h.file}:${h.line} "${h.word}": ${h.text}`)).toEqual([]);
  });

  test("every allowlist entry names a reason and still matches something (a stale entry goes)", () => {
    const hits = scan();
    for (const entry of allow.allow) {
      expect(entry.reason.length).toBeGreaterThan(15);
      expect(hits.some((h) => h.file === entry.file && h.word === entry.word)).toBe(true);
    }
  });

  test("the scanner itself catches the words it is for", () => {
    const sample = "The TV series V had one season and a sequel on the network; the show was a cast of five.";
    expect([...sample.matchAll(BANNED)].map((m) => m[0].toLowerCase()).sort()).toEqual(["cast", "network", "season", "sequel", "series", "tv"]);
    expect(sample.match(BANNED_CASE_SENSITIVE[0]![0])).not.toBeNull();
    expect("it shows the result".match(BANNED_CASE_SENSITIVE[1]![0])).toBeNull();
  });
});
