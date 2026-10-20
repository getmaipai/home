// FOLLOWUP-01 (hub half): GET /api/devices/me/people, the roster a robot's PeopleDirectory is filled from.
import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { biometricPrints, people } from "@/db/schema";
import { issueDeviceToken } from "@/lib/deviceTokens";
import { storeRobotCredential } from "@/lib/robotCredentials";
import { encryptSecret } from "@/lib/secrets";
import { newBiometricPrintId } from "@/lib/id";
import { setHouseholdSettingValue, setValue } from "@/lib/settings";
import type { DeviceKind } from "@/lib/devices";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

beforeEach(() => { resetDb(); setHouseholdSettingValue("home.robots.enabled", true); });

type Roster = { as_of: string; people: Array<{ person_id: string; age_band: string; follow_up: boolean }> };

async function setup() {
  const owner = new TestClient();
  expect((await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
  const ownerRow = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  const add = async (displayName: string, role: string) => {
    const res = await owner.post("/api/people", { displayName, role, ...(role === "adult" ? { secret: "adultpin1" } : {}) });
    expect(res.status).toBe(201);
    return db.select().from(people).where(eq(people.id, ((await res.json()) as { id: string }).id)).get()!;
  };
  return { owner, ownerRow, add };
}

function addPrint(personId: string, deletedAt?: string): string {
  const id = newBiometricPrintId();
  const now = new Date().toISOString();
  db.insert(biometricPrints).values({
    id, personId, modality: "face", modelId: "sface-2021dec", modelSha256: "test-sha256", dim: 128,
    embeddingEncrypted: deletedAt ? null : encryptSecret(JSON.stringify(Array.from({ length: 128 }, (_, i) => i / 128))),
    capturedBy: null, consentAt: now, consentedByPersonId: personId, createdAt: now, updatedAt: now, deletedAt: deletedAt ?? null, hlc: "1700000000000:0:testfix",
  }).run();
  return id;
}

async function deviceSession(personId: string, kind: DeviceKind, capabilities: string[] = []): Promise<TestClient> {
  const { token, deviceId } = issueDeviceToken(personId, kind, "Test device", capabilities);
  if (kind === "robot") storeRobotCredential(deviceId, "192.0.2.10", "pollen", "a-freshly-rotated-password");
  const client = new TestClient();
  expect((await client.post("/api/auth/devices/redeem", { token })).status).toBe(200);
  return client;
}

const rosterOf = async (robot: TestClient) => {
  const res = await robot.get("/api/devices/me/people");
  if (res.status !== 200) throw new Error(await res.text());
  return (await res.json()) as Roster;
};

describe("GET /api/devices/me/people", () => {
  test("only a robot device session may read it", async () => {
    const { owner, ownerRow } = await setup();
    expect((await owner.get("/api/devices/me/people")).status).toBe(403);
    const phone = await deviceSession(ownerRow.id, "phone");
    expect((await phone.get("/api/devices/me/people")).status).toBe(403);
    expect((await new TestClient().get("/api/devices/me/people")).status).toBe(401);
  });

  test("lists enrolled people with band and follow-up, and never a name or an unenrolled person", async () => {
    const { ownerRow, add } = await setup();
    const adult = await add("Marlow", "adult");
    await add("Nadia", "adult"); // no print: not listed
    addPrint(ownerRow.id);
    addPrint(adult.id);
    addPrint(adult.id); // a second sample is still one person
    const body = await rosterOf(await deviceSession(ownerRow.id, "robot"));
    expect(body.people.map((p) => p.person_id).sort()).toEqual([ownerRow.id, adult.id].sort());
    expect(body.people.every((p) => p.age_band === "adult" && p.follow_up === true)).toBe(true);
    expect(JSON.stringify(body)).not.toContain("Marlow");
    expect(Object.keys(body.people[0]!).sort()).toEqual(["age_band", "follow_up", "person_id"]);
  });

  test("an adult who switches follow-up off is listed with follow_up false", async () => {
    const { ownerRow } = await setup();
    addPrint(ownerRow.id);
    expect(setValue(ownerRow, `person:${ownerRow.id}`, "person.robot.follow_up", false).ok).toBe(true);
    expect((await rosterOf(await deviceSession(ownerRow.id, "robot"))).people).toEqual([{ person_id: ownerRow.id, age_band: "adult", follow_up: false }]);
  });

  test("a child is off by default, on only after a parent saves it, and cannot switch it on themself", async () => {
    const { ownerRow, add } = await setup();
    const child = await add("Bramble", "child");
    addPrint(child.id);
    const robot = await deviceSession(ownerRow.id, "robot");
    expect((await rosterOf(robot)).people).toEqual([{ person_id: child.id, age_band: "child", follow_up: false }]);

    expect(setValue(child, `person:${child.id}`, "person.robot.follow_up", true)).toMatchObject({ ok: false, status: 403 });
    expect((await rosterOf(robot)).people[0]!.follow_up).toBe(false);

    expect(setValue(ownerRow, `person:${child.id}`, "person.robot.follow_up", true).ok).toBe(true);
    expect((await rosterOf(robot)).people[0]!.follow_up).toBe(true);
  });

  test("a child role cannot switch these on for themself regardless of birthdate", async () => {
    const { ownerRow, add } = await setup();
    const minor = await add("Pippa", "child");
    db.update(people).set({ birthdate: `${new Date().getUTCFullYear() - 9}-01-01` }).where(eq(people.id, minor.id)).run();
    const row = db.select().from(people).where(eq(people.id, minor.id)).get()!;
    addPrint(minor.id);
    for (const [key, value] of [["person.robot.follow_up", true], ["person.vision.watch", "identify"], ["person.robot.may_address", true]] as const) {
      expect(setValue(row, `person:${minor.id}`, key, value)).toMatchObject({ ok: false, status: 403 });
    }
    expect((await rosterOf(await deviceSession(ownerRow.id, "robot"))).people).toEqual([{ person_id: minor.id, age_band: "child", follow_up: false }]);
  });

  test("legacy teen and guest prints, and a revoked print, drop their person from the roster", async () => {
    const { ownerRow, add } = await setup();
    const teen = await add("River", "teen");
    const guest = await add("Iris", "guest");
    const adult = await add("Marlow", "adult");
    addPrint(teen.id);
    addPrint(guest.id);
    addPrint(adult.id, new Date().toISOString());
    addPrint(ownerRow.id);
    const body = await rosterOf(await deviceSession(ownerRow.id, "robot"));
    expect(body.people.map((p) => p.person_id)).toEqual([ownerRow.id]);
  });
});
