import { describe, expect, test } from "bun:test";
import type { PersonRow } from "@/types";
import { cleanSceneLabel, runSceneTool, sceneObservations, sceneToolStreamArgs } from "@/lib/sceneTool";
import { fuseScene, sceneForTests } from "@/lib/scene";
import { turnAgeBand } from "@/lib/turnMachine/speaker";

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
    for (const args of [{ action: "left" }, { action: "left", label: "unknown" }, { action: "left", label: "Nobody" }]) {
      const result = sceneObservations(args, owner, "look", null, 101, [owner, adult], lookScene);
      expect(result.observations).toHaveLength(0);
      expect(result.line).toBeTruthy();
      expect(fuseScene(lookScene, result.observations, 101).people).toHaveLength(2);
    }
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
