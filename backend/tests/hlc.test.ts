// Direct unit tests for lib/hlc.ts (step 10, session-a-intelligence.md:
// "hlc.ts gets its missing seed/compare tests"). settings.test.ts's own
// "HLC" describe blocks already cover the pattern, basic monotonicity,
// and seedHlc's two headline regression scenarios; this file covers what
// those left out - the counter's own same-millisecond advance proven
// directly (not just inferred from strictly-increasing output),
// compareHlc()'s node tiebreak (hlc.ts's own header names it "the rarely-
// needed final tiebreak," never exercised anywhere until now), and
// seedHlc()'s exact boundary (a seed at the identical wall_ms with a
// LOWER counter must be a no-op, not just "an older wall_ms is").
import { describe, expect, test, beforeEach } from "bun:test";
import { is, getTableColumns, getTableName } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import { nextHlc, compareHlc, seedHlc, seedHlcFromDatabase, HLC_BEARING_TABLES, __resetHlcForTests } from "@/lib/hlc";
import * as schema from "@/db/schema";
import { db } from "@/db";
import { people } from "@/db/schema";
import { resetDb } from "./reset-db";

beforeEach(() => {
  __resetHlcForTests();
  resetDb();
});

describe("nextHlc()", () => {
  test("matches the spec's hlc pattern (wall_ms:counter:node)", () => {
    expect(nextHlc()).toMatch(/^[0-9]+:[0-9]+:[a-z0-9]{6,}$/);
  });

  test("the counter itself advances within the same wall-clock millisecond", () => {
    // settings.test.ts's own "consecutive calls are strictly increasing"
    // proves the OUTCOME but would pass identically if the wall clock
    // happened to tick between every call instead - parsing wallMs
    // directly is the only way to prove the counter branch is what
    // actually advanced.
    const a = nextHlc();
    const b = nextHlc();
    const partsA = a.split(":");
    const partsB = b.split(":");
    const wallA = Number(partsA[0]);
    const counterA = Number(partsA[1]);
    const wallB = Number(partsB[0]);
    const counterB = Number(partsB[1]);
    if (wallA === wallB) {
      expect(counterB).toBe(counterA + 1);
    } else {
      // A real clock tick landed between the two calls - rare, but a
      // valid outcome this test isn't trying to prove; still must hold.
      expect(wallB).toBeGreaterThan(wallA);
    }
  });
});

describe("compareHlc()", () => {
  test("orders by wall_ms first, regardless of counter", () => {
    expect(compareHlc("100:5:aaaaaa", "200:0:aaaaaa")).toBeLessThan(0);
    expect(compareHlc("200:0:aaaaaa", "100:5:aaaaaa")).toBeGreaterThan(0);
  });

  test("orders by counter when wall_ms ties", () => {
    expect(compareHlc("100:1:aaaaaa", "100:2:aaaaaa")).toBeLessThan(0);
    expect(compareHlc("100:2:aaaaaa", "100:1:aaaaaa")).toBeGreaterThan(0);
  });

  test("falls back to node as the final tiebreak when wall_ms and counter both tie", () => {
    // The case hlc.ts's own header calls "astronomically unlikely
    // locally; matters once a second node exists via sync" - real code,
    // never actually run until this test.
    expect(compareHlc("100:1:aaaaaa", "100:1:bbbbbb")).toBeLessThan(0);
    expect(compareHlc("100:1:bbbbbb", "100:1:aaaaaa")).toBeGreaterThan(0);
  });

  test("two identical hlcs compare equal", () => {
    expect(compareHlc("100:1:aaaaaa", "100:1:aaaaaa")).toBe(0);
  });
});

describe("seedHlc()", () => {
  test("a fresh nextHlc() after seeding with a future hlc lands strictly after it", () => {
    seedHlc("9999999999999:5:abc123");
    const fresh = nextHlc();
    expect(compareHlc(fresh, "9999999999999:5:abc123")).toBeGreaterThan(0);
  });

  test("seeding with an older wall_ms never regresses the clock backward", () => {
    const a = nextHlc();
    seedHlc("1:0:zzzzzz");
    const b = nextHlc();
    expect(compareHlc(b, a)).toBeGreaterThan(0);
  });

  test("seeding with the same wall_ms but a LOWER counter is a no-op, not a regression", () => {
    const first = nextHlc();
    const second = nextHlc();
    const [wallMs] = second.split(":");
    seedHlc(`${wallMs}:0:zzzzzz`); // strictly lower counter at the identical wall_ms
    const third = nextHlc();
    expect(compareHlc(third, second)).toBeGreaterThan(0);
  });
});

// COR-6 (code review, 2026-09-06): seedHlcFromDatabase() used to only
// ever seed from settings_values (lib/settings.ts's own module-load
// call) - memory_records, conversations, conversation_turns, people,
// issues and the rest of HLC_BEARING_TABLES were all free to get a
// stamp OLDER than what was already on disk after a clock regression.
describe("HLC_BEARING_TABLES stays in sync with the real schema", () => {
  test("every table with a real hlc column is in the list, and nothing else claims to be", () => {
    const tablesWithHlcColumn: string[] = [];
    for (const value of Object.values(schema)) {
      if (!is(value, SQLiteTable)) continue;
      const table = value as SQLiteTable;
      if ("hlc" in getTableColumns(table)) tablesWithHlcColumn.push(getTableName(table));
    }
    tablesWithHlcColumn.sort();
    expect(tablesWithHlcColumn).toEqual([...HLC_BEARING_TABLES].sort());
  });
});

describe("seedHlcFromDatabase()", () => {
  beforeEach(() => resetDb());

  test("seeds from a real row's hlc, across a real table (people), not just settings_values", async () => {
    db.insert(people)
      .values({
        id: "person-hlctest",
        displayName: "Test",
        role: "adult",
        avatarSeed: "person-hlctest",
        source: "hub",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        hlc: "9999999999999:5:abc123",
      })
      .run();

    seedHlcFromDatabase();
    const fresh = nextHlc();
    expect(compareHlc(fresh, "9999999999999:5:abc123")).toBeGreaterThan(0);
  });

  test("an empty database seeds nothing and never throws", () => {
    expect(() => seedHlcFromDatabase()).not.toThrow();
  });
});
