import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
// Per-voice settings kept in the voice's own folder of the lab voice store (meta.json, key "settings"), so each voice (and later each companion)
// carries its own stumbling level and mood strength. Missing values fall back to the lab defaults.
export const VOICE_STORE = Bun.env.LAB_VOICE_STORE ?? join(import.meta.dir, "..", "..", "..", "data-scratch", "voices", "voices_store");
export const STUMBLE_LEVELS = ["none", "light", "natural", "lively", "heavy"] as const, MOOD_STRENGTHS = ["off", "mild", "medium", "full"] as const;
export type VoiceSettings = { stumble: string; moodStrength: string };
export const defaultSettings = (): VoiceSettings => ({ stumble: Bun.env.LAB_STUMBLE ?? "natural", moodStrength: Bun.env.LAB_MOOD_STRENGTH ?? "mild" });
const safeId = (v: string) => /^[A-Za-z0-9_-]{1,64}$/.test(v);
/** The base voice of a mood variant: "casual_mild_happy" uses the settings of "casual". */
const baseOf = (voice: string, store: string) => (safeId(voice) && existsSync(join(store, voice, "meta.json")) ? voice : voice.split("_")[0]!);
export function voiceSettings(voice: string, store = VOICE_STORE): VoiceSettings {
  const d = defaultSettings(); const id = baseOf(voice, store); if (!safeId(id)) return d;
  try { const s = (JSON.parse(readFileSync(join(store, id, "meta.json"), "utf8")).settings ?? {}) as Partial<VoiceSettings>;
    return { stumble: (STUMBLE_LEVELS as readonly string[]).includes(s.stumble ?? "") ? s.stumble! : d.stumble, moodStrength: (MOOD_STRENGTHS as readonly string[]).includes(s.moodStrength ?? "") ? s.moodStrength! : d.moodStrength }; } catch { return d; }
}
export function setVoiceSettings(voice: string, patch: Partial<VoiceSettings>, store = VOICE_STORE): VoiceSettings {
  if (!safeId(voice) || !existsSync(join(store, voice, "meta.json"))) throw new Error("No such voice in the lab voice store.");
  const path = join(store, voice, "meta.json"); const meta = JSON.parse(readFileSync(path, "utf8")); const next = { ...voiceSettings(voice, store), ...patch };
  if (!(STUMBLE_LEVELS as readonly string[]).includes(next.stumble) || !(MOOD_STRENGTHS as readonly string[]).includes(next.moodStrength)) throw new Error("Unknown level.");
  meta.settings = next; writeFileSync(path, JSON.stringify(meta)); return next;
}
