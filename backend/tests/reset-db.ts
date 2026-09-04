import { db } from "@/db";
import { people, personCredentials, sessions, memoryRecords } from "@/db/schema";

// All test files in one `bun test` run share the same imported `@/db`
// module (Bun's module cache is process-wide, not per-file), so every
// test file clears the tables itself rather than trying to isolate
// per-file databases. Order matters: memoryRecords and sessions/
// personCredentials all reference people, so they're deleted first.
export function resetDb(): void {
  db.delete(memoryRecords).run();
  db.delete(sessions).run();
  db.delete(personCredentials).run();
  db.delete(people).run();
}
