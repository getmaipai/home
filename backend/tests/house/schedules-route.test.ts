// HOUSE-04 schedule verdict, app side: a signed-in adult sees their own device schedules and can cancel one;
// the owner/admin also gets a count of other people's, never names. Teens and children are refused for now.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { TestClient } from "../client";
import { owner, teen, child } from "../support/testAuth";
import { resetDb } from "../reset-db";
import { createDeviceSchedule, listOwnSchedules, type ScheduleDeps } from "@/lib/schedules/store";
import type { HouseEntity } from "@/lib/house/registry";
import { __setHouseSchedulesDepsForTests } from "@/routes/houseSchedules";
import { fakeHa, HOUSE_SETTINGS } from "../schedules/fakeHa";

const light = (id: string, name: string): HouseEntity => ({ id, name, kind: "light", area: "outside", state: "off", sensitive: null, deviceClass: null, rgb: null, brightness: null, sceneMembers: null });
const entities = [light("light.porch", "Porch Lamp"), light("light.hall", "Hall")];
const allow = () => ["see", "control"].flatMap((level) => entities.map((e) => ({ action: `house.${level}:default/entity:${e.id}`, effect: "allow" as const })));

let schedule: ScheduleDeps;
beforeEach(() => {
  resetDb();
  const ha = fakeHa();
  schedule = { house: { read: HOUSE_SETTINGS, fetch: ha.fetch }, loadRegistry: async () => ({ ok: true, areas: [], entities }), permissionsOf: allow, zoneOf: () => "America/New_York", now: () => new Date("2026-11-06T20:00:00.000Z") };
  __setHouseSchedulesDepsForTests({ schedule, entities: async () => entities });
});
afterEach(() => __setHouseSchedulesDepsForTests());

async function adultClient(ownerClient: TestClient): Promise<{ client: TestClient; id: string }> {
  const created = await ownerClient.post("/api/people", { displayName: "Iris", role: "adult", secret: "correcthorse2" });
  const { id } = (await created.json()) as { id: string };
  const client = new TestClient();
  await client.post("/api/auth/verify-secret", { personId: id, secret: "correcthorse2" });
  return { client, id };
}
const make = (id: string, role: string, targets = ["default/light.porch"], extra: Record<string, unknown> = {}) =>
  createDeviceSchedule({ person: { id, role }, kind: "device_action", targets, action: "turn_on", time: "16:00", days: [1, 2, 3, 4, 5], ...extra }, schedule);

describe("GET /api/house/schedules", () => {
  test("lists only the signed-in adult's own schedules with plain words", async () => {
    const { client, row } = await owner(); const other = await adultClient(client);
    await make(row.id, "owner"); await make(other.id, "adult", ["default/light.hall"]);
    const body = await (await client.get("/api/house/schedules")).json() as { schedules: Array<{ id: string; what: string; when: string; state: string; note: string | null }>; others: number | null };
    expect(body.schedules).toHaveLength(1);
    expect(body.schedules[0]).toMatchObject({ what: "Porch Lamp light turns on", when: "on Mon, Tue, Wed, Thu, Fri at 4:00 PM", state: "active", note: null });
    expect(JSON.stringify(body)).not.toContain("Hall");
  });
  test("owner gets a count of other people's live schedules, an ordinary adult gets none", async () => {
    const { client, row } = await owner(); const other = await adultClient(client);
    await make(row.id, "owner"); await make(other.id, "adult", ["default/light.hall"]);
    expect(((await (await client.get("/api/house/schedules")).json()) as { others: number | null }).others).toBe(1);
    expect(((await (await other.client.get("/api/house/schedules")).json()) as { others: number | null }).others).toBeNull();
  });
  test("teen, child and signed-out callers are refused", async () => {
    const { client } = await owner(); const kid = await teen(client); const small = (await child(client)).client;
    expect((await kid.get("/api/house/schedules")).status).toBe(403);
    expect((await small.get("/api/house/schedules")).status).toBe(403);
    expect((await new TestClient().get("/api/house/schedules")).status).toBe(401);
  });
  test("a paused schedule says why, in plain words", async () => {
    const { client, row } = await owner(); const made = await make(row.id, "owner");
    const { db } = await import("@/db"); const { scheduledTasks } = await import("@/db/schema"); const { eq } = await import("drizzle-orm");
    if (made.ok) db.update(scheduledTasks).set({ state: "paused", pausedReason: "grant_revoked" }).where(eq(scheduledTasks.id, made.id)).run();
    const body = await (await client.get("/api/house/schedules")).json() as { schedules: Array<{ state: string; note: string | null }> };
    expect(body.schedules[0]).toMatchObject({ state: "paused", note: "Paused because you can no longer control the device." });
  });
});

describe("DELETE /api/house/schedules/:id", () => {
  test("cancels the caller's own schedule", async () => {
    const { client, row } = await owner(); const made = await make(row.id, "owner");
    if (!made.ok) throw new Error("setup");
    expect((await client.delete(`/api/house/schedules/${made.id}`)).status).toBe(200);
    expect(listOwnSchedules(row.id)).toHaveLength(0);
  });
  test("an owner cannot cancel another person's schedule; a teen is refused", async () => {
    const { client, row } = await owner(); const other = await adultClient(client);
    const theirs = await make(other.id, "adult", ["default/light.hall"]);
    if (!theirs.ok) throw new Error("setup " + theirs.text);
    expect((await client.delete(`/api/house/schedules/${theirs.id}`)).status).toBe(404);
    expect(listOwnSchedules(other.id)).toHaveLength(1);
    expect((await (await teen(client)).delete(`/api/house/schedules/${theirs.id}`)).status).toBe(403);
    expect(row.id).toBeTruthy();
  });
});
