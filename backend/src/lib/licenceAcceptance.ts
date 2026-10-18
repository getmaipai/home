// LICENCE-ACK-01: the household's one acknowledgement of the licences of the AI models and tools Home installs.
// Stored as one row in the existing settings store (scope household, key `_licences.accepted`, the same internal-row
// pattern as `_tours.*`): who accepted, when, the terms version, and the component and licence ids it covers.
// The record names the wizard item it acknowledges ("internet") and that item's terms version.
// A licence the record covers (at the current terms version) never asks for an individual click; a licence it does not
// list (a new kind, or a changed id) still asks once, in the old per-item flow.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { settingsValues } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { LICENCE_ACK_ITEM_ID, LICENCE_TERMS_VERSION } from "../../../shared/licenceTerms";

const KEY = "_licences.accepted";
export interface LicenceAck { item_id: string; by: string; at: string; terms_version: string; component_ids: string[]; licence_ids: string[] }
export interface LicenceRef { component: string; id: string }

export function readLicenceAck(): LicenceAck | null {
  const row = db.select({ value: settingsValues.value }).from(settingsValues).where(and(eq(settingsValues.scope, "household"), eq(settingsValues.key, KEY))).get();
  if (!row) return null;
  try {
    const v = JSON.parse(row.value) as Partial<LicenceAck>;
    if (typeof v.at !== "string" || typeof v.terms_version !== "string") return null;
    return { item_id: typeof v.item_id === "string" ? v.item_id : "", by: typeof v.by === "string" ? v.by : "setup", at: v.at, terms_version: v.terms_version, component_ids: Array.isArray(v.component_ids) ? v.component_ids.filter((x): x is string => typeof x === "string") : [], licence_ids: Array.isArray(v.licence_ids) ? v.licence_ids.filter((x): x is string => typeof x === "string") : [] };
  } catch { return null; }
}

/** The acknowledgement counts only at the terms version this build ships. */
export function currentLicenceAck(): LicenceAck | null {
  const ack = readLicenceAck();
  return ack && ack.terms_version === LICENCE_TERMS_VERSION && ack.item_id === LICENCE_ACK_ITEM_ID ? ack : null;
}

/** First-run record (no owner yet, nothing listed): it covers what the plan page lists, and the wizard's Install writes that list into it. */
export const ackCovers = (ack: LicenceAck | null, licenceId: string): boolean => !!ack && (ack.licence_ids.includes(licenceId) || (ack.by === "setup" && ack.licence_ids.length === 0));
export const licenceCovered = (licenceId: string): boolean => ackCovers(currentLicenceAck(), licenceId);

/** Writes (or widens) the record. `by` is a person id, or "setup" before an owner exists. The lists only grow within one terms version. */
export function recordLicenceAck(by: string, licences: readonly LicenceRef[]): LicenceAck {
  const prior = currentLicenceAck();
  const ack: LicenceAck = {
    item_id: LICENCE_ACK_ITEM_ID, by: prior?.by ?? by, at: prior?.at ?? new Date().toISOString(), terms_version: LICENCE_TERMS_VERSION,
    component_ids: [...new Set([...(prior?.component_ids ?? []), ...licences.map((l) => l.component)])],
    licence_ids: [...new Set([...(prior?.licence_ids ?? []), ...licences.map((l) => l.id)])],
  };
  const hlc = nextHlc(); const now = new Date().toISOString();
  const value = JSON.stringify(ack);
  const exists = db.select({ k: settingsValues.key }).from(settingsValues).where(and(eq(settingsValues.scope, "household"), eq(settingsValues.key, KEY))).get();
  if (exists) db.update(settingsValues).set({ value, hlc, source: "hub", updatedAt: now }).where(and(eq(settingsValues.scope, "household"), eq(settingsValues.key, KEY))).run();
  else db.insert(settingsValues).values({ scope: "household", key: KEY, value, hlc, source: "hub", updatedAt: now }).run();
  return ack;
}

/** Hand the first-run record to the owner once the owner exists. */
export function adoptLicenceAck(personId: string): void {
  const ack = readLicenceAck();
  if (ack && ack.by === "setup") {
    const value = JSON.stringify({ ...ack, by: personId });
    db.update(settingsValues).set({ value, hlc: nextHlc(), updatedAt: new Date().toISOString() }).where(and(eq(settingsValues.scope, "household"), eq(settingsValues.key, KEY))).run();
  }
}
