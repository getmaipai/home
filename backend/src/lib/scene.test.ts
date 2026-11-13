import { describe, expect, test } from "bun:test";
import { fuseScene, getScene, setScene, dropScene, clearScenes, sceneCounts, SCENE_TTL } from "@/lib/scene";
import { comparePrompt } from "@/lib/promptPrefix";
import type { SceneObservation } from "@maipai/spec/gen/ts/scene-observation.js";
import type { Scene } from "@maipai/spec/gen/ts/scene.js";
import { renderScene } from "@/lib/turnMachine/nodes/context";

const person = (id: string | null, band: "child" | "teen" | "adult" | "unknown" = "adult", level: "confirmed" | "tentative" | "claimed" = "confirmed") => ({ person_id: id, label: null, relation: id ? "household" as const : "unknown" as const, band, level });
const obs = (kind: SceneObservation["kind"], value: unknown, sensor: SceneObservation["source"]["sensor"], now: number, strength: SceneObservation["strength"] = "strong", expires = SCENE_TTL[sensor as keyof typeof SCENE_TTL]): SceneObservation => ({ id: `${sensor}-${now}-${kind}`, source: { surface: "robot", device_id: "device-1", sensor }, kind, value, confidence: strength === "strong" ? 0.9 : 0.5, strength, at: now, expires_at: now + expires });
const empty = (conversation_id = "conversation-1"): Scene => ({ conversation_id, people: [], speaker: null, place: null, ambient: null, weather: null, alone: true, child_present: false, updated_at: 0 });

describe("scene fusion", () => {
  test("scene prompt names household members with stable age buckets; trace counts contain no names", () => {
    const at = 1_000_000;
    const sage = { id: "person-sage", displayName: "Sage", role: "adult", birthdate: null } as never;
    const marlow = { id: "person-marlow", displayName: "Marlow", role: "teen", birthdate: null } as never;
    const scene: Scene = { ...empty(), speaker: { person: "person-sage", basis: "signed_in", level: "confirmed" }, people: [
      { person_id: "person-marlow", label: null, relation: "household", band: "teen", level: "confirmed", basis: ["face"], last_seen_at: at - 10_000, expires_at: at + 1 },
      { person_id: null, label: null, relation: "unknown", band: "unknown", level: "tentative", basis: ["look"], last_seen_at: at - 10_000, expires_at: at + 1 },
      { person_id: null, label: "Bruno", relation: "unknown", band: "adult", level: "claimed", basis: ["typed"], last_seen_at: at - 90_000, expires_at: at + 1 },
    ] };
    const first = renderScene(scene, at, sage, [sage, marlow]);
    expect(first).toContain("With Sage:");
    expect(first).toContain("Marlow (teen, seen by the camera just now)");
    expect(first).toContain("someone the camera does not know");
    expect(first).toContain("Bruno (adult, Sage said so a few minutes ago)");
    expect(renderScene(scene, at + 20_000, sage, [sage, marlow])).toBe(first);
    const counts = JSON.stringify(sceneCounts(scene));
    expect(counts).not.toContain("Sage");
    expect(counts).not.toContain("Marlow");
    expect(counts).not.toContain("Bruno");
  });
  test("expires at the boundary, prefers strong people, and lets a strong sighting re-add after a typed leave", () => {
    const t = 10_000;
    const typed = obs("person_here", person("person-bruno1", "adult", "claimed"), "typed", t, "weak", SCENE_TTL.typed);
    const weak = fuseScene(empty(), [typed], t);
    const strong = obs("person_here", person("person-bruno1"), "face", t + 1);
    expect(fuseScene(weak, [strong], t + 1).people[0]?.basis).toContain("face");
    const left = obs("person_left", person("person-bruno1", "adult", "claimed"), "typed", t + 2, "weak", SCENE_TTL.typed);
    expect(fuseScene(fuseScene(weak, [left], t + 2), [strong], t + 3).people).toHaveLength(1);
    expect(fuseScene(weak, [], t + SCENE_TTL.typed).people).toHaveLength(0);
  });
  test("conflicting strong identities become unknown and never edits speaker", () => {
    const speaker = { person: "person-sage1", basis: "voice" as const, level: "confirmed" as const };
    const base = { ...empty(), speaker };
    const a = obs("person_here", person("person-nova1", "child"), "face", 10);
    const b = obs("person_here", person("person-marlow1", "teen"), "voice", 11);
    const result = fuseScene(base, [a, b], 11);
    expect(result.people).toHaveLength(1);
    expect(result.people[0]).toMatchObject({ person_id: null, label: null, band: "unknown", level: "tentative" });
    expect(result.speaker).toEqual(speaker);
  });
  test("look people count is a floor and derives alone and child_present", () => {
    const result = fuseScene(empty(), [obs("person_here", person("person-kid123", "child"), "face", 10), obs("people_count", 3, "look", 10)], 10);
    expect(result.people).toHaveLength(3);
    expect(result.alone).toBe(false);
    expect(result.child_present).toBe(true);
  });
  test("GPS beats typed place and all supported source TTLs expire", () => {
    const t = 100;
    const typedPlace = obs("place", { where: "home", setting: "indoor", area: null, precision: "area" }, "typed", t, "weak", SCENE_TTL.typed);
    const gps = obs("place", { where: "away", setting: "unknown", area: null, precision: "area" }, "gps", t, "strong");
    expect(fuseScene(fuseScene(empty(), [typedPlace], t), [gps], t).place?.where).toBe("away");
    for (const sensor of Object.keys(SCENE_TTL) as (keyof typeof SCENE_TTL)[]) {
      const ttl = SCENE_TTL[sensor];
      const kind: SceneObservation["kind"] = sensor === "look" ? "people_count" : sensor === "gps" || sensor === "typed" || sensor === "signed_in" ? "place" : "person_here";
      const value = kind === "people_count" ? 1 : kind === "place" ? { where: "home", setting: "unknown", area: null, precision: "area" } : person(`person-${sensor}123`);
      const item = obs(kind, value, sensor as SceneObservation["source"]["sensor"], t, sensor === "typed" || sensor === "signed_in" ? "weak" : "strong", ttl);
      expect(fuseScene(empty(), [item], t + ttl - 1).updated_at).toBe(t + ttl - 1);
      const fused = fuseScene(fuseScene(empty(), [item], t), [], t + ttl);
      if (kind === "person_here") expect(fused.people).toHaveLength(0);
      if (kind === "place") expect(fused.place).toBeNull();
    }
  });
  test("conversation scene store supports touch, end, and temporary conversation cleanup", () => {
    clearScenes();
    const item = fuseScene(empty("temporary-1"), [obs("person_here", person("person-guest1"), "typed", 50, "weak", SCENE_TTL.typed)], 50);
    setScene(item, 50);
    expect(getScene("temporary-1", 51)).toEqual(item);
    dropScene("temporary-1");
    expect(getScene("temporary-1", 52)).toBeNull();
    expect(sceneCounts(null)).toEqual({ people: 0, strong: 0, typed: 0, place_known: false, child_present: false, events: 0 });
  });
  test("different scene tails keep the system prefix byte-identical", () => {
    const id = "scene-prefix-test";
    const stable = { role: "system" as const, content: "stable system prefix" };
    comparePrompt(id, [stable, { role: "user", content: "context: one person" }], []);
    const next = comparePrompt(id, [stable, { role: "user", content: "context: two people" }], []);
    expect(next.had_previous).toBe(true);
    expect(next.first_diff).toBe("message 1 (user)");
  });
});
