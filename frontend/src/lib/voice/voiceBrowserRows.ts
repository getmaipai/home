import type { PersonRosterEntry, Roster, StackVoice } from "@/lib/api";

// Engine and product names never reach a person's screen (owner, 2026-10-17):
// this is the one place a voice gets its plain name and its description.
const ENGINE_WORDS = /\b(chatterbox|pocket|orpheus|mlx|turbo|tts)\b/gi;
const isUnknown = (value: unknown): value is "unknown" | "" | undefined => typeof value !== "string" || !value.trim() || value.trim() === "unknown";
const titleCase = (text: string) => text.replace(/[-_]+/g, " ").trim().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

export function voiceFriendlyName(voice: Pick<StackVoice, "id" | "name">): string {
  if (!isUnknown(voice.name)) {
    const cleaned = voice.name.replace(ENGINE_WORDS, "").replace(/\s+/g, " ").trim();
    if (cleaned) return titleCase(cleaned);
    return "Default";
  }
  const last = voice.id.split(/[-_/]/).filter(Boolean).pop() ?? voice.id;
  return titleCase(last.replace(ENGINE_WORDS, "")) || "Default";
}

/** Only a real descriptor from the catalog; "unknown" and engine talk are dropped. */
export function voiceDescription(voice: Pick<StackVoice, "description">): string | null {
  return isUnknown(voice.description) || /chatterbox|pocket|orpheus|mlx|\btts\b/i.test(voice.description) ? null : voice.description.trim();
}

export function presetNameForVoice(id: unknown, options: readonly string[]): string | null {
  if (typeof id !== "string") return null;
  return options.find((option) => id === option || id.endsWith(`-${option}`)) ?? null;
}

/** Settings targets mirror canAccessPerson: self plus children for owners/admins. */
export function voiceTargets(roster: readonly PersonRosterEntry[], actor: Roster): Array<Roster | PersonRosterEntry> {
  if (actor.role !== "owner" && actor.role !== "admin") return [];
  return [actor, ...roster.filter((person) => person.id !== actor.id && person.role === "child")];
}

/** Every preset voice the engine offers. A voice not yet downloaded still counts: the Stack installs it the first
 * time it is previewed or spoken (the live Stack lists 26 presets with only one on disk). */
export function playableVoices(rows: readonly StackVoice[]): StackVoice[] {
  return rows.filter((voice) => voice.source === "preset");
}

/** A stored voice that is not on the list still gets its plain name. */
export function storedVoiceName(stored: string): string {
  return voiceFriendlyName({ id: stored, name: "unknown" });
}

/** The saved value meaning "whatever voice the speech engine in use has built in" (backend VOICE_ENGINE_DEFAULT). */
export const ENGINE_DEFAULT_VALUE = "default";

export interface VoiceOption { id: string; value: string; label: string; engine: string | null; voice: StackVoice | null }
export interface VoiceChoices { options: VoiceOption[]; selected: VoiceOption; notice: string | null }

/** The one dropdown's contents (VOICE-PICK-01). The first option is always the voice in use when nothing else is
 * picked, so the speaking voice is never missing from the list. A saved voice the engine in use does not offer falls
 * back to it with one plain line; the list is never a dead select. Voices of more than one engine are kept together,
 * the engine in use first. `presetOptions` are the saved names the settings registry accepts. */
export function voiceChoices(voices: readonly StackVoice[], stored: string | null, presetOptions: readonly string[]): VoiceChoices {
  const fromEngineDefault = (voice: StackVoice) => presetNameForVoice(voice.id, [ENGINE_DEFAULT_VALUE]) === ENGINE_DEFAULT_VALUE;
  const defaultVoice = voices.find(fromEngineDefault) ?? null;
  const first: VoiceOption = { id: ENGINE_DEFAULT_VALUE, value: ENGINE_DEFAULT_VALUE, label: "Default voice", engine: defaultVoice?.engine ?? null, voice: defaultVoice };
  const others = voices.filter((voice) => !fromEngineDefault(voice)).map<VoiceOption>((voice) => ({
    id: voice.id, value: presetNameForVoice(voice.id, presetOptions.filter((name) => name !== ENGINE_DEFAULT_VALUE)) ?? voice.id, label: voiceFriendlyName(voice), engine: voice.engine ?? null, voice,
  }));
  const engineOrder = [...new Set(others.map((option) => option.engine ?? ""))];
  others.sort((a, b) => engineOrder.indexOf(a.engine ?? "") - engineOrder.indexOf(b.engine ?? ""));
  const options = [first, ...others];
  if (!stored || stored === ENGINE_DEFAULT_VALUE) return { options, selected: first, notice: null };
  const hit = others.find((option) => option.value === stored || option.id === stored || presetNameForVoice(option.id, [stored]) === stored);
  if (hit) return { options, selected: hit, notice: null };
  // An address (catalog or recorded voice) that is not on the list is also set aside, by its plain name.
  return { options, selected: first, notice: `${storedVoiceName(stored)} is not available with this engine, using the default voice.` };
}

/** The Stack voice id the Test button plays for an option. The default voice plays the engine's own default: its
 * listed voice, or Pocket's "alba" (what it speaks with nothing chosen), or the first voice offered. */
export function previewIdFor(option: VoiceOption, voices: readonly StackVoice[]): string | null {
  if (option.voice) return option.voice.id;
  return (voices.find((voice) => presetNameForVoice(voice.id, ["alba"]) === "alba") ?? voices[0])?.id ?? null;
}
