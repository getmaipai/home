import { db } from "@/db";
import { people, personCredentials, sessions } from "@/db/schema";

// All test files in one `bun test` run share the same imported `@/db`
// module (Bun's module cache is process-wide, not per-file), so each
// describe block clears the tables itself rather than trying to isolate
// per-file databases.
export function resetDb(): void {
  db.delete(sessions).run();
  db.delete(personCredentials).run();
  db.delete(people).run();
}
