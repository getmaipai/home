// LIKENESS-01: the append-only history of one person's consent changes (spec LikenessConsent), and the one hook the
// settings write path calls. No import of lib/settings.ts here (it imports this file), so the record of a change is
// written by the same code that wrote the setting and cannot be skipped; the side effects of taking consent back
// (stopping waiting jobs, queuing styles for removal) register themselves in revoke.ts.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { likenessConsentEvents } from "@/db/schema";
import { newLikenessConsentId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";

export type LikenessOption = "adults" | "adult_content";
export const LIKENESS_KEY_OPTION: Record<string, LikenessOption> = { "likeness.adults": "adults", "likeness.adult_content": "adult_content" };


/** Appends one record of a change (spec LikenessConsent). Called by the settings write path, never by a route. */
export function recordConsentChange(personId: string, option: LikenessOption, state: "on" | "off", at = new Date()): void {
  const iso = at.toISOString();
  db.insert(likenessConsentEvents).values({ id: newLikenessConsentId(), personId, option, state, source: "settings", changedAt: iso, createdAt: iso, updatedAt: iso, hlc: nextHlc() }).run();
}

export interface ConsentEvent { id: string; option: LikenessOption; state: "on" | "off"; changed_at: string }

/** The person's own history, newest first. Only the person reads it. */
export function consentHistory(personId: string, limit = 50): ConsentEvent[] {
  return db.select().from(likenessConsentEvents).where(eq(likenessConsentEvents.personId, personId)).all()
    .sort((a, b) => b.changedAt.localeCompare(a.changedAt) || b.hlc.localeCompare(a.hlc))
    .slice(0, limit)
    .map((row) => ({ id: row.id, option: row.option as LikenessOption, state: row.state as "on" | "off", changed_at: row.changedAt }));
}

/** The last recorded state of one option (off when the person never changed it). */
export function lastRecordedState(personId: string, option: LikenessOption): "on" | "off" {
  const rows = db.select().from(likenessConsentEvents).where(eq(likenessConsentEvents.personId, personId)).all().filter((row) => row.option === option);
  rows.sort((a, b) => b.changedAt.localeCompare(a.changedAt) || b.hlc.localeCompare(a.hlc));
  return rows[0]?.state === "on" ? "on" : "off";
}

// ---------------------------------------------------------------- the settings write hook

export type RevokeHandler = (personId: string, option: LikenessOption) => void;
let onRevoked: RevokeHandler | null = null;
/** revoke.ts registers what happens when a person switches an option off. */
export function registerRevokeHandler(handler: RevokeHandler | null): void { onRevoked = handler; }

/** Called by lib/settings.ts after a likeness switch was written (or reset). Records the change when it really changed and runs the revoke handler for an off. Turning the first switch off also turns the second off, so a later "on" never brings adult content back unasked. Returns the second switch's reset, if there was one, for the caller to write. */
export function likenessSettingWritten(personId: string, key: string, value: unknown): { alsoReset?: string } {
  const option = LIKENESS_KEY_OPTION[key];
  if (!option) return {};
  const state: "on" | "off" = value === true ? "on" : "off";
  if (lastRecordedState(personId, option) === state) return {};
  recordConsentChange(personId, option, state);
  if (state === "off") {
    try { onRevoked?.(personId, option); } catch (error) { console.error("[likeness] revoke handler failed", error instanceof Error ? error.name : "error"); }
    if (option === "adults" && lastRecordedState(personId, "adult_content") === "on") return { alsoReset: "likeness.adult_content" };
  }
  return {};
}
