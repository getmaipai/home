import type { PersonRosterEntry, Roster, StackVoice } from "@/lib/api";

export interface VoiceRow extends Record<string, unknown> {
  id: string; name: string; description: string; language: string; country: string;
  languageCountry: string; gender: string; source: string; installed: string;
}
export interface VoiceFilters { language: string; country: string; gender: string; source: string }
const unknown = (value: unknown) => typeof value === "string" && value.trim() ? value : "unknown";

export function toVoiceRow(v: StackVoice): VoiceRow {
  const language = unknown(v.language); const country = unknown(v.country);
  return { id: v.id, name: unknown(v.name), description: unknown(v.description), language, country, languageCountry: `${language} / ${country}`, gender: unknown(v.gender), source: unknown(v.source), installed: v.onDisk ? "Installed" : "Not installed" };
}

export function distinctFilterValues(rows: readonly VoiceRow[]) {
  const values = (key: keyof VoiceRow) => [...new Set(rows.map((row) => String(row[key])))].sort((a, b) => a.localeCompare(b));
  return { language: values("language"), country: values("country"), gender: values("gender"), source: values("source") };
}

export function applyVoiceFilters(rows: readonly VoiceRow[], filters: VoiceFilters): VoiceRow[] {
  return rows.filter((row) => (filters.language === "__all" || row.language === filters.language) && (filters.country === "__all" || row.country === filters.country) && (filters.gender === "__all" || row.gender === filters.gender) && (filters.source === "__all" || row.source === filters.source));
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

/** A child's list remains preset-only even when an adult is choosing for them. */
export function listForTarget(rows: readonly StackVoice[], target: Roster | PersonRosterEntry): StackVoice[] {
  return target.role === "child" ? rows.filter((voice) => voice.source === "preset") : [...rows];
}
