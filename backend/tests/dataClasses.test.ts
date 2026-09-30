import { describe, expect, test } from "bun:test";
import { DataClass } from "@maipai/spec/gen/ts/data-class.js";
import { DATA_CLASSES, dataClassById } from "@/lib/dataClasses";

// DATA-LOCATION-00c: Home's twenty-one data classes are declared once
// (lib/dataClasses.ts) and lib/paths.ts derives every path it exports
// from that list. Design: docs/dev.md, "DATA-LOCATION".

const EXPECTED_IDS = [
  "records",
  "keys",
  "people-files",
  "cloned-voices",
  "projects",
  "packages",
  "models",
  "engines",
  "sidecars",
  "reference",
  "wakeword-models",
  "stt-models",
  "tts-models",
  "vision-models",
  "logs",
  "cache",
  "favicons",
  "runtime",
  "labels",
  "backups",
  "received-backups",
];

describe("Home's class list", () => {
  test("declares exactly the design record's twenty-one classes, once each", () => {
    expect(DATA_CLASSES.map((c) => c.id).sort()).toEqual(
      [...EXPECTED_IDS].sort(),
    );
    expect(new Set(DATA_CLASSES.map((c) => c.id)).size).toBe(
      DATA_CLASSES.length,
    );
  });

  test("every declaration parses against the spec's data-class shape and belongs to home", () => {
    for (const c of DATA_CLASSES) {
      const parsed = DataClass.safeParse(c);
      expect(
        parsed.success,
        `${c.id}: ${parsed.success ? "" : parsed.error.message}`,
      ).toBe(true);
      expect(c.product).toBe("home");
    }
  });

  test("the design record's disclosure levels hold", () => {
    const level = (l: string) =>
      DATA_CLASSES.filter((c) => c.level === l)
        .map((c) => c.id)
        .sort();
    expect(level("basic")).toEqual(
      [
        "records",
        "keys",
        "people-files",
        "cloned-voices",
        "projects",
        "models",
        "reference",
        "backups",
      ].sort(),
    );
    expect(level("expert")).toEqual(
      ["cache", "favicons", "runtime", "labels"].sort(),
    );
    expect(level("advanced")).toEqual(
      [
        "packages",
        "engines",
        "sidecars",
        "wakeword-models",
        "stt-models",
        "tts-models",
        "vision-models",
        "received-backups",
        "logs",
      ].sort(),
    );
  });

  test("records and keys refuse to boot when missing; a hold class lists no features, a degrade class lists some", () => {
    expect(dataClassById("records").whenMissing).toBe("hold");
    expect(dataClassById("keys").whenMissing).toBe("hold");
    for (const c of DATA_CLASSES) {
      if (c.whenMissing === "hold") expect(c.degrades, c.id).toEqual([]);
    }
    for (const id of [
      "models",
      "engines",
      "tts-models",
      "reference",
      "people-files",
      "backups",
    ]) {
      expect(dataClassById(id).whenMissing).toBe("degrade");
      expect(dataClassById(id).degrades.length, id).toBeGreaterThan(0);
    }
  });

  test("the two backup classes sit beside the root; every other class sits under it", () => {
    for (const c of DATA_CLASSES) {
      const beside = c.id === "backups" || c.id === "received-backups";
      expect(c.default.base, c.id).toBe(beside ? "beside-root" : "root");
    }
  });

  test("no two default folders are the same, and none nests inside another (records is the root itself)", () => {
    const seen = new Map<string, string>();
    for (const c of DATA_CLASSES) {
      const key = `${c.default.base}:${c.default.subpath}`;
      expect(seen.has(key), `${c.id} repeats ${seen.get(key)}`).toBe(false);
      seen.set(key, c.id);
    }
    expect(dataClassById("records").default).toEqual({
      base: "root",
      subpath: "",
    });
    const rooted = DATA_CLASSES.filter(
      (c) => c.default.base === "root" && c.default.subpath !== "",
    );
    for (const a of rooted) {
      for (const b of rooted) {
        if (a.id === b.id) continue;
        expect(
          `${b.default.subpath}/`.startsWith(`${a.default.subpath}/`),
          `${b.id} (${b.default.subpath}) nests inside ${a.id} (${a.default.subpath})`,
        ).toBe(false);
      }
    }
  });

  test("a class's needs match the design record's class table", () => {
    const needs = (id: string) => [...dataClassById(id).needs].sort();
    expect(needs("records")).toEqual(["private", "sqlite"]);
    expect(needs("keys")).toEqual(["private"]);
    expect(needs("packages")).toEqual(["sqlite"]);
    expect(needs("models")).toEqual(["large-files"]);
    expect(needs("engines")).toEqual(["exec"]);
    expect(needs("tts-models")).toEqual(["exec", "symlinks"]);
    expect(needs("logs")).toEqual([]);
  });

  test("the sensitive and backup columns follow the design record", () => {
    expect(dataClassById("keys").sensitive).toBe("keys");
    expect(dataClassById("keys").backup).toBe("kit");
    expect(dataClassById("cloned-voices").sensitive).toBe("biometric");
    expect(dataClassById("reference").backup).toBe("library");
    expect(dataClassById("backups").backup).toBe("none");
    expect(dataClassById("received-backups").backup).toBe("none");
    expect(dataClassById("models").backup).toBe("exclude");
  });
});
