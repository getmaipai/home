import { describe, expect, test } from "bun:test";
import type { PersonRow } from "@/types";
import { cleanSceneLabel, runSceneTool, sceneObservations } from "@/lib/sceneTool";

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
    const result = sceneObservations({ action: "left", label: "Quill" }, child, "c2", null, 100, [child, adult]);
    expect(result.observations).toHaveLength(0);
    expect(result.line).toContain("can't mark a household adult");
  });

  test("left preserves sensor-seen people and gives only their roster display name", () => {
    const now = 100;
    const scene = { people: [{ person_id: adult.id, label: "private sensor text", relation: "household", band: "adult", level: "confirmed", basis: ["face"], last_seen_at: now, expires_at: now + 90_000 }] } as never;
    const result = sceneObservations({ action: "left", person_id: adult.id }, owner, "c3", null, now, [owner, adult], scene);
    expect(result.observations).toHaveLength(0);
    expect(result.line).toBe("The camera still sees Quill.");
    expect(result.line).not.toContain("private sensor text");
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

  test("stored tool outcome carries no label, name, room, or person id", () => {
    const outcome = runSceneTool({ actor: owner, args: { action: "arrived", label: "Quill", relation: "guest" }, callId: "c", conversationId: "c5", speakerId: null, roster: [owner], surface: "chat", observe: () => undefined });
    expect(outcome.args).toEqual({});
    expect(JSON.stringify(outcome)).not.toMatch(/Quill|person-owner123|room|label/i);
  });
});
