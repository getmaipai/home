// TALK-OVER-01 (docs/design/talk-over-2026-11-12.md): "Talk before I finish". The hub decides per listening session whether the
// person gets the end-of-turn acknowledgement and at which level (section 2 item 7: an adult, signed in, not a robot device, with
// the speculative start on), stamps each edge partial with the predictor's score (section 2 item 1) and sends the clip pool the
// client renders in the reply's voice (section 2 item 2). Nothing here reaches a minor, a robot or an unknown speaker (rule 0).
import type { PersonRow } from "@/lib/memoryIngestion";
import { speakerAgeBand } from "@/lib/ageBand";
import { evaluateSafety, carriesCrisisSignal } from "@/lib/safety";
import { getHouseholdSettingValue } from "@/lib/settings";
import { normalizeForSpeech } from "@maipai/spec/voice/ts/normalizeForSpeech.js";
import { ACKNOWLEDGEMENT_CLIPS } from "@/lib/replyVariation";
import { SPECULATIVE_START_KEY } from "@/lib/speculation";
import { predictTurnEnd, type TalkOverLevel, type TurnEndScore } from "@/lib/turnEnd";

export const TALK_OVER_KEY = "voice.talk_over";
export const TALK_OVER_WINDOW_KEY = "voice.talk_over_window_ms";
export const TALK_OVER_WINDOW_DEFAULT_MS = 800;
export const TALK_OVER_WINDOW_MIN_MS = 500;
export const TALK_OVER_WINDOW_MAX_MS = 1200;

export interface TalkOverGrant { level: Exclude<TalkOverLevel, "off">; window_ms: number; clips: readonly string[] }

export function talkOverLevel(): TalkOverLevel {
  const value = getHouseholdSettingValue(TALK_OVER_KEY);
  return value === "gentle" || value === "natural" ? value : "off";
}

export function talkOverWindowMs(): number {
  const value = getHouseholdSettingValue(TALK_OVER_WINDOW_KEY);
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : TALK_OVER_WINDOW_DEFAULT_MS;
  return Math.min(TALK_OVER_WINDOW_MAX_MS, Math.max(TALK_OVER_WINDOW_MIN_MS, n));
}

/** The grant for one listening session, or null when the person gets nothing (and then no field is sent at all). */
export function talkOverGrantFor(input: { actor: PersonRow; isRobot: boolean; now?: Date }): TalkOverGrant | null {
  const level = talkOverLevel();
  if (level === "off") return null;
  if (getHouseholdSettingValue(SPECULATIVE_START_KEY) !== true) return null;
  if (input.isRobot) return null;
  if (speakerAgeBand(input.actor, input.now ?? new Date()) !== "adult") return null;
  return { level, window_ms: talkOverWindowMs(), clips: ACKNOWLEDGEMENT_CLIPS.map((clip) => normalizeForSpeech(clip)) };
}

/** The edge partial's score for the client, or `none` when the deterministic floor flags the words (a crisis disclosure gets no
 * acknowledgement; section 2 item 7). The band is the adult's, since only an adult session is ever granted. */
export function scoreEdgePartial(text: string): TurnEndScore {
  const scored = predictTurnEnd(text);
  if (scored.level === "none") return scored;
  const safety = evaluateSafety(text, "adult", "message");
  if (safety.action !== "allow" || carriesCrisisSignal(safety)) return { ...scored, level: "none" };
  return scored;
}
