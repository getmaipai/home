import { setBounded } from "@/lib/boundedMap";
import type { SceneObservation } from "@maipai/spec/gen/ts/scene-observation.js";
import type { Scene } from "@maipai/spec/gen/ts/scene.js";
import { onConversationFolded } from "@/lib/conversationHistory";
import type { Surface } from "@/lib/turnShared";
import type { SpeakerEvidence, PresentPerson } from "@/lib/turnShared";
import { homeOrAway } from "@/lib/places";

export const SCENE_TTL = { face: 90_000, voice: 120_000, typed: 1_800_000, look: 90_000, gps: 600_000, signed_in: Number.POSITIVE_INFINITY, robot_room: 1_800_000, ha_entity: 1_800_000, sound: 60_000, light: 300_000, temperature: 300_000, motion: 60_000 } as const;
const MAX_SCENES = 200;
const IDLE_TTL = 30 * 60_000;
const store = new Map<string, FusedScene>();
type Person = Scene["people"][number];
export type FusedScene = Scene & { alone_observed: boolean; alone_observed_until: number | null; weather_alerts?: WeatherAlertCue[] };

export type WeatherCue = {
  temp_f?: number;
  temp_c?: number;
  sky: string;
  precipitation: string;
  wind_mph: number;
  change: string | null;
  checked_at: number;
  expires_at: number;
  source: "current" | "saved" | "home" | "device";
};
export type WeatherAlertCue = { id: string; event: string; severity: string; headline: string; ends: string };

const weatherCache = new Map<string, { cue: WeatherCue | null; point: { lat: number; lon: number }; source: WeatherCue["source"]; expires_at: number }>();
const weatherGenerations = new Map<string, number>();
const alertCache = new Map<string, { point: { lat: number; lon: number }; alerts: WeatherAlertCue[]; expires_at: number }>();
/** A late weather lookup may only fill the cache while its conversation still exists. */
export function weatherCacheLease(conversationId: string): () => boolean {
  const generation = weatherGenerations.get(conversationId) ?? 0;
  return () => (weatherGenerations.get(conversationId) ?? 0) === generation;
}
export function getWeatherCue(conversationId: string, point: { lat: number; lon: number }, source: WeatherCue["source"], now = Date.now()): WeatherCue | false | null {
  const entry = weatherCache.get(conversationId);
  if (!entry) return null;
  const moved = Math.abs(point.lat - entry.point.lat) >= 0.02 || Math.abs(point.lon - entry.point.lon) >= 0.02;
  if (entry.source !== source || moved || entry.expires_at <= now) { weatherCache.delete(conversationId); return null; }
  return entry.cue ?? false;
}
export function setWeatherCue(conversationId: string, cue: WeatherCue, point: { lat: number; lon: number }): void { setBounded(weatherCache, conversationId, { cue, point, source: cue.source, expires_at: cue.expires_at }, MAX_SCENES); }
export function setWeatherFailure(conversationId: string, point: { lat: number; lon: number }, source: WeatherCue["source"], now: number): void {
  setBounded(weatherCache, conversationId, { cue: null, point, source, expires_at: now + 30 * 60_000 }, MAX_SCENES);
}
export function dropWeatherCue(conversationId: string): void { weatherCache.delete(conversationId); weatherGenerations.set(conversationId, (weatherGenerations.get(conversationId) ?? 0) + 1); }
export function getWeatherAlertCues(conversationId: string, point: { lat: number; lon: number }, now = Date.now()): WeatherAlertCue[] | null {
  const entry = alertCache.get(conversationId);
  if (!entry || entry.expires_at <= now || Math.abs(point.lat - entry.point.lat) >= 0.02 || Math.abs(point.lon - entry.point.lon) >= 0.02) { alertCache.delete(conversationId); return null; }
  return entry.alerts.filter((alert) => Date.parse(alert.ends) > now);
}
export function setWeatherAlertCues(conversationId: string, point: { lat: number; lon: number }, alerts: WeatherAlertCue[], now = Date.now()): void {
  const active = alerts.filter((alert) => Date.parse(alert.ends) > now);
  const expires_at = Math.min(now + 5 * 60_000, ...active.map((alert) => Date.parse(alert.ends)));
  setBounded(alertCache, conversationId, { point, alerts: active, expires_at }, MAX_SCENES);
}
export function dropWeatherAlertCues(conversationId: string): void { alertCache.delete(conversationId); }
export function clearWeatherCues(): void { weatherCache.clear(); alertCache.clear(); weatherGenerations.clear(); }

export function sceneForTests(scene: Partial<Scene> & { weather_alerts?: WeatherAlertCue[] } & Pick<Scene, "conversation_id"> = { conversation_id: "test" }): FusedScene {
  return {
    conversation_id: scene.conversation_id,
    people: scene.people ?? [],
    speaker: scene.speaker ?? null,
    place: scene.place ?? null,
    ambient: scene.ambient ?? null,
    weather: scene.weather ?? null,
    weather_alerts: scene.weather_alerts ?? [],
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
  const haEntityIds = new Set(observations.filter((o) => o.source.sensor === "ha_entity" && o.kind === "person_here").map((o) => o.id));
  const live = (previous?.people ?? []).filter((p) => !isExpired(p.expires_at, now) && !(p.basis.includes("ha_entity") && !haEntityIds.size));
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
      const index = live.findIndex((p) => personKey(p) === key && !(o.source.sensor === "ha_entity" && p.basis.includes("ha_entity")));
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
      if (place && priority(o.source.sensor) < priority(place.basis) && !(place.where === "unknown" && !place.area)) continue;
      place = { where: place?.where ?? "unknown", setting: !place || place.setting === "unknown" ? "indoor" : place.setting, area: value.room, precision: "room", basis: o.source.sensor, expires_at: clampExpires(o) };
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
export function dropScene(conversationId: string): void { store.delete(conversationId); dropWeatherCue(conversationId); }
export function clearScenes(): void { store.clear(); clearWeatherCues(); }
export function dropIdleScenes(now = Date.now()): void { for (const [id, scene] of store) if (now - scene.updated_at >= IDLE_TTL) { store.delete(id); dropWeatherCue(id); } }
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

export type HomeAssistantSceneState = { entity_id: string; state: string; attributes: Record<string, unknown>; last_updated?: string; area?: string | null };
export function homeAssistantObservations(states: readonly HomeAssistantSceneState[], ownEntityId: string | null, surface: Surface, now: number): SceneObservation[] {
  const result: SceneObservation[] = [];
  for (const state of states) {
    const updated = state.last_updated ? Date.parse(state.last_updated) : NaN;
    if (!Number.isFinite(updated) || updated + 30 * 60_000 <= now || state.state === "unknown" || state.state === "unavailable") continue;
    const domain = state.entity_id.split(".", 1)[0];
    if (state.entity_id === ownEntityId && (domain === "person" || domain === "device_tracker") && state.state === "home") {
      result.push({ id: `ha-own-place-${now}`, source: { surface, device_id: null, sensor: "ha_entity" }, kind: "place", value: { where: "home", setting: "unknown", area: null, precision: "area" }, confidence: 0.4, strength: "weak", at: updated, expires_at: updated + 30 * 60_000 });
      continue;
    }
  }
  return result;
}

export function observationsForTurn(input: { surface: Surface; deviceId?: string; deviceArea?: string | null; deviceKind?: string; currentLocation?: { lat: number; lon: number } | null; actorId: string; actorBand: "child" | "teen" | "adult"; speakerEvidence?: SpeakerEvidence | null; present?: readonly PresentPerson[] | null; lookPeople?: number | null; haStates?: readonly HomeAssistantSceneState[]; ownHaEntityId?: string | null; now: number }): SceneObservation[] {
  const result: SceneObservation[] = [];
  result.push(...homeAssistantObservations(input.haStates ?? [], input.ownHaEntityId ?? null, input.surface, input.now));
  for (const p of input.present ?? []) {
    if (!input.speakerEvidence && p.person === input.actorId) continue;
    const sensor: SceneObservation["source"]["sensor"] = p.basis === "face" ? "face" : p.basis === "voice" || p.basis === "voice_and_face" ? "voice" : p.basis === "signed_in" ? "signed_in" : "typed";
    result.push({ id: `present-${sensor}-${input.now}-${p.person ?? "unknown"}`, source: { surface: input.surface, device_id: input.deviceId ?? null, sensor }, kind: "person_here", value: { person_id: p.person?.startsWith("person-") ? p.person : null, label: null, relation: "unknown", band: "unknown", level: p.level === "confirmed" ? "confirmed" : "tentative" }, confidence: p.level === "confirmed" ? 0.95 : 0.5, strength: p.level === "confirmed" ? "strong" : "weak", at: input.now, expires_at: input.now + SCENE_TTL[sensor as keyof typeof SCENE_TTL] });
  }
  if (input.lookPeople !== null && input.lookPeople !== undefined && input.lookPeople > 0) result.push({ id: `look-${input.now}`, source: { surface: input.surface, device_id: input.deviceId ?? null, sensor: "look" }, kind: "people_count", value: input.lookPeople, confidence: 1, strength: "strong", at: input.now, expires_at: input.now + SCENE_TTL.look });
  if (input.currentLocation) {
    const decimals = input.actorBand === "child" ? 1 : 2;
    const lat = Number(input.currentLocation.lat.toFixed(decimals));
    const lon = Number(input.currentLocation.lon.toFixed(decimals));
    result.push({ id: `gps-place-${input.now}`, source: { surface: input.surface, device_id: input.deviceId ?? null, sensor: "gps" }, kind: "place", value: { where: homeOrAway(lat, lon), setting: "unknown", area: null, precision: "area" }, confidence: 1, strength: "strong", at: input.now, expires_at: input.now + SCENE_TTL.gps });
  }
  else if (input.deviceId) result.push({ id: `signed-place-${input.now}`, source: { surface: input.surface, device_id: input.deviceId, sensor: "signed_in" }, kind: "place", value: { where: "unknown", setting: "unknown", area: null, precision: "area" }, confidence: 0.4, strength: "weak", at: input.now, expires_at: input.now + SCENE_TTL.signed_in });
  if ((input.deviceKind === "robot" || input.deviceKind === "pod") && input.deviceArea?.trim()) result.push({ id: `device-room-${input.now}`, source: { surface: input.surface, device_id: input.deviceId ?? null, sensor: "robot_room" }, kind: "room", value: { room: input.deviceArea.trim() }, confidence: 1, strength: "strong", at: input.now, expires_at: input.now + SCENE_TTL.robot_room });
  return result;
}
export function sceneCounts(scene: Scene | null | undefined) { return { people: scene?.people.length ?? 0, strong: scene?.people.filter((p) => p.basis.some((b) => b === "face" || b === "voice" || b === "signed_in" )).length ?? 0, typed: scene?.people.filter((p) => p.basis.includes("typed")).length ?? 0, place_known: !!scene?.place && scene.place.where !== "unknown", child_present: scene?.child_present ?? false, events: scene?.ambient?.events.length ?? 0 }; }
