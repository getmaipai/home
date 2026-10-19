// Personal bearer keys. Wire records use spec api-key; secret material stays here.
import crypto from "node:crypto";
import { isIP } from "node:net";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { apiKeys, people } from "@/db/schema";
import { hashApiKeySecret } from "@/lib/secret";
import { newApiKeyId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { effectivePermissions } from "@/lib/permissions";
import { getHouseholdSettingValue, getPersonSettingValue } from "@/lib/settings";
import type { PersonRow } from "@/types";

export type ApiKeyScope = "turn" | "code";
export type KeyOrigin = { place: "home_network" | "away"; address: string };
type KeyRow = typeof apiKeys.$inferSelect;
const DAY = 86_400_000;
export const API_KEY_REFUSAL = "This key is not valid or its access has changed. Check its expiry and permissions in Settings, or make a new key.";
export const CreateApiKeyInput = z.object({
  name: z.string().trim().min(1).max(60),
  scopes: z.array(z.enum(["turn", "code"])).min(1).max(2).refine(s => new Set(s).size === s.length),
  expires_in_days: z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(365)]).default(90),
}).strict();

/** Classifies a peer address for "last used from". Anything that is not an IP literal is not recorded. */
export function keyOriginOf(address: string | undefined | null): KeyOrigin | undefined {
  if (!address) return undefined;
  const plain = address.replace(/^::ffff:/i, "");
  const kind = isIP(plain);
  if (!kind) return undefined;
  const p = plain.toLowerCase();
  const v4 = kind === 4 ? plain.split(".").map(Number) : [];
  const home = kind === 4
    ? v4[0] === 10 || v4[0] === 127 || (v4[0] === 169 && v4[1] === 254) || (v4[0] === 192 && v4[1] === 168) || (v4[0] === 172 && v4[1]! >= 16 && v4[1]! <= 31)
    : p === "::1" || p.startsWith("fc") || p.startsWith("fd") || p.startsWith("fe80:");
  return { place: home ? "home_network" : "away", address: plain };
}

export function constantTimeHashEqual(left: string, right: string): boolean {
  // All digests are fixed-size. Unknown ids still go through the same comparison.
  const a = Buffer.from(left, "hex"); const b = Buffer.from(right, "hex");
  return a.length === 32 && b.length === 32 && crypto.timingSafeEqual(a, b);
}

/** Four characters from inside the random part. The last base32 character carries only one bit, so it is left out. */
function hintOf(secret: string): string { return secret.slice(-5, -1); }
function usable(row: KeyRow): "revoked" | "expired" | null {
  if (row.revokedAt || row.status === "revoked") return "revoked";
  return Date.parse(row.expiresAt) <= Date.now() ? "expired" : null;
}
/** Why a person may not use a coding key right now. "ok" is the only admission; the rest name the plain reply the gateway gives. */
export type CodeAdmission = "ok" | "not_allowed" | "keys_off" | "coding_off" | "coding_paused";
/** The person's controls read NOW, every call: nothing is cached on the key, so a key never widens after a controls change. */
export function codeAdmission(person: PersonRow): CodeAdmission {
  if (person.deletedAt || !person.enabled || person.memorializedAt || person.role === "guest") return "not_allowed";
  if (getHouseholdSettingValue("coding.enabled") !== true) return "coding_off";
  if (getHouseholdSettingValue("coding.paused") === true) return "coding_paused";
  const effect = effectivePermissions(person.id).find(p => p.action === "use:code")?.effect;
  if (effect === "deny") return "not_allowed";
  const minor = person.role === "child" || person.role === "teen";
  if ((minor || getHouseholdSettingValue("coding.adults_by_default") !== true) && effect !== "allow") return "not_allowed";
  return getPersonSettingValue(person, "coding.person.api_keys") === true ? "ok" : "keys_off";
}
function mayHoldKey(person: PersonRow, scope: ApiKeyScope): boolean {
  if (person.deletedAt) return false;
  if (scope === "turn") return true; // Preserve the interim voice token's admission rules.
  return codeAdmission(person) === "ok";
}
function status(row: KeyRow, person: PersonRow): KeyRow["status"] {
  const dead = usable(row);
  if (dead) return dead;
  // The wire status shows suspended when any scope is held back; admission below checks only the scope asked for.
  return row.scopes.every(s => mayHoldKey(person, s)) ? "active" : "suspended";
}
function wire(row: KeyRow, person: PersonRow) {
  return { id: row.id, person_id: row.personId, name: row.name, scopes: row.scopes,
    created_at: row.createdAt, expires_at: row.expiresAt, revoked_at: row.revokedAt,
    status: status(row, person), last_used_at: row.lastUsedAt, last_used_from: row.lastUsedFrom,
    limits: row.limits, hint: row.hint, provenance: row.provenance, hlc: row.hlc };
}
export function listApiKeys(person: PersonRow) {
  return db.select().from(apiKeys).where(eq(apiKeys.personId, person.id)).all().map(r => wire(r, person));
}
/** Explicit whitelist: administrative reads carry no name, hint or activity. */
export function listApiKeysForAdmin(person: PersonRow) {
  return listApiKeys(person).map(k => ({ id: k.id, person_id: k.person_id, scopes: k.scopes,
    status: k.status, created_at: k.created_at, expires_at: k.expires_at, revoked_at: k.revoked_at }));
}
function base32(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, buffer = 0, result = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; result += alphabet[(buffer >>> bits) & 31]; }
  }
  if (bits) result += alphabet[(buffer << (5 - bits)) & 31];
  return result;
}
export function createApiKey(person: PersonRow, input: z.input<typeof CreateApiKeyInput>, compatibility = false) {
  const body = CreateApiKeyInput.safeParse(input);
  if (!body.success) throw new Error("The key details are invalid. Use a name of 1 to 60 characters, turn or code scopes, and 7, 30, 90 or 365 days.");
  const { name, scopes, expires_in_days: days } = body.data;
  if (!scopes.every(s => mayHoldKey(person, s))) throw new Error("Keys are not allowed with your current access. Ask an admin to check your Coding access in Settings.");
  // Design 3.7 rule 9: the minor limits (30 days, 3 keys) are coding limits. A voice (turn) key keeps the ordinary rules.
  const minor = person.role === "child" || person.role === "teen";
  const codeKey = scopes.includes("code");
  if (minor && codeKey && days > 30) throw new Error("A child's or teen's coding key lasts at most 30 days. Choose 7 or 30 days.");
  pruneLegacyApiKeyHashes();
  return db.transaction(() => {
    // Count suspended keys too, so turning Coding off cannot bypass the cap.
    const live = listApiKeys(person).filter(k => k.status !== "expired" && k.status !== "revoked");
    if (live.length >= 10 || (minor && codeKey && live.filter(k => k.scopes.includes("code")).length >= 3)) throw new Error("You have reached your key limit. Revoke a key before making another.");
    const id = newApiKeyId();
    const secret = `maipai_${id}_${base32(crypto.randomBytes(32))}`;
    const at = new Date().toISOString();
    const rpm = getHouseholdSettingValue("coding.api.rate_per_minute");
    const row = db.insert(apiKeys).values({ id, personId: person.id, name, scopes, createdAt: at,
      expiresAt: new Date(Date.now() + days * DAY).toISOString(), status: "active", hint: hintOf(secret),
      limits: { requests_per_minute: typeof rpm === "number" && Number.isInteger(rpm) && rpm > 0 ? rpm : 60 },
      secretHash: hashApiKeySecret(secret), compatibility, provenance: "Created in Settings", hlc: nextHlc(), updatedAt: at,
    }).returning().get();
    return { key: wire(row, person), secret };
  });
}
export function renameApiKey(personId: string, id: string, name: string): boolean {
  if (!name.trim() || name.trim().length > 60) throw new Error("The key name must have 1 to 60 characters. Enter a shorter name.");
  return db.update(apiKeys).set({ name: name.trim(), updatedAt: new Date().toISOString(), hlc: nextHlc() })
    .where(and(eq(apiKeys.personId, personId), eq(apiKeys.id, id))).returning({ id: apiKeys.id }).all().length > 0;
}
export function revokeApiKey(personId: string, id: string): boolean {
  const at = new Date().toISOString();
  return db.update(apiKeys).set({ revokedAt: at, status: "revoked", legacyHash: null, updatedAt: at, hlc: nextHlc() })
    .where(and(eq(apiKeys.personId, personId), eq(apiKeys.id, id))).returning({ id: apiKeys.id }).all().length > 0;
}
/** What a bearer secret resolved to. `invalid` covers every case where the secret itself does not open a key (unknown, wrong, expired, revoked, wrong scope), so
 * those cannot be told apart; the other refusals are only reachable by someone holding a real secret. */
export type ApiKeyOutcome =
  | { ok: true; person: PersonRow; key: { id: string; limits: KeyRow["limits"] } }
  | { ok: false; reason: "invalid" | Exclude<CodeAdmission, "ok"> };
export function resolveApiKeyOutcome(secret: string, scope: ApiKeyScope, origin?: KeyOrigin): ApiKeyOutcome {
  const invalid = { ok: false, reason: "invalid" } as const;
  if (secret.length > 256) return invalid;
  const digest = hashApiKeySecret(secret);
  const match = /^maipai_(key_[a-z0-9]{6,})_[A-Z2-7]{52}$/.exec(secret);
  let row: KeyRow | undefined;
  let legacy = false;
  if (match) row = db.select().from(apiKeys).where(eq(apiKeys.id, match[1]!)).get();
  else if (/^maipai_[a-f0-9]{64}$/.test(secret)) {
    // Old credentials have no id. After upgrade only the peppered digest is searchable.
    row = db.select().from(apiKeys).where(and(eq(apiKeys.legacyFormat, true), eq(apiKeys.secretHash, digest))).get();
    if (!row) {
      const oldDigest = crypto.createHash("sha256").update(secret).digest("hex");
      row = db.select().from(apiKeys).where(and(eq(apiKeys.legacyFormat, true), eq(apiKeys.legacyHash, oldDigest))).get();
      legacy = !!row && constantTimeHashEqual(oldDigest, row.legacyHash!);
    }
  }
  const valid = constantTimeHashEqual(digest, row?.secretHash ?? "0".repeat(64));
  if (!row || (!valid && !legacy)) return invalid;
  const person = db.select().from(people).where(eq(people.id, row.personId)).get() as PersonRow | undefined;
  if (!person || person.deletedAt || !row.scopes.includes(scope) || usable(row)) return invalid;
  if (scope === "code") {
    const admission = codeAdmission(person);
    if (admission !== "ok") return { ok: false, reason: admission };
  }
  const at = new Date().toISOString();
  if (legacy || !row.lastUsedAt || Date.now() - Date.parse(row.lastUsedAt) >= 60_000) {
    db.update(apiKeys).set({ lastUsedAt: at, ...(origin ? { lastUsedFrom: origin } : {}),
      ...(legacy ? { secretHash: digest, legacyHash: null, hint: hintOf(secret) } : {}), updatedAt: at, hlc: nextHlc(),
    }).where(eq(apiKeys.id, row.id)).run();
  }
  return { ok: true, person, key: { id: row.id, limits: row.limits } };
}
/** The same admission again for a key already accepted, read fresh: a request that waited in a queue is checked before it is sent on. `role` is the role it was accepted with. */
export function recheckCodeKey(keyId: string, role: string): "ok" | "invalid" | Exclude<CodeAdmission, "ok"> {
  const row = db.select().from(apiKeys).where(eq(apiKeys.id, keyId)).get();
  if (!row || usable(row) || !row.scopes.includes("code")) return "invalid";
  const person = db.select().from(people).where(eq(people.id, row.personId)).get() as PersonRow | undefined;
  if (!person || person.deletedAt) return "invalid";
  return person.role !== role ? "not_allowed" : codeAdmission(person);
}
export function resolveApiKey(secret: string, scope: ApiKeyScope, origin?: KeyOrigin): PersonRow | null {
  const outcome = resolveApiKeyOutcome(secret, scope, origin);
  return outcome.ok ? outcome.person : null;
}
/** Compatibility endpoints rotate only the former single voice token, not named keys. It keeps the old 365-day lifetime for everyone. */
export function issueApiToken(personId: string): string {
  const person = db.select().from(people).where(eq(people.id, personId)).get() as PersonRow;
  return db.transaction(() => {
    revokeApiToken(personId);
    return createApiKey(person, { name: "Voice and Home Assistant", scopes: ["turn"],
      expires_in_days: 365 }, true).secret;
  });
}
export function revokeApiToken(personId: string): void {
  for (const row of db.select().from(apiKeys).where(and(eq(apiKeys.personId, personId), eq(apiKeys.compatibility, true))).all()) revokeApiKey(personId, row.id);
}
/** Lazily erase unpeppered transition digests after their 90-day window. */
export function pruneLegacyApiKeyHashes(): void {
  const now = Date.now();
  for (const row of db.select().from(apiKeys).where(isNotNull(apiKeys.legacyHash)).all()) {
    if (Date.parse(row.expiresAt) <= now) db.update(apiKeys).set({ legacyHash: null, updatedAt: new Date(now).toISOString(), hlc: nextHlc() }).where(eq(apiKeys.id, row.id)).run();
  }
}
/** Ends every key a person holds: the person is deleted, memorialised or otherwise loses access altogether. */
export function revokeAllApiKeys(personId: string): void {
  const at = new Date().toISOString();
  db.update(apiKeys).set({ revokedAt: at, status: "revoked", legacyHash: null, updatedAt: at, hlc: nextHlc() })
    .where(and(eq(apiKeys.personId, personId), isNull(apiKeys.revokedAt))).run();
}
