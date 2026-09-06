// Hybrid logical clock, `wall_ms:counter:node` (spec/schemas/setting-
// value.schema.json's `hlc` field, 7.3). Per-field last-writer-wins for
// settings is one of this whole platform's settled sync primitives
// (0.4's research findings), so the write path generates a real HLC now
// even though there's only one writer today (no link/sync yet, Hub v0.3):
// getting the comparison right from the first write means a future
// remote write compares correctly against it with no shape change.
import { getDeviceId6 } from "@/lib/deviceId";
import { sqlite } from "@/db";

let lastWallMs = 0;
let counter = 0;

export function nextHlc(): string {
  const wallMs = Date.now();
  if (wallMs > lastWallMs) {
    lastWallMs = wallMs;
    counter = 0;
  } else {
    counter++;
  }
  return `${lastWallMs}:${counter}:${getDeviceId6()}`;
}

function parseHlc(hlc: string): { wallMs: number; counter: number; node: string } {
  const [wallMs, counter, node] = hlc.split(":");
  return { wallMs: Number(wallMs), counter: Number(counter), node: node ?? "" };
}

// A review (2026-09-04) found nextHlc() only guaranteed monotonicity
// within one process's lifetime: lastWallMs/counter reset to 0 on every
// restart with nothing recovering from what was already persisted. If
// the wall clock is ever behind where it was before a restart (no RTC,
// NTP not synced yet at boot, a manual/DST clock change), a freshly
// generated hlc could be SMALLER than an hlc already stored, and
// lib/settings.ts's compareHlc(hlc, existing.hlc) <= 0 check would then
// permanently refuse every future write to that key with a misleading
// "a newer value already exists" error, never recovering until the wall
// clock naturally caught back up. Called once at boot (seedHlcFromDatabase()
// below) with the highest hlc already on disk, across every hlc-bearing
// table, so a restart can never regress behind what was already
// committed - COR-6 (code review, 2026-09-06) found this originally only
// ever seeded from settings_values (lib/settings.ts's own module-load
// call, still here for the same reason), leaving memory_records,
// conversations, conversation_turns, people, issues, devices, entities,
// relationships, grants, and routing_embeddings all free to get a stamp
// OLDER than what was already on disk after the exact clock regression
// this function exists to recover from.
export function seedHlc(knownHlc: string): void {
  const { wallMs, counter: c } = parseHlc(knownHlc);
  if (wallMs > lastWallMs || (wallMs === lastWallMs && c > counter)) {
    lastWallMs = wallMs;
    counter = c;
  }
}

// Every table that stamps hlc via nextHlc() - kept here, not scattered
// across each table's own module, so this list can never silently miss
// a table the way the settings.ts-only seeding did. Exported so
// tests/hlc.test.ts can walk db/schema.ts (getTableColumns() against
// every exported table) and assert this list exactly matches every real
// hlc-bearing table - a table added later that also carries an hlc
// column and isn't added here fails that test instead of silently
// repeating this exact bug.
export const HLC_BEARING_TABLES = [
  "people",
  "memory_records",
  "memory_embeddings",
  "settings_values",
  "conversations",
  "conversation_turns",
  "issues",
  "devices",
  "entities",
  "relationships",
  "grants",
  "routing_embeddings",
  "lists",
] as const;

/** Seeds from every hlc already on disk, across every table that stamps
 * one - called once at boot (index.ts), before any write can happen.
 * Every row, not a SQL MAX(hlc): hlc sorts lexicographically as TEXT
 * ("999:0:abc" > "1000:0:abc" as strings, despite 1000 being the later
 * wall_ms), so only seedHlc()'s own numeric-aware comparison can find
 * the real highest one - the same reason lib/settings.ts's own call site
 * below has always fed it every row rather than a SQL-computed max. */
export function seedHlcFromDatabase(): void {
  // Every row, not a SQL-side reduction to one per table: a review,
  // 2026-09-06, named the real cost this has as data grows (a household's
  // full history, eventually tens of thousands of rows across all 13
  // tables) - genuinely O(total rows), but a one-time boot cost, not a
  // per-request one, and each row is just a string split plus a numeric
  // comparison. Revisit if boot time actually becomes visible at real
  // household scale; not a correctness concern today.
  for (const table of HLC_BEARING_TABLES) {
    const rows = sqlite.query(`SELECT hlc FROM ${table}`).all() as { hlc: string }[];
    for (const row of rows) seedHlc(row.hlc);
  }
}

/** >0 if a is newer, <0 if b is newer, 0 if equal. Node is the final,
 * rarely-needed tiebreak for two nodes writing at the identical wall_ms
 * and counter (astronomically unlikely locally; matters once a second
 * node exists via sync). */
export function compareHlc(a: string, b: string): number {
  const pa = parseHlc(a);
  const pb = parseHlc(b);
  if (pa.wallMs !== pb.wallMs) return pa.wallMs - pb.wallMs;
  if (pa.counter !== pb.counter) return pa.counter - pb.counter;
  return pa.node.localeCompare(pb.node);
}

/** Test-only: the counter is module-local state with no other reset hook. */
export function __resetHlcForTests(): void {
  lastWallMs = 0;
  counter = 0;
}
