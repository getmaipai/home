// session-d-packages-and-store.md step 2: proves the new manifest fields
// (cache, warm, warm_on, contributes.widgets, exposes.queries, channel,
// smoke) round-trip through the generated Zod model with the real shapes
// the plan and wave-2.md's contracts describe. No bundled package uses
// these yet (cache/warm land in step 3, widgets in step 9, exposes.queries
// is C's to populate), so this is the only place proving the schema itself
// is right until then.
import { describe, expect, test } from "bun:test";
import { PackageManifest } from "../../gen/ts/manifest.js";

const BASE = {
  id: "test-pkg",
  version: "0.1.0",
  kind: "plugin",
  category: "Info",
  display: "Test",
  description: "A minimal manifest for schema field tests.",
  author: "MaiPai",
  license: "AGPL-3.0",
  platforms: ["home"],
  min_role: "child",
  consequential: false,
  offline: "full",
  min_app: "0.1.0",
  tier: 0,
} as const;

describe("PackageManifest, step 2's new fields", () => {
  test("cache: key_template, ttl_s, stale_ok_s, max_bytes", () => {
    const manifest = {
      ...BASE,
      cache: { key_template: "weather:{place}", ttl_s: 1800, stale_ok_s: 3600, max_bytes: 4096 },
    };
    expect(() => PackageManifest.parse(manifest)).not.toThrow();
  });

  test("warm: schedule, keys", () => {
    const manifest = {
      ...BASE,
      warm: { schedule: "every:1h", keys: [{ place: "household's home place" }] },
    };
    expect(() => PackageManifest.parse(manifest)).not.toThrow();
  });

  test("warm.schedule rejects a grammar the scheduler doesn't understand", () => {
    const manifest = { ...BASE, warm: { schedule: "hourly", keys: [] } };
    expect(() => PackageManifest.parse(manifest)).toThrow();
  });

  test("warm_on: setting keys that trigger an immediate warm", () => {
    const manifest = { ...BASE, warm_on: ["household.home_place"] };
    expect(() => PackageManifest.parse(manifest)).not.toThrow();
  });

  test("contributes.widgets: id, title, size, refresh_s, inputs", () => {
    const manifest = {
      ...BASE,
      contributes: {
        widgets: [{ id: "forecast", title: "Weather", size: "card", refresh_s: 1800, inputs: { place: "home" } }],
      },
    };
    expect(() => PackageManifest.parse(manifest)).not.toThrow();
  });

  test("contributes.widgets rejects a size outside card/row", () => {
    const manifest = {
      ...BASE,
      contributes: { widgets: [{ id: "forecast", title: "Weather", size: "banner", refresh_s: 1800 }] },
    };
    expect(() => PackageManifest.parse(manifest)).toThrow();
  });

  test("exposes.queries: id, description, args, returns", () => {
    const manifest = {
      ...BASE,
      exposes: {
        queries: [
          {
            id: "current_temperature",
            description: "The current temperature at a named place.",
            args: { type: "object", required: ["place"], properties: { place: { type: "string" } } },
            returns: { type: "object", properties: { temperature_f: { type: "number" } } },
          },
        ],
      },
    };
    expect(() => PackageManifest.parse(manifest)).not.toThrow();
  });

  test("channel defaults to stable and rejects an unknown value", () => {
    expect(PackageManifest.parse({ ...BASE, channel: "beta" }).channel).toBe("beta");
    expect(() => PackageManifest.parse({ ...BASE, channel: "nightly" })).toThrow();
  });

  test("smoke.kind is required once smoke is present", () => {
    expect(() => PackageManifest.parse({ ...BASE, smoke: {} })).toThrow();
    expect(() => PackageManifest.parse({ ...BASE, smoke: { kind: "static" } })).not.toThrow();
    expect(() =>
      PackageManifest.parse({ ...BASE, smoke: { kind: "recipe_fixture", fixture: "tests/smoke.json" } }),
    ).not.toThrow();
  });
});
