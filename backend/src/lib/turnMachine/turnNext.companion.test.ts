import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { people } from "@/db/schema";
import { createHouseholdCompanion, setHouseholdCompanionAudience, setHouseholdCompanionStatus } from "@/lib/householdCompanions";
import { getHouseholdCompanion } from "@/lib/householdCompanions";
import { loadManifestOnly } from "@/lib/plugins";
import { __reloadPersonasForTests } from "@/lib/persona";
import { __resetSettingsCacheForTests } from "@/lib/settings";
import { setValue } from "@/lib/settings";
import { conversationPersona, mentionedConversationPersona, runTurnNext } from "@/lib/turnMachine/turnNext";
import { addVersion, setRest } from "@/lib/companionLook";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { companionVoiceVersion, portraitPath, retainCompanionPortrait, voiceVersion } from "@/lib/companionPortrait";
import { resetDb } from "../../../tests/reset-db";
import { resolveOrCreateConversation, updateConversationCompanion } from "@/lib/conversationHistory";

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
const dataRoot = process.env.MAIPAI_DATA_DIR!;
beforeEach(() => { resetDb(); __reloadPersonasForTests(); __resetSettingsCacheForTests(); });
afterEach(() => { resetDb(); __reloadPersonasForTests(); __resetSettingsCacheForTests(); });

describe("conversation persona", () => {
  test("mentioning the conversation speaker keeps conversation attribution", async () => {
    addPerson("person-compoowner", "adult");
    const actor = addPerson("person-turnadult", "adult");
    const picked = companion("adult");
    const conversation = resolveOrCreateConversation(actor, "chat");
    if (!conversation.ok) throw new Error("Could not create test chat");
    updateConversationCompanion(actor, conversation.value.id, picked);
    const result = await runTurnNext(actor, "chat", "hello", { conversationId: conversation.value.id, mentionCompanionId: picked });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.answered_by?.via).toBe("conversation");
  });

  test("forbidden adult companion mention falls back for a child without naming that companion", async () => {
    addPerson("person-compoowner", "adult");
    const child = addPerson("person-turnchild", "child");
    const forbidden = companion("adult");
    const conversation = resolveOrCreateConversation(child, "chat");
    if (!conversation.ok) throw new Error("Could not create test chat");
    const result = await runTurnNext(child, "chat", "hello", { conversationId: conversation.value.id, mentionCompanionId: forbidden });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.answered_by?.via).toBe("fallback");
      expect(result.value.answered_by?.companion_id).not.toBe(forbidden);
      expect(result.value.answered_by?.name).not.toBe("Chat pick");
    }
  });

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

  test("captures a companion's rest look, voice version, and retained portrait key", async () => {
    addPerson("person-compoowner", "adult"); addPerson("turn-adult", "adult");
    const picked = companion("adult");
    const png = new Uint8Array(await sharp({ create: { width: 256, height: 192, channels: 3, background: "#4988aa" } }).png().toBuffer());
    const version = addVersion(picked, png, { source: "upload", label: "Rest", width: 256, height: 192, from: null }); setRest(picked, version.id);
    const persona = conversationPersona(db.select().from(people).all().find((row) => row.id === "turn-adult")!, picked);
    const voice = companionVoiceVersion(picked), portrait = await retainCompanionPortrait(picked, version.id);
    expect(persona.id).toBe(picked); expect(voice).toBe(voiceVersion(getHouseholdCompanion(picked)?.companion?.voice_id)); expect(portrait).toBe(`${picked}/${version.id}`);
    expect(portraitPath(picked, version.id)).toBeTruthy();
    expect(readFileSync(portraitPath(picked, version.id)!)).toBeTruthy();
    rmSync(join(dataRoot, "companion-portraits", picked), { recursive: true, force: true });
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
