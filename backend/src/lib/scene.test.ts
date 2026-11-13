import { describe, expect, test } from "bun:test";
import { fuseScene, getScene, setScene, dropScene, clearScenes, sceneCounts, SCENE_TTL, observationsForTurn } from "@/lib/scene";
import { comparePrompt } from "@/lib/promptPrefix";
import type { SceneObservation } from "@maipai/spec/gen/ts/scene-observation.js";
import type { Scene } from "@maipai/spec/gen/ts/scene.js";
import { renderScene, fitSceneBlock } from "@/lib/turnMachine/nodes/context";
import { TraceRecorder } from "@/lib/turnMachine/trace";

const person = (id: string | null, band: "child" | "teen" | "adult" | "unknown" = "adult", level: "confirmed" | "tentative" | "claimed" = "confirmed") => ({ person_id: id, label: null, relation: id ? "household" as const : "unknown" as const, band, level });
const obs = (kind: SceneObservation["kind"], value: unknown, sensor: SceneObservation["source"]["sensor"], now: number, strength: SceneObservation["strength"] = "strong", expires = SCENE_TTL[sensor as keyof typeof SCENE_TTL]): SceneObservation => ({ id: `${sensor}-${now}-${kind}`, source: { surface: "robot", device_id: "device-1", sensor }, kind, value, confidence: strength === "strong" ? 0.9 : 0.5, strength, at: now, expires_at: now + expires });
const empty = (conversation_id = "conversation-1"): Scene => ({ conversation_id, people: [], speaker: null, place: null, ambient: null, weather: null, alone: true, child_present: false, updated_at: 0 });

describe("scene fusion", () => {
  test("context trace scene counts contain the measured token count and no identity fields", () => {
    const trace = new TraceRecorder();
    trace.record("context", "context", "v1", 1, 2, { ok: true });
    trace.setSceneCounts("context", { people: 2, strong: 1, typed: 1, place_known: false, child_present: false, events: 0, scene_tokens: 37 });
    expect(trace.nodes()[0]?.scene).toEqual({ people: 2, strong: 1, typed: 1, place_known: false, child_present: false, events: 0, scene_tokens: 37 });
    expect(typeof trace.nodes()[0]?.scene?.scene_tokens).toBe("number");
    expect(JSON.stringify(trace.nodes()[0]?.scene)).not.toMatch(/name|label|room|person.?id/i);
  });

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
  test("alone observation requires strong current evidence and expires with its TTL", () => {
    const one = obs("people_count", 1, "look", 10);
    const scene = fuseScene(empty(), [one], 10);
    expect(scene.alone_observed).toBe(true);
    expect(fuseScene(scene, [], 10 + SCENE_TTL.look).alone_observed).toBe(false);
    const weak = obs("people_count", 1, "look", 10, "weak");
    expect(fuseScene(empty(), [weak], 10).alone_observed).toBe(false);
  });
  test("an unknown robot speaker remains unknown and absent evidence does not list the signed-in actor", () => {
    const sage = { id: "person-sage", displayName: "Sage", role: "adult", birthdate: null } as never;
    const observations = observationsForTurn({ surface: "robot", actorId: "person-sage", actorBand: "adult", present: [{ person: "person-sage", basis: "signed_in", level: "confirmed" }], now: 10 });
    const scene = fuseScene(empty(), observations, 10, "robot-unknown", null);
    expect(scene.speaker).toBeNull();
    expect(scene.people).toHaveLength(0);
  });
  test("speaker names are shown only when the scene confirms the actor", () => {
    const sage = { id: "person-sage", displayName: "Sage", role: "adult", birthdate: null } as never;
    const scene: Scene = { ...empty(), speaker: { person: "person-other", basis: "voice", level: "confirmed" } };
    const text = renderScene(scene, 10, sage, [sage]);
    expect(text).not.toContain("With Sage:");
    expect(text).toContain("With: someone the system has not identified.");
  });
  test("many typed people with long labels retain speaker, alone, and child lines", () => {
    const at = 10_000;
    const sage = { id: "person-sage", displayName: "Sage", role: "adult", birthdate: null } as never;
    const scene: Scene & { alone_observed?: boolean } = {
      ...empty(),
      speaker: { person: "person-sage", basis: "signed_in", level: "confirmed" },
      people: Array.from({ length: 20 }, (_, index) => ({
        person_id: null,
        label: `Guest ${index} ${"with a very long typed label ".repeat(5)}`,
        relation: "unknown" as const,
        band: "unknown" as const,
        level: "claimed" as const,
        basis: ["typed" as const],
        last_seen_at: at,
        expires_at: at + 1,
      })),
      alone: true,
      alone_observed: true,
      child_present: true,
    };
    const text = renderScene(scene, at, sage, [sage]);
    expect(text).toContain("With Sage:");
    expect(text).toContain("Alone: positively observed.");
    expect(text).toContain("A child is in the room.");
    expect(text.length).toBeGreaterThan(1200);
  });
  test("scene budget keeps speaker, alone, and child lines over cap and with a missing tokenizer", async () => {
    const required = "With: someone the system has not identified. Alone: not confirmed. A child is in the room.";
    const oversized = `Ambient events: ${"very loud event ".repeat(100)}. ${required}`;
    expect(await fitSceneBlock(oversized, required, async (value) => value === required ? 30 : 400)).toBe(required);
    expect(await fitSceneBlock(oversized, required, async () => null)).toBe(required);
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
