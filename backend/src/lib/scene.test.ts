import { afterEach, describe, expect, test } from "bun:test";
import { fuseScene, getScene, setScene, dropScene, clearScenes, sceneCounts, SCENE_TTL, observationsForTurn, homeAssistantObservations, sceneForTests, getWeatherCue, setWeatherCue, setWeatherFailure, type FusedScene } from "@/lib/scene";

afterEach(() => { clearScenes(); __resetHeardSongsForTests(); });
import { sensitiveAllowed } from "@/lib/turnContext";
import { comparePrompt } from "@/lib/promptPrefix";
import type { SceneObservation } from "@maipai/spec/gen/ts/scene-observation.js";
import { renderScene, fitSceneBlock } from "@/lib/turnMachine/nodes/context";
import { noteNowPlaying, __resetHeardSongsForTests } from "@/lib/music/heardSong";
import { TraceRecorder } from "@/lib/turnMachine/trace";

const person = (id: string | null, band: "child" | "teen" | "adult" | "unknown" = "adult", level: "confirmed" | "tentative" | "claimed" = "confirmed") => ({ person_id: id, label: null, relation: id ? "household" as const : "unknown" as const, band, level });
const obs = (kind: SceneObservation["kind"], value: unknown, sensor: SceneObservation["source"]["sensor"], now: number, strength: SceneObservation["strength"] = "strong", expires = SCENE_TTL[sensor as keyof typeof SCENE_TTL]): SceneObservation => ({ id: `${sensor}-${now}-${kind}`, source: { surface: "robot", device_id: "device-1", sensor }, kind, value, confidence: strength === "strong" ? 0.9 : 0.5, strength, at: now, expires_at: now + expires });
const empty = (conversation_id = "conversation-1"): FusedScene => sceneForTests({ conversation_id });

describe("scene fusion", () => {
  test("away, another person's tracker, unavailable, unknown, and stale HA states add no cue", () => {
    const now = Date.parse("2026-11-14T12:00:00Z");
    const states = [
      { entity_id: "device_tracker.sage_phone", state: "away", attributes: {}, last_updated: new Date(now).toISOString() },
      { entity_id: "person.marlow", state: "home", attributes: {}, last_updated: new Date(now).toISOString() },
      { entity_id: "device_tracker.sage_phone", state: "unavailable", attributes: {}, last_updated: new Date(now).toISOString() },
      { entity_id: "device_tracker.sage_old", state: "home", attributes: {}, last_updated: new Date(now - 30 * 60_000).toISOString() },
    ];
    expect(homeAssistantObservations(states, "device_tracker.sage_phone", "chat", now)).toEqual([]);
  });
  test("the own home tracker is visible only as a place cue and never establishes alone", () => {
    const now = Date.parse("2026-11-14T12:00:00Z");
    const own = { entity_id: "device_tracker.sage_phone", state: "home", attributes: {}, last_updated: new Date(now).toISOString() };
    const ownCues = homeAssistantObservations([own], own.entity_id, "chat", now);
    const scene = fuseScene(empty(), ownCues, now);
    expect(scene.people).toHaveLength(0);
    expect(scene.alone).toBe(true);
    expect(scene.alone_observed).toBe(false);
    expect(scene.place?.where).toBe("home");
    const sage = { id: "person-sage", displayName: "Sage", role: "adult", birthdate: null } as never;
    const text = renderScene(scene, now, sage, [sage]);
    expect(text).toContain("Place: at home.");
    const trace = JSON.stringify(sceneCounts(scene));
    expect(trace).not.toContain(own.entity_id);
    expect(text).not.toContain(own.entity_id);
  });
  test("another person's Home Assistant tracker cannot affect rendered text, trace, or evidence", () => {
    const now = Date.parse("2026-11-14T12:00:00Z");
    const states = [
      { entity_id: "device_tracker.sage_phone", state: "home", attributes: {}, last_updated: new Date(now).toISOString() },
      { entity_id: "person.marlow_private_tracker", state: "away", attributes: {}, last_updated: new Date(now).toISOString() },
    ];
    const cues = homeAssistantObservations(states, "device_tracker.sage_phone", "chat", now);
    const scene = fuseScene(empty(), cues, now);
    const sage = { id: "person-sage", displayName: "Sage", role: "adult", birthdate: null } as never;
    const text = renderScene(scene, now, sage, [sage]);
    const trace = JSON.stringify(sceneCounts(scene));
    const evidence = JSON.stringify(cues);
    for (const forbidden of ["Marlow", "person.marlow_private_tracker", "device_tracker.marlow"]) {
      expect(text).not.toContain(forbidden);
      expect(trace).not.toContain(forbidden);
      expect(evidence).not.toContain(forbidden);
    }
  });
  test("weather cache reuses a rounded point within TTL and invalidates on movement, source, or expiry", () => {
    clearScenes();
    const cue = { temp_f: 41, sky: "rainy", precipitation: "rain", wind_mph: 12, change: null, checked_at: 100, expires_at: 1_800_100, source: "current" as const };
    setWeatherCue("weather-convo", cue, { lat: 40.71, lon: -74.01 });
    expect(getWeatherCue("weather-convo", { lat: 40.72, lon: -74 }, "current", 200)).toEqual(cue);
    expect(getWeatherCue("weather-convo", { lat: 40.74, lon: -74.01 }, "current", 200)).toBeNull();
    setWeatherCue("weather-convo", cue, { lat: 40.71, lon: -74.01 });
    expect(getWeatherCue("weather-convo", { lat: 40.71, lon: -74.01 }, "home", 200)).toBeNull();
    setWeatherCue("weather-convo", cue, { lat: 40.71, lon: -74.01 });
    expect(getWeatherCue("weather-convo", { lat: 40.71, lon: -74.01 }, "current", cue.expires_at)).toBeNull();
  });
  test("a failed weather fetch is held silent until its retry TTL", () => {
    clearScenes();
    const point = { lat: 40.71, lon: -74.01 };
    setWeatherFailure("failed-weather", point, "current", 100);
    expect(getWeatherCue("failed-weather", point, "current", 101)).toBe(false);
    expect(getWeatherCue("failed-weather", point, "current", 30 * 60_000 + 100)).toBeNull();
  });
  test("weather renders facts only, never coordinates, and outside adds the stated setting", () => {
    const at = 1_000_000;
    const actor = { id: "person-sage", displayName: "Sage", role: "adult", birthdate: null } as never;
    const scene = sceneForTests({ ...empty(), place: { where: "away", setting: "outdoor", area: null, precision: "area", basis: "typed", expires_at: at + 1 }, weather: { temp_f: 41, sky: "rainy", precipitation: "rain", wind_mph: 12, change: null, checked_at: at - 4 * 60_000, expires_at: at + 1, source: "current" } });
    const rendered = renderScene(scene, at, actor, [actor]);
    expect(rendered).toContain("Weather here: 41 F, rain, wind 12 mph (checked a few minutes ago)");
    expect(rendered).toContain("Setting: outdoors.");
    expect(rendered).not.toMatch(/40\.71|-74\.01/);
    expect(renderScene({ ...scene, place: { ...scene.place!, setting: "indoor" } }, at, actor, [actor])).not.toContain("said they are outside");
    expect(renderScene({ ...scene, weather: { ...scene.weather as object, expires_at: at } }, at, actor, [actor])).not.toContain("Weather here:");
  });
  test("media adds one title-free scene line only during playback", () => {
    const at = 1_000_000;
    const sage = { id: "person-sage", displayName: "Sage", role: "adult", birthdate: null } as never;
    noteNowPlaying("scene-device", { title: "Secret Album" }, at);
    const playing = renderScene(empty(), at, sage, [sage], "robot", "scene-device");
    expect(playing).toContain("Media is playing on this device.");
    expect(playing).not.toContain("Secret Album");
    expect(renderScene(empty(), at, sage, [sage], "robot", "other-device")).not.toContain("Media is playing on this device.");
  });
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
    const scene = sceneForTests({ ...empty(), speaker: { person: "person-sage", basis: "signed_in", level: "confirmed" }, people: [
      { person_id: "person-marlow", label: null, relation: "household", band: "teen", level: "confirmed", basis: ["face"], last_seen_at: at - 10_000, expires_at: at + 1 },
      { person_id: null, label: null, relation: "unknown", band: "unknown", level: "tentative", basis: ["look"], last_seen_at: at - 10_000, expires_at: at + 1 },
      { person_id: null, label: "Bruno", relation: "unknown", band: "adult", level: "claimed", basis: ["typed"], last_seen_at: at - 90_000, expires_at: at + 1 },
    ] });
    const first = renderScene(scene, at, sage, [sage, marlow]);
    expect(first).toContain("Speaker: Sage (signed in).");
    expect(first).toContain("Marlow (teen) (seen by the camera just now)");
    expect(first).toContain("someone the camera does not know");
    expect(first).toContain("Bruno (adult) (Sage said so a few minutes ago)");
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
  test("typed leave never removes a look-only unknown person", () => {
    const t = 20;
    const look = obs("people_count", 2, "look", t);
    const scene = fuseScene(empty(), [look], t);
    const left = obs("person_left", person(null, "unknown", "claimed"), "typed", t + 1, "weak");
    expect(fuseScene(scene, [left], t + 1).people).toHaveLength(2);
    const claimed = obs("person_here", { ...person(null, "unknown", "claimed"), label: "Guest" }, "typed", t, "weak");
    const typedScene = fuseScene(empty(), [claimed], t);
    const namedLeft = obs("person_left", { ...person(null, "unknown", "claimed"), label: "Guest" }, "typed", t + 1, "weak");
    expect(fuseScene(typedScene, [namedLeft], t + 1).people).toHaveLength(0);
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
  test("speaker sighting alone is not alone evidence, and does not open shared sensitive surfaces", () => {
    const actorId = "person-sage";
    const scene = fuseScene({ ...empty(), speaker: { person: actorId, basis: "signed_in", level: "confirmed" } }, [obs("person_here", person(actorId), "face", 10)], 10);
    expect(scene.alone_observed).toBe(false);
    expect(scene.alone_observed_until).toBeNull();
    for (const surface of ["tv", "overlay", "pod"] as const) {
      expect(sensitiveAllowed(surface, null, null, actorId, scene)).toBe(false);
    }
    const observed = fuseScene(scene, [obs("people_count", 1, "look", 11)], 11);
    expect(observed.alone_observed).toBe(true);
    const cleared = fuseScene(observed, [obs("person_here", person("person-other"), "face", 12)], 12);
    expect(cleared.alone_observed).toBe(false);
    expect(cleared.alone_observed_until).toBeNull();
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
    const scene = sceneForTests({ ...empty(), speaker: { person: "person-other", basis: "voice", level: "confirmed" } });
    const text = renderScene(scene, 10, sage, [sage]);
    expect(text).not.toContain("Speaker: Sage");
    expect(text).toContain("Speaker: unknown.");
  });
  test("many typed people with long labels retain speaker, alone, and child lines", () => {
    const at = 10_000;
    const sage = { id: "person-sage", displayName: "Sage", role: "adult", birthdate: null } as never;
    const scene: FusedScene = {
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
    expect(text).toContain("Speaker: Sage (signed in).");
    expect(text).toContain("Alone: positively observed.");
    expect(text).toContain("A child is in the room.");
    expect(text.length).toBeGreaterThan(1200);
  });
  test("scene budget keeps speaker, alone, and child lines over cap and with a missing tokenizer", async () => {
    const required = "Speaker: unknown. Alone: not confirmed. A child is in the room.";
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
  test("room observations preserve place identity and only accepted room sensors set it", () => {
    const t = 100;
    const home = obs("place", { where: "home", setting: "indoor", area: "house", precision: "area" }, "typed", t, "weak");
    const room = obs("room", { room: "kitchen" }, "robot_room", t + 1);
    const updated = fuseScene(fuseScene(empty(), [home], t), [room], t + 1).place;
    expect(updated).toMatchObject({ where: "home", setting: "indoor", area: "house", precision: "area", basis: "typed" });
    const created = fuseScene(empty(), [room], t + 1).place;
    expect(created).toMatchObject({ where: "unknown", setting: "indoor", area: "kitchen", precision: "room" });
    const gpsRoom = obs("room", { room: "kitchen" }, "gps", t + 2);
    expect(fuseScene(empty(), [gpsRoom], t + 2).place).toBeNull();
  });
  test("configured robot room renders as detail and missing room emits nothing", () => {
    const t = 100;
    const observations = observationsForTurn({ surface: "robot", deviceId: "device-x", deviceKind: "robot", deviceArea: "kitchen", actorId: "person-sage", actorBand: "adult", now: t });
    expect(observations).toHaveLength(2); // weak device-address place plus configured room
    const scene = fuseScene(empty(), observations, t);
    const sage = { id: "person-sage", displayName: "Sage", role: "adult" } as never;
    expect(renderScene(scene, t, sage, [sage])).toContain("Place: indoors, kitchen.");
    const noRoom = observationsForTurn({ surface: "robot", deviceId: "device-x", deviceKind: "robot", actorId: "person-sage", actorBand: "adult", now: t });
    expect(noRoom.some((item) => item.kind === "room")).toBe(false);
    expect(renderScene(fuseScene(empty(), noRoom, t), t, sage, [sage])).not.toContain("Place:");
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
  test("a write opportunistically drops idle scenes using its injected time", () => {
    clearScenes();
    const stale = fuseScene(empty("idle-scene"), [], 10);
    const active = fuseScene(empty("active-scene"), [], 10);
    setScene(stale, 10);
    setScene(active, 10);
    setScene(fuseScene(empty("next-write"), [], 10), 10 + 30 * 60_000);
    expect(getScene("idle-scene", 10 + 30 * 60_000)).toBeNull();
    expect(getScene("active-scene", 10 + 30 * 60_000)).toBeNull();
    expect(getScene("next-write", 10 + 30 * 60_000)).not.toBeNull();
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
