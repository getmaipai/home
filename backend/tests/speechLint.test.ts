// A placeholder for C's real speech lint (session-c-brain-and-voice.md
// step 6, docs/PACKAGES.md's "the speech lint on every speech string").
// Until that lands, this is the mechanical half only: no em dash
// (getmaipai/.github/CLAUDE.md's AI writing standard, "the number one
// machine-generated tell") and no exclamation point in a bundled
// package's spoken or displayed text - `format` steps' `text`/`speech`
// templates for a Tier 0 plugin, and the instruction body for a `skill`
// package. Scans every bundled package, not just D's own: a violation in
// any package is a real housemate-test failure regardless of who owns
// the file.
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const PACKAGES_DIR = join(import.meta.dir, "..", "packages");
const EM_DASH = "—";

function collectTemplateStrings(recipeJson: unknown): string[] {
  const strings: string[] = [];
  const steps = (recipeJson as { steps?: unknown[] })?.steps ?? [];
  for (const step of steps) {
    const s = step as { op?: string; text?: string; speech?: string };
    if (s.op === "format") {
      if (typeof s.text === "string") strings.push(s.text);
      if (typeof s.speech === "string") strings.push(s.speech);
    }
  }
  return strings;
}

function violations(text: string): string[] {
  const found: string[] = [];
  if (text.includes(EM_DASH)) found.push("em dash");
  if (text.includes("!")) found.push("exclamation point");
  return found;
}

const packageIds = readdirSync(PACKAGES_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

describe("speech lint (placeholder for C's real one)", () => {
  for (const id of packageIds) {
    const recipePath = join(PACKAGES_DIR, id, "recipe.json");
    const skillPath = join(PACKAGES_DIR, id, "SKILL.md");

    if (existsSync(recipePath)) {
      test(`${id}/recipe.json's format templates are clean`, () => {
        const recipe = JSON.parse(readFileSync(recipePath, "utf-8"));
        for (const text of collectTemplateStrings(recipe)) {
          expect(violations(text), `"${text}" in ${id}/recipe.json`).toEqual([]);
        }
      });
    }

    if (existsSync(skillPath)) {
      test(`${id}/SKILL.md's body is clean`, () => {
        const body = readFileSync(skillPath, "utf-8");
        expect(violations(body), `${id}/SKILL.md`).toEqual([]);
      });
    }
  }
});
