import type { SceneObservation } from "@maipai/spec/gen/ts/scene-observation.js";
import type { FusedScene } from "@/lib/scene";
import type { PersonRow } from "@/types";
import { dismiss as suppressScene, resume as resumeScene, type SuppressionKind, type SuppressionScope } from "@/lib/sceneSuppression";
import { applyAlarmAction, listActiveSafetyAlarms } from "@/lib/safetyAlarm";
import { getDeviceById } from "@/lib/devices";
import { speakerAgeBand } from "@/lib/ageBand";

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

export function runSceneTool(input: { actor: PersonRow; args: Record<string, unknown>; callId: string; conversationId: string; speakerId?: string | null; roster: readonly PersonRow[]; scene?: FusedScene | null; surface: SceneObservation["source"]["surface"]; actorBand: "child" | "teen" | "adult"; deviceId?: string; speakerEvidence?: { person: string | null; basis: string; level: string } | null; observe: (conversationId: string, observations: readonly SceneObservation[]) => unknown }) {
  const { action } = input.args;
  if (action === "dismiss" || action === "resume" || action === "party") {
    const evidence = input.speakerEvidence;
    const confirmedAdult = input.actorBand === "adult" && ((!evidence && (input.surface === "chat" || input.surface === "phone")) ||
      (!!evidence && evidence.person === input.actor.id && evidence.level === "confirmed" && ["signed_in", "voice", "face", "voice_and_face"].includes(evidence.basis)));
    const device = input.deviceId ? getDeviceById(input.deviceId) : null;
    const room = device?.area ?? null;
    const now = Date.now();
    let line = "I couldn't change that.";
    if (action === "resume") {
      resumeScene({ personId: input.actor.id, deviceId: input.deviceId, room, byConfirmedAdult: confirmedAdult, byPersonId: input.actor.id });
      line = "Done: listening again.";
    } else if (action === "party") {
      if (!confirmedAdult) line = "Only a confirmed adult can set that household context.";
      else {
        for (const kind of ["music_or_tv", "shouting"] as const) suppressScene({ kind, scope: "household", reason: "party", personId: input.actor.id, deviceId: input.deviceId, room, now, byBand: input.actorBand, byConfirmedAdult: true });
        line = "Done: I will ignore those sounds for everyone here for four hours.";
      }
    } else {
      // A sounding hardware alarm takes precedence over every model supplied selector.
      const active = listActiveSafetyAlarms();
      const matching = room ? active.filter((alarm) => alarm.area === room) : [];
      const alarm = matching.length === 1 ? matching[0] : active.length === 1 ? active[0] : undefined;
      // A heard-sound dismissal (a kind is given) never acknowledges a sounding hardware alarm: only a dismissal with no kind is about the alarm.
      const aboutSound = typeof input.args.kind === "string" && input.args.kind.length > 0;
      if (alarm && !aboutSound) {
        if (input.args.reason === "false_alarm") line = "I can't mark a sensor alarm as a false alarm here.";
        else if (confirmedAdult) {
          const result = applyAlarmAction(input.actor.id, alarm.id, "acknowledge");
          line = result.ok ? "Done: the alarm is acknowledged." : "I couldn't dismiss that alarm.";
        } else if (input.surface === "robot" && input.deviceId && device?.kind === "robot") {
          const result = applyAlarmAction(input.actor.id, alarm.id, "quiet_here", input.deviceId);
          line = result.ok ? "Done: the alarm is quiet on this robot for you only." : "I couldn't dismiss that alarm.";
        } else line = "I couldn't dismiss that alarm for this speaker.";
      } else if (input.args.kind && typeof input.args.kind === "string") {
      const requested = input.args.scope as SuppressionScope | undefined;
      const scope: SuppressionScope = !confirmedAdult ? "self" : requested ?? (room ? "room" : "device");
      const result = suppressScene({ kind: input.args.kind as SuppressionKind, reason: input.args.reason as "media" | "handled" | "false_alarm" | "party" | "other", scope, personId: input.actor.id, deviceId: input.deviceId, room, now, byBand: input.actorBand, byConfirmedAdult: confirmedAdult });
      if (result.ok && result.until) line = `Done: I will ignore that until ${new Date(result.until).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}, ${scope === "self" ? "for you only" : scope === "household" ? "for everyone here" : scope === "room" ? "in this room" : "on this device"}.`;
      else line = "I can't set that dismissal for this speaker.";
      } else line = "There isn't one active alarm here that I can dismiss.";
    }
    return { callId: input.callId, packageId: SCENE_TOOL_ID, status: "succeeded" as const, via: "tool_call" as const, args: {}, result: { reply: { text: line }, actions: [] }, durationMs: 0 };
  }
  const { observations, line } = sceneObservations(input.args, input.actor, input.conversationId, input.speakerId, Date.now(), input.roster, input.scene, input.surface, input.actorBand);
  if (observations.length) input.observe(input.conversationId, observations);
  return { callId: input.callId, packageId: SCENE_TOOL_ID, status: "succeeded" as const, via: "tool_call" as const, args: {}, result: { reply: { text: line ?? "Scene noted." }, actions: [] }, durationMs: 0 };
}
