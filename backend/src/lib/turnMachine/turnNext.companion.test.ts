import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { people } from "@/db/schema";
import { createHouseholdCompanion, setHouseholdCompanionAudience, setHouseholdCompanionStatus } from "@/lib/householdCompanions";
import { loadManifestOnly } from "@/lib/plugins";
import { __reloadPersonasForTests } from "@/lib/persona";
import { __resetSettingsCacheForTests } from "@/lib/settings";
import { setValue } from "@/lib/settings";
import { conversationPersona, mentionedConversationPersona } from "@/lib/turnMachine/turnNext";
import { resetDb } from "../../../tests/reset-db";

function addPerson(id: string, role: string) {
  const now = new Date().toISOString();
  db.insert(people).values({ id, displayName: id, role, avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  return db.select().from(people).all().find((row) => row.id === id)!;
}
function companion(audience: "all" | "adult" = "all") {
  const loaded = loadManifestOnly("rivet");
  if (!loaded.ok || !loaded.value.companion) throw new Error("rivet fixture is unavailable");
  const created = createHouseholdCompanion({ ...loaded.value.companion, display_name: "Chat pick", audience: "all" }, { display_name: "Author", person_id: "person-compoowner" });
  if (!created.ok) throw new Error(created.error);
  setHouseholdCompanionAudience(created.value.id, audience, { display_name: "Admin" });
  setHouseholdCompanionStatus(created.value.id, "ready");
  __reloadPersonasForTests();
  return created.value.id;
}
beforeEach(() => { resetDb(); __reloadPersonasForTests(); __resetSettingsCacheForTests(); });
afterEach(() => { resetDb(); __reloadPersonasForTests(); __resetSettingsCacheForTests(); });

describe("conversation persona", () => {
  test("a valid mention picks a guest for one selection while the conversation pick stays available", () => {
    addPerson("person-compoowner", "adult");
    const actor = addPerson("turn-adult", "adult");
    const active = companion("all");
    const guest = companion("adult");
    expect(mentionedConversationPersona(actor, guest)?.id).toBe(guest);
    expect(conversationPersona(actor, active).id).toBe(active);
  });

  test("a mention that is not allowed falls back to the conversation pick", () => {
    const owner = addPerson("person-turnowner", "owner");
    const actor = addPerson("person-turnteen", "teen");
    const active = "default";
    const guest = companion("adult");
    expect(mentionedConversationPersona(actor, guest)).toBeNull();
    expect(conversationPersona(actor, active).id).toBe(active);
    setValue(owner, `person:${actor.id}`, "companions.allowed", false);
  });
  test("uses the allowed companion stored on the conversation", () => {
    addPerson("person-compoowner", "adult");
    const actor = addPerson("turn-adult", "adult");
    const picked = companion("adult");
    __reloadPersonasForTests();
    expect(conversationPersona(actor, picked).id).toBe(picked);
  });

  test("falls back to the person's own persona when the conversation pick is no longer allowed", () => {
    const owner = addPerson("person-turnowner", "owner");
    const actor = addPerson("person-turnteen", "teen");
    const picked = "rivet";
    setValue(owner, `person:${actor.id}`, "companions.allowed", false);
    __resetSettingsCacheForTests();
    const own = conversationPersona(actor, null).id;
    expect(conversationPersona(actor, picked).id).toBe(own);
    expect(conversationPersona(actor, "unknown-id").id).toBe(conversationPersona(actor, null).id);
  });
});
