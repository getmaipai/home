import { describe, expect, test } from "bun:test";
import type { PersonRow } from "@/types";
import { cleanSceneLabel, runSceneTool, sceneObservations, sceneToolStreamArgs } from "@/lib/sceneTool";
import { fuseScene, sceneForTests } from "@/lib/scene";
import { turnAgeBand } from "@/lib/turnMachine/speaker";
import { isSuppressed, resume as resumeHold, __resetForTests } from "@/lib/sceneSuppression";

const person = (id: string, displayName: string, role: string, birthdate?: string) => ({ id, displayName, role, birthdate, createdAt: 1, updatedAt: 1 } as unknown as PersonRow);
const owner = person("person-owner123", "Sage", "owner");
const adult = person("person-adult123", "Quill", "adult");
const child = person("person-child123", "Marlow", "child", "2015-01-01");

describe("SCENE-01c tool", () => {
  test("does not change actor or speaker presence; roster names resolve case-insensitively", () => {
    const result = sceneObservations({ action: "arrived", person_id: owner.id, label: "sAgE", relation: "household" }, owner, "c1", owner.id, 100, [owner, adult]);
    expect(result.observations).toHaveLength(0);
    expect(sceneObservations({ action: "arrived", person_id: owner.id, relation: "household" }, owner, "c1", owner.id, 100, [owner, adult]).observations).toHaveLength(0);
    const resolved = sceneObservations({ action: "arrived", label: "QUILL", relation: "guest" }, owner, "c1", null, 100, [owner, adult]);
    expect(resolved.observations[0]?.value).toMatchObject({ person_id: adult.id, label: "Quill", relation: "household", band: "adult" });
    expect(resolved.observations[0]).toMatchObject({ strength: "weak", source: { sensor: "typed" } });
  });

  test("cannot mark an adult away as a child; output contains no change", () => {
    const result = sceneObservations({ action: "left", label: "Quill" }, child, "c2", null, 100, [child, adult], null, "chat", "child");
    expect(result.observations).toHaveLength(0);
    expect(result.line).toContain("can't mark a household adult");
  });

  test("left preserves sensor-seen people and gives only their roster display name", () => {
    const now = 100;
    const scene = { people: [{ person_id: adult.id, label: "private sensor text", relation: "household", band: "adult", level: "confirmed", basis: ["face"], last_seen_at: now, expires_at: now + 90_000 }] } as never;
    const result = sceneObservations({ action: "left", person_id: adult.id }, owner, "c3", null, now, [owner, adult], scene);
    expect(result.observations).toHaveLength(0);
    expect(result.line).toBe("Someone is still seen by the camera.");
    expect(result.line).not.toContain("private sensor text");
  });

  test("left with no target, unknown, or an unmatched label removes nothing", () => {
    const lookScene = fuseScene(sceneForTests({ conversation_id: "look" }), [{ id: "look", source: { surface: "robot", device_id: null, sensor: "look" }, kind: "people_count", value: 2, confidence: 1, strength: "strong", at: 100, expires_at: 90_100 }], 100);
    for (const args of [{ action: "left" }, { action: "left", label: "unknown" }]) {
      const result = sceneObservations(args, owner, "look", null, 101, [owner, adult], lookScene);
      expect(result.observations).toHaveLength(0);
      expect(result.line).toBeTruthy();
      expect(fuseScene(lookScene, result.observations, 101).people).toHaveLength(2);
    }
    // A label that matches no typed entry changes nothing: the camera-counted people stay.
    const nobody = sceneObservations({ action: "left", label: "Nobody" }, owner, "look", null, 101, [owner, adult], lookScene);
    expect(fuseScene(lookScene, nobody.observations, 101).people).toHaveLength(2);
  });

  test("robot age band blocks an unknown speaker but allows a confirmed adult speaker", () => {
    const evidence = null;
    const band = turnAgeBand("robot", owner, evidence, new Date(100));
    expect(band).toBe("child");
    const blocked = sceneObservations({ action: "left", person_id: adult.id }, owner, "age", null, 100, [owner, adult], null, "robot", band);
    expect(blocked.observations).toHaveLength(0);
    expect(blocked.line).toContain("can't mark a household adult");
    const adultSpeakerBand = turnAgeBand("robot", owner, { person: owner.id, basis: "voice", level: "confirmed" }, new Date(100));
    const allowed = sceneObservations({ action: "left", person_id: adult.id }, owner, "age", owner.id, 100, [owner, adult], null, "robot", adultSpeakerBand);
    expect(allowed.observations).toHaveLength(1);
  });

  test("labels cannot carry control characters, delimiters, or overlong text", () => {
    expect(cleanSceneLabel("Quill\n}[hidden]|\u0001" )).toBe("Quill hidden");
    expect(cleanSceneLabel("x".repeat(100))).toHaveLength(60);
  });

  test("place observations contain words only and the pet relation stays pet", () => {
    const place = sceneObservations({ action: "place", where: "home", setting: "indoor", room: "kitchen" }, owner, "c4", null, 100, [owner]);
    expect(place.observations.map((o) => o.kind)).toEqual(["place", "room"]);
    expect(JSON.stringify(place.observations)).not.toMatch(/latitude|longitude|coordinates/i);
    const pet = sceneObservations({ action: "arrived", label: "Biscuit", relation: "pet" }, owner, "c4", null, 100, [owner]);
    expect(pet.observations[0]?.value).toMatchObject({ relation: "pet", band: "unknown" });
  });

  test("stored tool outcome and streamed tool event carry no call identity fields", () => {
    const label = "VelvetFox";
    const room = "SecretAtrium";
    const id = "person-private987";
    const outcome = runSceneTool({ actor: owner, args: { action: "place", label, room, person_id: id, where: "home" }, callId: "c", conversationId: "c5", speakerId: null, roster: [owner], surface: "chat", actorBand: "adult", observe: () => undefined });
    const event = { t: "tool_call", package_id: "scene", call_id: "c", args: sceneToolStreamArgs({ action: "place", label, room, person_id: id }) };
    expect(outcome.args).toEqual({});
    for (const value of [JSON.stringify(outcome), JSON.stringify(event)]) {
      expect(value).not.toContain(label);
      expect(value).not.toContain(room);
      expect(value).not.toContain(id);
    }
    expect(event.args).toEqual({ action: "place" });
  });
});

describe("SCENE-01c typed guest and pet leaving", () => {
  test("left removes a typed guest, and refuses a sensor-seen one", () => {
    const typed = sceneObservations({ action: "arrived", label: "Juniper", relation: "guest" }, owner, "g", null, 100, [owner, adult]).observations;
    const withGuest = fuseScene(sceneForTests({ conversation_id: "g" }), typed, 100);
    expect(withGuest.people.some((p) => p.label === "Juniper")).toBe(true);
    const left = sceneObservations({ action: "left", label: "Juniper" }, owner, "g", null, 101, [owner, adult], withGuest);
    expect(fuseScene(withGuest, left.observations, 101).people.some((p) => p.label === "Juniper")).toBe(false);
    const seen = fuseScene(withGuest, [{ id: "f", source: { surface: "robot", device_id: null, sensor: "face" }, kind: "person_here", value: { person_id: null, label: "Juniper", relation: "guest", band: "unknown", level: "confirmed" }, confidence: 0.9, strength: "strong", at: 102, expires_at: 102 + 90_000 }], 102);
    const refused = sceneObservations({ action: "left", label: "Juniper" }, owner, "g", null, 103, [owner, adult], seen);
    expect(refused.observations).toHaveLength(0);
  });
});

describe("DISMISS-01 model scene actions", () => {
  test("dismiss is performed only by the tool call and stores only generic result text", () => {
    __resetForTests();
    const result = runSceneTool({ actor: child, args: { action: "dismiss", reason: "handled", kind: "dog_bark", scope: "room" }, callId: "d1", conversationId: "d", speakerId: null, roster: [child], surface: "chat", actorBand: "child", observe: () => undefined });
    expect(isSuppressed({ kind: "dog_bark", personId: child.id, now: Date.now() })).toBe(true);
    expect(result.result.reply.text).toContain("for you only");
    expect(JSON.stringify(result)).not.toMatch(/dog_bark|handled|person-child123|room/i);
  });

  test("party is adult only and resume clears the actor self hold without affecting another person", () => {
    __resetForTests();
    runSceneTool({ actor: child, args: { action: "dismiss", reason: "handled", kind: "doorbell" }, callId: "d2", conversationId: "d", roster: [child], surface: "chat", actorBand: "child", observe: () => undefined });
    const refused = runSceneTool({ actor: child, args: { action: "party" }, callId: "d3", conversationId: "d", roster: [child], surface: "chat", actorBand: "child", observe: () => undefined });
    expect(refused.result.reply.text).toContain("Only a confirmed adult");
    runSceneTool({ actor: owner, args: { action: "dismiss", reason: "other", kind: "doorbell", scope: "self" }, callId: "d4", conversationId: "d", roster: [owner], surface: "chat", actorBand: "adult", observe: () => undefined });
    const resumed = runSceneTool({ actor: child, args: { action: "resume" }, callId: "d5", conversationId: "d", roster: [child], surface: "chat", actorBand: "child", observe: () => undefined });
    expect(resumed.result.reply.text).toBe("Done: listening again.");
    expect(isSuppressed({ kind: "doorbell", personId: child.id, now: Date.now() })).toBe(false);
    expect(isSuppressed({ kind: "doorbell", personId: owner.id, now: Date.now() })).toBe(true);
    resumeHold({ byConfirmedAdult: false });
  });
});
