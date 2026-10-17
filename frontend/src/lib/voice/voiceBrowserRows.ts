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

/** The voices the engine can play right now: installed presets, one flat list.
 * A child's list is the same preset-only list an adult choosing for them sees. */
export function playableVoices(rows: readonly StackVoice[]): StackVoice[] {
  return rows.filter((voice) => voice.source === "preset" && voice.onDisk);
}
