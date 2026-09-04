// Round-trips every fixture in spec/fixtures/records/ through its generated
// Zod model. This is the TS half of the proof required by platform plan 3:
// "home's check.sh round-trips every fixture in spec/fixtures/ through both
// generated model sets." The Python half is spec/gen/py/test_fixtures.py.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Person } from "../../gen/ts/person.js";
import { SettingValue } from "../../gen/ts/setting-value.js";
import { SettingsKey } from "../../gen/ts/settings-key.js";
import { MemoryRecord } from "../../gen/ts/memory-record.js";
import { PackageManifest } from "../../gen/ts/manifest.js";
import { SafetyResult } from "../../gen/ts/safety-result.js";
// ErrorEntry is standards-owned (std-v0.2.0), not generated here; the error
// catalogue's shape is imported from the sibling .github checkout, the same
// way spec/schemas/manifest.schema.json imports PrivacyRow by $ref.
import { ErrorEntry } from "../../../../.github/standards/gen/ts/error-entry.js";

const FIXTURES_DIR = join(import.meta.dir, "..", "..", "fixtures", "records");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf-8"));
}

describe("record fixtures validate against their generated Zod models", () => {
  test("person.example.json", () => {
    expect(() => Person.parse(loadFixture("person.example.json"))).not.toThrow();
  });

  test("setting-value.example.json", () => {
    expect(() =>
      SettingValue.parse(loadFixture("setting-value.example.json")),
    ).not.toThrow();
  });

  test("settings-key.example.json", () => {
    expect(() =>
      SettingsKey.parse(loadFixture("settings-key.example.json")),
    ).not.toThrow();
  });

  for (const kind of ["memory", "entity", "episode"]) {
    test(`memory-record.${kind}.example.json`, () => {
      expect(() =>
        MemoryRecord.parse(loadFixture(`memory-record.${kind}.example.json`)),
      ).not.toThrow();
    });
  }

  test("manifest.example.json", () => {
    expect(() =>
      PackageManifest.parse(loadFixture("manifest.example.json")),
    ).not.toThrow();
  });

  test("safety-result.example.json", () => {
    expect(() =>
      SafetyResult.parse(loadFixture("safety-result.example.json")),
    ).not.toThrow();
  });

  test("error catalogue entries", () => {
    const errors = JSON.parse(
      readFileSync(
        join(import.meta.dir, "..", "..", "errors", "errors.json"),
        "utf-8",
      ),
    ) as unknown[];
    expect(errors.length).toBeGreaterThan(0);
    for (const entry of errors) {
      expect(() => ErrorEntry.parse(entry)).not.toThrow();
    }
  });
});

describe("a bad record is rejected, not silently accepted", () => {
  test("person missing a required field fails", () => {
    const bad = loadFixture("person.example.json") as Record<string, unknown>;
    delete bad.role;
    expect(() => Person.parse(bad)).toThrow();
  });

  test("person with an unknown extra field fails (additionalProperties: false)", () => {
    const bad = { ...(loadFixture("person.example.json") as Record<string, unknown>), extra: "nope" };
    expect(() => Person.parse(bad)).toThrow();
  });
});
