import { setBounded } from "@/lib/boundedMap";
import type { SceneObservation } from "@maipai/spec/gen/ts/scene-observation.js";
import type { Scene } from "@maipai/spec/gen/ts/scene.js";
import { onConversationFolded } from "@/lib/conversationHistory";
import type { Surface } from "@/lib/turnShared";
import type { SpeakerEvidence, PresentPerson } from "@/lib/turnShared";

export const SCENE_TTL = { face: 90_000, voice: 120_000, typed: 1_800_000, look: 90_000, gps: 600_000, signed_in: Number.POSITIVE_INFINITY, robot_room: 1_800_000, ha_entity: 1_800_000, sound: 60_000, light: 300_000, temperature: 300_000, motion: 60_000 } as const;
const MAX_SCENES = 200;
const IDLE_TTL = 30 * 60_000;
const store = new Map<string, FusedScene>();
type Person = Scene["people"][number];
export type FusedScene = Scene & { alone_observed: boolean; alone_observed_until: number | null };

export function sceneForTests(scene: Partial<Scene> & Pick<Scene, "conversation_id"> = { conversation_id: "test" }): FusedScene {
  return {
    conversation_id: scene.conversation_id,
    people: scene.people ?? [],
    speaker: scene.speaker ?? null,
    place: scene.place ?? null,
    ambient: scene.ambient ?? null,
    weather: scene.weather ?? null,
    alone: scene.alone ?? true,
    alone_observed: false,
    alone_observed_until: null,
    child_present: scene.child_present ?? false,
    updated_at: scene.updated_at ?? 0,
  };
}

function personKey(p: Pick<Person, "person_id" | "label">): string { return p.person_id ? `id:${p.person_id}` : `label:${p.label ?? "unknown"}`; }
function isExpired(expires: number, now: number): boolean { return expires <= now; }
function clampExpires(o: SceneObservation): number { return Math.min(o.expires_at, o.at + (SCENE_TTL[o.source.sensor as keyof typeof SCENE_TTL] ?? IDLE_TTL)); }

export function fuseScene(previous: FusedScene | null | undefined, observations: readonly SceneObservation[], now: number, conversationId = previous?.conversation_id ?? "", speaker: Scene["speaker"] = previous?.speaker ?? null): FusedScene {
  const live = (previous?.people ?? []).filter((p) => !isExpired(p.expires_at, now));
  let place = previous?.place && !isExpired(previous.place.expires_at, now) ? previous.place : null;
  let countFloor = 0;
  let aloneObservedUntil = previous?.alone_observed_until ?? null;
  if (aloneObservedUntil !== null && aloneObservedUntil <= now) aloneObservedUntil = null;
  const typedLeft = new Set<string>();
  const strongIds = new Set<string>();
  const incoming = [...observations].filter((o) => !isExpired(clampExpires(o), now));

  for (const o of incoming) {
    if (o.kind === "person_left") { if (o.strength === "weak") typedLeft.add(personKey(o.value as Person)); continue; }
    if (o.kind === "people_count" && o.source.sensor === "look") { countFloor = Math.max(countFloor, Number(o.value) || 0); aloneObservedUntil = Number(o.value) === 1 && o.strength === "strong" ? clampExpires(o) : null; continue; }
    if (o.kind === "person_here") {
      const value = o.value as Omit<Person, "basis" | "last_seen_at" | "expires_at">;
      if (value.person_id !== speaker?.person) aloneObservedUntil = null;
      const key = personKey(value);
      const index = live.findIndex((p) => personKey(p) === key);
      const next: Person = { ...value, basis: [o.source.sensor], last_seen_at: o.at, expires_at: clampExpires(o) };
      if (o.strength === "strong" && value.person_id) strongIds.add(value.person_id);
      if (o.strength === "strong" && value.person_id && value.person_id === speaker?.person) continue;
      if (index < 0) live.push(next);
      else {
        const old = live[index]!;
        if (old.basis.some((b) => b === "face" || b === "voice") && o.strength === "strong" && old.person_id && value.person_id && old.person_id !== value.person_id) {
          live[index] = { person_id: null, label: null, relation: "unknown", band: "unknown", level: "tentative", basis: [...new Set([...old.basis, o.source.sensor])], last_seen_at: Math.max(old.last_seen_at, o.at), expires_at: Math.max(old.expires_at, clampExpires(o)) };
        } else if (o.strength === "strong" || !old.basis.some((b) => b === "face" || b === "voice")) {
          live[index] = { ...next, basis: [...new Set([...old.basis, o.source.sensor])] };
        }
      }
      continue;
    }
    if (o.kind === "room") {
      if (!["robot_room", "ha_entity", "typed"].includes(o.source.sensor)) continue;
      const value = o.value as { room: string };
      const priority = (sensor: string) => sensor === "typed" ? 3 : sensor === "signed_in" ? 2 : sensor === "robot_room" || sensor === "ha_entity" ? 1 : 0;
      if (place && priority(o.source.sensor) < priority(place.basis)) continue;
      place = { where: place?.where ?? "unknown", setting: place?.setting ?? "indoor", area: value.room, precision: "room", basis: o.source.sensor, expires_at: clampExpires(o) };
      continue;
    }
    if (o.kind === "place") {
      const priority = (sensor: string) => sensor === "gps" ? 4 : sensor === "typed" ? 3 : sensor === "signed_in" ? 2 : sensor === "robot_room" || sensor === "ha_entity" ? 1 : 0;
      const oldPriority = place ? priority(place.basis) : -1;
      if (priority(o.source.sensor) >= oldPriority) {
        const v = o.value as NonNullable<Scene["place"]>;
        place = { where: v.where ?? "unknown", setting: v.setting ?? "unknown", area: o.source.sensor === "gps" ? null : v.area ?? null, precision: v.precision ?? "area", basis: o.source.sensor, expires_at: clampExpires(o) };
      }
    }
  }
  for (let i = live.length - 1; i >= 0; i--) {
    const p = live[i]!;
    if (typedLeft.has(personKey(p)) && p.basis.length > 0 && p.basis.every((b) => b === "typed")) live.splice(i, 1);
  }
  // Face and voice evidence naming different people is ambiguous. Collapse both to one unnamed cue.
  const sensed = live.filter((p) => p.basis.some((b) => b === "face" || b === "voice") && p.person_id && strongIds.has(p.person_id));
  if (sensed.length > 1) {
    const expiry = Math.max(...sensed.map((p) => p.expires_at));
    for (const p of sensed) live.splice(live.indexOf(p), 1);
    live.push({ person_id: null, label: null, relation: "unknown", band: "unknown", level: "tentative", basis: [...new Set(sensed.flatMap((p) => p.basis))], last_seen_at: now, expires_at: expiry });
  }
  const otherCountFloor = Math.max(0, countFloor - (aloneObservedUntil !== null && aloneObservedUntil > now ? 1 : 0));
  while (live.length < otherCountFloor) live.push({ person_id: null, label: null, relation: "unknown", band: "unknown", level: "tentative", basis: ["look"], last_seen_at: now, expires_at: now + SCENE_TTL.look });
  const people = live.filter((p) => !isExpired(p.expires_at, now));
  return { conversation_id: conversationId, people, speaker, place, ambient: previous?.ambient ?? null, weather: previous?.weather ?? null, alone: people.length === 0, alone_observed: aloneObservedUntil !== null && aloneObservedUntil > now, alone_observed_until: aloneObservedUntil, child_present: people.some((p) => p.band === "child"), updated_at: now };
}

export function getScene(conversationId: string, now = Date.now()): FusedScene | null {
  const value = store.get(conversationId);
  if (!value) return null;
  if (now - value.updated_at >= IDLE_TTL) { store.delete(conversationId); return null; }
  setBounded(store, conversationId, value, MAX_SCENES);
  return value;
}
export function setScene(scene: FusedScene, now = Date.now()): void { dropIdleScenes(now); const value = { ...scene, updated_at: now }; setBounded(store, scene.conversation_id, value, MAX_SCENES); }
export function dropScene(conversationId: string): void { store.delete(conversationId); }
export function clearScenes(): void { store.clear(); }
export function dropIdleScenes(now = Date.now()): void { for (const [id, scene] of store) if (now - scene.updated_at >= IDLE_TTL) store.delete(id); }
// conversationHistory and the scene runtime import one another through
// shared memory/access helpers. Defer listener registration until the
// module graph has finished evaluating so the listener set is initialized.
queueMicrotask(() => onConversationFolded(dropScene));
export function observeSceneClaims(conversationId: string, observations: readonly SceneObservation[], now = Date.now()): Scene | null {
  if (!observations.length) return getScene(conversationId, now);
  const scene = fuseScene(getScene(conversationId, now), observations, now, conversationId);
  setScene(scene, now);
  return scene;
}

export function observationsForTurn(input: { surface: Surface; deviceId?: string; actorId: string; actorBand: "child" | "teen" | "adult"; speakerEvidence?: SpeakerEvidence | null; present?: readonly PresentPerson[] | null; lookPeople?: number | null; now: number }): SceneObservation[] {
  const result: SceneObservation[] = [];
  for (const p of input.present ?? []) {
    if (!input.speakerEvidence && p.person === input.actorId) continue;
    const sensor: SceneObservation["source"]["sensor"] = p.basis === "face" ? "face" : p.basis === "voice" || p.basis === "voice_and_face" ? "voice" : p.basis === "signed_in" ? "signed_in" : "typed";
    result.push({ id: `present-${sensor}-${input.now}-${p.person ?? "unknown"}`, source: { surface: input.surface, device_id: input.deviceId ?? null, sensor }, kind: "person_here", value: { person_id: p.person?.startsWith("person-") ? p.person : null, label: null, relation: "unknown", band: "unknown", level: p.level === "confirmed" ? "confirmed" : "tentative" }, confidence: p.level === "confirmed" ? 0.95 : 0.5, strength: p.level === "confirmed" ? "strong" : "weak", at: input.now, expires_at: input.now + SCENE_TTL[sensor as keyof typeof SCENE_TTL] });
  }
  if (input.lookPeople !== null && input.lookPeople !== undefined && input.lookPeople > 0) result.push({ id: `look-${input.now}`, source: { surface: input.surface, device_id: input.deviceId ?? null, sensor: "look" }, kind: "people_count", value: input.lookPeople, confidence: 1, strength: "strong", at: input.now, expires_at: input.now + SCENE_TTL.look });
  return result;
}
export function sceneCounts(scene: Scene | null | undefined) { return { people: scene?.people.length ?? 0, strong: scene?.people.filter((p) => p.basis.some((b) => b === "face" || b === "voice" || b === "signed_in" )).length ?? 0, typed: scene?.people.filter((p) => p.basis.includes("typed")).length ?? 0, place_known: !!scene?.place && scene.place.where !== "unknown", child_present: scene?.child_present ?? false, events: scene?.ambient?.events.length ?? 0 }; }
