import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people, memoryRecords } from "@/db/schema";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import type { PersonRow } from "@/types";
import { createHouseholdCompanion, setHouseholdCompanionAudience, updateHouseholdCompanion } from "@/lib/householdCompanions";
import { listSynths } from "@/lib/synths";
import { runImpressionTool, IMPRESSION_UNKNOWN_LINE } from "@/lib/impressionTool";
import { setHouseholdSettingValue, setValue, getDeviceSettingValue } from "@/lib/settings";
import { companionVoiceKey } from "@/settings/companionVoiceKeys";
import { voiceForSpeech, companionOwnVoice } from "@/lib/voiceForSpeech";
import { ROBOT_GUISE_KEY, robotCompanionOf } from "@/lib/robotCompanion";
import { __reloadRegistryForTests } from "@/lib/settingsRegistry";
import { issueDeviceToken } from "@/lib/deviceTokens";
import { remember, list as listMemory } from "@/lib/memory";
import { createConversation } from "@/lib/conversationHistory";
import { voiceForActiveChat } from "@/routes/turn";
import { robotAssignments } from "@/lib/companionsApp";

beforeEach(() => resetDb());
async function household() {
  const client = new TestClient(); await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return db.select().from(people).where(eq(people.displayName, "Sage")).get() as PersonRow;
}
function actor(role: string): PersonRow {
  const now = new Date().toISOString(), id = `person-impression-${role}`;
  db.insert(people).values({ id, displayName: role, role, avatarSeed: role, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  return db.select().from(people).where(eq(people.id, id)).get() as PersonRow;
}
function synth(owner: PersonRow, name = "Rivet", audience: "adult" | "teen" | "all" = "adult", real = false) {
  const result = createHouseholdCompanion({ display_name: name, formality: "formal", complexity: "standard", engagement: "brief", filler_density: "none", behavior: ["Use crisp, measured phrasing."], examples: ["Roster line one.", "Roster line two.", "Roster line three."], status: "ready", audience } as never, { person_id: owner.id, display_name: owner.displayName }, audience, { companion: { status: "ready", audience }, synth: { based_on: { kind: real ? "real_person" : "none", person_id: null, name: real ? "Roster Person" : null, refresh: "7d", minor: false } } });
  if (!result.ok) throw new Error(result.error);
  if (audience === "all") { const reviewed = setHouseholdCompanionAudience(result.value.id, "all", { person_id: owner.id, display_name: owner.displayName }); if (!reviewed.ok) throw new Error(reviewed.error); }
  __reloadRegistryForTests(); return result.value.id;
}

describe("held robot synth guise", () => {
  test("start and stop preserve assigned companion and robot voice, and synth voice wins only while active", async () => {
    const owner = await household(), id = synth(owner), device = issueDeviceToken(owner.id, "robot", "StackChan");
    setValue(owner, `device:${device.deviceId}`, "robot.controls", "adult");
    setValue(owner, `device:${device.deviceId}`, "robot.companion.id", "rivet");
    setValue(owner, `device:${device.deviceId}`, "robot.voice.id", "robot-voice");
    setHouseholdSettingValue(companionVoiceKey(id), "vera");
    const oldVoice = voiceForSpeech({ actor: owner, deviceId: device.deviceId, band: "adult" });
    expect(await runImpressionTool({ actor: owner, deviceId: device.deviceId, band: "adult", args: { action: "start", synth: id } })).toBe("Impression started.");
    expect(getDeviceSettingValue(device.deviceId, ROBOT_GUISE_KEY)).toBe(id);
    expect(robotCompanionOf(device.deviceId)?.id).toBe("rivet");
    expect(voiceForSpeech({ actor: owner, deviceId: device.deviceId, band: "adult" })).toBe("vera");
    expect(await runImpressionTool({ actor: owner, deviceId: device.deviceId, band: "adult", args: { action: "stop" } })).toBe("Impression stopped.");
    expect(getDeviceSettingValue(device.deviceId, ROBOT_GUISE_KEY)).toBe("");
    expect(voiceForSpeech({ actor: owner, deviceId: device.deviceId, band: "adult" })).toBe(oldVoice);
  });
  test("adult guise is bypassed for a child speaker and returns for an adult; non-robot refuses", async () => {
    const owner = await household(), id = synth(owner), device = issueDeviceToken(owner.id, "robot", "StackChan"), child = actor("child");
    setValue(owner, `device:${device.deviceId}`, "robot.controls", "adult");
    setValue(owner, `device:${device.deviceId}`, "robot.voice.id", "robot-voice");
    await runImpressionTool({ actor: owner, deviceId: device.deviceId, band: "adult", args: { action: "start", synth: id } });
    expect(voiceForSpeech({ actor: child, deviceId: device.deviceId, band: "child" })).not.toBe("vera");
    // A turn the guise does not apply to is the customization layer again: the robot's own voice is spoken, not skipped.
    expect(voiceForSpeech({ actor: child, deviceId: device.deviceId, band: "child" })).toBe("robot-voice");
    expect(voiceForSpeech({ actor: owner, deviceId: device.deviceId, band: "adult" })).toBe(voiceForSpeech({ actor: owner, deviceId: device.deviceId, band: "adult" }));
    expect(await runImpressionTool({ actor: owner, band: "adult", args: { action: "start", synth: id } })).toContain("robot only");
    expect(getDeviceSettingValue(device.deviceId, ROBOT_GUISE_KEY)).toBe(id);
  });
  test("speaker band and robot controls apply only the synth audience floor, including real-person synths", async () => {
    const owner = await household(), all = synth(owner, "Moss", "all"), teenFloor = synth(owner, "Teal", "teen"), adult = synth(owner, "Ada", "adult", true), child = actor("child"), teen = actor("teen"), device = issueDeviceToken(owner.id, "robot", "StackChan");
    setValue(owner, `device:${device.deviceId}`, "robot.controls", "adult");
    expect(await runImpressionTool({ actor: owner, deviceId: device.deviceId, band: "child", args: { action: "start", synth: all } })).toBe("Impression started.");
    expect(await runImpressionTool({ actor: owner, deviceId: device.deviceId, band: "child", args: { action: "start", synth: adult } })).toBe(IMPRESSION_UNKNOWN_LINE);
    expect(await runImpressionTool({ actor: owner, deviceId: device.deviceId, band: "teen", args: { action: "start", synth: teenFloor } })).toBe("Impression started.");
    expect(await runImpressionTool({ actor: owner, deviceId: device.deviceId, band: "teen", args: { action: "start", synth: adult } })).toBe(IMPRESSION_UNKNOWN_LINE);
    expect(await runImpressionTool({ actor: owner, deviceId: device.deviceId, band: "adult", args: { action: "start", synth: adult } })).toBe("Impression started.");
    expect(await runImpressionTool({ actor: owner, deviceId: device.deviceId, band: "child", args: { action: "start", synth: all } })).toBe("Impression started.");
    setValue(owner, `device:${device.deviceId}`, "robot.controls", "child");
    expect(await runImpressionTool({ actor: owner, deviceId: device.deviceId, band: "adult", args: { action: "start", synth: adult } })).toBe(IMPRESSION_UNKNOWN_LINE);
    expect(await runImpressionTool({ actor: owner, deviceId: device.deviceId, band: "child", args: { action: "start", synth: all } })).toBe("Impression started.");
  });
  test("person memory remains speaker-keyed and synth beat contains no household facts", async () => {
    const owner = await household(), id = synth(owner), device = issueDeviceToken(owner.id, "robot", "StackChan");
    setValue(owner, `device:${device.deviceId}`, "robot.controls", "adult");
    remember(owner, { text: "Sage's dog is named Juniper.", category: "relationship", tier: "durable", scope: "person", person: owner.id, source: "test", importance: 0.8 });
    await runImpressionTool({ actor: owner, deviceId: device.deviceId, band: "adult", args: { action: "start", synth: id } });
    // The speaker's own memory is still readable (turn-scoped, selfOnly) while the guise is on; listed directly so the test does not depend on the embedder.
    expect(listMemory(owner, { scope: "person", person: owner.id, selfOnly: true }).map((record) => record.text).join(" ")).toContain("Juniper");
    const rows = db.select().from(memoryRecords).all();
    // The record is the speaker's own (person scope); nothing is written into the synth's shared life, and the synth never learns household facts.
    expect(rows.some((row) => row.scope === "person" && row.source === "robot.guise" && row.text.includes("Rivet"))).toBe(true);
    expect(rows.some((row) => row.scope === "companion" && row.source === "robot.guise")).toBe(false);
    expect(rows.filter((row) => row.companionId === id).every((row) => !row.text.includes("Juniper"))).toBe(true);
  });
  test("the admin assignment view reports the stored guise name", async () => {
    const owner = await household(), id = synth(owner), device = issueDeviceToken(owner.id, "robot", "StackChan");
    setValue(owner, `device:${device.deviceId}`, "robot.companion.guise", id);
    expect(robotAssignments().find((row) => row.id === device.deviceId)?.guise).toBe("Rivet");
  });
  test("unknown robot speakers can start only child-floor synths and can stop a guise", async () => {
    const owner = await household(), id = synth(owner), all = synth(owner, "Moss", "all"), device = issueDeviceToken(owner.id, "robot", "StackChan");
    setValue(owner, `device:${device.deviceId}`, "robot.controls", "adult");
    expect(await runImpressionTool({ actor: owner, deviceId: device.deviceId, band: "child", args: { action: "start", synth: id } })).toBe(IMPRESSION_UNKNOWN_LINE);
    expect(getDeviceSettingValue(device.deviceId, ROBOT_GUISE_KEY)).toBe("");
    expect(await runImpressionTool({ actor: owner, deviceId: device.deviceId, band: "child", args: { action: "start", synth: all } })).toBe("Impression started.");
    setValue(owner, `device:${device.deviceId}`, ROBOT_GUISE_KEY, id);
    expect(await runImpressionTool({ actor: owner, deviceId: device.deviceId, band: "child", identified: false, args: { action: "stop" } })).toBe("That synth cannot be used for this speaker or device.");
    expect(getDeviceSettingValue(device.deviceId, ROBOT_GUISE_KEY)).toBe(id);
  });
  test("tool result is a fixed status without voice or setting values and private synths use the unknown line", async () => {
    const owner = await household(), id = synth(owner), device = issueDeviceToken(owner.id, "robot", "StackChan");
    setValue(owner, `device:${device.deviceId}`, "robot.controls", "adult");
    setHouseholdSettingValue(companionVoiceKey(id), "vera");
    expect(await runImpressionTool({ actor: owner, deviceId: device.deviceId, band: "adult", args: { action: "start", synth: id } })).toBe("Impression started.");
    expect(await runImpressionTool({ actor: owner, deviceId: device.deviceId, band: "adult", args: { action: "stop" } })).toBe("Impression stopped.");
  });
  test("a synth's own voice is its household voice setting, then the voice in its details, else none (a chat with it is spoken in that voice)", async () => {
    const owner = await household(), id = synth(owner);
    expect(companionOwnVoice(id)).toBeUndefined();
    expect(updateHouseholdCompanion(id, { voice_id: "from-details" } as never).ok).toBe(true);
    expect(companionOwnVoice(id)).toBe("from-details");
    setHouseholdSettingValue(companionVoiceKey(id), "from-setting");
    expect(companionOwnVoice(id)).toBe("from-setting");
    expect(companionOwnVoice("not-a-synth")).toBeUndefined();
  });
  test("a sentence that names no turn (the filler and the reply) is spoken in the voice of the synth in the person's newest chat", async () => {
    const owner = await household(), id = synth(owner);
    setHouseholdSettingValue(companionVoiceKey(id), "synth-voice");
    expect(voiceForActiveChat(owner)).toBeUndefined();
    const made = createConversation(owner, { surface: "chat", companionId: id });
    expect(made.ok).toBe(true);
    expect(voiceForActiveChat(owner)).toBe("synth-voice");
  });
});
