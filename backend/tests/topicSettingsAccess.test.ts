// MINOR-TOPICS-01e: who can change which sensitive-subject level. A child never changes their own,
// an owner or admin sets a child's, no path reaches a teen's own settings (the teen levels are two
// household rows), and the fixed families (feelings, people, beliefs) accept no key at all.
import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";

async function household() {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const make = async (displayName: string, role: string, secret?: string) =>
    (await (await owner.post("/api/people", { displayName, role, ...(secret ? { secret } : {}) })).json()) as { id: string };
  const child = await make("Bramble", "child");
  const teen = await make("Willow", "teen");
  const admin = await make("Marlow", "admin", "adminpin1");
  const as = async (id: string, secret?: string) => {
    const client = new TestClient();
    if (secret) await client.post("/api/auth/verify-secret", { personId: id, secret });
    else await client.post("/api/auth/select", { personId: id });
    return client;
  };
  return { owner, child, teen, admin, childClient: await as(child.id), teenClient: await as(teen.id), adminClient: await as(admin.id, "adminpin1") };
}

const put = (client: TestClient, scope: string, key: string, value: unknown) =>
  client.request("/api/settings", { method: "PUT", body: { scope, key, value } });
const reset = (client: TestClient, scope: string, key: string) => client.post("/api/settings/reset", { scope, key });

describe("a child's topic levels", () => {
  beforeEach(() => resetDb());

  test("an owner and an admin set them; the child cannot, for any key", async () => {
    const h = await household();
    const scope = `person:${h.child.id}`;
    expect((await put(h.owner, scope, "topics.bodies", "gentle")).status).toBe(200);
    expect((await put(h.adminClient, scope, "topics.health", "redirect")).status).toBe(200);
    for (const [key, value] of [["topics.bodies", "default"], ["topics.risk", "redirect"], ["topics.violence", "gentle"], ["topics.family_stories", "off"], ["topics.family_story_names", "Santa Claus"]] as const) {
      const res = await put(h.childClient, scope, key, value);
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: string }).error).toContain("owner or admin");
    }
    expect((await reset(h.childClient, scope, "topics.bodies")).status).toBe(403);
    expect((await reset(h.owner, scope, "topics.bodies")).status).toBe(200);
  });

  test("a sibling child and an adult target are refused with a message that fits", async () => {
    const h = await household();
    const sibling = await (await h.owner.post("/api/people", { displayName: "Clover", role: "child" })).json() as { id: string };
    const siblingClient = new TestClient();
    await siblingClient.post("/api/auth/select", { personId: sibling.id });
    expect((await put(siblingClient, `person:${h.child.id}`, "topics.bodies", "gentle")).status).toBe(403);
    const adult = await put(h.owner, `person:${(await (await h.owner.get("/api/auth/me")).json() as { id: string }).id}`, "topics.bodies", "gentle");
    expect(adult.status).toBe(403);
    expect(((await adult.json()) as { error: string }).error).not.toContain("teen");
  });

  test("a value outside the range is refused", async () => {
    const h = await household();
    expect((await put(h.owner, `person:${h.child.id}`, "topics.bodies", "informative")).status).toBe(400);
  });
});

describe("a teen's own settings stay private", () => {
  beforeEach(() => resetDb());

  test("no person-level topic key can be written for a teen, by an admin, the owner or the teen", async () => {
    const h = await household();
    const scope = `person:${h.teen.id}`;
    for (const client of [h.owner, h.adminClient, h.teenClient]) {
      const res = await put(client, scope, "topics.bodies", "redirect");
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: string }).error).toContain("household teen controls");
    }
    expect((await reset(h.adminClient, scope, "topics.bodies")).status).toBe(403);
  });

  test("the two teen rows are household settings only an owner or admin changes", async () => {
    const h = await household();
    expect((await put(h.owner, "household", "topics.teen.bodies", "redirect")).status).toBe(200);
    expect((await put(h.adminClient, "household", "topics.teen.risk", "redirect")).status).toBe(200);
    expect((await put(h.teenClient, "household", "topics.teen.bodies", "informative")).status).toBe(403);
    expect((await put(h.childClient, "household", "topics.teen.risk", "informative")).status).toBe(403);
    // A teen-scope key is not a person key.
    expect((await put(h.owner, `person:${h.child.id}`, "topics.teen.bodies", "redirect")).status).toBe(400);
  });
});

describe("fixed families accept no key", () => {
  beforeEach(() => resetDb());

  test("feelings, people and beliefs have no settings key, at any scope", async () => {
    const h = await household();
    for (const family of ["feelings", "people", "beliefs"]) {
      for (const key of [`topics.${family}`, `topics.teen.${family}`]) {
        expect((await put(h.owner, `person:${h.child.id}`, key, "informative")).status).toBe(400);
        expect((await put(h.owner, "household", key, "informative")).status).toBe(400);
      }
    }
  });
});
