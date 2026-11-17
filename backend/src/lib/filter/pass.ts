/**
 * OVERRIDES-01 (RULES.md C3, C4, C6; design record 5a): the pass. One small in-memory record per person, worked out once from the
 * role's defaults, the admin's overrides, the person's own lowering, their grants and the installed packages, and rebuilt on the next
 * read after any write to one of those (`passCache.ts` holds the cache and the invalidation, called from settings, grants, people and
 * package code). Every choke point reads it: the door's ceiling, the stored-rating lists, the app list, today's per-person protection
 * settings. It is never logged, put on a status page or returned by an API as a whole. `buildPass` is the only place that reads
 * settings, grants, the role and the installed packages for this. Prohibited and crisis handling are not here: no ceiling can reach 5
 * and `safety.ts` reads nothing from this module (C6).
 */
import { rankOf } from "@maipai/spec/ratings/ts/contentRating";
import { db } from "@/db";
import { people } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { audienceBand, stricterBand, type AgeBand } from "@/lib/audience";
import { resolveLayeredScalar } from "@/lib/layeredScalar";
import { getRegistry, getRegistryKey } from "@/lib/settingsRegistry";
import { ACCESS_THINKING_KEY, ACCESS_TIER_BOOST_KEY, ACCESS_TIER_MAX_KEY, ACCESS_WORKS, CONTENT_CEILING_KEY, CONTENT_KINDS, CONTENT_OWN_CEILING_KEY, CONTENT_OWN_UNRATED_KEY, CONTENT_UNRATED_KEY } from "@/settings/accessKeys";
import type { PersonRow } from "@/types";
import { ceilingFor, type Ceiling } from "./ceiling";
import { getCachedPass, invalidatePass, nextPassVersion, putCachedPass } from "./passCache";

export { invalidatePass };
export type ContentKind = "chat" | "web" | "news" | "library" | "made";
export interface Pass {
  readonly person_id: string;
  readonly version: number;
  readonly access: ReadonlySet<string>;
  readonly ceiling: Readonly<Record<ContentKind, Ceiling>>;
  readonly unrated: ReadonlySet<ContentKind>;
  readonly band: AgeBand;
  /** The resolved values of the per-person protection settings the readers use (search.safe_search, media.allowlist_only, synths.*, topics.*). */
  readonly settings: Readonly<Record<string, unknown>>;
}
type PassPerson = Pick<PersonRow, "id" | "role" | "controls">;

// The door must stay light (tests/filter/adult-module-graph.ts), and settings, grants and plugins import most of Home, so the build reads them
// through a synchronous require on its first use. The pass is built from a request or a list read, never at import time.
const settingsModule = () => require("@/lib/settings") as typeof import("@/lib/settings");
const grantsModule = () => require("@/lib/grants") as typeof import("@/lib/grants");
const pluginsModule = () => require("@/lib/plugins") as typeof import("@/lib/plugins");

const KINDS = CONTENT_KINDS as readonly ContentKind[];
const MAX_RANK = 4;

function levelRank(value: unknown): Ceiling | null {
  if (typeof value !== "string") return null;
  const rank = rankOf(value as never);
  if (rank === null || rank === undefined) return null;
  return Math.min(rank, MAX_RANK) as Ceiling; // Prohibited is not a ceiling anywhere: a stored one reads as X, never 5 (C6)
}
function scalar(key: string, personId: string, band: AgeBand): unknown {
  const def = getRegistryKey(key);
  return def ? resolveLayeredScalar(def, personId, band).value : undefined;
}
function listOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && (ACCESS_WORKS as readonly string[]).includes(entry)) : [];
}

let protectionKeys: string[] | undefined;
function personProtectionKeys(): string[] {
  protectionKeys ??= getRegistry().filter((def) => def.scope === "person" && (def.key === "search.safe_search" || def.key === "media.allowlist_only" || def.key.startsWith("synths.") || def.key.startsWith("topics."))).map((def) => def.key);
  return protectionKeys;
}

function buildFrom(person: PassPerson): Pass {
  const band = audienceBand(person);
  const roleCeiling = ceilingFor(band);
  const ceiling = {} as Record<ContentKind, Ceiling>;
  const unrated = new Set<ContentKind>();
  const ownUnratedNo = scalar(CONTENT_OWN_UNRATED_KEY, person.id, band) === "no";
  for (const kind of KINDS) {
    const kindValue = scalar(`${CONTENT_CEILING_KEY}.${kind}`, person.id, band);
    const adminRank = (kindValue !== "default" ? levelRank(kindValue) : null) ?? levelRank(scalar(CONTENT_CEILING_KEY, person.id, band)) ?? roleCeiling;
    const ownKind = scalar(`${CONTENT_OWN_CEILING_KEY}.${kind}`, person.id, band);
    const ownRank = (ownKind !== "default" ? levelRank(ownKind) : null) ?? levelRank(scalar(CONTENT_OWN_CEILING_KEY, person.id, band));
    ceiling[kind] = ownRank === null ? adminRank : (Math.min(adminRank, ownRank) as Ceiling);
    const unratedValue = scalar(`${CONTENT_UNRATED_KEY}.${kind}`, person.id, band);
    const allowed = unratedValue === "yes" || (unratedValue !== "no" && scalar(CONTENT_UNRATED_KEY, person.id, band) === true);
    if (allowed && !ownUnratedNo) unrated.add(kind);
  }

  const access = new Set<string>();
  if (scalar(ACCESS_THINKING_KEY, person.id, band) === true) access.add("thinking");
  for (const work of listOf(scalar(ACCESS_TIER_BOOST_KEY, person.id, band))) access.add(`tier.boost:${work}`);
  for (const work of listOf(scalar(ACCESS_TIER_MAX_KEY, person.id, band))) {
    if (band === "child" || (band === "teen" && work !== "image")) continue; // rules 0 and 8: no override gives a child Max, or a teen Max beyond pictures
    access.add(`tier.max:${work}`);
  }
  if (person.role === "owner" || person.role === "admin") access.add("tier.max:*");

  const now = new Date().toISOString();
  const grants = grantsModule().listGrants(person.id).filter((grant) => grantsModule().isGrantActive({ validFrom: grant.valid_from, validTo: grant.valid_to }, now));
  const denied = new Set(grants.filter((grant) => grant.effect === "deny").map((grant) => grant.action));
  const { listInstalledManifests, meetsMinRole } = pluginsModule();
  for (const manifest of listInstalledManifests()) {
    // An allow grant never lifts `min_role` for a child or teen (C7): meetsMinRole stays the gate.
    if (meetsMinRole(person.role, manifest.min_role) && !denied.has(`use:${manifest.id}`)) access.add(`use:${manifest.id}`);
  }
  for (const grant of grants) if (grant.effect === "allow" && !denied.has(grant.action) && !grant.action.startsWith("use:")) access.add(grant.action);

  const settings: Record<string, unknown> = {};
  for (const key of personProtectionKeys()) settings[key] = settingsModule().getPersonSettingValue(person as PersonRow, key);

  return Object.freeze({ person_id: person.id, version: nextPassVersion(), access, ceiling: Object.freeze(ceiling), unrated, band, settings: Object.freeze(settings) });
}

/** The pass for a person row we already hold (a stale entry from another role or controls is rebuilt, so a changed role never reads old). */
export function passForPerson(person: PassPerson): Pass {
  const hit = getCachedPass(person.id);
  if (hit && hit.role === person.role && hit.controls === (person.controls ?? null)) return hit.pass;
  const pass = buildFrom(person);
  putCachedPass(person.id, { pass, role: person.role, controls: person.controls ?? null });
  return pass;
}

export function buildPass(personId: string): Pass {
  const row = db.select().from(people).where(and(eq(people.id, personId), isNull(people.deletedAt))).get();
  const person: PassPerson = row ?? { id: personId, role: "child", controls: null } as PassPerson;
  const pass = buildFrom(person);
  putCachedPass(personId, { pass, role: person.role, controls: person.controls ?? null });
  return pass;
}

export function passFor(personId: string): Pass {
  const hit = getCachedPass(personId);
  return hit ? hit.pass : buildPass(personId);
}

const CHILD_SURFACE: PassPerson = { id: "surface:child", role: "child", controls: null } as PassPerson;
/** The pass a surface gets: the actor's own, tightened to the surface band's role defaults when the surface is stricter than the actor
 * (an unknown speaker on a shared surface gets the child result, rule 0); with no actor, the child role's default pass. */
export function passForSurface(audience: { actor?: PassPerson | null; band: AgeBand }): Pass {
  const actor = audience.actor ?? CHILD_SURFACE;
  const base = passForPerson(actor);
  const band = audience.actor ? stricterBand(base.band, audience.band) : "child";
  if (audience.actor && band === base.band) return base;
  const key = `${actor.id}@${band}`;
  const hit = getCachedPass(key);
  if (hit && hit.role === actor.role && hit.controls === (actor.controls ?? null) && hit.pass.version === base.version) return hit.pass;
  const floor = ceilingFor(band);
  const ceiling = {} as Record<ContentKind, Ceiling>;
  for (const kind of KINDS) ceiling[kind] = Math.min(base.ceiling[kind], floor) as Ceiling;
  const derived: Pass = Object.freeze({ ...base, ceiling: Object.freeze(ceiling), unrated: new Set<ContentKind>(), band });
  putCachedPass(key, { pass: derived, role: actor.role, controls: actor.controls ?? null });
  return derived;
}
