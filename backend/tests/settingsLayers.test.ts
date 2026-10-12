// SETTINGS-LAYERS-01b: the resolver and the one write gate for layered list settings.
// Zero-tolerance cases: a child or teen cannot lift or read what an admin set; an override cannot unlock a
// locked list; an admin never sees a teen's own choices; a change to the global defaults never overwrites a
// person's override.
import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people, settingsValues } from "@/db/schema";
import { setHouseholdSettingValue, writeLayerRow } from "@/lib/settings";
import { lockedListIds } from "@/lib/blocklists/policy";
import {
  backToUserDefaults,
  changeOverrides,
  readOverrides,
  resolveUnion,
  visibleOverrideCount,
} from "@/lib/settingsLayers";

beforeEach(() => resetDb());

const DENY = "search.hosts.deny";
const ALLOW = "search.hosts.allow";
const LISTS = "search.blocklists";

async function household() {
  const client = new TestClient();
  expect((await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
  const add = async (displayName: string, role: string) => {
    expect((await client.post("/api/people", { displayName, role, ...(role === "adult" ? { secret: "0000" } : {}) })).status).toBe(201);
    return db.select().from(people).where(eq(people.displayName, displayName)).get()!;
  };
  return {
    owner: db.select().from(people).where(eq(people.displayName, "Sage")).get()!,
    child: await add("Bramble", "child"),
    teen: await add("Willow", "teen"),
    adult: await add("Marlow", "adult"),
  };
}

describe("the resolver", () => {
  test("user defaults, then global defaults, then the person's overrides, each layer visible in the result", async () => {
    const { teen } = await household();
    const base = resolveUnion(LISTS, { band: "teen", personId: teen.id });
    expect(base.items).toContain("blp-gambling");
    expect(base.source["blp-gambling"]).toBe("user-default");
    setHouseholdSettingValue(LISTS, ["blp-drugs"]);
    expect(resolveUnion(LISTS, { band: "teen", personId: teen.id }).source["blp-drugs"]).toBe("global-default");
    writeLayerRow(teen.id, LISTS, JSON.stringify({ add: [], remove: [{ item: "blp-gambling", set_by: "self", hlc: "1:0:abcdef" }] }));
    expect(resolveUnion(LISTS, { band: "teen", personId: teen.id }).items).not.toContain("blp-gambling");
  });

  test("a locked list is always in the result, whatever a stored override says", async () => {
    const { child } = await household();
    const locked = lockedListIds("child");
    expect(locked.length).toBeGreaterThan(0);
    writeLayerRow(child.id, LISTS, JSON.stringify({ add: [], remove: locked.map((item) => ({ item, set_by: "system", hlc: "1:0:abcdef" })) }));
    const result = resolveUnion(LISTS, { band: "child", personId: child.id });
    for (const id of locked) expect(result.items).toContain(id);
  });

  test("a garbled override row changes nothing", async () => {
    const { adult } = await household();
    const before = resolveUnion(DENY, { band: "adult", personId: adult.id }).items;
    writeLayerRow(adult.id, DENY, "{not json");
    expect(resolveUnion(DENY, { band: "adult", personId: adult.id }).items).toEqual(before);
  });
});

describe("what an admin sets", () => {
  test("a teen cannot lift, clear or read an admin-set entry; the entry still applies", async () => {
    const { owner, teen } = await household();
    expect(changeOverrides(owner, teen.id, DENY, { add: ["casino.example.com"] }).ok).toBe(true);
    // applies
    expect(resolveUnion(DENY, { band: "teen", personId: teen.id }).items).toContain("casino.example.com");
    // cannot read
    const seen = readOverrides(teen, teen.id, DENY);
    expect(seen.ok && seen.value.add).toEqual([]);
    expect(seen.ok && seen.value.hidden).toBe(true);
    // cannot lift
    expect(changeOverrides(teen, teen.id, DENY, { remove: ["casino.example.com"] }).ok).toBe(false);
    // cannot loosen with an allow
    expect(changeOverrides(teen, teen.id, ALLOW, { add: ["casino.example.com"] }).ok).toBe(false);
    // cannot clear
    const cleared = backToUserDefaults(teen, teen.id, [DENY]);
    expect(cleared.ok && cleared.value.cleared).toBe(0);
    expect(resolveUnion(DENY, { band: "teen", personId: teen.id }).items).toContain("casino.example.com");
  });

  test("a child changes no site setting; an admin does, and lifts it again", async () => {
    const { owner, child } = await household();
    expect(changeOverrides(child, child.id, DENY, { add: ["a.example.com"] }).ok).toBe(false);
    expect(changeOverrides(owner, child.id, DENY, { add: ["a.example.com"] }).ok).toBe(true);
    expect(changeOverrides(child, child.id, DENY, { remove: ["a.example.com"] }).ok).toBe(false);
    expect(backToUserDefaults(child, child.id, [DENY]).ok).toBe(false);
    expect(changeOverrides(owner, child.id, DENY, { remove: ["a.example.com"] }).ok).toBe(true);
    expect(resolveUnion(DENY, { band: "child", personId: child.id }).items).not.toContain("a.example.com");
  });

  test("an admin lifts a default list for a teen, and back to Teen restores it", async () => {
    const { owner, teen } = await household();
    expect(changeOverrides(owner, teen.id, LISTS, { remove: ["blp-gambling"] }).ok).toBe(true);
    expect(resolveUnion(LISTS, { band: "teen", personId: teen.id }).items).not.toContain("blp-gambling");
    const back = backToUserDefaults(owner, teen.id, [LISTS]);
    expect(back.ok && back.value.cleared).toBe(1);
    expect(resolveUnion(LISTS, { band: "teen", personId: teen.id }).items).toContain("blp-gambling");
  });
});

describe("the locked lists", () => {
  test("no override of any writer removes a locked list", async () => {
    const { owner, child, teen, adult } = await household();
    for (const [person, band] of [[child, "child"], [teen, "teen"]] as const) {
      const locked = lockedListIds(band);
      for (const id of locked) {
        expect(changeOverrides(owner, person.id, LISTS, { remove: [id] }).ok, `${band} ${id} by owner`).toBe(false);
        expect(changeOverrides(person, person.id, LISTS, { remove: [id] }).ok, `${band} ${id} by self`).toBe(false);
      }
    }
    expect(lockedListIds("adult")).toEqual([]);
    expect(changeOverrides(adult, adult.id, LISTS, { add: ["blp-gambling"] }).ok).toBe(true);
  });
});

describe("a teen's own choices", () => {
  test("an owner never reads, counts, touches or clears them", async () => {
    const { owner, teen } = await household();
    expect(changeOverrides(teen, teen.id, DENY, { add: ["mine.example.com"] }).ok).toBe(true);
    expect(resolveUnion(DENY, { band: "teen", personId: teen.id }).items).toContain("mine.example.com");
    const adminView = readOverrides(owner, teen.id, DENY);
    expect(adminView.ok && adminView.value.add).toEqual([]);
    expect(visibleOverrideCount(owner, teen.id, [DENY, ALLOW, LISTS])).toBe(0);
    expect(changeOverrides(owner, teen.id, DENY, { remove: ["mine.example.com"] }).ok).toBe(false);
    const cleared = backToUserDefaults(owner, teen.id, [DENY]);
    expect(cleared.ok && cleared.value.cleared).toBe(0);
    expect(resolveUnion(DENY, { band: "teen", personId: teen.id }).items).toContain("mine.example.com");
    // the teen sees and removes their own
    const own = readOverrides(teen, teen.id, DENY);
    expect(own.ok && own.value.add.map((e) => e.item)).toEqual(["mine.example.com"]);
    expect(changeOverrides(teen, teen.id, DENY, { remove: ["mine.example.com"] }).ok).toBe(true);
  });

  test("an admin never touches an adult's overrides", async () => {
    const { owner, adult } = await household();
    expect(changeOverrides(adult, adult.id, DENY, { add: ["x.example.com"] }).ok).toBe(true);
    expect(changeOverrides(owner, adult.id, DENY, { add: ["y.example.com"] }).ok).toBe(false);
    expect(readOverrides(owner, adult.id, DENY).ok && (readOverrides(owner, adult.id, DENY) as { value: { add: unknown[] } }).value.add).toEqual([]);
  });
});

describe("global defaults and overrides", () => {
  test("changing the global defaults never overwrites a person's override", async () => {
    const { owner, teen } = await household();
    setHouseholdSettingValue(DENY, "first.example.com");
    expect(changeOverrides(owner, teen.id, DENY, { add: ["kept.example.com"] }).ok).toBe(true);
    setHouseholdSettingValue(DENY, "second.example.com");
    const items = resolveUnion(DENY, { band: "teen", personId: teen.id }).items;
    expect(items).toContain("kept.example.com");
    expect(items).toContain("second.example.com");
    expect(items).not.toContain("first.example.com");
    const rows = db.select().from(settingsValues).where(eq(settingsValues.scope, `person:${teen.id}`)).all();
    expect(rows.length).toBe(1);
  });

  test("an adult changes their own freely, both directions", async () => {
    const { adult } = await household();
    setHouseholdSettingValue(LISTS, ["blp-scam"]);
    expect(changeOverrides(adult, adult.id, LISTS, { remove: ["blp-scam"] }).ok).toBe(true);
    expect(resolveUnion(LISTS, { band: "adult", personId: adult.id }).items).not.toContain("blp-scam");
    expect(changeOverrides(adult, adult.id, ALLOW, { add: ["fine.example.com"] }).ok).toBe(true);
  });

  test("a bad site name or list is refused with what to type", async () => {
    const { owner, teen } = await household();
    const host = changeOverrides(owner, teen.id, DENY, { add: ["not a site"] });
    expect(host.ok).toBe(false);
    if (!host.ok) expect(host.error).toContain("example.com");
    const list = changeOverrides(owner, teen.id, LISTS, { add: ["blp-nope"] });
    expect(list.ok).toBe(false);
  });

  test("a key without layers is not writable through the gate", async () => {
    const { owner, teen } = await household();
    expect(changeOverrides(owner, teen.id, "search.safe_search", { add: ["x"] }).ok).toBe(false);
  });
});

describe("gate hardening", () => {
  test("a garbled row is not overwritten by a write, and an admin reset clears it", async () => {
    const { owner, teen } = await household();
    writeLayerRow(teen.id, DENY, "{not json");
    const attempt = changeOverrides(teen, teen.id, DENY, { add: ["x.example.com"] });
    expect(attempt.ok).toBe(false);
    if (!attempt.ok) expect(attempt.error).toContain("could not be read");
    expect(backToUserDefaults(owner, teen.id, [DENY]).ok).toBe(true);
    expect(changeOverrides(teen, teen.id, DENY, { add: ["x.example.com"] }).ok).toBe(true);
  });

  test("a teen cannot remove an own block that duplicates a layer above", async () => {
    const { teen } = await household();
    expect(changeOverrides(teen, teen.id, LISTS, { add: ["blp-drugs"] }).ok).toBe(true);
    setHouseholdSettingValue(LISTS, ["blp-drugs"]);
    expect(changeOverrides(teen, teen.id, LISTS, { remove: ["blp-drugs"] }).ok).toBe(false);
  });

  test("an admin can allow an ordinary site for a child or teen (the locked-list refusal is proven end to end in 01c)", async () => {
    const { owner, child, teen } = await household();
    for (const person of [child, teen]) {
      expect(changeOverrides(owner, person.id, ALLOW, { add: ["fine.example.com"] }).ok, "an ordinary allow still works for an admin").toBe(true);
    }
  });

  test("a refused multi-item write changes nothing", async () => {
    const { teen } = await household();
    const r = changeOverrides(teen, teen.id, LISTS, { add: ["blp-drugs"], remove: ["blp-porn"] });
    expect(r.ok).toBe(false);
    expect(resolveUnion(LISTS, { band: "teen", personId: teen.id }).items).not.toContain("blp-drugs");
  });

  test("back to defaults with no keys named clears every layered key", async () => {
    const { owner, teen } = await household();
    expect(changeOverrides(owner, teen.id, DENY, { add: ["a.example.com"] }).ok).toBe(true);
    expect(changeOverrides(owner, teen.id, LISTS, { add: ["blp-drugs"] }).ok).toBe(true);
    const r = backToUserDefaults(owner, teen.id, []);
    expect(r.ok && r.value.cleared).toBe(2);
  });

  test("back to defaults validates every key before clearing any", async () => {
    const { owner, teen } = await household();
    expect(changeOverrides(owner, teen.id, DENY, { add: ["a.example.com"] }).ok).toBe(true);
    expect(backToUserDefaults(owner, teen.id, [DENY, "search.safe_search"]).ok).toBe(false);
    expect(resolveUnion(DENY, { band: "teen", personId: teen.id }).items).toContain("a.example.com");
  });
});
