import { quietHours } from "@/lib/notifications";
import { heardSongFor } from "@/lib/music/heardSong";
import type { PersonRow } from "@/types";

export type SoundThreshold = "normal" | "raised" | "ignore";
export type SoundKind = "music_or_tv" | "glass_breaking" | "shouting" | string;
export type AutoState = "media_playing" | "call_in_progress" | "quiet_hours" | "away";
const MEDIA_TAIL_MS = 2 * 60_000;
const mediaStoppedAt = new Map<string, number>();
const activeCalls = new Set<string>();
const observedPlaying = new Set<string>();

/** Playback is read from Home's existing per-robot now-playing projection; the tail is process-local. */
export function mediaPlaying(deviceId: string, now = Date.now()): boolean {
  const current = heardSongFor(deviceId, now);
  if (current?.source === "home" && current.nowPlaying) { observedPlaying.add(deviceId); mediaStoppedAt.delete(deviceId); return true; }
  if (!observedPlaying.has(deviceId)) return false;
  if (!mediaStoppedAt.has(deviceId)) mediaStoppedAt.set(deviceId, now);
  const stoppedAt = mediaStoppedAt.get(deviceId)!;
  if (now - stoppedAt >= MEDIA_TAIL_MS) { mediaStoppedAt.delete(deviceId); return false; }
  return true;
}

/** Voice session integration point. No active duplex/session registry is currently exposed by the hub. */
export function setCallInProgress(deviceId: string, active: boolean): void {
  if (active) activeCalls.add(deviceId); else activeCalls.delete(deviceId);
}
export function callInProgress(deviceId: string): boolean { return activeCalls.has(deviceId); }

export function soundThresholdFor(kind: SoundKind, deviceId: string, _room: string | null | undefined, now = Date.now()): SoundThreshold {
  // Emergency and sensor events are invariant under all automatic context states.
  if (["smoke_alarm", "co_alarm", "siren", "glass_breaking", "smoke", "co", "gas", "leak", "temperature", "alarm_panel"].includes(kind)) return "normal";
  if (!mediaPlaying(deviceId, now)) return "normal";
  if (kind === "music_or_tv") return "ignore";
  if (kind === "glass_breaking" || kind === "shouting") return "raised";
  return "normal";
}
export function offersAllowed(deviceId: string, _now = Date.now()): boolean { return !callInProgress(deviceId); }
export function notableToNotificationOnly(personOwnPlace: "home" | "away" | "unknown" | null, now = Date.now(), actor?: PersonRow): boolean {
  if (actor && quietHours(actor, new Date(now)).active) return true;
  return personOwnPlace === "away";
}
export function automaticStates(input: { deviceId: string; room?: string | null; actor?: PersonRow; ownPlace?: "home" | "away" | "unknown" | null; now?: number }): Set<AutoState> {
  const now = input.now ?? Date.now();
  const states = new Set<AutoState>();
  if (mediaPlaying(input.deviceId, now)) states.add("media_playing");
  if (callInProgress(input.deviceId)) states.add("call_in_progress");
  if (input.actor && quietHours(input.actor, new Date(now)).active) states.add("quiet_hours");
  if (input.ownPlace === "away") states.add("away");
  return states;
}
export function __resetSceneAutoStatesForTests(): void { mediaStoppedAt.clear(); activeCalls.clear(); observedPlaying.clear(); }
