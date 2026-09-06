// A shared owner()/teen() test-auth setup, used wherever a route test
// needs a signed-in owner and a lower-role person to check a role gate
// against (routes/repairs.ts's own tests, and now routes/store.ts's).
// A real gap found by code review: before this file existed, the
// identical pair was hand-copied into tests/repairs.test.ts and
// tests/store.test.ts (and, per that review, into 15+ other test files
// across this suite - a pre-existing pattern from before this session,
// out of this file's own scope to retrofit everywhere at once).
// getmaipai/.github/CLAUDE.md's testing standard: "reuse the same
// helpers and fixtures," not a parallel hand-rolled copy - if
// /api/auth/setup or /api/people's shape ever changes, there should be
// one place that needs updating, not N.
import { TestClient } from "../client";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { PersonRow } from "@/types";

export async function owner(): Promise<{ client: TestClient; row: PersonRow }> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const row = db.select().from(people).where(eq(people.displayName, "Sage")).get()! as PersonRow;
  return { client, row };
}

export async function teen(ownerClient: TestClient): Promise<TestClient> {
  const created = await ownerClient.post("/api/people", { displayName: "Bramble", role: "teen" });
  const { id } = (await created.json()) as { id: string };
  const client = new TestClient();
  await client.post("/api/auth/select", { personId: id });
  return client;
}
