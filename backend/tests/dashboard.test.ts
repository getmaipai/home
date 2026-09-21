// SHELL-01: GET /api/dashboard, the one aggregate the template's modern-
// dashboard widgets read (lib/dashboard.ts's own header has the full
// person-scoping rule). Backend-only per the item's own scope.
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { owner, teen } from "./support/testAuth";
import { db } from "@/db";
import { people, appUpdateState } from "@/db/schema";
import { eq } from "drizzle-orm";
import { runTurn } from "@/lib/turnEngine";
import { raiseIssue, __resetFixHandlersForTests } from "@/lib/issues";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __setStackClientForTests, __resetStackEngineForTests } from "@/lib/stackEngine";
import { startStackFixture, type StackFixture } from "./stackFixture";
import type { PersonRow } from "@/types";

beforeEach(() => {
  resetDb();
  __resetFixHandlersForTests();
});

async function child(ownerClient: TestClient): Promise<{ client: TestClient; row: PersonRow }> {
  const created = await ownerClient.post("/api/people", { displayName: "Pippa", role: "child" });
  const { id } = (await created.json()) as { id: string };
  const row = db.select().from(people).where(eq(people.id, id)).get()! as PersonRow;
  const client = new TestClient();
  await client.post("/api/auth/select", { personId: id });
  return { client, row };
}

describe("GET /api/dashboard", () => {
  test("requires a signed-in person", async () => {
    const client = new TestClient();
    const res = await client.get("/api/dashboard");
    expect(res.status).toBe(401);
  });

  test("every signed-in person gets people_count, updates_available, recent_activity and turns_per_day - never repairs_open or engines", async () => {
    const { client: ownerClient } = await owner();
    await child(ownerClient);
    const teenClient = await teen(ownerClient);

    const res = await teenClient.get("/api/dashboard");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.people_count).toBe(3); // owner, child, teen - a household-wide fact, visible regardless of role
    expect(body.updates_available).toBe(false);
    expect(Array.isArray(body.recent_activity)).toBe(true);
    expect(Array.isArray(body.turns_per_day)).toBe(true);
    expect(body.turns_per_day).toHaveLength(30);
    expect("repairs_open" in body).toBe(false);
    expect("engines" in body).toBe(false);
  });

  test("owner/admin gets repairs_open (0) and engines (null, no Stack configured)", async () => {
    const { client } = await owner();
    const res = await client.get("/api/dashboard");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { repairs_open: number; engines: unknown };
    expect(body.repairs_open).toBe(0);
    expect(body.engines).toBeNull();
  });

  test("repairs_open counts unresolved issues; engines counts a configured Stack's own health severities", async () => {
    const { client } = await owner();
    await raiseIssue({ source: "a", key: "1", severity: "warning", title: "Open one", detail: "d" });

    const fixture = startStackFixture({
      "GET /stack/v1/health": async () =>
        Response.json({
          health: [
            { code: "engine.crashed.chat", severity: "critical", title: "t", text: "t", since: "2026-09-21T00:00:00Z", cause: "c" },
            { code: "engine.slow.judge", severity: "warning", title: "t", text: "t", since: "2026-09-21T00:00:00Z", cause: "c" },
          ],
        }),
    });
    try {
      setHouseholdSettingValue("engines.stack.url", fixture.url);
      __setStackClientForTests(fixture.client);

      const res = await client.get("/api/dashboard");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { repairs_open: number; engines: { critical: number; warning: number; error: number; total: number } };
      // Both Stack health items fold into Issues too (syncStackHealthIssues(),
      // the same step repairs.ts's own GET runs), so this is the
      // pre-existing manually-raised issue PLUS both newly-synced ones.
      expect(body.repairs_open).toBe(3);
      expect(body.engines).toEqual({ critical: 1, warning: 1, error: 0, total: 2 });
    } finally {
      fixture.stop();
      __resetStackEngineForTests();
    }
  });

  test("a child's own turn is visible to owner/admin, but a teen's or another adult's own turn never is", async () => {
    const { client: ownerClient, row: ownerRow } = await owner();
    const { row: childRow } = await child(ownerClient);
    const teenClient = await teen(ownerClient);
    const adultCreated = await ownerClient.post("/api/people", { displayName: "Vincent", role: "adult", secret: "0000" });
    const { id: adultId } = (await adultCreated.json()) as { id: string };
    const adultRow = db.select().from(people).where(eq(people.id, adultId)).get()! as PersonRow;

    await runTurn(ownerRow, "chat", "hello from the owner");
    await runTurn(childRow, "chat", "hello from the child");
    // Sign in as the teen/adult only to speak, then read the dashboard
    // back as the owner - canAccessPerson()'s own rule (this file's own
    // header) says an owner sees a child's turns but never a teen's or
    // another adult's.
    await runTurn(adultRow, "chat", "hello from another adult");
    const teenSpoke = await teenClient.post("/api/turn", { text: "hello from the teen" });
    expect(teenSpoke.status).toBe(200);

    const res = await ownerClient.get("/api/dashboard");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { recent_activity: Array<{ person_id: string; display_name: string }> };
    const speakers = body.recent_activity.map((a) => a.person_id);
    expect(speakers).toContain(ownerRow.id);
    expect(speakers).toContain(childRow.id);
    expect(speakers).not.toContain(adultRow.id);
    expect(speakers.length).toBe(new Set(speakers).size); // no duplicates from the self+children merge
  });

  test("updates_available reflects a real pending update, without calling GitHub", async () => {
    const { client } = await owner();
    db.insert(appUpdateState).values({ id: "app", checkedAt: new Date().toISOString(), latestVersion: "v9.9.9" }).run();

    const res = await client.get("/api/dashboard");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { updates_available: boolean };
    expect(body.updates_available).toBe(true);
  });

  // A review finding: a raw string inequality between `latest` ("vX.Y.Z")
  // and `installed` (unprefixed, "0.1.0" by default in tests) reads a
  // household as needing an update forever even when the two name the
  // identical release - this is the exact case the fix (reusing
  // lib/updates.ts's own semver-derived `blockedBy`) has to get right,
  // which the "v9.9.9" test above cannot tell apart from the old buggy
  // code (any non-null latestVersion differs from "0.1.0" as a string).
  test("updates_available is false when latest and installed name the identical release, v-prefix and all", async () => {
    const { client } = await owner();
    db.insert(appUpdateState).values({ id: "app", checkedAt: new Date().toISOString(), latestVersion: "v0.1.0" }).run();

    const res = await client.get("/api/dashboard");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { updates_available: boolean };
    expect(body.updates_available).toBe(false);
  });
});
