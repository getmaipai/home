import type { SceneObservation } from "@maipai/spec/gen/ts/scene-observation.js";
import type { FusedScene } from "@/lib/scene";
import { speakerAgeBand } from "@/lib/ageBand";
import type { PersonRow } from "@/types";

export const SCENE_TOOL_ID = "scene";

export function sceneToolStreamArgs(args: Record<string, unknown>): { action: unknown } {
  return { action: args.action };
}

export function cleanSceneLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029<>\[\]{}|.:;,]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60).trim();
  return clean || undefined;
}

export function sceneObservations(args: Record<string, unknown>, actor: PersonRow, conversationId: string, speakerId?: string | null, now = Date.now(), roster: readonly PersonRow[] = [], scene?: FusedScene | null, surface: SceneObservation["source"]["surface"] = "chat", actorBand: "child" | "teen" | "adult" = "adult"): { observations: SceneObservation[]; line?: string } {
  const action = args.action;
  const label = cleanSceneLabel(args.label);
  const requestedId = typeof args.person_id === "string" ? args.person_id : undefined;
  const protectedIds = new Set([actor.id, speakerId].filter((id): id is string => !!id));
  const targetId = requestedId && !protectedIds.has(requestedId) ? requestedId : undefined;
  const matched = targetId ? roster.find((p) => p.id === targetId) : label ? roster.find((p) => p.displayName.toLocaleLowerCase() === label.toLocaleLowerCase()) : undefined;
  const resolvedLabel = matched?.displayName ?? label;
  const observations: SceneObservation[] = [];
  const base = { id: `typed-${now}-${Math.random().toString(36).slice(2)}`, source: { surface, device_id: null, sensor: "typed" as const }, confidence: 0.5, strength: "weak" as const, at: now, expires_at: now + 1_800_000 };
  if (action === "arrived") {
    if (requestedId && protectedIds.has(requestedId) && !label) return { observations };
    const relation = matched ? "household" : args.relation === "pet" ? "pet" : args.relation === "guest" ? "guest" : args.relation === "household" ? "unknown" : "unknown";
    const id = matched?.id ?? null;
    if (!id || !protectedIds.has(id)) observations.push({ ...base, kind: "person_here", value: { person_id: id, label: resolvedLabel ?? null, relation, band: matched ? speakerAgeBand(matched, new Date(now)) : "unknown", level: "tentative" } });
  } else if (action === "left") {
    if (!matched && (!label || label.toLocaleLowerCase() === "unknown")) return { observations, line: "I need a person's name to mark them as gone." };
    if (matched && actorBand !== "adult" && speakerAgeBand(matched, new Date(now)) === "adult") return { observations, line: "I can't mark a household adult as gone." };
    if (matched && protectedIds.has(matched.id)) return { observations, line: "I won't mark the speaker or acting account as gone." };
    const sensed = scene?.people.find((p) => (matched ? p.person_id === matched.id : resolvedLabel && p.label?.toLocaleLowerCase() === resolvedLabel.toLocaleLowerCase()) && p.basis.some((b) => b === "face" || b === "voice" || b === "signed_in"));
    if (sensed) return { observations, line: "Someone is still seen by the camera." };
    observations.push({ ...base, kind: "person_left", value: { person_id: matched?.id ?? null, label: resolvedLabel ?? null, relation: matched ? "household" : "unknown", band: matched ? speakerAgeBand(matched, new Date(now)) : "unknown", level: "tentative" } });
  } else if (action === "place") {
    if (args.where || args.setting) observations.push({ ...base, kind: "place", value: { where: args.where ?? "unknown", setting: args.setting ?? "unknown", area: null, precision: "area" } });
    if (cleanSceneLabel(args.room)) observations.push({ ...base, id: `${base.id}-room`, kind: "room", value: { room: cleanSceneLabel(args.room)! } });
  }
  return { observations };
}

export function runSceneTool(input: { actor: PersonRow; args: Record<string, unknown>; callId: string; conversationId: string; speakerId?: string | null; roster: readonly PersonRow[]; scene?: FusedScene | null; surface: SceneObservation["source"]["surface"]; actorBand: "child" | "teen" | "adult"; observe: (conversationId: string, observations: readonly SceneObservation[]) => unknown }) {
  const { observations, line } = sceneObservations(input.args, input.actor, input.conversationId, input.speakerId, Date.now(), input.roster, input.scene, input.surface, input.actorBand);
  if (observations.length) input.observe(input.conversationId, observations);
  return { callId: input.callId, packageId: SCENE_TOOL_ID, status: "succeeded" as const, via: "tool_call" as const, args: {}, result: { reply: { text: line ?? "Scene noted." }, actions: [] }, durationMs: 0 };
}
