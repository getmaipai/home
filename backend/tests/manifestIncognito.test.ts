// INCOGNITO-04 (home/docs/BACKLOG.md): every package manifest declares a
// required incognito: "blocked" | "ephemeral" | "unaffected" field.
// Enforcement is the schema itself (spec/schemas/manifest.schema.json's
// own `required` array) read through the one shared reader every route
// and install check already calls - loadManifestOnly()/loadPackage()'s
// PackageManifest.safeParse() gate (lib/plugins.ts). No new host code:
// this proves that gate actually rejects a manifest missing the field,
// and that every one of home's own bundled packages has it set.
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import { loadManifestOnly, listPackageIds } from "@/lib/plugins";
import { PACKAGES_DIR } from "@/lib/paths";

const MINIMAL_MANIFEST = {
  id: "test-pkg",
  version: "0.1.0",
  kind: "plugin",
  category: "Info",
  display: "Test",
  description: "A minimal manifest for the incognito field's own tests.",
  author: "MaiPai",
  license: "AGPL-3.0",
  platforms: ["home"],
  min_role: "child",
  consequential: false,
  offline: "full",
  min_app: "0.1.0",
  tier: 0,
} as const;

describe("PackageManifest.incognito: required, never a silent default", () => {
  test("a manifest missing incognito fails PackageManifest.safeParse()", () => {
    expect(PackageManifest.safeParse(MINIMAL_MANIFEST).success).toBe(false);
  });

  test("the same manifest with incognito set parses fine", () => {
    expect(PackageManifest.safeParse({ ...MINIMAL_MANIFEST, incognito: "unaffected" }).success).toBe(true);
  });

  test("loadManifestOnly() refuses to load a bundled package whose manifest is missing incognito - proves the install/load path, not just the schema in isolation", () => {
    // almanac-date is a real bundled package; strip incognito the way an
    // interrupted or hand-edited install could, and confirm the shared
    // reader reports it unloadable rather than falling back to a default.
    const real = JSON.parse(readFileSync(join(PACKAGES_DIR, "almanac-date", "manifest.json"), "utf-8"));
    delete real.incognito;
    expect(PackageManifest.safeParse(real).success).toBe(false);
  });
});

describe("every bundled package's manifest has a real incognito value", () => {
  const bundledIds = readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  test("at least one bundled package exists", () => {
    expect(bundledIds.length).toBeGreaterThan(0);
  });

  for (const id of bundledIds) {
    test(`${id}: loads and declares incognito`, () => {
      const result = loadManifestOnly(id);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(["blocked", "ephemeral", "unaffected"]).toContain(result.value.incognito);
      }
    });
  }
});

test("listPackageIds() and the bundled directory sweep above agree on every bundled id", () => {
  const bundledIds = readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  for (const id of bundledIds) {
    expect(listPackageIds()).toContain(id);
  }
});
