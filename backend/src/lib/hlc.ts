// Home's own hybrid logical clock instance, node-stamped with this
// install's device id. The clock algorithm itself lives in
// @maipai/core/src/hlc now (core-v0.1.0); everything below this line is
// Home's own: which tables carry an hlc column, and reseeding from the
// database at boot.
import { getDeviceId6 } from "@/lib/deviceId";
import { sqlite } from "@/db";
import { compareHlc, createHlcClock } from "@maipai/core/src/hlc";

// getDeviceId6() caches internally after its first real read/write, so
// reading it once here (module load) rather than per nextHlc() call
// changes nothing observable - the id never changes within a process.
const clock = createHlcClock(getDeviceId6());

export const nextHlc = clock.next;
export const seedHlc = clock.seed;
export const __resetHlcForTests = clock.__resetForTests;
export { compareHlc };

// Every table that stamps hlc via nextHlc() - kept here, not scattered
// across each table's own module, so this list can never silently miss
// a table the way an earlier settings.ts-only seeding did. Exported so
// tests/hlc.test.ts can walk db/schema.ts (getTableColumns() against
// every exported table) and assert this list exactly matches every real
// hlc-bearing table - a table added later that also carries an hlc
// column and isn't added here fails that test instead of silently
// repeating this exact bug.
export const HLC_BEARING_TABLES = [
  "people",
  "memory_records",
  "memory_embeddings",
  "episodes",
  "episode_embeddings",
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
  "open_questions",
  "reply_constraints",
  "reply_feedback",
  "attachments",
] as const;

/** Seeds from every hlc already on disk, across every table that stamps
 * one - called once at boot (index.ts), before any write can happen.
 * Every row, not a SQL MAX(hlc): hlc sorts lexicographically as TEXT
 * ("999:0:abc" > "1000:0:abc" as strings, despite 1000 being the later
 * wall_ms), so only seedHlc()'s own numeric-aware comparison can find
 * the real highest one. */
export function seedHlcFromDatabase(): void {
  // Every row, not a SQL-side reduction to one per table: genuinely
  // O(total rows), but a one-time boot cost, not a per-request one, and
  // each row is just a string split plus a numeric comparison.
  for (const table of HLC_BEARING_TABLES) {
    const rows = sqlite.query(`SELECT hlc FROM ${table}`).all() as { hlc: string }[];
    for (const row of rows) seedHlc(row.hlc);
  }
}
