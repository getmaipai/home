// COMPANIONS-APP-01: the Companions app's data. Who sees what by type, "Set as my default", the admin-only parts, and the age rule on
// every way a companion can be written.
import { beforeEach, describe, expect, test } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { issueDeviceToken } from "@/lib/deviceTokens";

beforeEach(() => resetDb());

interface Card { id: string; type: string; is_default: boolean; dials: Array<{ label: string; value: string }>; who_can_use: string }
interface Listing { allowed: boolean; companions: Card[]; robots: Array<{ id: string; companion_id: string }> | null }

async function setup() {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const signIn = async (displayName: string, role: string) => {
    const made = await owner.post("/api/people", { displayName, role, secret: "0000", ...(role === "child" ? { birthdate: "2018-03-01" } : {}) });
    const created = (await made.json()) as { id: string };
    const client = new TestClient();
    await client.post("/api/auth/verify-secret", { personId: created.id, secret: "0000" });
    return { client, id: created.id };
  };
  const adult = await signIn("Marlow", "adult");
  const teen = await signIn("Riff", "teen");
  const child = await signIn("Sprout", "child");
  const list = async (client: TestClient) => (await (await client.get("/api/companions")).json()) as Listing;
  return { owner, adult, teen, child, list };
}

describe("the companion list follows the person's type", () => {
  test("a signed-out visitor is refused", async () => {
    expect((await new TestClient().get("/api/companions")).status).toBe(401);
  });
  test("a child sees child companions only, a teen child and teen, an adult all", async () => {
    const { child, teen, adult, list } = await setup();
    const types = async (client: TestClient) => new Set((await list(client)).companions.map((card) => card.type));
    expect(await types(child.client)).toEqual(new Set(["child"]));
    expect(await types(teen.client)).toEqual(new Set(["child", "teen"]));
    expect(await types(adult.client)).toEqual(new Set(["child", "teen", "adult"]));
  });
  test("each card says the type plainly and carries the four dials in words", async () => {
    const { adult, list } = await setup();
    const nova = (await list(adult.client)).companions.find((card) => card.id === "lively-adult")!;
    expect(nova.dials.map((dial) => dial.label)).toEqual(["How it talks", "Word choice", "Questions back", "Casual chatter"]);
    expect(nova.who_can_use).toBe("Adults only.");
    expect((await list(adult.client)).companions.find((card) => card.is_default)?.id).toBe("default");
  });
  test("only owners and admins get the robots list", async () => {
    const { owner, adult, list } = await setup();
    expect((await list(owner)).robots).toEqual([]);
    expect((await list(adult.client)).robots).toBeNull();
  });
  test("turned off for a person, the list is empty and says so", async () => {
    const { owner, child, list } = await setup();
    const off = await owner.put("/api/settings", { scope: `person:${child.id}`, key: "companions.allowed", value: false });
    expect(off.status).toBe(200);
    const listing = await list(child.client);
    expect(listing.allowed).toBe(false);
    expect(listing.companions).toEqual([]);
    expect((await child.client.put("/api/companions/lively-child/default")).status).toBe(403);
  });
});

describe("one companion in full", () => {
  test("the detail has examples and, for an admin, who uses it", async () => {
    const { owner, adult } = await setup();
    expect((await adult.client.put("/api/companions/lively-adult/default")).status).toBe(200);
    const asAdult = (await (await adult.client.get("/api/companions/lively-adult")).json()) as { examples: string[]; used_by: unknown; is_default: boolean };
    expect(asAdult.examples.length).toBeGreaterThanOrEqual(3);
    expect(asAdult.used_by).toBeNull();
    expect(asAdult.is_default).toBe(true);
    const asOwner = (await (await owner.get("/api/companions/lively-adult")).json()) as { used_by: { people: Array<{ name: string }>; robots: unknown[] } };
    expect(asOwner.used_by.people.map((person) => person.name)).toEqual(["Marlow"]);
  });
  test("a companion above the person's type is a 404, not a hint that it exists", async () => {
    const { child, teen } = await setup();
    expect((await child.client.get("/api/companions/lively-adult")).status).toBe(404);
    expect((await child.client.get("/api/companions/lively-teen")).status).toBe(404);
    expect((await teen.client.get("/api/companions/lively-adult")).status).toBe(404);
    expect((await child.client.get("/api/companions/no-such")).status).toBe(404);
  });
  test("a robot using the companion is named for an admin", async () => {
    const { owner, list } = await setup();
    const me = (await (await owner.get("/api/auth/me")).json()) as { id?: string; person?: { id: string } };
    const personId = me.id ?? me.person!.id;
    const { deviceId } = issueDeviceToken(personId, "robot", "StackChan");
    expect((await owner.put("/api/settings", { scope: `device:${deviceId}`, key: "robot.companion.id", value: "lively-child" })).status).toBe(200);
    const detail = (await (await owner.get("/api/companions/lively-child")).json()) as { used_by: { robots: Array<{ id: string }> } };
    expect(detail.used_by.robots.map((robot) => robot.id)).toEqual([deviceId]);
    expect((await list(owner)).robots?.[0]?.companion_id).toBe("lively-child");
  });
});

describe("Set as my default", () => {
  test("saves the person's own persona and the list marks it", async () => {
    const { child, list } = await setup();
    const saved = await child.client.put("/api/companions/lively-child/default");
    expect(saved.status).toBe(200);
    expect((await list(child.client)).companions.find((card) => card.is_default)?.id).toBe("lively-child");
  });
  test("refuses a companion above the person's type, with a sentence that says what to do", async () => {
    const { child, teen } = await setup();
    const refused = await child.client.put("/api/companions/lively-adult/default");
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: string }).error).toContain("Choose one from your list");
    expect((await teen.client.put("/api/companions/lively-adult/default")).status).toBe(403);
    expect((await child.client.put("/api/companions/no-such/default")).status).toBe(404);
  });
  test("the settings route holds the same line, and a stale value reads as the default", async () => {
    const { child, owner, list } = await setup();
    const viaSettings = await child.client.put("/api/settings", { scope: `person:${child.id}`, key: "persona.active_id", value: "lively-adult" });
    expect(viaSettings.status).toBe(400);
    const byAdmin = await owner.put("/api/settings", { scope: `person:${child.id}`, key: "persona.active_id", value: "lively-adult" });
    expect(byAdmin.status).toBe(400);
    expect((await list(child.client)).companions.find((card) => card.is_default)?.id).toBe("default");
  });
});
