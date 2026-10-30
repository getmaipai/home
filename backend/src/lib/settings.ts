// The settings store (platform plan 4.6): "Values by scope (household,
// person, device) with per-field last-writer-wins on the oplog;
// definitions from the registry (3.2) and from package manifests." This
// is the store and its API; the generic renderer and the UI rules in
// 6.5/6.6 are shell/kit work (chapter 6, not started).
import { TierSlot } from "@maipai/spec/gen/ts/tier-slot.js";
import { checkTierSlotOptions } from "@maipai/spec/records/ts/tierSlot.js";
import { checkFeedAddressBox } from "@/lib/shelf/feedAddresses";
import { eq, and, isNull, like } from "drizzle-orm";
import { db } from "@/db";
import { settingsValues, people, entities } from "@/db/schema";
import { getRegistry, getRegistryKey, registerStoredHouseholdReader } from "@/lib/settingsRegistry";
import { calledAdminForOwnSettings } from "@/lib/relationships";
import { nextHlc, compareHlc, seedHlc } from "@/lib/hlc";
import { isOwnerOrAdmin, canAccessPerson, getPersonRole } from "@/lib/access";
import { encryptSecret, decryptSecret } from "@/lib/secrets";
import { speakerAgeBand, type AgeBand } from "@/lib/ageBand";
import { safeSearchDefaultFor, safeSearchStrictness, type SafeSearchLevel } from "@/lib/safeSearch";
import { PERSON_STORAGE_CAP_KEY } from "@/settings/storageKeys";
import { WAKEWORD_SETTING_KEY } from "@/settings/wakewordKeys";
import { VOICE_ENGINE_DEFAULT, VOICE_PRESET_NAMES } from "@/settings/voiceKeys";
import type { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
import { BLOCKLIST_KEYS } from "@/lib/blocklists/policy";
import { blocklistStatusNote } from "@/lib/blocklists/status";
import { describeSetting } from "@maipai/spec/interpreters/ts/describeSetting.js";
import type { PersonRow } from "@/types";
import { newEntityId } from "@/lib/id";
import { assertCanWriteSelfService, isLayeredScalar, isSelfService, resolveLayeredScalar } from "@/lib/layeredScalar";
import { LIVE_PERSONA_IDS } from "@/lib/personaIds";

const HOUSEHOLD_HOME_KEY = "household.home";
const ROBOT_FIRMWARE_INSTALLED_KEY = "robot.firmware.installed";
const COMPANIONS_ALLOWED_KEY = "companions.allowed";
const COMPANIONS_PERMISSION_ERROR = "Only a household owner or admin chooses who can use AI companions. Ask one of them.";

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

// Generic device settings remain owner/admin-only. Adult access to the
// wakeword opt-in is granted separately at that key's boundary below.
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

function assertCanAccessWakewordDeviceSetting(actor: PersonRow): SettingsOpResult<true> {
  if (isOwnerOrAdmin(actor) || actor.role === "adult") return { ok: true, value: true };
  return { ok: false, status: 403, error: "only a household adult may access the wakeword setting" };
}

export function assertCanSetTtsVoice(actor: PersonRow, targetId: string): SettingsOpResult<true> {
  const targetRole = getPersonRole(targetId);
  if (!targetRole) return { ok: false, status: 403, error: "That person cannot choose a voice here. Ask the person who manages Home to check the household profiles." };
  if (actor.id === targetId) {
    if (targetRole === "child") return { ok: false, status: 403, error: "A parent chooses your voice. Ask the person who manages Home to pick one for you." };
    return { ok: true, value: true };
  }
  if (isOwnerOrAdmin(actor) && targetRole === "child") return { ok: true, value: true };
  return { ok: false, status: 403, error: "That person chooses their own voice. Only they can change it." };
}

/** Voice print enrollment is a guardian choice for a child and a self choice
 * for teens and adults, as declared by the shared settings registry. */
function assertCanSetVoicePrintEnrollment(actor: PersonRow, targetId: string): SettingsOpResult<true> {
  const targetRole = getPersonRole(targetId);
  if (!targetRole) return { ok: false, status: 403, error: "cannot access another person's settings" };
  if (actor.id === targetId) {
    if (targetRole === "child") return { ok: false, status: 403, error: "A parent must agree before a child's voice pattern is saved." };
    return { ok: true, value: true };
  }
  if (isOwnerOrAdmin(actor) && targetRole === "child") return { ok: true, value: true };
  return { ok: false, status: 403, error: "Only a person can choose voice print enrollment for themselves, or a parent for a child." };
}

function assertCanSetPhotoUploads(actor: PersonRow, targetId: string): SettingsOpResult<true> {
  const targetRole = getPersonRole(targetId);
  if (!targetRole) return { ok: false, status: 403, error: "cannot access another person's settings" };
  if (actor.id === targetId) {
    if (targetRole === "child") return { ok: false, status: 403, error: "a household adult must change a child's photo setting" };
    return { ok: true, value: true };
  }
  if (isOwnerOrAdmin(actor) && (targetRole === "child" || targetRole === "teen")) return { ok: true, value: true };
  return { ok: false, status: 403, error: "only a household adult may change a minor's photo setting" };
}

/** ANSWER-IMG-02's `reference.images`: a child never changes their own (off
 * until a household adult turns it on); a teen and an adult change only their
 * own (teens' settings stay private, owner ruling 2026-09-30); an owner or
 * admin may change a child's. */
function assertCanSetAnswerPictures(actor: PersonRow, targetId: string): SettingsOpResult<true> {
  const targetRole = getPersonRole(targetId);
  if (!targetRole) return { ok: false, status: 403, error: "cannot access another person's settings" };
  if (actor.id === targetId) {
    if (targetRole === "child") return { ok: false, status: 403, error: "a household adult must change a child's picture setting" };
    return { ok: true, value: true };
  }
  if (isOwnerOrAdmin(actor) && targetRole === "child") return { ok: true, value: true };
  return { ok: false, status: 403, error: "only a household adult may change a child's picture setting, and only a teen changes their own" };
}

/** MINOR-TOPICS-01e: a child's sensitive-subject levels (`topics.*` person keys) are set by a household
 * owner or admin on the child's page and nowhere else. A child never changes their own, no key exists
 * for a teen (the teen levels are the two household rows), and an adult has no use for one. */
function assertCanSetChildTopic(actor: PersonRow, targetId: string): SettingsOpResult<true> {
  const targetRole = getPersonRole(targetId);
  if (!targetRole) return { ok: false, status: 403, error: "cannot access another person's settings" };
  if (targetRole === "teen") {
    return { ok: false, status: 403, error: "Sensitive-subject levels are set for a child only. A teen's levels are the household teen controls in Settings, Privacy." };
  }
  if (targetRole !== "child") {
    return { ok: false, status: 403, error: "Sensitive-subject levels apply to a child only. To change them, open a child's page, Topics." };
  }
  if (!isOwnerOrAdmin(actor)) {
    return { ok: false, status: 403, error: "A household owner or admin sets a child's sensitive-subject levels. Ask one of them to open the child's page, Topics." };
  }
  return { ok: true, value: true };
}

function validateSelectorValue(keyDef: SettingsKey, value: unknown): SettingsOpResult<true> {
  if (keyDef.key === "companions.enabled") {
    if (!Array.isArray(value) || value.some((id) => typeof id !== "string") || new Set(value).size !== value.length) return { ok: false, status: 400, error: "Choose a list of companion ids without duplicates." };
    return { ok: true, value: true };
  }
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
      // TIER-HOME-02: a tier slot is a { model, options, who } record, checked against the spec's shape and its category's typed options.
      if (range?.value_schema === "tier-slot") {
        const slot = TierSlot.safeParse(value);
        if (!slot.success) return { ok: false, status: 400, error: "A slot needs a model (a catalog id, recommended or off) and its options." };
        const problems = checkTierSlotOptions(String(range.category), slot.data.options);
        if (problems.length > 0) return { ok: false, status: 400, error: problems.join(" ") };
        break;
      }
      if (typeof value !== "string") return { ok: false, status: 400, error: "expected a string" };
      break;
    case "select": {
      const options = range?.options as unknown[] | undefined;
      if (keyDef.key === "persona.active_id") {
        if (typeof value !== "string" || !LIVE_PERSONA_IDS.has(value)) return { ok: false, status: 400, error: "Choose a companion that is ready on this Home." };
        break;
      }
      // Engine model choices are populated by the Stack's live model
      // inventory, so the shared declaration names an options_from source
      // instead of copying a static enum into Home. "auto" is the stable
      // sentinel that delegates selection to the Stack; specific ids are
      // checked by the Stack when applying its setup plan.
      if (typeof range?.options_from === "string" && range.options_from.startsWith("models.")) {
        if (typeof value !== "string" || (value !== "auto" && value !== "off" && value.length === 0)) {
          return { ok: false, status: 400, error: "expected auto, off, or a model id" };
        }
        break;
      }
      // ROBOT-VOICE-01: the voice list lives in the Stack; the route checks the id against it after authorization.
      // Here a voice id is a plain token, never a URL (same shape rule as tts.voice_id).
      if (range?.options_from === "voices.tts") {
        if (typeof value !== "string" || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(value)) return { ok: false, status: 400, error: "That voice is not on this hub. Choose one from the list." };
        break;
      }
      // Dynamic option sets can be empty during first-run setup (for
      // example, before any chat model is installed). Their declared
      // default sentinel remains a valid choice while the live options
      // are unavailable.
      if (range?.options_from && value === keyDef.default) break;
      if (range?.multiple === true) {
        const labels = (keyDef.copy as { option_labels?: Record<string, string> } | undefined)?.option_labels;
        // SEARCH-SOURCES-01: a multi-select stores a list of the declared options, each at most once.
        if (!Array.isArray(value) || value.some((entry) => !options?.includes(entry))) {
          return { ok: false, status: 400, error: `Pick one or more of: ${(options ?? []).map((o) => (labels?.[String(o)] ?? String(o))).join(", ")}.` };
        }
        if (new Set(value).size !== value.length) return { ok: false, status: 400, error: "each option can be picked once" };
        break;
      }
      // A dynamic selector may declare only its option source instead of a
      // static list. Its declared default remains a valid choice (for
      // example `engines.chat.choice` defaults to `auto`).
      if (range?.options_from && value === keyDef.default) break;
      // A Stack voice id (a reference voice the engine offers) is a plain token, never a URL: no ":" or "/", so it cannot
      // point the speech engine at an address. The speech path drops an id the engine in use does not offer.
      if (keyDef.key === "tts.voice_id" && typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,79}$/.test(value)) break;
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
      // NOTIFY-SHARE-02: `range.multiple` (Home Assistant's own shape
      // for "select some entities of a kind") is the first real caller
      // of this branch - every existing "person" selector use (the
      // spec's own recipe fixtures) is still a single id, so a plain
      // string stays the default when `multiple` isn't set.
      // LIVE-VIEW-01: `robot.live_view.who` declares `range.multiple` in the spec (spec-v0.1.147), so it is a list
      // like any other; the key alone keeps the adults-only gate (the selector offers adults only).
      const adultsOnly = keyDef.key === LIVE_VIEW_WHO_KEY;
      const multiple = (range as { multiple?: boolean } | undefined)?.multiple === true;
      const ids = multiple ? value : [value];
      if (multiple ? !Array.isArray(value) : typeof value !== "string") {
        return { ok: false, status: 400, error: multiple ? "expected an array of person ids" : "expected a person id" };
      }
      for (const id of ids as unknown[]) {
        if (typeof id !== "string") return { ok: false, status: 400, error: "expected an array of person ids" };
        const exists = db
          .select({ id: people.id })
          .from(people)
          .where(and(eq(people.id, id), isNull(people.deletedAt)))
          .get();
        if (!exists) return { ok: false, status: 400, error: `unknown person: ${id}` };
        if (adultsOnly) {
          const named = db.select().from(people).where(eq(people.id, id)).get()!;
          if (speakerAgeBand(named, new Date()) !== "adult") return { ok: false, status: 400, error: "Live view can only name adults. Pick an adult, or leave a child or teen off the list." };
        }
      }
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
    case "location": {
      const multiple = range?.multiple === true;
      const allowCurrent = range?.allow_current === true;
      if (value === null && keyDef.key === HOUSEHOLD_HOME_KEY) break;
      const values = multiple ? value : [value];
      if (multiple ? !Array.isArray(value) : typeof value !== "string") return { ok: false, status: 400, error: multiple ? "expected an array of place ids" : "expected a place id" };
      for (const entry of values as unknown[]) {
        if (entry === "current" && allowCurrent) continue;
        if (typeof entry !== "string" || !/^ent-[a-z0-9]{6,}$/.test(entry)) return { ok: false, status: 400, error: "expected a place id" };
      }
      break;
    }
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
  context?: { viewer: PersonRow; subject?: PersonRow; adminName?: string | null },
): ResolvedSetting {
  const subject = context?.subject ?? context?.viewer;
  const band = subject ? speakerAgeBand(subject, new Date()) : "adult";
  const viewer = context?.viewer ?? subject;
  let value = rawValue;
  if (keyDef.scope === "person" && subject && source === "default" && band === "child"
    && (keyDef.key === "chat.photo_uploads" || keyDef.key === "reference.images")) value = false;
  // NAT-07b: off by default for a teen, and never for a child (conversationOpening gates the child whatever is stored).
  if (keyDef.scope === "person" && subject && source === "default" && band !== "adult" && keyDef.key === "chat.pick_up_threads") value = false;
  const descriptionValue = keyDef.secret ? null : value;
  const description = describeSetting(
    { ...keyDef, copy: keyDef.copy ?? { does: keyDef.label } },
    {
      subjectBand: band,
      viewer: !viewer || !subject || viewer.id === subject.id ? "self" : viewer.role === "owner" || viewer.role === "admin" ? "admin" : "guardian",
      value: descriptionValue,
      source,
      effective: descriptionValue,
      adminName: context && "adminName" in context
        ? context.adminName ?? undefined
        : subject && viewer?.id === subject.id && (band === "child" || band === "teen") && keyDef.scope === "person"
          ? calledAdminForOwnSettings(viewer!) ?? householdAdminName()
          : viewer && viewer.id !== subject?.id ? viewer.displayName : householdAdminName(),
      personName: subject?.displayName,
    },
  );
  const blocklistBand = (Object.keys(BLOCKLIST_KEYS) as AgeBand[]).find((band) => BLOCKLIST_KEYS[band] === keyDef.key);
  if (blocklistBand) description.state = blocklistStatusNote(blocklistBand);
  const base = { key: keyDef.key, source, label: keyDef.label, help: keyDef.help, level: keyDef.level, secret: keyDef.secret, ...description };
  if (!keyDef.secret) return { ...base, value };
  return { ...base, value: null, isSet: source !== "default" };
}

function responseSubject(actor: PersonRow, parsed: ParsedScope): PersonRow {
  if (parsed.kind === "person" && parsed.id) {
    return db.select().from(people).where(and(eq(people.id, parsed.id), isNull(people.deletedAt))).get() ?? actor;
  }
  return actor;
}

function householdAdminName(): string | undefined {
  const candidates = db.select({ displayName: people.displayName, role: people.role }).from(people).where(isNull(people.deletedAt)).all();
  return candidates.find((person) => person.role === "owner")?.displayName
    ?? candidates.find((person) => person.role === "admin")?.displayName;
}

function responseContext(viewer: PersonRow, subject: PersonRow, scopeKind: ParsedScope["kind"]) {
  const band = speakerAgeBand(subject, new Date());
  const adminName = scopeKind === "person" && viewer.id === subject.id && (band === "child" || band === "teen")
    ? calledAdminForOwnSettings(viewer) ?? householdAdminName()
    : viewer.id !== subject.id ? viewer.displayName : householdAdminName();
  return { viewer, subject, adminName };
}

/** Every registered key whose scope kind matches, each resolved to its
 * stored value or the registry default (4.6: a setting always has a
 * value, even before anyone customizes it). */
export function listValues(actor: PersonRow, scope: string, onlyKey?: string): SettingsOpResult<ResolvedSetting[]> {
  const parsed = parseScope(scope);
  if (!parsed) return { ok: false, status: 400, error: `invalid scope: ${scope}` };
  const companionsOnly = onlyKey === COMPANIONS_ALLOWED_KEY;
  if (onlyKey && !companionsOnly && onlyKey !== "companions.preview_shells") return { ok: false, status: 400, error: `unsupported settings key filter: ${onlyKey}` };
  const adultWakewordRead = parsed.kind === "device" && actor.role === "adult"
    && getRegistry().some((keyDef) => keyDef.key === WAKEWORD_SETTING_KEY);
  const auth = companionsOnly
    ? (isOwnerOrAdmin(actor) && (parsed.kind !== "person" || getPersonRole(parsed.id!) !== undefined)
      ? { ok: true as const, value: true as const }
      : { ok: false as const, status: 403 as const, error: COMPANIONS_PERMISSION_ERROR })
    : adultWakewordRead
    ? assertCanAccessWakewordDeviceSetting(actor)
    : assertCanAccessScope(actor, parsed, "read");
  if (!auth.ok) return auth;

  const stored = db.select().from(settingsValues).where(eq(settingsValues.scope, scope)).all();
  const storedByKey = new Map(stored.map((row) => [row.key, row]));
  const subject = responseSubject(actor, parsed);
  const descriptionContext = responseContext(actor, subject, parsed.kind);

  const results: ResolvedSetting[] = getRegistry()
    .filter((k) => (k.scope === parsed.kind || (companionsOnly && parsed.kind === "household" && isLayeredScalar(k) && k.key === COMPANIONS_ALLOWED_KEY && k.layers?.includes("household"))) && (!adultWakewordRead || k.key === WAKEWORD_SETTING_KEY) && (!onlyKey || k.key === onlyKey))
    // Location settings and their values are private to their person even
    // where the general People settings page canAccessPerson() permits a
    // guardian to inspect other settings for a child.
    .filter((k) => !(parsed.kind === "person" && parsed.id !== actor.id && k.selector === "location"))
    .map((k) => {
      const row = storedByKey.get(k.key);
      if (parsed.kind === "person" && parsed.id && isLayeredScalar(k)) {
        // EASE-OF-USE-01c: person's own value, else household's, else the age group's, else the default.
        const layered = resolveLayeredScalar(k, parsed.id, speakerAgeBand(subject, new Date()));
        const own = layered.layer === "person";
        return { ...resolveForResponse(k, layered.value, own ? "user" : "default", descriptionContext), layer: layered.layer, locked: layered.locked };
      }
      const rawValue = row ? decodeStoredRow(k, row.value) : k.default;
      const source = row ? (row.source as ResolvedSetting["source"]) : "default";
      return resolveForResponse(k, rawValue, source, descriptionContext);
    });
  return { ok: true, value: results };
}

/** The validate-then-write core shared by setValue (actor-gated, every
 * person-facing write) and setHouseholdSettingValue (actor-less, for core
 * background jobs already gated elsewhere - see that function's doc).
 * Caller is responsible for scope/key/authorization checks; this only
 * validates the value against the key's selector and persists it. */
const householdWriteListeners: Array<(key: string, value: unknown) => void> = [];
/** Runs after every stored household value, so a legacy key can keep its replacement in step until the legacy key retires (tierSlotMigration.ts). */
export function onHouseholdWrite(listener: (key: string, value: unknown) => void): void { householdWriteListeners.push(listener); }

function writeValue(
  scope: string,
  keyDef: SettingsKey,
  value: unknown,
  opts: { skipValidation?: boolean; viewer?: PersonRow; subject?: PersonRow; adminName?: string | null; setBy?: string } = {},
): SettingsOpResult<ResolvedSetting> {
  const key = keyDef.key;
  if (!opts.skipValidation) {
    const validated = validateSelectorValue(keyDef, value);
    if (!validated.ok) return validated;
  }

  // KS-05: a feed-address box is checked before it is stored, so a bad
  // address is refused with the fix instead of failing quietly at poll time.
  if (key.startsWith("news.feeds.")) {
    const checked = checkFeedAddressBox(value);
    if (!checked.ok) return { ok: false, status: 400, error: checked.error };
  }

  if (keyDef.key === HOUSEHOLD_HOME_KEY && value !== null) {
    const row = typeof value === "string" ? db.select().from(entities).where(and(eq(entities.id, value), isNull(entities.deletedAt))).get() : undefined;
    if (!row || row.kind !== "place" || row.placeKind !== "map" || row.scope !== "household") return { ok: false, status: 400, error: "household.home must reference a household map place" };
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
      .set({ value: serialized, hlc, source: "user", updatedAt: now, ...(opts.setBy ? { setBy: opts.setBy } : {}) })
      .where(and(eq(settingsValues.scope, scope), eq(settingsValues.key, key)))
      .run();
  } else {
    db.insert(settingsValues).values({ scope, key, value: serialized, hlc, source: "user", updatedAt: now, setBy: opts.setBy ?? null }).run();
  }

  settingsCache.delete(settingsCacheKey(scope, key));
  if (scope === "household") for (const listener of householdWriteListeners) listener(key, value);
  const descriptionContext = opts.viewer
    ? { viewer: opts.viewer, subject: opts.subject, adminName: opts.adminName }
    : undefined;
  return { ok: true, value: resolveForResponse(keyDef, value, "user", descriptionContext) };
}

// SEARCH-SAFE-01 (Jesse's own ruling, 2026-09-24): `search.safe_search`
// needs a wider, and in one direction narrower, write rule than every
// other person-scope key's generic `assertCanAccessScope`/
// `canAccessPerson` gate - wider because an admin must reach a TEEN's
// level too (`canAccessPerson`'s own child-only reach is a deliberate,
// documented, conservative privacy boundary for memory/conversation
// access - access.ts's own header - not touched here, since widening
// it would hand an admin a teen's private memories as a side effect no
// one asked for); narrower because a child or teen must never be able
// to loosen their OWN level below their own band's default, which no
// other settings key has a concept of at all. Scoped to this one key,
// never folded into the shared predicate.
const SAFE_SEARCH_KEY = "search.safe_search";

// INCOGNITO-07: session lock is admin-configurable for ANY account
// (backlog's own wording - "any account can be configured (by an admin)
// to require it"), unlike the generic person-scope gate above, which
// lets everyone edit their own person-scope settings with no ladder
// check at all. A plain adult must not be able to switch off a lock an
// admin required for them, so both keys need an owner/admin gate
// regardless of who the target is - but a code review (medium effort,
// before commit) caught the first version of this checking only
// isOwnerOrAdmin(actor) with no target-role check at all, which let an
// admin force the lock onto the OWNER's own account through this
// route's generic PUT /api/settings path, even though the sibling
// PATCH /api/people/:id path already refuses that (canManage()'s own
// MANAGEABLE_BY.admin ladder excludes "owner" and "admin"). The same
// setValue()-backed operation enforcing two different policies
// depending only on which HTTP route reached it is exactly the "one
// definition, one enforcement" bug this file's other bespoke gates
// (assertCanSetSafeSearch) are already careful not to introduce. Fixed
// by mirroring that ladder here rather than importing it -
// personLifecycle.ts already imports invalidateScopeCache from this
// file, so importing MANAGEABLE_BY back would cycle; if that table's
// own admin row ever changes, this needs the matching edit.
// Read is unrestricted (the generic person-scope gate already lets a
// person read their own; routes/people.ts's roster response is what
// surfaces another person's value to an admin, via
// getSettingValueForPerson()).
// Exported: routes/people.ts reads both keys via getSettingValueForPerson()
// to merge them onto the roster response, and writes them via setValue()
// after its own canManage() check, rather than a duplicated string literal.
export const SESSION_LOCK_REQUIRED_KEY = "security.session_lock_required";
export const SESSION_LOCK_TIMEOUT_KEY = "security.session_lock_timeout_minutes";

// The shared "owner/admin only; self is always fine; but an admin may not
// act on another owner's or admin's own value" ladder - INCOGNITO-07's
// session lock and STORE-CAP-01's storage-cap override both need exactly
// this shape. One definition now, not two: a code review on the
// storage-cap addition caught assertCanSetPersonStorageCap as a hand
// copy of assertCanSetSessionLock, the very risk this function's own
// comment (below) already named ("if that table's own admin row ever
// changes, this needs the matching edit") - true of two hand-kept copies,
// not of one shared function each caller supplies its own error text to.
//
// Self is always fine for owner/admin (birthdate/localOnly's own
// precedent in routes/people.ts: "owner/admin editing themselves is
// unaffected") - a second review pass on the session-lock version (low
// effort, before commit) caught the first cut of this ladder refusing an
// admin setting THEIR OWN session lock, since the target-role check
// resolved to "admin" for a self-edit too before the self-exemption
// existed; kept here so neither caller can reintroduce that bug.
function assertOwnerAdminLadder(actor: PersonRow, targetPersonId: string, errorMessage: string): SettingsOpResult<true> {
  if (actor.role === "owner") return { ok: true, value: true };
  if (!isOwnerOrAdmin(actor)) return { ok: false, status: 403, error: errorMessage };
  if (actor.id === targetPersonId) return { ok: true, value: true };
  const targetRole = getPersonRole(targetPersonId);
  if (targetRole === "owner" || targetRole === "admin") {
    return { ok: false, status: 403, error: errorMessage };
  }
  return { ok: true, value: true };
}

function assertCanSetSessionLock(actor: PersonRow, targetPersonId: string): SettingsOpResult<true> {
  return assertOwnerAdminLadder(actor, targetPersonId, "only owner or admin may change session lock settings");
}

// STORE-CAP-01: the person-scope cap override is "set by an admin"
// (household-storage-2026-09-23.md's cap table) - the generic per-person
// gate below (canAccessPerson's `actor.id === personId` branch) would
// otherwise let anyone raise their OWN cap just by writing their own
// person-scope setting, which defeats the whole point of an admin-set
// override.
/** Media protections are guardian-held for both minor bands. An admin can set one person's controls,
 * without gaining access to that person's progress or activity. Set and reset share this gate. */
function assertCanSetMediaProtection(actor: PersonRow, targetPersonId: string): SettingsOpResult<true> {
  const target = db.select().from(people).where(and(eq(people.id, targetPersonId), isNull(people.deletedAt))).get();
  if (!target) return { ok: false, status: 403, error: "That person was not found. Open People and pick them again." };
  if (isOwnerOrAdmin(actor)) return assertOwnerAdminLadder(actor, targetPersonId, "You cannot change these media controls. Ask the person who manages Home.");
  if (actor.id === targetPersonId && speakerAgeBand(actor, new Date()) === "adult" && actor.role !== "guest") return { ok: true, value: true };
  return { ok: false, status: 403, error: "A grown-up sets your media controls. Ask a grown-up to change them." };
}

/** CODE-KEYS-01: the coding.person.* keys are held by the band's declared `control` (local-coding design 3.7). Where it says
 * guardian, only an owner or admin writes it (the person's own write is refused, so a child or teen cannot give themselves
 * keys, hosts or a bigger share, and an adult cannot raise their own cap); where it says self, the ordinary person rule applies. */
function assertCanSetCodingPersonKey(actor: PersonRow, targetPersonId: string, keyDef: { control?: Record<string, string> }): SettingsOpResult<true> {
  const target = db.select().from(people).where(and(eq(people.id, targetPersonId), isNull(people.deletedAt))).get();
  if (!target) return { ok: false, status: 403, error: "That person was not found. Open People and pick them again." };
  const band = speakerAgeBand(target as PersonRow, new Date());
  if (keyDef.control?.[band] !== "guardian") return assertCanAccessScope(actor, { kind: "person", id: targetPersonId }, "write");
  if (!isOwnerOrAdmin(actor)) return { ok: false, status: 403, error: "An admin sets this for you. Ask the person who manages Home to change it." };
  return assertOwnerAdminLadder(actor, targetPersonId, "You cannot change this person's coding access. Ask the person who manages Home.");
}
const isCodingPersonKey = (key: string) => key.startsWith("coding.person.");

const isMediaProtection = (key: string) => key === "media.allowlist_only" || key === "allowance.media.daily_minutes";

function assertCanSetPersonStorageCap(actor: PersonRow, targetPersonId: string): SettingsOpResult<true> {
  return assertOwnerAdminLadder(actor, targetPersonId, "only owner or admin may change a person's storage cap");
}

function assertCanSetSafeSearch(actor: PersonRow, targetPersonId: string, newValue: unknown): SettingsOpResult<true> {
  const targetIsSelf = actor.id === targetPersonId;
  if (!targetIsSelf) {
    if (!isOwnerOrAdmin(actor)) return { ok: false, status: 403, error: "cannot access another person's settings" };
    const targetRole = getPersonRole(targetPersonId);
    // MINOR-SEARCH-01c, the 2026-09-30 teen-private ruling: an admin reaches a
    // child's own settings and never a teen's.
    if (targetRole === "teen") {
      return { ok: false, status: 403, error: "A teen's safe search level is private to the teen, so an admin can't change it. The household-wide switch for teens is Settings, Search, Web search with teen controls." };
    }
    if (targetRole !== "child") {
      return { ok: false, status: 403, error: "An adult's safe search level is their own to change. Ask them to open Settings, Search on their own account." };
    }
    // A child's level is always strict: an admin may keep it at "default" or
    // set "strict", never looser.
    if (newValue === "off" || newValue === "moderate") {
      return { ok: false, status: 403, error: "A child's safe search is always strict, so it can't be set lower. Leave it on Default or Strict." };
    }
    return { ok: true, value: true };
  }
  if (isOwnerOrAdmin(actor)) return { ok: true, value: true };
  // A child or teen setting their own: "default" always resolves to
  // their own band default, never a loosening by construction; an
  // unrecognized value is left to `validateSelectorValue`'s own 400,
  // not read as an authorization question here.
  if (newValue === "default") return { ok: true, value: true };
  if (newValue !== "off" && newValue !== "moderate" && newValue !== "strict") return { ok: true, value: true };
  const ownDefault = safeSearchDefaultFor(speakerAgeBand(actor, new Date()));
  if (safeSearchStrictness(newValue as SafeSearchLevel) < safeSearchStrictness(ownDefault)) {
    return { ok: false, status: 403, error: "Safe search can't go lower than the level for your age. Pick Default or a stricter level." };
  }
  return { ok: true, value: true };
}

/** SETTINGS-LAYERS-01a: `search.page_text_cleaning` is a guardian-held key for a child and a teen
 * (a minor never turns the check off for themselves); an adult changes their own, and an owner or
 * admin sets a child's or a teen's. 01b replaces this with the one layered write gate. */
function assertCanSetPageTextCleaning(actor: PersonRow, targetId: string): SettingsOpResult<true> {
  const targetRole = getPersonRole(targetId);
  if (!targetRole) return { ok: false, status: 403, error: "cannot access another person's settings" };
  if (actor.id === targetId) {
    if (targetRole !== "child" && targetRole !== "teen") return { ok: true, value: true };
    return { ok: false, status: 403, error: "A household owner or admin changes the page text check for a child or teen. Ask one of them to open your page." };
  }
  if (isOwnerOrAdmin(actor) && (targetRole === "child" || targetRole === "teen")) return { ok: true, value: true };
  return { ok: false, status: 403, error: "Only a household owner or admin changes this for a child or teen, and only an adult changes their own." };
}

/** INITIATIVE-01: the robot may speak first to a child only on a parent's or admin's switch, so a child
 * can never write this key for themselves; everyone else follows the ordinary person-scope rule. */
export const LIVE_VIEW_WHO_KEY = "robot.live_view.who";
export const ROBOT_MAY_ADDRESS_KEY = "person.robot.may_address";
/** The robot follow-up window (FOLLOWUP-01) and the person's own watch level (FACE-WATCH-01) follow the same
 * rule: the registry help says a parent turns them on for a child, so a child never writes them for themselves. */
export const ROBOT_FOLLOW_UP_KEY = "person.robot.follow_up";
export const VISION_WATCH_KEY = "person.vision.watch";
// NEWS-03: every news.* person key the News package declares guardian-set for a child (My Mix, reader_open, digest...) is held to the same
// guard by its declared `control`, so a new News key cannot drift from its text.
const PARENT_GATED_ROBOT_KEYS: ReadonlySet<string> = new Set([ROBOT_MAY_ADDRESS_KEY, ROBOT_FOLLOW_UP_KEY, VISION_WATCH_KEY, "generation.kid_enabled"]);
function assertCanSetRobotMayAddress(actor: PersonRow, targetId: string): SettingsOpResult<true> {
  // The band, not the role alone: a birthdate under 13 makes an adult-role person a child here too (speakerAgeBand is role-floored).
  if (actor.id === targetId && speakerAgeBand(actor, new Date()) === "child") {
    return { ok: false, status: 403, error: "A parent sets this for you. Ask the person who manages Home." };
  }
  return assertCanAccessScope(actor, { kind: "person", id: targetId }, "write");
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
  if (key === ROBOT_FIRMWARE_INSTALLED_KEY) return { ok: false, status: 403, error: "Home records installed robot firmware after a successful flash." };
  const companionsLayer = key === COMPANIONS_ALLOWED_KEY && isLayeredScalar(keyDef)
    && (parsed.kind === "household" || parsed.kind === "person") && keyDef.layers?.includes(parsed.kind);
  if (keyDef.scope !== parsed.kind && !companionsLayer) {
    return { ok: false, status: 400, error: `${key} is a ${keyDef.scope}-scope key, not ${parsed.kind}` };
  }

  if (keyDef.selector === "location" && parsed.kind === "person" && parsed.id !== actor.id) {
    return { ok: false, status: 403, error: "location settings are private to each person" };
  }

  // EASE-OF-USE-01c: a self-service key (the ease.* comfort keys) has its own gate: the person writes their
  // own unless an admin locked it, and an admin writes any person's, which locks it. See lib/layeredScalar.ts.
  if (parsed.kind === "person" && isSelfService(keyDef)) {
    const gate = assertCanWriteSelfService(actor, parsed.id!, keyDef);
    if (!gate.ok) return gate;
    const written = writeValue(scope, keyDef, value, { ...responseContext(actor, responseSubject(actor, parsed), parsed.kind), setBy: gate.setBy });
    return written.ok ? { ok: true, value: { ...written.value, layer: "person", locked: gate.setBy !== "self" } } : written;
  }

  const auth = isMediaProtection(key) && parsed.kind === "person"
    ? assertCanSetMediaProtection(actor, parsed.id!)
    : (isCodingPersonKey(key) || key === "ui.home_layout") && parsed.kind === "person"
    ? assertCanSetCodingPersonKey(actor, parsed.id!, keyDef as { control?: Record<string, string> })
    : key === COMPANIONS_ALLOWED_KEY
      ? (isOwnerOrAdmin(actor) && (parsed.kind !== "person" || getPersonRole(parsed.id!) !== undefined)
        ? { ok: true as const, value: true as const }
        : { ok: false as const, status: 403 as const, error: COMPANIONS_PERMISSION_ERROR })
    : key === SAFE_SEARCH_KEY && parsed.kind === "person"
      ? assertCanSetSafeSearch(actor, parsed.id!, value)
      : key === SESSION_LOCK_REQUIRED_KEY || key === SESSION_LOCK_TIMEOUT_KEY
        ? assertCanSetSessionLock(actor, parsed.id!)
      : key === WAKEWORD_SETTING_KEY && parsed.kind === "device"
        ? assertCanAccessWakewordDeviceSetting(actor)
        : key === "tts.voice_id" && parsed.kind === "person"
          ? assertCanSetTtsVoice(actor, parsed.id!)
        : key === "person.voice_print.enrollment" && parsed.kind === "person"
          ? assertCanSetVoicePrintEnrollment(actor, parsed.id!)
        : key === "chat.photo_uploads" && parsed.kind === "person"
          ? assertCanSetPhotoUploads(actor, parsed.id!)
        : key === "reference.images" && parsed.kind === "person"
          ? assertCanSetAnswerPictures(actor, parsed.id!)
        : key === "search.page_text_cleaning" && parsed.kind === "person"
          ? assertCanSetPageTextCleaning(actor, parsed.id!)
        : (PARENT_GATED_ROBOT_KEYS.has(key) || (key.startsWith("news.") && keyDef.control?.child === "guardian")) && parsed.kind === "person"
          ? assertCanSetRobotMayAddress(actor, parsed.id!)
        : key.startsWith("topics.") && parsed.kind === "person"
          ? assertCanSetChildTopic(actor, parsed.id!)
        : key === PERSON_STORAGE_CAP_KEY
          ? assertCanSetPersonStorageCap(actor, parsed.id!)
          : assertCanAccessScope(actor, parsed, "write");
  if (!auth.ok) return auth;

  if (key === "tts.voice_id" && parsed.kind === "person" && getPersonRole(parsed.id!) === "child" && isOwnerOrAdmin(actor) && value !== VOICE_ENGINE_DEFAULT && !VOICE_PRESET_NAMES.includes(value as typeof VOICE_PRESET_NAMES[number])) {
    return { ok: false, status: 403, error: "A parent chooses your voice. Ask the person who manages Home to pick a preset voice for you." };
  }

  if (keyDef.selector === "location" && key !== HOUSEHOLD_HOME_KEY) {
    const range = keyDef.range as { multiple?: boolean; allow_current?: boolean } | undefined;
    const entries = range?.multiple ? value as unknown[] : [value];
    for (const entry of entries) {
      if (entry === "current" && range?.allow_current) continue;
      const place = typeof entry === "string" ? db.select().from(entities).where(and(eq(entities.id, entry), isNull(entities.deletedAt))).get() : undefined;
      if (!place || place.kind !== "place" || place.placeKind !== "map" || place.scope !== "person" || place.person !== actor.id) {
        return { ok: false, status: 400, error: "location settings may only reference your own saved places" };
      }
    }
  }

  const written = writeValue(scope, keyDef, value, responseContext(actor, responseSubject(actor, parsed), parsed.kind));
  return written;
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

/** Internal device value written only by the owner/admin firmware record route. */
export function setRobotFirmwareInstalled(deviceId: string, value: { version: string; at: string }, setBy: string): SettingsOpResult<ResolvedSetting> {
  const keyDef = getRegistryKey(ROBOT_FIRMWARE_INSTALLED_KEY);
  if (!keyDef || keyDef.scope !== "device") return { ok: false, status: 400, error: "robot firmware setting is unavailable" };
  return writeValue(`device:${deviceId}`, keyDef, value, { skipValidation: true, setBy });
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

/** Whether a household key has an explicitly stored value, including false. */
export function getHouseholdSettingSource(key: string): string | undefined {
  return db.select({ source: settingsValues.source }).from(settingsValues)
    .where(and(eq(settingsValues.scope, "household"), eq(settingsValues.key, key))).get()?.source;
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
  if (isLayeredScalar(keyDef)) return resolveLayeredScalar(keyDef, actor.id, speakerAgeBand(actor, new Date())).value;
  return resolveStoredValue(`person:${actor.id}`, keyDef);
}

/** ANY person's own setting, with no actor gate - the `getHouseholdSettingValue`
 * posture above, extended to `person`-scope: a real system operation acting
 * ON a person's behalf (lib/notifications.ts resolving a notification
 * RECIPIENT's own channel preferences and Telegram chat id before
 * delivering something to them) isn't that person reading their own
 * settings, so `getPersonSettingValue`'s safe-by-construction "always the
 * caller's own id" design doesn't fit here - the caller here is the
 * system, not the person. Never exposed through a route, same as
 * `getHouseholdSettingValue`. */
export function getSettingValueForPerson(personId: string, key: string): unknown {
  const keyDef = getRegistryKey(key);
  if (!keyDef || keyDef.scope !== "person") return undefined;
  if (keyDef.selector === "location") return undefined;
  if (isLayeredScalar(keyDef)) {
    const person = db.select().from(people).where(eq(people.id, personId)).get();
    return resolveLayeredScalar(keyDef, personId, person ? speakerAgeBand(person, new Date()) : "adult").value;
  }
  return resolveStoredValue(`person:${personId}`, keyDef);
}

/** A device-scope setting's resolved value, no actor gate: the hub resolving a robot's own room setting
 * (robot.initiative.allowed_here) for a gate it enforces itself. Never exposed through a route. */
export function getDeviceSettingValue(deviceId: string, key: string): unknown {
  const keyDef = getRegistryKey(key);
  if (!keyDef || keyDef.scope !== "device") return undefined;
  return resolveStoredValue(`device:${deviceId}`, keyDef);
}

/** Whether a person setting was explicitly saved. Used for age-band defaults
 * whose safe default differs from the shared schema default. */
export function getPersonSettingSource(personId: string, key: string): string | undefined {
  return db.select({ source: settingsValues.source }).from(settingsValues)
    .where(and(eq(settingsValues.scope, `person:${personId}`), eq(settingsValues.key, key))).get()?.source;
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
  const authorization = assertCanSetTtsVoice(actor, actor.id);
  if (!authorization.ok) return authorization;
  return writeValue(`person:${actor.id}`, keyDef, hfPath, { skipValidation: true, ...responseContext(actor, actor, "person") });
}

// In-process cache for resolveStoredValue() (a latency review, 2026-09-06:
// buildSystemPrompt() alone hits getHouseholdSettingValue()/
// getPersonSettingValue() several times every single turn, each a
// synchronous SQLite read on the same event loop that's also pumping
// another household member's token stream). Keyed by scope+key so a
// household-scope and a person-scope row for the same key never collide.
// Invalidated exactly where a value can change: writeValue() (every
// setValue()/setHouseholdSettingValue()/setPersonTtsVoiceUnchecked() call),
// resetValue()'s delete, clearMatchingValues()'s cross-scope delete
// (which doesn't know in advance which scopes it touched, so it clears
// the whole cache rather than risk leaving a stale entry for one it
// missed - a rare admin cleanup path, not a per-turn one, so the cost of
// being conservative there is negligible), and personLifecycle.ts's own
// raw `DELETE FROM settings_values WHERE scope = ?` (erasePersonData() -
// a code review, 2026-09-06, found this bypassed every one of the three
// invalidation points above, so a person's just-erased settings could
// keep serving their last cached value for the rest of the process's
// life) via invalidateScopeCache() below.
const settingsCache = new Map<string, unknown>();

function settingsCacheKey(scope: string, key: string): string {
  return `${scope}:${key}`;
}

/** For a caller that deletes every row at one scope directly (bypassing
 * writeValue()/resetValue()) and so can't invalidate key-by-key the way
 * those do - today, personLifecycle.ts's erasePersonData() erasing a
 * departed person's `person:<id>` settings wholesale. */
export function invalidateScopeCache(scope: string): void {
  const prefix = `${scope}:`;
  for (const key of settingsCache.keys()) {
    if (key.startsWith(prefix)) settingsCache.delete(key);
  }
}

export function __resetSettingsCacheForTests(): void {
  settingsCache.clear();
}

/** Shared by getHouseholdSettingValue() and getPersonSettingValue() above
 * (a code review, 2026-09-04, found the two had drifted into
 * near-identical copies of the same lookup/default-resolution logic): the
 * one place that reads a stored value's row and falls back to the
 * registry default, given an already-resolved key definition. Each
 * public function still owns its own registry lookup and scope-kind
 * guard - only the actual row query is shared. */
function resolveStoredValue(scope: string, keyDef: SettingsKey): unknown {
  const cacheKey = settingsCacheKey(scope, keyDef.key);
  if (settingsCache.has(cacheKey)) return settingsCache.get(cacheKey);
  const row = db
    .select()
    .from(settingsValues)
    .where(and(eq(settingsValues.scope, scope), eq(settingsValues.key, keyDef.key)))
    .get();
  const value = row ? decodeStoredRow(keyDef, row.value) : keyDef.default;
  settingsCache.set(cacheKey, value);
  return value;
}

// The registry decides whether a key is shown from the stored value of one household key (settingsRegistry.ts
// getRegistry), so it reads through this cached raw reader. A key with no row reads as `fallback` (its default).
registerStoredHouseholdReader((key, fallback) => {
  const cacheKey = settingsCacheKey("household", key);
  if (settingsCache.has(cacheKey)) return settingsCache.get(cacheKey);
  const row = db.select({ value: settingsValues.value }).from(settingsValues).where(and(eq(settingsValues.scope, "household"), eq(settingsValues.key, key))).get();
  const value = row ? JSON.parse(row.value) : fallback;
  settingsCache.set(cacheKey, value);
  return value;
});

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
  if (key === ROBOT_FIRMWARE_INSTALLED_KEY) return { ok: false, status: 403, error: "Home records installed robot firmware after a successful flash." };
  const companionsLayer = key === COMPANIONS_ALLOWED_KEY && isLayeredScalar(keyDef)
    && (parsed.kind === "household" || parsed.kind === "person") && keyDef.layers?.includes(parsed.kind);
  if (keyDef.scope !== parsed.kind && !companionsLayer) return { ok: false, status: 400, error: `${key} is a ${keyDef.scope}-scope key, not ${parsed.kind}` };
  if (keyDef.selector === "location" && parsed.kind === "person" && parsed.id !== actor.id) {
    return { ok: false, status: 403, error: "location settings are private to each person" };
  }

  if (parsed.kind === "person" && isSelfService(keyDef)) {
    // A person resets their own unless an admin locked it; an admin's reset lifts the lock.
    const gate = assertCanWriteSelfService(actor, parsed.id!, keyDef);
    if (!gate.ok) return gate;
    db.delete(settingsValues).where(and(eq(settingsValues.scope, scope), eq(settingsValues.key, key))).run();
    settingsCache.delete(settingsCacheKey(scope, key));
    const subject = responseSubject(actor, parsed);
    const layered = resolveLayeredScalar(keyDef, parsed.id!, speakerAgeBand(subject, new Date()));
    return { ok: true, value: { ...resolveForResponse(keyDef, layered.value, layered.layer === "person" ? "user" : "default", responseContext(actor, subject, parsed.kind)), layer: layered.layer, locked: false } };
  }

  const auth = isMediaProtection(key) && parsed.kind === "person"
    ? assertCanSetMediaProtection(actor, parsed.id!)
    : (isCodingPersonKey(key) || key === "ui.home_layout") && parsed.kind === "person"
    ? assertCanSetCodingPersonKey(actor, parsed.id!, keyDef as { control?: Record<string, string> })
    : key === COMPANIONS_ALLOWED_KEY
    ? (isOwnerOrAdmin(actor) && (parsed.kind !== "person" || getPersonRole(parsed.id!) !== undefined)
      ? { ok: true as const, value: true as const }
      : { ok: false as const, status: 403 as const, error: COMPANIONS_PERMISSION_ERROR })
    : key === WAKEWORD_SETTING_KEY && parsed.kind === "device"
    ? assertCanAccessWakewordDeviceSetting(actor)
    : key === "search.page_text_cleaning" && parsed.kind === "person"
      ? assertCanSetPageTextCleaning(actor, parsed.id!)
    : key.startsWith("topics.") && parsed.kind === "person"
      ? assertCanSetChildTopic(actor, parsed.id!)
      : assertCanAccessScope(actor, parsed, "write");
  if (!auth.ok) return auth;


  db.delete(settingsValues).where(and(eq(settingsValues.scope, scope), eq(settingsValues.key, key))).run();
  settingsCache.delete(settingsCacheKey(scope, key));
  const restored = isLayeredScalar(keyDef) && parsed.kind === "person" && parsed.id
    ? resolveLayeredScalar(keyDef, parsed.id, speakerAgeBand(responseSubject(actor, parsed), new Date()))
    : { value: keyDef.default, layer: "default" as const };
  return { ok: true, value: resolveForResponse(keyDef, restored.value, restored.layer === "person" || restored.layer === "household" ? "user" : "default", responseContext(actor, responseSubject(actor, parsed), parsed.kind)) };
}

/** SETTINGS-LAYERS-01b: raw access to a user-overrides row of a layered list key (a
 * `person:<id>` row of a household-scope union key). Only lib/settingsLayers.ts calls these, behind its
 * one write gate; they check nothing themselves. The value is the JSON text of a SettingsDelta. */
export function readLayerRow(personId: string, key: string): string | undefined {
  return db.select({ value: settingsValues.value }).from(settingsValues)
    .where(and(eq(settingsValues.scope, `person:${personId}`), eq(settingsValues.key, key))).get()?.value;
}

export function readLayerSetBy(personId: string, key: string): string | undefined {
  return db.select({ setBy: settingsValues.setBy }).from(settingsValues)
    .where(and(eq(settingsValues.scope, `person:${personId}`), eq(settingsValues.key, key))).get()?.setBy ?? undefined;
}

export function writeLayerRow(personId: string, key: string, jsonText: string, setBy?: string): void {
  const scope = `person:${personId}`;
  const hlc = nextHlc();
  const now = new Date().toISOString();
  const existing = db.select({ hlc: settingsValues.hlc, setBy: settingsValues.setBy }).from(settingsValues)
    .where(and(eq(settingsValues.scope, scope), eq(settingsValues.key, key))).get();
  if (existing) {
    db.update(settingsValues).set({ value: jsonText, hlc, source: "user", updatedAt: now, setBy: setBy ?? existing.setBy ?? null })
      .where(and(eq(settingsValues.scope, scope), eq(settingsValues.key, key))).run();
  } else {
    db.insert(settingsValues).values({ scope, key, value: jsonText, hlc, source: "user", updatedAt: now, setBy: setBy ?? null }).run();
  }
  settingsCache.delete(settingsCacheKey(scope, key));
}

export function deleteLayerRow(personId: string, key: string): void {
  const scope = `person:${personId}`;
  db.delete(settingsValues).where(and(eq(settingsValues.scope, scope), eq(settingsValues.key, key))).run();
  settingsCache.delete(settingsCacheKey(scope, key));
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
  // Which scopes this touched isn't known without a second query - clears
  // the whole cache rather than risk leaving a stale entry behind for one
  // of them (see the cache's own comment above); this path runs on an
  // admin deleting a cloned voice, not on any per-turn hot path.
  settingsCache.clear();
}
