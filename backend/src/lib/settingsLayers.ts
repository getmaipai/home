// SETTINGS-LAYERS-01b: the one resolver and the one write gate for settings that come in layers.
//
// Naming, everywhere: user overrides > global defaults > user defaults (Kids, Teens, Adults).
//   - user defaults   scope `band:<child|teen|adult>`, held today under the band-named household keys a
//                     key lists in `user_defaults_keys` (01e moves them to band rows);
//   - global defaults scope `household`;
//   - user overrides  scope `person:<id>`; a list key (merge: union) stores a SettingsDelta there that only
//                     adds and removes entries, so a later change to a layer above flows through.
//
// What no layer can change (rule 0/10, SAFETY.md): the locked lists for a band (derived here from
// `lockedListIds`; always in the result and never removable), the locked adult-site host list, hard lines, the crisis overlay
// and the output gate. Those are enforced where they live; this file never loosens them and re-adds the
// locked lists on every read.
//
// The write gate (changeOverrides, backToUserDefaults) is the only code that writes a user-overrides row of
// a list key. Its rules:
//   - an owner or admin sets entries on a child's or a teen's overrides, stamped with the admin's id;
//   - a person sets their own entries, stamped `self`; a child sets none (guardian-held), a teen only
//     tightens, an adult changes their own freely;
//   - nobody but an admin lifts or reads an entry an admin set (a child or teen cannot);
//   - an admin never reads or touches a teen's or an adult's own (`self`) entries;
//   - an unknown list or a bad site name is refused with what to type instead.
import { SettingsDelta } from "@maipai/spec/gen/ts/settings-delta.js";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { getPersonRole, isOwnerOrAdmin } from "@/lib/access";
import { speakerAgeBand, type AgeBand } from "@/lib/ageBand";
import { blocklistIds, defaultListIds, lockedListIds } from "@/lib/blocklists/policy";
import { parseHostEntries } from "@/lib/blocklists/customHosts";
import { checkHost } from "@/lib/blocklists/hostLists";
import { nextHlc } from "@/lib/hlc";
import {
  deleteLayerRow,
  getHouseholdSettingValue,
  readLayerRow,
  writeLayerRow,
  type SettingsOpResult,
} from "@/lib/settings";
import { validateWebSources, WEB_SOURCE_IDS } from "@/lib/retrieval/webSources";
import { getRegistry, getRegistryKey } from "@/lib/settingsRegistry";
import type { PersonRow } from "@/types";

export type DeltaEntry = { item: string; set_by: string; hlc: string };
export type Delta = { add: DeltaEntry[]; remove: DeltaEntry[] };
export type Layer = "user-default" | "global-default" | "user-override";

export interface UnionResult {
  /** The effective entries, sorted. */
  items: string[];
  /** Which layer each effective entry comes from. */
  source: Record<string, Layer>;
}

export const SELF = "self";
const HOSTS_ALLOW = "search.hosts.allow";

const EMPTY: Delta = { add: [], remove: [] };

/** The key's layering declaration, or undefined when the key is not a layered list. */
function unionKey(key: string) {
  const def = getRegistryKey(key);
  if (!def || def.merge !== "union" || !def.layers?.includes("person")) return undefined;
  return def;
}

function toItems(key: string, raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === "string");
  if (typeof raw === "string") return key === "search.blocklists" ? [] : parseHostEntries(raw);
  return [];
}

function personBand(person: PersonRow): AgeBand {
  return speakerAgeBand(person, new Date());
}

function personById(id: string): PersonRow | undefined {
  return db.select().from(people).where(eq(people.id, id)).get();
}

/** The user-defaults layer for one band: the band-named household key the spec points at. An unset
 * blocklist choice means the spec's defaults for the band; an unset host list is empty. */
export function userDefaultItems(key: string, band: AgeBand): string[] {
  const def = unionKey(key);
  const bandKey = def?.user_defaults_keys?.[band];
  if (!bandKey) return [];
  let stored: unknown;
  try {
    stored = getHouseholdSettingValue(bandKey);
  } catch {
    stored = undefined;
  }
  if (key === "search.blocklists") {
    const known = new Set(blocklistIds());
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string" && known.has(id)) : defaultListIds(band);
  }
  return toItems(key, stored);
}

/** The global-defaults layer: the household's own value of the key. */
export function globalDefaultItems(key: string): string[] {
  try {
    return toItems(key, getHouseholdSettingValue(key));
  } catch {
    return [];
  }
}

/** A user-overrides row, parsed. An unreadable row reads as no change from the layers above, which is what
 * the person gets until an admin resets it; the write gate refuses to build on one (see readDeltaForWrite). */
function readDelta(personId: string, key: string): Delta {
  const text = readLayerRow(personId, key);
  if (text === undefined) return EMPTY;
  try {
    const parsed = SettingsDelta.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : EMPTY;
  } catch {
    return EMPTY;
  }
}

function readDeltaForWrite(personId: string, key: string): Delta | undefined {
  const text = readLayerRow(personId, key);
  if (text === undefined) return EMPTY;
  try {
    const parsed = SettingsDelta.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** The layered list keys, from the registry. */
export function layeredListKeys(): string[] {
  return getRegistry().filter((def) => def.merge === "union" && def.layers?.includes("person")).map((def) => def.key);
}

/** The lists a band cannot turn off (always part of the result for `search.blocklists`). */
function lockedFor(key: string, band: AgeBand): string[] {
  return key === "search.blocklists" ? lockedListIds(band) : [];
}

/** The effective entries of a layered list key for a band and, when given, a person. With no person the
 * result is the band-and-household view every caller had before person overrides existed. The band's
 * locked lists are always in the result, whatever any layer says. Callers outside the settings code read
 * through the key-specific helpers (enabledListIds, customHostRules), not this. */
export function resolveUnion(key: string, opts: { band: AgeBand; personId?: string | null }): UnionResult {
  const source: Record<string, Layer> = {};
  for (const item of userDefaultItems(key, opts.band)) source[item] = "user-default";
  for (const item of globalDefaultItems(key)) source[item] = "global-default";
  if (opts.personId) {
    const delta = readDelta(opts.personId, key);
    for (const entry of delta.remove) delete source[entry.item];
    for (const entry of delta.add) source[entry.item] = "user-override";
  }
  for (const item of lockedFor(key, opts.band)) source[item] = source[item] ?? "user-default";
  return { items: Object.keys(source).sort(), source };
}

/** The band a person is held to. */
export function bandOfPerson(personId: string): AgeBand {
  const person = personById(personId);
  return person ? personBand(person) : "child";
}

// ---------------------------------------------------------------------------------------------------------
// Reading overrides

export interface OverrideEntry extends DeltaEntry {
  /** `self` or an admin's id; the People page shows it as "set by you" or the admin's name. */
  by: "self" | "admin";
}

export interface OverrideView {
  add: OverrideEntry[];
  remove: OverrideEntry[];
  /** True when entries were left out because the viewer may not see them. */
  hidden: boolean;
}

function viewKind(viewer: PersonRow, target: { id: string; role: string }): "self" | "admin-of-child" | "admin-other" | "none" {
  if (viewer.id === target.id) return "self";
  if (!isOwnerOrAdmin(viewer)) return "none";
  return target.role === "child" ? "admin-of-child" : "admin-other";
}

/** What `viewer` may see of `targetId`'s overrides for one key:
 *   - the person themself: their own entries, plus their admin-set ones only when they are an adult
 *     (a child or teen never reads what an admin set);
 *   - an owner or admin: everything of a child's; of a teen's or an adult's, only the admin-set entries,
 *     never the person's own choices. */
export function readOverrides(viewer: PersonRow, targetId: string, key: string): SettingsOpResult<OverrideView> {
  if (!unionKey(key)) return { ok: false, status: 400, error: `${key} is not a setting with user overrides. Pick one of the site-block settings.` };
  const role = getPersonRole(targetId);
  if (!role) return { ok: false, status: 403, error: "That person could not be found. Pick someone from the People page." };
  const kind = viewKind(viewer, { id: targetId, role });
  if (kind === "none") return { ok: false, status: 403, error: "Only the person or a household owner or admin can see these settings. Ask an owner or admin." };
  const delta = readDelta(targetId, key);
  const minorSelf = kind === "self" && (role === "child" || role === "teen");
  const show = (entry: DeltaEntry): boolean => {
    if (kind === "self") return minorSelf ? entry.set_by === SELF : true;
    if (kind === "admin-of-child") return true;
    return entry.set_by !== SELF;
  };
  const shape = (entry: DeltaEntry): OverrideEntry => ({ ...entry, by: entry.set_by === SELF ? "self" : "admin" });
  const hiddenCount = [...delta.add, ...delta.remove].filter((e) => !show(e)).length;
  return {
    ok: true,
    value: { add: delta.add.filter(show).map(shape), remove: delta.remove.filter(show).map(shape), hidden: hiddenCount > 0 },
  };
}

/** How many changes a person's overrides make on top of their user defaults, as far as `viewer` may count
 * them (the People page label, "Teen + 3 changes"). Never counts what the viewer may not see. */
export function visibleOverrideCount(viewer: PersonRow, targetId: string, keys: readonly string[]): number {
  let count = 0;
  for (const key of keys) {
    const view = readOverrides(viewer, targetId, key);
    if (view.ok) count += view.value.add.length + view.value.remove.length;
  }
  return count;
}

// ---------------------------------------------------------------------------------------------------------
// The one write gate

export interface LayerChange {
  add?: readonly string[];
  remove?: readonly string[];
}

/** Whether adding an entry makes the key stricter (a block) or looser (an allow). */
function addTightens(key: string): boolean {
  return key !== HOSTS_ALLOW;
}

function normalizeItem(key: string, raw: string): { ok: true; item: string } | { ok: false; error: string } {
  const text = raw.trim();
  if (key === "search.blocklists") {
    if (!blocklistIds().includes(text)) return { ok: false, error: `"${text.slice(0, 40)}" is not a kind of site Home can block. Pick one from the list.` };
    return { ok: true, item: text };
  }
  const hosts = parseHostEntries(text);
  if (hosts.length !== 1) return { ok: false, error: `"${text.slice(0, 60)}" is not a site name. Type a name like example.com, one at a time.` };
  return { ok: true, item: hosts[0]! };
}

function deny(error: string): { ok: false; status: 403; error: string } {
  return { ok: false, status: 403, error };
}

function saveDelta(personId: string, key: string, delta: Delta): void {
  if (delta.add.length === 0 && delta.remove.length === 0) deleteLayerRow(personId, key);
  else writeLayerRow(personId, key, JSON.stringify(delta));
}

/** Who a write is, to the gate. */
function writer(actor: PersonRow, targetId: string, targetRole: string): { by: string; kind: "self" | "admin" } | { error: string } {
  if (actor.id === targetId) return { by: SELF, kind: "self" };
  if (isOwnerOrAdmin(actor) && (targetRole === "child" || targetRole === "teen")) return { by: actor.id, kind: "admin" };
  return { error: "Only the person, or a household owner or admin for a child or teen, can change these. Ask one of them to open the person's page." };
}

/** The one write gate for a person's overrides of a layered list key. Returns the person's new effective
 * list. The band's locked lists are never removable and a locked adult-site host is never allowed. */
export function changeOverrides(actor: PersonRow, targetId: string, key: string, change: LayerChange): SettingsOpResult<UnionResult> {
  if (!unionKey(key)) return { ok: false, status: 400, error: `${key} is not a setting with user overrides. Pick one of the site-block settings.` };
  const role = getPersonRole(targetId);
  if (!role) return deny("That person could not be found. Pick someone from the People page.");
  const w = writer(actor, targetId, role);
  if ("error" in w) return deny(w.error);
  const band = bandOfPerson(targetId);
  const minor = role === "child" || role === "teen" || band === "child" || band === "teen";
  const locked = new Set(lockedFor(key, band));

  const adds: string[] = [];
  const removes: string[] = [];
  for (const raw of change.add ?? []) {
    const n = normalizeItem(key, raw);
    if (!n.ok) return { ok: false, status: 400, error: n.error };
    adds.push(n.item);
  }
  for (const raw of change.remove ?? []) {
    const n = normalizeItem(key, raw);
    if (!n.ok) return { ok: false, status: 400, error: n.error };
    removes.push(n.item);
  }

  const current = readDeltaForWrite(targetId, key);
  if (!current) return deny("This person's saved site settings could not be read, so Home will not change them. Use Back to the age group's settings on their page to reset them, then try again.");
  const tightens = addTightens(key);
  const delta: Delta = { add: [...current.add], remove: [...current.remove] };
  if (w.kind === "self" && minor) {
    if (role === "child") return deny("A household owner or admin changes site blocks for a child. Ask one of them to open your page.");
    // A teen only tightens: an added block is fine, an added allow is not, and a removal is fine only
    // for a block the teen added themself and that no layer above also holds.
    if (!tightens && (adds.length > 0 || removes.length > 0)) return deny("A teen can add blocks but not allow a site. Ask a household owner or admin to change it.");
  }
  for (const item of removes) {
    if (locked.has(item)) return deny("That block can't be turned off for this age group. It keeps the person safe.");
  }
  if (!tightens && minor && lockedListIds(band).length > 0) {
    for (const item of adds) {
      const hit = checkHost(band, item);
      if (hit && lockedListIds(band).includes(hit)) return deny("That site is on the adult-site list, which stays blocked for children and teens. It can't be allowed.");
    }
  }

  const baseline = new Set([...userDefaultItems(key, band), ...globalDefaultItems(key)]);
  const hlc = nextHlc();

  // What the gate may not touch: an entry an admin set (unless the writer is an admin), and, for an admin,
  // anything the person set themself on a teen's or an adult's overrides.
  const mayTouch = (entry: DeltaEntry): string | null => {
    if (w.kind === "self") {
      if (entry.set_by !== SELF && role !== "adult") return "An owner or admin set that. Only they can change it.";
      return null;
    }
    if (entry.set_by === SELF && role !== "child") return "That is the person's own choice. Only they can change it.";
    return null;
  };

  // A teen's removal must be of an own add; checked before anything changes so a refusal writes nothing.
  if (w.kind === "self" && role === "teen" && tightens) {
    const ownAdds = new Set(delta.add.filter((e) => e.set_by === SELF).map((e) => e.item));
    for (const item of removes) {
      if (!ownAdds.has(item) || baseline.has(item)) return deny("A teen can add blocks but not remove one that was already in place. Ask a household owner or admin to change it.");
    }
  }

  for (const item of adds) {
    const inRemove = delta.remove.find((e) => e.item === item);
    if (inRemove) {
      const refused = mayTouch(inRemove);
      if (refused) return deny(refused);
      delta.remove = delta.remove.filter((e) => e.item !== item);
      if (baseline.has(item)) continue; // putting a removed baseline entry back needs no entry of its own
    }
    const existing = delta.add.find((e) => e.item === item);
    if (existing) {
      if (existing.set_by === w.by || w.kind === "self") continue; // already in force
      const refused = mayTouch(existing);
      if (refused) return deny(refused);
      delta.add = delta.add.filter((e) => e.item !== item);
    } else if (baseline.has(item) && !inRemove) {
      continue; // already in force from a layer above
    }
    delta.add.push({ item, set_by: w.by, hlc });
  }

  for (const item of removes) {
    const existing = delta.add.find((e) => e.item === item);
    if (existing) {
      const refused = mayTouch(existing);
      if (refused) return deny(refused);
      delta.add = delta.add.filter((e) => e.item !== item);
    }
    if (baseline.has(item) && !delta.remove.some((e) => e.item === item)) delta.remove.push({ item, set_by: w.by, hlc });
  }

  saveDelta(targetId, key, delta);
  return { ok: true, value: resolveUnion(key, { band, personId: targetId }) };
}

/** "Back to Teen": drop a person's overrides of the given keys (all layered list keys when none are
 * named). An admin clears everything on a child's page, and on a teen's only what an admin set; a person
 * clears their own, and a child or teen never clears what an admin set. */
export function backToUserDefaults(actor: PersonRow, targetId: string, keys: readonly string[]): SettingsOpResult<{ cleared: number }> {
  const role = getPersonRole(targetId);
  if (!role) return deny("That person could not be found. Pick someone from the People page.");
  const w = writer(actor, targetId, role);
  if ("error" in w) return deny(w.error);
  if (w.kind === "self" && role === "child") return deny("A household owner or admin changes site blocks for a child. Ask one of them to open your page.");
  const names = keys.length > 0 ? keys : layeredListKeys();
  for (const key of names) {
    if (!unionKey(key)) return { ok: false, status: 400, error: `${key} is not a setting with user overrides. Pick one of the site-block settings.` };
  }
  let cleared = 0;
  for (const key of names) {
    // A row Home cannot read is cleared whole by an admin of a child, and by the person for their own.
    const delta = readDelta(targetId, key);
    // What this writer may clear: admins clear admin entries (and a child's own); a person clears their own,
    // and an adult clears everything on their own row. A teen never clears what an admin set.
    const mayClear = (e: DeltaEntry): boolean => {
      if (w.kind === "admin") return e.set_by !== SELF || role === "child";
      return e.set_by === SELF || role === "adult";
    };
    const keep = { add: delta.add.filter((e) => !mayClear(e)), remove: delta.remove.filter((e) => !mayClear(e)) };
    cleared += delta.add.length + delta.remove.length - keep.add.length - keep.remove.length;
    saveDelta(targetId, key, keep);
  }
  return { ok: true, value: { cleared } };
}

// ---------------------------------------------------------------------------------------------------------
// Override-kind keys on a household-scope key (`search.web_sources`): the person's pick replaces the global default.

const SOURCES_KEY = "search.web_sources";

/** Set (an array of source ids) or clear (null) a person's own web search sources. An adult sets their own;
 * an owner or admin sets a child's or a teen's; a child or teen never sets their own. The row is stamped with
 * who set it, and an admin never reads or touches an adult's. */
export function changeWebSources(actor: PersonRow, targetId: string, value: readonly string[] | null): SettingsOpResult<{ sources: string[] | null }> {
  const role = getPersonRole(targetId);
  if (!role) return deny("That person could not be found. Pick someone from the People page.");
  const self = actor.id === targetId;
  if (self && role !== "adult") return deny("A household owner or admin picks the web search sources for a child or teen. Ask one of them to open the person's page.");
  if (!self && !(isOwnerOrAdmin(actor) && (role === "child" || role === "teen"))) return deny("Only the person, or a household owner or admin for a child or teen, can change this. Ask one of them.");
  if (value === null) {
    deleteLayerRow(targetId, SOURCES_KEY);
    return { ok: true, value: { sources: null } };
  }
  const list = [...new Set(value)];
  const refusal = validateWebSources(SOURCES_KEY, list);
  if (refusal) return { ok: false, status: 400, error: refusal };
  if (list.some((id) => !(WEB_SOURCE_IDS as readonly string[]).includes(id))) {
    return { ok: false, status: 400, error: `Pick sources from: ${WEB_SOURCE_IDS.join(", ")}.` };
  }
  writeLayerRow(targetId, SOURCES_KEY, JSON.stringify(list), self ? SELF : actor.id);
  return { ok: true, value: { sources: list } };
}
