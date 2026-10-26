// LYRICS-LOOKUP: receipts and the pause state for the lyrics lookup.
import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { lyricsLookups, lyricsLookupState } from "@/db/schema";
import { hasReceipt, isPaused, recordReceipt, recordRefusal, recordSuccess } from "@/lib/media/lyricsReceipts";
import { resetDb } from "./reset-db";

// These two tables land in a migration this change does not write, so the
// test database does not have them yet: create them here, matching
// backend/src/db/schema.ts exactly.
sqlite.exec(`
CREATE TABLE IF NOT EXISTS lyrics_lookups (
  item_id text PRIMARY KEY NOT NULL,
  looked_up_at integer NOT NULL,
  outcome text NOT NULL
);
CREATE TABLE IF NOT EXISTS lyrics_lookup_state (
  id integer PRIMARY KEY NOT NULL,
  paused_until integer NOT NULL DEFAULT 0,
  backoff_s integer NOT NULL DEFAULT 0
);
`);

// resetDb() predates these tables and does not clear them, so the rows go.
beforeEach(() => {
  resetDb();
  sqlite.exec("DELETE FROM lyrics_lookups");
  sqlite.exec("DELETE FROM lyrics_lookup_state");
});

const receipt = (itemId: string) => db.select().from(lyricsLookups).where(eq(lyricsLookups.itemId, itemId)).get();
const state = () => db.select().from(lyricsLookupState).where(eq(lyricsLookupState.id, 1)).get();

describe("receipts", () => {
  test("a receipt is absent until recorded, then present", () => {
    expect(hasReceipt("media-1")).toBe(false);
    recordReceipt("media-1", "hit", 1000);
    expect(hasReceipt("media-1")).toBe(true);
  });

  test("a repeated receipt keeps the first", () => {
    recordReceipt("media-2", "miss", 1000);
    recordReceipt("media-2", "hit", 2000);
    expect(receipt("media-2")).toEqual({ itemId: "media-2", lookedUpAt: 1000, outcome: "miss" });
  });
});

describe("the pause state", () => {
  test("the lookup is not paused before any refusal", () => {
    expect(isPaused(0)).toBe(false);
    expect(state()).toBeUndefined();
  });

  test("a refusal pauses for an hour and each refusal doubles it", () => {
    const t0 = 1000000;
    recordRefusal(t0);
    expect(state()).toEqual({ id: 1, pausedUntil: t0 + 3600 * 1000, backoffS: 3600 });
    recordRefusal(t0);
    expect(state()).toEqual({ id: 1, pausedUntil: t0 + 7200 * 1000, backoffS: 7200 });
  });

  test("the backoff caps at a day", () => {
    const t0 = 1000000;
    for (let n = 0; n < 9; n++) recordRefusal(t0);
    expect(state()).toEqual({ id: 1, pausedUntil: t0 + 86400 * 1000, backoffS: 86400 });
  });

  test("an answer from the service clears the pause and the backoff", () => {
    const t0 = 1000000;
    recordRefusal(t0);
    expect(isPaused(t0 + 1000)).toBe(true);
    recordSuccess();
    expect(state()).toEqual({ id: 1, pausedUntil: 0, backoffS: 0 });
    expect(isPaused(t0 + 1000)).toBe(false);
    recordRefusal(t0); // the run restarts at the first backoff
    expect(state()).toEqual({ id: 1, pausedUntil: t0 + 3600 * 1000, backoffS: 3600 });
  });

  test("after the pause time passes the lookup is not paused", () => {
    const t0 = 1000000;
    recordRefusal(t0);
    expect(isPaused(t0 + 3600 * 1000 - 1)).toBe(true);
    expect(isPaused(t0 + 3600 * 1000)).toBe(false);
    expect(isPaused(t0 + 3600 * 1000 + 1000)).toBe(false);
  });
});
