// TIER-HOME-03 and TIER-PRIO-05: the Max window routes that are left of `/api/ai` (the model choices moved to the Stack: aiStackRoutes.test.ts).
import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { invalidateSessionCacheForPerson } from "@/middleware/auth";
import { closeForJob, resetCloseAppsForTests, type CloseHelper } from "@/lib/jobs/closeApps";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

beforeEach(() => { resetDb(); });

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  return { client, actor };
}

describe("the Max window (TIER-HOME-03)", () => {
  test("an admin reads that no Max job runs and Stop reports nothing to stop; an adult is refused", async () => {
    const { client, actor } = await owner();
    expect(await (await client.get("/api/ai/tier-window")).json()).toEqual({ open: false, minutes_left: null, line: null, profile: null, closed_apps: [] });
    expect(await (await client.post("/api/ai/tier-window/stop", {})).json()).toEqual({ stopped: false });
    db.update(people).set({ role: "adult" }).where(eq(people.id, actor.id)).run();
    invalidateSessionCacheForPerson(actor.id);
    expect((await client.get("/api/ai/tier-window")).status).toBe(403);
    expect((await client.post("/api/ai/tier-window/stop", {})).status).toBe(403);
  });
});

describe("the Status line for closed apps (TIER-PRIO-05)", () => {
  test("an admin reads which apps were closed; the names never reach a non-admin", async () => {
    const { client, actor } = await owner();
    resetCloseAppsForTests();
    const helper: CloseHelper = { list: async () => ({ installed: true, apps: [{ bundleId: "x.Safari", name: "Safari", bytes: 9e9, frontmost: false }] }), quit: async () => "quit", reopen: async () => true };
    await closeForJob("job-1", "video", 8, { mode: "automatic", always: ["x.Safari"], never: [], reopen: true, noReopen: [] }, helper, Date.parse("2026-10-30T12:00:00Z"));
    const body = await (await client.get("/api/ai/tier-window")).json() as { closed_apps: string[] };
    expect(body.closed_apps).toEqual([expect.stringContaining("Closed Safari to make room")]);
    db.update(people).set({ role: "adult" }).where(eq(people.id, actor.id)).run();
    invalidateSessionCacheForPerson(actor.id);
    const refused = await client.get("/api/ai/tier-window");
    expect(refused.status).toBe(403);
    expect(JSON.stringify(await refused.json())).not.toContain("Safari");
    resetCloseAppsForTests();
  });
});
