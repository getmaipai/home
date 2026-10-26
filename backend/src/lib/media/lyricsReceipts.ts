// LYRICS-LOOKUP: receipts and a pause state for the lyrics lookup (lyricsLookup.ts).
// A receipt proves an item was already asked about (hit or miss), so it is never
// asked twice. The state row is the household-wide backoff: a refusal pauses the
// lookup for 3600 s, doubling on each refusal up to 86400 s; any answer from the
// service (hit or miss) proves it answers and resets the backoff.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { lyricsLookups, lyricsLookupState } from "@/db/schema";

const BACKOFF_START_S = 3600;
const BACKOFF_MAX_S = 86400;
const STATE_ID = 1;

export function hasReceipt(itemId: string): boolean {
  return db.select().from(lyricsLookups).where(eq(lyricsLookups.itemId, itemId)).get() !== undefined;
}

export function recordReceipt(itemId: string, outcome: "hit" | "miss", nowMs: number): void {
  db.insert(lyricsLookups).values({ itemId, lookedUpAt: nowMs, outcome }).onConflictDoNothing().run();
}

function stateRow() {
  return db.select().from(lyricsLookupState).where(eq(lyricsLookupState.id, STATE_ID)).get();
}

export function isPaused(nowMs: number): boolean {
  const row = stateRow();
  return row !== undefined && nowMs < row.pausedUntil;
}

export function recordRefusal(nowMs: number): void {
  const current = stateRow()?.backoffS ?? 0;
  const backoffS = Math.min(current === 0 ? BACKOFF_START_S : current * 2, BACKOFF_MAX_S);
  const pausedUntil = nowMs + backoffS * 1000;
  db.insert(lyricsLookupState)
    .values({ id: STATE_ID, pausedUntil, backoffS })
    .onConflictDoUpdate({ target: lyricsLookupState.id, set: { pausedUntil, backoffS } })
    .run();
}

export function recordSuccess(): void {
  db.insert(lyricsLookupState)
    .values({ id: STATE_ID, pausedUntil: 0, backoffS: 0 })
    .onConflictDoUpdate({ target: lyricsLookupState.id, set: { pausedUntil: 0, backoffS: 0 } })
    .run();
}
