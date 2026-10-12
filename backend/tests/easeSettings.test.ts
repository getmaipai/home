// EASE-OF-USE-01c: the ease of use comfort keys resolve through the age group, household and person layers,
// and one write gate decides who may change them. Zero-tolerance cases: a person changes their own unless an
// admin locked the key; an admin's write is the lock and an admin's reset lifts it; nobody else writes for
// another person; a safety key never becomes self-service.
import { beforeEach, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people, settingsValues } from "@/db/schema";
import { getSettingValueForPerson, listValues, resetValue, setValue } from "@/lib/settings";
import { getRegistry } from "@/lib/settingsRegistry";
import { CHILD_VISIBLE_SETTING_KEYS, EASE_SETTING_KEYS, TEEN_VISIBLE_SETTING_KEYS } from "@/lib/settingsMinorSnapshot";

beforeEach(() => resetDb());

async function household() {
  const client = new TestClient();
  expect((await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
  const add = async (displayName: string, role: string) => {
    expect((await client.post("/api/people", { displayName, role, ...(role !== "child" && role !== "teen" ? { secret: "0000" } : {}) })).status).toBe(201);
    return db.select().from(people).where(eq(people.displayName, displayName)).get()!;
  };
  return {
    client,
    owner: db.select().from(people).where(eq(people.displayName, "Sage")).get()!,
    child: await add("Bramble", "child"),
    teen: await add("Willow", "teen"),
    adult: await add("Marlow", "adult"),
    admin: await add("Quill", "admin"),
  };
}

const ownScope = (id: string) => `person:${id}`;
function find(actor: Parameters<typeof listValues>[0], personId: string, key: string) {
  const listed = listValues(actor, ownScope(personId));
  if (!listed.ok) throw new Error(listed.error);
  return listed.value.find((v) => v.key === key)!;
}

describe("resolving the layers", () => {
  test("the age group's default, then the household's, then the person's own, each layer named", async () => {
    const { child, adult } = await household();
    expect(find(child, child.id, "ease.preset")).toMatchObject({ value: "simple", layer: "band", source: "default", locked: false });
    expect(find(adult, adult.id, "ease.preset")).toMatchObject({ value: "standard", layer: "band" });
    expect(find(adult, adult.id, "ease.text_size")).toMatchObject({ value: "preset", layer: "band" });

    db.insert(settingsValues).values({ scope: "household", key: "ease.preset", value: JSON.stringify("comfortable"), hlc: "1:0:abcdef", source: "user", updatedAt: new Date().toISOString() }).run();
    expect(find(child, child.id, "ease.preset")).toMatchObject({ value: "comfortable", layer: "household" });

    expect(setValue(child, ownScope(child.id), "ease.preset", "large").ok).toBe(true);
    expect(find(child, child.id, "ease.preset")).toMatchObject({ value: "large", layer: "person", source: "user" });
    expect(getSettingValueForPerson(child.id, "ease.preset")).toBe("large");
  });

  test("a change to the age group or household default still reaches a person who changed a different key", async () => {
    const { child } = await household();
    expect(setValue(child, ownScope(child.id), "ease.text_size", "160").ok).toBe(true);
    expect(getSettingValueForPerson(child.id, "ease.preset")).toBe("simple");
    expect(getSettingValueForPerson(child.id, "ease.text_size")).toBe("160");
  });

  test("a reset returns the layered value, not the bare key default", async () => {
    const { child } = await household();
    expect(setValue(child, ownScope(child.id), "ease.preset", "large").ok).toBe(true);
    const back = resetValue(child, ownScope(child.id), "ease.preset");
    expect(back.ok && back.value).toMatchObject({ value: "simple", layer: "band", source: "default" });
  });

  test("a value outside the key's options is refused", async () => {
    const { adult } = await household();
    const result = setValue(adult, ownScope(adult.id), "ease.text_size", "huge");
    expect(result.ok).toBe(false);
  });
});

describe("the write gate", () => {
  test("a person changes their own ease keys, a child and a teen included, and the row is stamped self", async () => {
    const { child, teen, adult } = await household();
    for (const person of [child, teen, adult]) {
      const set = setValue(person, ownScope(person.id), "ease.targets", "large");
      expect(set.ok).toBe(true);
      const row = db.select().from(settingsValues).where(and(eq(settingsValues.scope, ownScope(person.id)), eq(settingsValues.key, "ease.targets"))).get();
      expect(row?.setBy).toBe("self");
      expect(find(person, person.id, "ease.targets").locked).toBe(false);
    }
  });

  test("an admin's write locks the key: the person cannot change or reset it, and the refusal says what to do", async () => {
    const { child, owner } = await household();
    const set = setValue(owner, ownScope(child.id), "ease.text_size", "140");
    expect(set.ok && set.value).toMatchObject({ value: "140", layer: "person", locked: true });
    expect(db.select().from(settingsValues).where(and(eq(settingsValues.scope, ownScope(child.id)), eq(settingsValues.key, "ease.text_size"))).get()?.setBy).toBe(owner.id);

    const change = setValue(child, ownScope(child.id), "ease.text_size", "100");
    expect(change.ok).toBe(false);
    if (!change.ok) {
      expect(change.status).toBe(403);
      expect(change.error).toContain("Ask one of them");
    }
    expect(resetValue(child, ownScope(child.id), "ease.text_size").ok).toBe(false);
    expect(getSettingValueForPerson(child.id, "ease.text_size")).toBe("140");
    expect(find(child, child.id, "ease.text_size")).toMatchObject({ value: "140", locked: true });
  });

  test("a lock holds for that key only; the person still changes the others", async () => {
    const { child, owner } = await household();
    expect(setValue(owner, ownScope(child.id), "ease.text_size", "140").ok).toBe(true);
    expect(setValue(child, ownScope(child.id), "ease.spacing", "roomy").ok).toBe(true);
  });

  test("an admin's reset lifts the lock and the person can change it again", async () => {
    const { child, owner } = await household();
    expect(setValue(owner, ownScope(child.id), "ease.contrast", "more").ok).toBe(true);
    expect(setValue(child, ownScope(child.id), "ease.contrast", "standard").ok).toBe(false);
    const lifted = resetValue(owner, ownScope(child.id), "ease.contrast");
    expect(lifted.ok && lifted.value.locked).toBe(false);
    expect(setValue(child, ownScope(child.id), "ease.contrast", "standard").ok).toBe(true);
  });

  test("an admin may set an adult's key; a plain adult or a teen cannot write another person's", async () => {
    const { adult, teen, child, owner, admin } = await household();
    expect(setValue(admin, ownScope(adult.id), "ease.motion", "calm").ok).toBe(true);
    expect(setValue(owner, ownScope(teen.id), "ease.motion", "calm").ok).toBe(true);
    for (const actor of [adult, teen]) {
      const result = setValue(actor, ownScope(child.id), "ease.motion", "calm");
      expect(result.ok).toBe(false);
      expect(!result.ok && result.status).toBe(403);
    }
  });

  test("an admin cannot write the owner's or another admin's keys", async () => {
    const { owner, admin } = await household();
    const result = setValue(admin, ownScope(owner.id), "ease.preset", "large");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("owner's or another admin's");
    const ownerOnOwner = setValue(owner, ownScope(owner.id), "ease.preset", "large");
    expect(ownerOnOwner.ok).toBe(true);
  });

  test("an admin cannot reset a key a different admin locked for them; they ask the admin", async () => {
    const { owner, admin } = await household();
    expect(setValue(owner, ownScope(admin.id), "ease.preset", "large").ok).toBe(true);
    expect(setValue(admin, ownScope(admin.id), "ease.preset", "standard").ok).toBe(false);
  });

  test("the over-the-wire write and list carry layer and locked", async () => {
    const { client, owner } = await household();
    const put = await client.put("/api/settings", { scope: ownScope(owner.id), key: "ease.preset", value: "large" });
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ value: "large", layer: "person", locked: false });
    const list = (await (await client.get(`/api/settings?scope=${encodeURIComponent(ownScope(owner.id))}`)).json()) as Array<{ key: string; layer?: string }>;
    expect(list.find((v) => v.key === "ease.preset")?.layer).toBe("person");
  });
});

describe("what is self-service", () => {
  test("only comfort keys carry self_service; no safety, search or consent key does", () => {
    const flagged = getRegistry().filter((k) => k.self_service === true).map((k) => k.key);
    expect(flagged.length).toBeGreaterThan(0);
    for (const key of flagged) expect(key.startsWith("ease.")).toBe(true);
    expect(flagged.sort()).toEqual([...EASE_SETTING_KEYS].sort());
  });

  test("a safety key keeps its own gate: a child still cannot loosen safe search", async () => {
    const { child } = await household();
    const result = setValue(child, ownScope(child.id), "search.safe_search", "off");
    expect(result.ok).toBe(false);
  });

  test("a child and a teen are shown the ease keys in Settings", () => {
    for (const key of EASE_SETTING_KEYS) {
      expect(CHILD_VISIBLE_SETTING_KEYS).toContain(key);
      expect(TEEN_VISIBLE_SETTING_KEYS).toContain(key);
    }
  });
});

describe("who counts as a lock", () => {
  test("a stamp from a person who is no longer an admin does not lock the person out", async () => {
    const { child, owner } = await household();
    expect(setValue(owner, ownScope(child.id), "ease.spacing", "roomy").ok).toBe(true);
    db.update(settingsValues).set({ setBy: "removed-admin-id" }).where(and(eq(settingsValues.scope, ownScope(child.id)), eq(settingsValues.key, "ease.spacing"))).run();
    expect(setValue(child, ownScope(child.id), "ease.spacing", "standard").ok).toBe(true);
  });

  test("an owner cannot set another owner's keys", async () => {
    const { client, owner } = await household();
    expect((await client.post("/api/people", { displayName: "Atlas", role: "owner", secret: "0000" })).status).toBe(201);
    const other = db.select().from(people).where(eq(people.displayName, "Atlas")).get()!;
    expect(setValue(owner, ownScope(other.id), "ease.preset", "large").ok).toBe(false);
  });
});
