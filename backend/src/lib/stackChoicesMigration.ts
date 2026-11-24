// STACK-MODELS-HOME-01: the one-time move of Home's old model values to the Stack (`POST /stack/v1/choices/migrate`).
// Home sends what it stored under the old keys: `engines.<role>.tier.<tier>.model`, `engines.<category>.order`, the feature switches and the added
// chat model records. The Stack takes each value or refuses it with a sentence. Nothing is deleted here: a value the Stack took is read from the
// Stack from now on (lib/stackChoiceSnapshot.ts), a value it refused stays where it was and is shown to the admin as a plain notice. The result is
// recorded once (a `system` settings row), so a second boot, a second tab or a second call sends nothing. Idempotent.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { addedModels, settingsValues } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { getHouseholdSettingSource, getHouseholdSettingValue } from "@/lib/settings";
import { forwardToStack, StackChoicesError } from "@/lib/stackChoicesForward";

const MARKER_KEY = "__migration.stack_choices_01";
/** The Stack role and the feature id the old per-role slot keys were saved under (`engines.<feature>.tier.<tier>`, renamed by lib/tierKeyMigration.ts). */
const ROLES = [["chat", "chat"], ["coding", "coding"], ["image", "pictures"], ["video", "video"], ["music", "music"], ["tts", "voice"]] as const;
const TIERS = ["reduced", "standard", "boost", "max"] as const;
/** The categories whose order Home stored (`engines.<category>.order`). */
const ORDERED = ["pictures", "video", "music"] as const;
/** Home's feature switches and the Stack role each one is. `chat.paused` is the inverse of the Stack's `enabled`. */
export const HOME_FEATURE_SWITCHES: ReadonlyArray<{ role: string; key: string; invert: boolean }> = [
  { role: "chat", key: "chat.paused", invert: true },
  { role: "video", key: "generation.video.enabled", invert: false },
  { role: "music", key: "generation.music.enabled", invert: false },
  { role: "vision", key: "vision.on_request.enabled", invert: false },
  { role: "coding", key: "coding.enabled", invert: false },
];

export interface MigrationNotice { kind: "slot" | "order" | "feature" | "added_model"; key: string; reason: string }
export interface MigrationRecord { done_at: string; accepted: number; refused: MigrationNotice[]; dismissed: boolean }

interface SlotValue { role: string; tier: (typeof TIERS)[number]; model: string }
export interface MigrateBody {
  dry_run: boolean;
  slots: SlotValue[];
  orders: Array<{ category: string; order: string[] }>;
  features: Array<{ role: string; enabled: boolean }>;
  added_models: Array<Record<string, unknown>>;
}

const stored = (key: string): unknown => (getHouseholdSettingSource(key) === undefined ? undefined : getHouseholdSettingValue(key));

/** The record a Hugging Face URL names: `https://huggingface.co/<owner>/<repo>/resolve/<revision>/<file>`. Null when the URL has another shape. */
function partsOfUrl(url: string): { repo: string; revision: string; file: string } | null {
  const match = /^https:\/\/huggingface\.co\/([^/]+\/[^/]+)\/resolve\/([^/]+)\/(.+?)(?:\?.*)?$/.exec(url);
  return match ? { repo: match[1]!, revision: match[2]!, file: decodeURIComponent(match[3]!) } : null;
}

/** Home's added chat models as the Stack's migrate body wants them; a record Home cannot describe fully is returned in `unmappable` with the reason (it stays in Home). */
function addedModelValues(): { values: Array<Record<string, unknown>>; unmappable: MigrationNotice[] } {
  const values: Array<Record<string, unknown>> = []; const unmappable: MigrationNotice[] = [];
  for (const row of db.select().from(addedModels).all()) {
    try {
      const record = JSON.parse(row.record) as { id?: string; label?: string; license?: string; origin?: string; download?: { url?: string; sha256?: string; approx_bytes?: number } };
      if (record.origin !== "added" || !record.id) continue;
      const found = record.download?.url ? partsOfUrl(record.download.url) : null;
      if (!found || !record.download?.sha256 || !record.download.approx_bytes) { unmappable.push({ kind: "added_model", key: record.id, reason: "Home does not have this model's link, checksum and size on record. Add the model again from its link." }); continue; }
      const stated = record.license && !/^not stated/i.test(record.license) ? record.license : null;
      values.push({ id: record.id, label: record.label ?? record.id, repo: found.repo, file: found.file, url: record.download.url, revision: found.revision, sha256: record.download.sha256, size_bytes: record.download.approx_bytes, licence: stated });
    } catch { unmappable.push({ kind: "added_model", key: row.id, reason: "Home could not read this model's record. Add the model again from its link." }); }
  }
  return { values, unmappable };
}

/** Everything Home stored under the old keys, as the Stack's migrate body. Only values a person set are sent (a default is not a choice). */
export function collectHomeValues(dryRun = false): { body: MigrateBody; unmappable: MigrationNotice[] } {
  const slots: SlotValue[] = [];
  for (const [role, feature] of ROLES) for (const tier of TIERS) {
    const value = stored(`engines.${feature}.tier.${tier}`) as { model?: unknown } | undefined;
    if (value && typeof value.model === "string" && value.model) slots.push({ role, tier, model: value.model });
  }
  const orders = ORDERED.flatMap((category) => { const raw = stored(`engines.${category}.order`); return Array.isArray(raw) && raw.length ? [{ category, order: raw.filter((id): id is string => typeof id === "string") }] : []; });
  const features = HOME_FEATURE_SWITCHES.flatMap(({ role, key, invert }) => { const raw = stored(key); return typeof raw === "boolean" ? [{ role, enabled: invert ? !raw : raw }] : []; });
  const added = addedModelValues();
  return { body: { dry_run: dryRun, slots, orders, features, added_models: added.values }, unmappable: added.unmappable };
}

export function readMigrationRecord(): MigrationRecord | null {
  const row = db.select({ value: settingsValues.value }).from(settingsValues).where(and(eq(settingsValues.scope, "system"), eq(settingsValues.key, MARKER_KEY))).get();
  if (!row) return null;
  try { const parsed = JSON.parse(row.value) as Partial<MigrationRecord>; return typeof parsed.done_at === "string" ? { done_at: parsed.done_at, accepted: Number(parsed.accepted) || 0, refused: Array.isArray(parsed.refused) ? parsed.refused : [], dismissed: parsed.dismissed === true } : { done_at: new Date(0).toISOString(), accepted: 0, refused: [], dismissed: true }; } catch { return null; }
}
function writeMigrationRecord(record: MigrationRecord): void {
  const values = { value: JSON.stringify(record), hlc: nextHlc(), source: "migration", setBy: null, updatedAt: new Date().toISOString() };
  db.insert(settingsValues).values({ scope: "system", key: MARKER_KEY, ...values }).onConflictDoUpdate({ target: [settingsValues.scope, settingsValues.key], set: values }).run();
}
/** The admin has read the notice. The values themselves stay in Home. */
export function dismissMigrationNotice(): void { const record = readMigrationRecord(); if (record && !record.dismissed) writeMigrationRecord({ ...record, dismissed: true }); }

let inFlight: Promise<MigrationRecord | null> | null = null;

/**
 * Sends Home's values once. Returns the recorded result, or null when the Stack could not be asked (unreachable, refused the whole call): nothing is
 * recorded then, so the next attempt sends again. A record already there is returned as it is and nothing is sent.
 */
export function ensureChoicesMigrated(): Promise<MigrationRecord | null> {
  const done = readMigrationRecord();
  if (done) return Promise.resolve(done);
  inFlight ??= (async () => {
    try {
      const { body, unmappable } = collectHomeValues();
      const answer = (await forwardToStack("POST", "/stack/v1/choices/migrate", body)).body as { already_done?: boolean; accepted?: number; refused?: Array<{ kind: MigrationNotice["kind"]; key: string; reason: string | null }>; done_at?: string | null };
      const refused: MigrationNotice[] = [...(answer.refused ?? []).map((row) => ({ kind: row.kind, key: row.key, reason: row.reason ?? "The Stack did not take this value." })), ...unmappable];
      const record: MigrationRecord = { done_at: answer.done_at ?? new Date().toISOString(), accepted: answer.accepted ?? 0, refused, dismissed: refused.length === 0 };
      writeMigrationRecord(record);
      console.log(`[ai-stack] migrated Home's model values to the Stack accepted=${record.accepted} refused=${refused.length}${answer.already_done ? " (the Stack had already done it)" : ""}`);
      return record;
    } catch (error) {
      if (!(error instanceof StackChoicesError)) throw error;
      return null;
    } finally { inFlight = null; }
  })();
  return inFlight;
}
