import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { db } from "@/db";
import { conversations, people, settingsValues } from "@/db/schema";
import { canCreateCompanion, currentCompanionId, listCompanionCards, discoverCompanionCards } from "@/lib/companionsApp";
import { __resetSettingsCacheForTests } from "@/lib/settings";
import { createHouseholdCompanion, setHouseholdCompanionAudience, setHouseholdCompanionStatus } from "@/lib/householdCompanions";
import { loadManifestOnly } from "@/lib/plugins";
import { __reloadPersonasForTests } from "@/lib/persona";
import { resetDb } from "../../tests/reset-db";

const root = join(process.env.MAIPAI_DATA_DIR!, "companions");
function addPerson(id: string, role: string) {
  const now = new Date().toISOString();
  db.insert(people).values({ id, displayName: id, role, avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
}
beforeEach(() => { resetDb(); rmSync(root, { recursive: true, force: true }); __reloadPersonasForTests(); });
afterEach(() => { resetDb(); rmSync(root, { recursive: true, force: true }); __reloadPersonasForTests(); });

describe("companion app cards", () => {
  test("a person without a pick defaults to Tessa, including a child, while an ineligible pick falls back to default", () => {
    addPerson("person-tessa-owner", "adult"); addPerson("person-tessa-child", "child");
    const owner = db.select().from(people).all().find((person) => person.id === "person-tessa-owner")!;
    const child = db.select().from(people).all().find((person) => person.id === "person-tessa-child")!;
    expect(currentCompanionId(owner)).toBe("tessa");
    expect(currentCompanionId(child)).toBe("tessa");
    expect(listCompanionCards(child).map((card) => card.id)).toContain("tessa");
    const loaded = loadManifestOnly("rivet");
    if (!loaded.ok || !loaded.value.companion) throw new Error("rivet fixture is unavailable");
    const explicit = createHouseholdCompanion({ ...loaded.value.companion, display_name: "Adult-only fixture" }, { display_name: "Author", person_id: owner.id });
    if (!explicit.ok) throw new Error(explicit.error);
    setHouseholdCompanionAudience(explicit.value.id, "adult", { display_name: "Admin" });
    setHouseholdCompanionStatus(explicit.value.id, "ready");
    __reloadPersonasForTests();
    db.insert(settingsValues).values({ scope: `person:${child.id}`, key: "persona.active_id", value: JSON.stringify(explicit.value.id), hlc: "2:0:test", source: "user", updatedAt: new Date().toISOString() }).run();
    __resetSettingsCacheForTests();
    expect(currentCompanionId(child)).toBe("default");
  });

  test("unset means all companions, while stored sets are person scoped and include the default", () => {
    addPerson("person-set-a", "adult"); addPerson("person-set-b", "adult");
    const [a, b] = db.select().from(people).all();
    expect(listCompanionCards(a!).length).toBeGreaterThan(1);
    db.insert(settingsValues).values({ scope: `person:${a!.id}`, key: "companions.enabled", value: JSON.stringify(["buddy"]), hlc: "2:0:test", source: "user", updatedAt: new Date().toISOString() }).run();
    __resetSettingsCacheForTests();
    expect(listCompanionCards(a!).map((card) => card.id)).toEqual(expect.arrayContaining(["buddy", "default"]));
    expect(listCompanionCards(a!).map((card) => card.id)).not.toContain("rivet");
    expect(listCompanionCards(b!).map((card) => card.id)).toContain("rivet");
    expect(discoverCompanionCards(a!).map((card) => card.id)).toContain("rivet");
  });
  test("teens, adults and admins may create companions", () => {
    addPerson("person-adult-create", "adult"); addPerson("person-teen-create", "teen"); addPerson("person-child-create", "child"); addPerson("person-admin-create", "admin");
    const rows = db.select().from(people).all();
    expect(canCreateCompanion(rows.find((row) => row.id === "person-adult-create")!)).toBe(true);
    expect(canCreateCompanion(rows.find((row) => row.id === "person-teen-create")!)).toBe(true);
    expect(canCreateCompanion(rows.find((row) => row.id === "person-child-create")!)).toBe(false);
    expect(canCreateCompanion(rows.find((row) => row.id === "person-admin-create")!, true)).toBe(true);
  });
  test("ready household companions are listed with household status; the author sees their draft", () => {
    addPerson("person-adult06", "adult");
    const loaded = loadManifestOnly("rivet"); if (!loaded.ok || !loaded.value.companion) throw new Error("rivet fixture is unavailable");
    const ready = createHouseholdCompanion({ ...loaded.value.companion, display_name: "Ready house" }, { display_name: "author", person_id: "person-adult06" });
    const draft = createHouseholdCompanion({ ...loaded.value.companion, display_name: "Draft house", examples: undefined }, { display_name: "author", person_id: "person-adult06" });
    if (!ready.ok || !draft.ok) throw new Error("test fixtures could not be created");
    setHouseholdCompanionStatus(ready.value.id, "ready");
    __reloadPersonasForTests();
    const cards = listCompanionCards(db.select().from(people).get()!);
    expect(cards.find((card) => card.id === ready.value.id)).toMatchObject({ is_household: true, status: "ready" });
    expect(cards.find((card) => card.id === draft.value.id)).toMatchObject({ is_household: true, status: "draft", is_default: false });
  });
});


test("cards count only this person's live chats and include null companion chats for their default", () => {
  addPerson("person-sage-count", "adult");
  addPerson("person-marlow-count", "adult");
  const sage = db.select().from(people).all().find((person) => person.id === "person-sage-count")!;
  const marlow = db.select().from(people).all().find((person) => person.id === "person-marlow-count")!;
  db.insert(settingsValues).values({ scope: `person:${sage.id}`, key: "persona.active_id", value: JSON.stringify("lively-child"), hlc: "2:0:test", source: "user", updatedAt: new Date().toISOString() }).run();
  __resetSettingsCacheForTests();
  const now = new Date().toISOString();
  const makeChat = (id: string, personId: string, companionId: string | null) => db.insert(conversations).values({ id, personId, companionId, surface: "web", mode: "chat", createdAt: now, updatedAt: now, hlc: "1:0:test", status: "open", source: "hub" }).run();
  makeChat("sage-nova-1", sage.id, "lively-child");
  makeChat("sage-nova-2", sage.id, "lively-child");
  makeChat("sage-default", sage.id, null);
  makeChat("marlow-nova", marlow.id, "lively-child");
  const novaBeforeNullChat = listCompanionCards(sage).find((card) => card.id === "lively-child")!;
  expect(novaBeforeNullChat.chats).toBe(3);
  makeChat("sage-nova-3", sage.id, "lively-child");
  const nova = listCompanionCards(sage).find((card) => card.id === "lively-child")!;
  expect(nova.chats).toBe(4);
  const other = listCompanionCards(sage).find((card) => card.id === "lively-adult")!;
  makeChat("sage-other", sage.id, other.id);
  expect(listCompanionCards(sage).find((card) => card.id === other.id)?.chats).toBe(1);
  expect(listCompanionCards(marlow).find((card) => card.id === "lively-child")?.chats).toBe(1);

});
