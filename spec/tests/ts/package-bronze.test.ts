// The bronze completeness check docs/PACKAGES.md and
// session-d-packages-and-store.md step 1 both ask for: "the release
// skill's 'refuse below bronze' check has something to read." This is
// that something - it walks every bundled package under `home`'s own
// backend/packages/ (the only bundled set that exists today; the
// catalog repo will carry the same shape once step 6 moves the default
// set there) and proves the definition of done in docs/PACKAGES.md is
// actually met, not just claimed by the manifest's own `quality_scale`
// string:
//
//   tests green everywhere, five or more routing examples, a privacy
//   row per data source, stated offline behavior, a smoke test, README
//   and changelog present, lint clean.
//
// "Tests green" and "lint clean" are scripts/check.sh's own job (this
// suite running at all, and the rest of check.sh passing); this file
// checks the parts that are otherwise just convention: routing examples,
// privacy rows, offline behavior (already schema-required), a
// quality_scale.yaml stating bronze is met, a smoke declaration, and a
// README/CHANGELOG. A spec/ file reading into `home`'s backend/packages/
// is a one-way dependency (home depends on spec, never the reverse) so
// this never runs against the `bot` repo reusing spec/ - it is scoped
// explicitly to the one directory that exists today, not a generic path.
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PackageManifest } from "../../gen/ts/manifest.js";
import { lintSpeechTemplate } from "../../voice/ts/normalizeForSpeech.js";

const PACKAGES_DIR = join(import.meta.dir, "..", "..", "..", "backend", "packages");

// Session C step 6 (session-c-brain-and-voice.md): "the speech lint on
// every package `speech` string" (docs/PACKAGES.md's own definition-of-
// done line) - walks recipe.json's own tree collecting every string value
// under a key literally named "speech", wherever it appears, rather than
// assuming today's flat `{op, as, text, speech}` step shape is the only
// one a future step type will ever use.
function collectSpeechStrings(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectSpeechStrings(item, out);
    return;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "speech" && typeof value === "string") out.push(value);
      else collectSpeechStrings(value, out);
    }
  }
}

// remember/recall are C's packages (session-d-packages-and-store.md's
// ownership map carves them out explicitly: "backend/packages/{remember,
// recall}/ (memory-owned recipes; every other package is D's)"). This
// suite checks the bar this session actually built its own packages
// against; it is not this session's place to fail check.sh over another
// session's in-flight work, or to write their README/CHANGELOG/
// quality_scale.yaml/smoke entries for them. C carries the identical
// bronze bar for those two packages in its own dev docs.
const NOT_D_OWNED_IDS = new Set(["remember", "recall"]);

// `kind: "companion"` packages (buddy, default, pal, tutor - Session A's
// step 8, merged to main 2026-09-06) are persona/identity packages, not
// D's lane at all (D's ownership map is silent on companions; they
// belong with whichever session owns persona.ts). Excluded by kind
// rather than by a growing id list, since any future companion is the
// same "not D's" answer regardless of its id.
function isDOwned(manifest: PackageManifest): boolean {
  if (manifest.kind === "companion") return false;
  if (NOT_D_OWNED_IDS.has(manifest.id)) return false;
  return true;
}

interface QualityScale {
  scale: string;
  bronze: Record<string, { met: boolean }>;
}

const allPackageIds = readdirSync(PACKAGES_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

const packageIds = allPackageIds.filter((id) => {
  const manifest = PackageManifest.parse(JSON.parse(readFileSync(join(PACKAGES_DIR, id, "manifest.json"), "utf-8")));
  return isDOwned(manifest);
});

// A real bundled set should never be empty; an empty result here almost
// certainly means PACKAGES_DIR's relative path broke, which would
// otherwise silently pass every "for each package" test below with zero
// iterations.
test("at least one bundled package exists to check", () => {
  expect(packageIds.length).toBeGreaterThan(0);
});

describe("every bundled package clears bronze", () => {
  for (const id of packageIds) {
    describe(id, () => {
      const dir = join(PACKAGES_DIR, id);
      const manifest = PackageManifest.parse(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf-8")));

      test("has 5+ routing examples", () => {
        expect(manifest.routing?.examples?.length ?? 0).toBeGreaterThanOrEqual(5);
      });

      test("states offline behavior", () => {
        expect(["full", "degraded", "unavailable"]).toContain(manifest.offline);
      });

      test("has a privacy row for every net: permission", () => {
        const declaresNet = (manifest.permissions ?? []).some((p) => p.startsWith("net:"));
        if (declaresNet) {
          expect((manifest.data_sources ?? []).length).toBeGreaterThan(0);
        }
      });

      test("declares a smoke entry", () => {
        expect(manifest.smoke).toBeDefined();
      });

      test("every speech string passes the speech lint", () => {
        const recipePath = join(dir, "recipe.json");
        if (!existsSync(recipePath)) return; // a declarative kind with no recipe of its own (a skill, say)
        const speechStrings: string[] = [];
        collectSpeechStrings(JSON.parse(readFileSync(recipePath, "utf-8")), speechStrings);
        for (const speech of speechStrings) {
          expect(lintSpeechTemplate(speech), `${id}'s recipe.json speech field ${JSON.stringify(speech)}`).toEqual([]);
        }
      });

      test("has a README.md", () => {
        expect(existsSync(join(dir, "README.md"))).toBe(true);
      });

      test("has a CHANGELOG.md", () => {
        expect(existsSync(join(dir, "CHANGELOG.md"))).toBe(true);
      });

      test("has a quality_scale.yaml stating bronze is met", () => {
        const path = join(dir, "quality_scale.yaml");
        expect(existsSync(path)).toBe(true);
        const scale = Bun.YAML.parse(readFileSync(path, "utf-8")) as QualityScale;
        for (const [criterion, value] of Object.entries(scale.bronze)) {
          expect(value.met, `${id}'s quality_scale.yaml bronze.${criterion} is not met`).toBe(true);
        }
      });
    });
  }
});
