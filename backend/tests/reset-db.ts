import { db } from "@/db";
import {
  people,
  personCredentials,
  sessions,
  memoryRecords,
  idSequences,
  settingsValues,
  scheduledJobs,
  conversationTurns,
} from "@/db/schema";

// All test files in one `bun test` run share the same imported `@/db`
// module (Bun's module cache is process-wide, not per-file), so every
// test file clears the tables itself rather than trying to isolate
// per-file databases. Order matters: memoryRecords and sessions/
// personCredentials all reference people, so they're deleted first.
//
// idSequences (lib/memoryId.ts's mem/ent/ep counters) is cleared too: a
// code review (2026-09-04) found it wasn't, so the counters kept
// incrementing across every describe block in a `bun test` run despite
// this function's own comment claiming full per-file isolation. No test
// currently asserts a specific id value (only the id *pattern*), so this
// was silent; clearing it now means a future test that does assert a
// specific id (e.g. the first record created is "mem1-...") won't have a
// hidden dependency on what ran before it in the same process.
export function resetDb(): void {
  db.delete(scheduledJobs).run();
  db.delete(conversationTurns).run();
  db.delete(memoryRecords).run();
  db.delete(settingsValues).run();
  db.delete(idSequences).run();
  db.delete(sessions).run();
  db.delete(personCredentials).run();
  db.delete(people).run();
}
