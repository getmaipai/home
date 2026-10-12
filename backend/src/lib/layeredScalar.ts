// EASE-OF-USE-01c: the resolver and the write gate for single-value settings that come in layers
// (spec `merge: override`, `layers: [band, household, person]`), today the `ease.*` comfort keys.
//
// Resolution, one key at a time: the person's own value > the household's value > the age group's
// default (`band_default`) > the key's default. A value of `preset` is kept as is here; the screen
// turns it into the resolved `ease.preset`'s number from spec/ease/presets.json.
//
// The write gate (`assertCanWriteSelfService`) is the only rule for who may write such a key:
//   - a person writes their own, a child included, and the row is stamped `self`;
//   - an owner or admin writes any other person's (not another owner's or admin's); the row is
//     stamped with the admin's id, and that stamp is the lock: the person cannot change or reset
//     the key until an admin resets it (an owner's keys are never set by another person, an admin's only by an owner);
//   - only a key the spec marks `self_service` is covered. Safety keys never carry it, so they keep
//     their own gates in settings.ts.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { settingsValues } from "@/db/schema";
import { getPersonRole, isOwnerOrAdmin } from "@/lib/access";
import type { AgeBand } from "@/lib/ageBand";
import type { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
import type { PersonRow } from "@/types";

export type ScalarLayer = "person" | "household" | "band" | "default";

export interface LayeredScalar {
  value: unknown;
  layer: ScalarLayer;
  /** True when an admin set the person's own value, so the person cannot change it. */
  locked: boolean;
}

export const SELF_STAMP = "self";
const SYSTEM_STAMP = "system";

/** A key that resolves through the person, household and age-group layers as one value. */
export function isLayeredScalar(def: SettingsKey): boolean {
  return def.scope === "person" && def.merge === "override" && (def.layers?.includes("person") ?? false);
}

/** A layered key the person changes for themselves unless an admin has locked it. */
export function isSelfService(def: SettingsKey): boolean {
  return isLayeredScalar(def) && def.self_service === true;
}

function readRow(scope: string, key: string) {
  return db.select({ value: settingsValues.value, setBy: settingsValues.setBy }).from(settingsValues)
    .where(and(eq(settingsValues.scope, scope), eq(settingsValues.key, key))).get();
}

function parse(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/** A row stamped by an admin's id (not `self`, not `system`, not unstamped) is a lock. */
export function isLockStamp(setBy: string | null | undefined): boolean {
  if (!setBy || setBy === SELF_STAMP || setBy === SYSTEM_STAMP) return false;
  // Only a live owner or admin's id locks; a removed or demoted admin's stamp, or any other writer's, does not.
  const role = getPersonRole(setBy);
  return role === "owner" || role === "admin";
}

export function resolveLayeredScalar(def: SettingsKey, personId: string, band: AgeBand): LayeredScalar {
  const own = readRow(`person:${personId}`, def.key);
  const ownValue = own ? parse(own.value) : undefined;
  if (own && ownValue?.ok) return { value: ownValue.value, layer: "person", locked: isLockStamp(own.setBy) };
  if (def.layers?.includes("household")) {
    const house = readRow("household", def.key);
    const houseValue = house ? parse(house.value) : undefined;
    if (houseValue?.ok) return { value: houseValue.value, layer: "household", locked: false };
  }
  const bandDefault = def.layers?.includes("band") ? def.band_default?.[band] : undefined;
  if (bandDefault !== undefined) return { value: bandDefault, layer: "band", locked: false };
  return { value: def.default, layer: "default", locked: false };
}

export type GateResult = { ok: true; setBy: string } | { ok: false; status: 403; error: string };

/** Who may write (or reset) a self-service key for `targetId`, and what the row is stamped with. */
export function assertCanWriteSelfService(actor: PersonRow, targetId: string, def: SettingsKey): GateResult {
  const targetRole = getPersonRole(targetId);
  if (!targetRole) return { ok: false, status: 403, error: "That person was not found. Open the person from the People page and try again." };
  if (actor.id === targetId) {
    const row = readRow(`person:${targetId}`, def.key);
    if (isLockStamp(row?.setBy)) {
      return { ok: false, status: 403, error: `A household owner or admin set "${def.label}" for you, so you can't change it here. Ask one of them to change it or unlock it.` };
    }
    return { ok: true, setBy: SELF_STAMP };
  }
  if (!isOwnerOrAdmin(actor)) {
    return { ok: false, status: 403, error: "You can only change your own ease of use settings. Open your own Settings page to change them." };
  }
  // The ladder: nobody sets another owner's keys, and only an owner sets an admin's.
  if (targetRole === "owner" || (actor.role !== "owner" && targetRole === "admin")) {
    return { ok: false, status: 403, error: "You can't change an owner's or another admin's ease of use settings. Ask that person to open their own Settings page." };
  }
  return { ok: true, setBy: actor.id };
}
