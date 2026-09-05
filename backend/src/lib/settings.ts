// The settings store (platform plan 4.6): "Values by scope (household,
// person, device) with per-field last-writer-wins on the oplog;
// definitions from the registry (3.2) and from package manifests." This
// is the store and its API; the generic renderer and the UI rules in
// 6.5/6.6 are shell/kit work (chapter 6, not started).
import { eq, and, isNull, like } from "drizzle-orm";
import { db } from "@/db";
import { settingsValues, people } from "@/db/schema";
import { getRegistry, getRegistryKey } from "@/lib/settingsRegistry";
import { nextHlc, compareHlc, seedHlc } from "@/lib/hlc";
import { isOwnerOrAdmin, canAccessPerson } from "@/lib/access";
import { encryptSecret, decryptSecret } from "@/lib/secrets";
import type { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
import type { PersonRow } from "@/types";

// `CLAUDE.md` > Credentials and secrets: "Any reversible secret the app
// stores... is encrypted with the keystore... never plaintext in a
// table or JSON file." A code review (2026-09-04) found a `secret: true`
// registry key's real value went straight into `settings_values` as
// plain JSON - resolveForResponse() below already redacted it from every
// API response, but nothing encrypted it at rest, an unenforced half of
// the same rule (voice.ts's `hf_token` is the first real key that needed
// this to actually be true, not just documented). Operates on the
// SERIALIZED JSON text, not the raw value, so any value type (not just
// strings) round-trips identically whether or not the key is secret. */
function encodeForStorage(keyDef: SettingsKey, value: unknown): string {
  const serialized = JSON.stringify(value);
  return keyDef.secret ? encryptSecret(serialized) : serialized;
}

function decodeStoredRow(keyDef: SettingsKey, storedText: string): unknown {
  const jsonText = keyDef.secret ? decryptSecret(storedText) : storedText;
  return JSON.parse(jsonText);
}

export type SettingsOpResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 403; error: string };

// Recover HLC monotonicity across a restart (see lib/hlc.ts's seedHlc
// comment for the failure this prevents): seed from every hlc already on
// disk once, at module load, before any write can happen.
for (const row of db.select({ hlc: settingsValues.hlc }).from(settingsValues).all()) {
  seedHlc(row.hlc);
}

type ScopeKind = "household" | "person" | "device";

export interface ParsedScope {
  kind: ScopeKind;
  id: string | null;
}

// Matches spec/schemas/setting-value.schema.json's scope pattern exactly:
// "household", "person:<id>", or "device:<id>". Exported (not test-only:
// this is real logic worth testing on its own, the same as lib/secret.ts's
// lockoutDurationMs) since there's no person-scope key in the registry
// yet to exercise its person/device branches through the HTTP layer.
export function parseScope(scope: string): ParsedScope | null {
  if (scope === "household") return { kind: "household", id: null };
  const personMatch = /^person:([a-z0-9-]+)$/.exec(scope);
  if (personMatch) return { kind: "person", id: personMatch[1]! };
  const deviceMatch = /^device:([a-z0-9-]+)$/.exec(scope);
  if (deviceMatch) return { kind: "device", id: deviceMatch[1]! };
  return null;
}

// device:<id> has no real authorization model yet: 3.1's Device record
// type isn't built (deferred, see docs/dev.md), so there's no ownership
// or pairing concept to check against. Owner/admin only for now,
// provisional until Device exists. Exported for the same reason as
// parseScope above.
export function assertCanAccessScope(
  actor: PersonRow,
  parsed: ParsedScope,
  purpose: "read" | "write",
): SettingsOpResult<true> {
  if (parsed.kind === "household") {
    if (purpose === "read" || isOwnerOrAdmin(actor)) return { ok: true, value: true };
    return { ok: false, status: 403, error: "only owner or admin may change household settings" };
  }
  if (parsed.kind === "person") {
    if (canAccessPerson(actor, parsed.id!)) return { ok: true, value: true };
    return { ok: false, status: 403, error: "cannot access another person's settings" };
  }
  // device
  if (isOwnerOrAdmin(actor)) return { ok: true, value: true };
  return { ok: false, status: 403, error: "only owner or admin may access device settings" };
}

function validateSelectorValue(keyDef: SettingsKey, value: unknown): SettingsOpResult<true> {
  const range = keyDef.range as Record<string, unknown> | undefined;
  switch (keyDef.selector) {
    case "boolean":
      if (typeof value !== "boolean") return { ok: false, status: 400, error: "expected a boolean" };
      break;
    case "number":
    case "duration": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return { ok: false, status: 400, error: "expected a number" };
      }
      if (keyDef.selector === "duration" && value < 0) {
        return { ok: false, status: 400, error: "duration must be non-negative" };
      }
      const min = range?.min as number | undefined;
      const max = range?.max as number | undefined;
      if (min !== undefined && value < min) return { ok: false, status: 400, error: `must be >= ${min}` };
      if (max !== undefined && value > max) return { ok: false, status: 400, error: `must be <= ${max}` };
      break;
    }
    case "text":
      if (typeof value !== "string") return { ok: false, status: 400, error: "expected a string" };
      break;
    case "select": {
      const options = range?.options as unknown[] | undefined;
      if (!options || !options.includes(value)) {
        return { ok: false, status: 400, error: `must be one of ${JSON.stringify(options ?? [])}` };
      }
      break;
    }
    case "time":
      if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
        return { ok: false, status: 400, error: "expected a 24-hour HH:MM string" };
      }
      break;
    case "person": {
      if (typeof value !== "string") return { ok: false, status: 400, error: "expected a person id" };
      const exists = db
        .select({ id: people.id })
        .from(people)
        .where(and(eq(people.id, value), isNull(people.deletedAt)))
        .get();
      if (!exists) return { ok: false, status: 400, error: `unknown person: ${value}` };
      break;
    }
    case "entity":
    case "area":
    case "media":
      // No Home Assistant entity/area concept and no media library exist
      // yet (both later integrations/features); loose string validation
      // only, a documented gap until those land.
      if (typeof value !== "string") return { ok: false, status: 400, error: "expected a string" };
      break;
  }
  return { ok: true, value: true };
}

// Defined in @/wire (alias-free) so a frontend client can import the real
// shape through the @maipai/home-backend workspace dependency, the same
// pattern Roster/TurnValue/ConversationTurnRow already use (2026-09-04
// code review, shell/kit/Chat slice); re-exported here since this is
// where callers already look for it.
import type { ResolvedSetting } from "@/wire";
export type { ResolvedSetting } from "@/wire";

// CLAUDE.md > Credentials and secrets is a hard rule: "No secret value in
// ... API responses (status = present, expires, never the value)." A
// review (2026-09-04) found this had no enforcement anywhere: a
// secret:true registry key's real value went straight into every list/
// set response, an untested gap since household.locale (today's only
// key) isn't secret. Every response now goes through this before
// leaving the function, so the day a real secret-selector key (an API
// key, an OAuth token) is declared, it's covered from that key's first
// commit rather than needing its own retrofit. Exported (not test-only)
// since there's no real secret key in the registry yet to exercise this
// through the HTTP layer; tests construct a SettingsKey directly instead.
export function resolveForResponse(
  keyDef: SettingsKey,
  rawValue: unknown,
  source: ResolvedSetting["source"],
): ResolvedSetting {
  const base = { key: keyDef.key, source, label: keyDef.label, help: keyDef.help, level: keyDef.level, secret: keyDef.secret };
  if (!keyDef.secret) return { ...base, value: rawValue };
  return { ...base, value: null, isSet: source !== "default" };
}

/** Every registered key whose scope kind matches, each resolved to its
 * stored value or the registry default (4.6: a setting always has a
 * value, even before anyone customizes it). */
export function listValues(actor: PersonRow, scope: string): SettingsOpResult<ResolvedSetting[]> {
  const parsed = parseScope(scope);
  if (!parsed) return { ok: false, status: 400, error: `invalid scope: ${scope}` };
  const auth = assertCanAccessScope(actor, parsed, "read");
  if (!auth.ok) return auth;

  const stored = db.select().from(settingsValues).where(eq(settingsValues.scope, scope)).all();
  const storedByKey = new Map(stored.map((row) => [row.key, row]));

  const results: ResolvedSetting[] = getRegistry()
    .filter((k) => k.scope === parsed.kind)
    .map((k) => {
      const row = storedByKey.get(k.key);
      const rawValue = row ? decodeStoredRow(k, row.value) : k.default;
      const source = row ? (row.source as ResolvedSetting["source"]) : "default";
      return resolveForResponse(k, rawValue, source);
    });
  return { ok: true, value: results };
}

/** The validate-then-write core shared by setValue (actor-gated, every
 * person-facing write) and setHouseholdSettingValue (actor-less, for core
 * background jobs already gated elsewhere - see that function's doc).
 * Caller is responsible for scope/key/authorization checks; this only
 * validates the value against the key's selector and persists it. */
function writeValue(
  scope: string,
  keyDef: SettingsKey,
  value: unknown,
  opts: { skipValidation?: boolean } = {},
): SettingsOpResult<ResolvedSetting> {
  const key = keyDef.key;
  if (!opts.skipValidation) {
    const validated = validateSelectorValue(keyDef, value);
    if (!validated.ok) return validated;
  }

  const existing = db
    .select()
    .from(settingsValues)
    .where(and(eq(settingsValues.scope, scope), eq(settingsValues.key, key)))
    .get();

  const hlc = nextHlc();
  // Per-field last-writer-wins (7.3): a fresh local hlc is always newer
  // than whatever's stored today (no remote writer exists yet), but the
  // comparison is real, not assumed, so a future sync-originated write
  // with an independently-generated hlc resolves correctly with no
  // change to this function.
  if (existing && compareHlc(hlc, existing.hlc) <= 0) {
    return { ok: false, status: 400, error: "a newer value already exists for this key" };
  }

  const now = new Date().toISOString();
  const serialized = encodeForStorage(keyDef, value);
  if (existing) {
    db.update(settingsValues)
      .set({ value: serialized, hlc, source: "user", updatedAt: now })
      .where(and(eq(settingsValues.scope, scope), eq(settingsValues.key, key)))
      .run();
  } else {
    db.insert(settingsValues).values({ scope, key, value: serialized, hlc, source: "user", updatedAt: now }).run();
  }

  return { ok: true, value: resolveForResponse(keyDef, value, "user") };
}

export function setValue(
  actor: PersonRow,
  scope: string,
  key: string,
  value: unknown,
): SettingsOpResult<ResolvedSetting> {
  const parsed = parseScope(scope);
  if (!parsed) return { ok: false, status: 400, error: `invalid scope: ${scope}` };

  const keyDef = getRegistryKey(key);
  if (!keyDef) return { ok: false, status: 400, error: `unknown settings key: ${key}` };
  if (keyDef.scope !== parsed.kind) {
    return { ok: false, status: 400, error: `${key} is a ${keyDef.scope}-scope key, not ${parsed.kind}` };
  }

  const auth = assertCanAccessScope(actor, parsed, "write");
  if (!auth.ok) return auth;

  return writeValue(scope, keyDef, value);
}

/** Household-scope write with no actor gate: for a core background job
 * that already checked access at the HTTP route that started it
 * (modelDownloadJobs.ts's select flow runs behind requireRole("owner",
 * "admin"), same as getHouseholdSettingValue's read-side counterpart) and
 * needs to persist a result well after that request has returned. Still
 * runs the selector's own validation - a bad value here is a code bug,
 * not a hostile request, but the check is nearly free either way. Never
 * exposed through a route. */
export function setHouseholdSettingValue(key: string, value: unknown): SettingsOpResult<ResolvedSetting> {
  const keyDef = getRegistryKey(key);
  if (!keyDef) return { ok: false, status: 400, error: `unknown settings key: ${key}` };
  if (keyDef.scope !== "household") return { ok: false, status: 400, error: `${key} is a ${keyDef.scope}-scope key, not household` };
  return writeValue("household", keyDef, value);
}

/** A household setting's resolved value with no actor gate: for core
 * maintenance jobs (conversation retention, and eventually memory decay)
 * that need a real settings value but aren't acting on any one person's
 * behalf, the same way lib/scheduler.ts's core jobs call lib/memory.ts's
 * runMaintenance() directly. Never exposed through a route: a person-
 * facing read always goes through listValues()'s real authorization. */
export function getHouseholdSettingValue(key: string): unknown {
  const keyDef = getRegistryKey(key);
  if (!keyDef) return undefined;
  return resolveStoredValue("household", keyDef);
}

/** The signed-in actor's OWN person-scope setting, resolved with no
 * separate authorization check - safe by construction, not just by
 * convention: a code review (2026-09-04) found the original version took
 * a bare `personId` string, which compiled and worked for its one real
 * caller (routes/tts.ts, always `c.get("person").id`) but had no way to
 * stop a future caller from passing someone ELSE's id and silently
 * reading their setting with no 403 - the real authorization every other
 * person-scoped read in this file goes through (listValues()'s
 * assertCanAccessScope()). Taking the actor itself instead of an id
 * closes that off at the type level: there is no parameter a caller
 * could mis-supply to read anyone but themselves. */
export function getPersonSettingValue(actor: PersonRow, key: string): unknown {
  const keyDef = getRegistryKey(key);
  if (!keyDef || keyDef.scope !== "person") return undefined;
  return resolveStoredValue(`person:${actor.id}`, keyDef);
}

/** Sets the signed-in actor's own `tts.voice_id` to an arbitrary value
 * the `select` selector's fixed 26-name option list would normally
 * reject - the community voice catalog (2026-09-04, lib/voiceCatalog.ts)
 * needs this for the other ~2,000 real voices in `kyutai/tts-voices`
 * that aren't among the bundled presets. The exact same "advanced escape
 * hatch, not the generic PUT route" shape `chat.model_id`'s own registry
 * comment already describes for an identical reason
 * (`ModelsSection.tsx`'s "choose this" flow, never a plain value write):
 * `tts.voice_id` itself stays a normal, fully-`select`-validated `basic`
 * key for the common case (the settings page's own dropdown still only
 * ever offers the 26 curated presets), and this is the one, narrowly-
 * named bypass. The caller (routes/voice.ts) is entirely responsible for
 * validating `hfPath` against the real, live-fetched catalog before
 * calling this - it trusts the value completely, the same contract
 * `setHouseholdSettingValue()` already has ("caller already gated this
 * elsewhere"). */
export function setPersonTtsVoiceUnchecked(actor: PersonRow, hfPath: string): SettingsOpResult<ResolvedSetting> {
  const keyDef = getRegistryKey("tts.voice_id");
  if (!keyDef) return { ok: false, status: 400, error: "unknown settings key: tts.voice_id" };
  return writeValue(`person:${actor.id}`, keyDef, hfPath, { skipValidation: true });
}

/** Shared by getHouseholdSettingValue() and getPersonSettingValue() above
 * (a code review, 2026-09-04, found the two had drifted into
 * near-identical copies of the same lookup/default-resolution logic): the
 * one place that reads a stored value's row and falls back to the
 * registry default, given an already-resolved key definition. Each
 * public function still owns its own registry lookup and scope-kind
 * guard - only the actual row query is shared. */
function resolveStoredValue(scope: string, keyDef: SettingsKey): unknown {
  const row = db
    .select()
    .from(settingsValues)
    .where(and(eq(settingsValues.scope, scope), eq(settingsValues.key, keyDef.key)))
    .get();
  return row ? decodeStoredRow(keyDef, row.value) : keyDef.default;
}

/** Reset a key back to its registry default: a real delete (this table
 * makes no "never hard-deletes" promise the way memory does; there's no
 * history to preserve for a settings reset, 6.6 Rule 6). Returns the
 * resolved default, symmetric with setValue's return - a code review
 * (2026-09-04) found the earlier `{ok: true, value: true}` shape forced
 * every caller into a second round trip (a full list re-fetch) just to
 * learn the value it already knew was the registry default. */
export function resetValue(actor: PersonRow, scope: string, key: string): SettingsOpResult<ResolvedSetting> {
  const parsed = parseScope(scope);
  if (!parsed) return { ok: false, status: 400, error: `invalid scope: ${scope}` };
  const keyDef = getRegistryKey(key);
  if (!keyDef) return { ok: false, status: 400, error: `unknown settings key: ${key}` };

  const auth = assertCanAccessScope(actor, parsed, "write");
  if (!auth.ok) return auth;

  db.delete(settingsValues).where(and(eq(settingsValues.scope, scope), eq(settingsValues.key, key))).run();
  return { ok: true, value: resolveForResponse(keyDef, keyDef.default, "default") };
}

/** Clears every stored value at `key`, across every scope, whose stored
 * JSON text contains `valueContains` - for cross-cutting cleanup when
 * something a setting referenced was deleted out from under it (a code
 * review, 2026-09-04, found lib/clonedVoices.ts's deleteClonedVoice()
 * reaching directly into `settingsValues` with a hand-rolled delete: no
 * real invariant this table enforces on a DELETE - no HLC stamp, no
 * encode/decode-for-storage, both write-only concerns - is skipped by
 * that raw query, but a second such need would have re-hand-rolled it a
 * second time). No actor gate, deliberately: unlike resetValue()/
 * setValue(), the caller isn't resetting their OWN setting - it's
 * cleaning up EVERY person's setting that referenced something that no
 * longer exists, and the caller (deleteClonedVoice's own creator/owner-
 * admin check) already owns the authorization for the thing being
 * deleted, not for touching settings directly. A substring match (SQL
 * LIKE), not an exact one, so the caller never needs to know or rebuild
 * whatever host/port a value happened to be resolved against when it was
 * first written - only that a stable, unique piece of it (a real id) is
 * still there. */
export function clearMatchingValues(key: string, valueContains: string): void {
  db.delete(settingsValues)
    .where(and(eq(settingsValues.key, key), like(settingsValues.value, `%${valueContains}%`)))
    .run();
}
