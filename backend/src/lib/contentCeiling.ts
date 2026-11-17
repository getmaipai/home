// The content ceiling (session-c-brain-and-voice.md step 7,
// spec/schemas/content-ceiling.schema.json): how explicit a generated
// reply may be for one age band. One record per band (child, teen,
// adult) - not a per-household custom profile yet (that authoring UI is
// future, deferred work, docs/BACKLOG.md's own "nine sliders" entry, and
// the activation-steering spike this session already ran ahead of it,
// step 4). These three records are code, not data read from
// spec/fixtures/records/ at runtime - the fixtures exist to prove the
// schema round-trips (spec/tests/{ts,py}/fixtures.test.ts), the same
// "generated bindings, plus a fixture that validates against them"
// pattern every other spec record already follows; matching every other
// built-in table in this codebase (persona.ts's PERSONAS, the legacy
// hub's own BUILTIN_PROFILES this dial architecture is ported from),
// these three are a real, committed, reviewed decision, not configuration
// loaded from a JSON file a household could edit by hand.
//
// Register only, completely separate from spec/safety/ts/classifier.ts's
// own hard refuse/allow_with_resources categories: checkSafety() never
// reads a ceiling and never will (see FLOOR's own comment below). There
// is no path to "unrestricted" today - reaching past the adult ceiling
// needs a one-time signed adult acknowledgment, a Grant
// (spec/schemas/grant.schema.json already ships `chat.unrestricted`/
// `generate.unrestricted` actions with `acknowledged_at`/
// `acknowledged_by_person_id` for exactly this), but session-f-platform-
// and-trust.md step 7 (the hub table, routes, and requireRole wiring for
// Grant) has not landed yet - F is at step 5 as of this writing. A real,
// deferred gap: hasUnrestrictedGrant() below always returns false until
// that lands, which is the safe direction for this specific gap to fail
// in (nobody can reach past "adult" by a code path that doesn't exist
// yet, rather than a code path that silently grants too much).
import type { AgeBand } from "@/lib/ageBand";
import type { ContentCeiling } from "@maipai/spec/gen/ts/content-ceiling.js";
import type { Pass } from "@/lib/filter/pass";

// Documentation, not enforcement, exactly like the schema field it
// mirrors: the classifier's own hard-refuse categories (self_harm
// excluded - that one is allow_with_resources, never refuse) that no
// dial on any band, present or future, can ever reach. Identical across
// every band on purpose (a test in spec/tests/{ts,py}/fixtures.test.ts
// asserts this about the fixtures; CONTENT_CEILINGS below asserts the
// same thing about these code constants via a unit test).
const FLOOR: ContentCeiling["floor"] = [
  "harmful_request",
  "credible_threat",
  "csam",
  "grooming",
  "pii_extraction",
  "prompt_injection",
  "jailbreak",
];

export const CONTENT_CEILINGS: Readonly<Record<AgeBand, ContentCeiling>> = {
  child: {
    band: "child",
    dials: {
      profanity: "off",
      sexual: "off",
      violence: "off",
      substances: "off",
      crime: "off",
      hate: "off",
      self_harm: "off",
      privacy: "off",
    },
    floor: FLOOR,
    topics: {
      bodies: { stance: "redirect", allowed: ["redirect", "gentle"], fixed: false },
      health: { stance: "gentle", allowed: ["gentle", "redirect"], fixed: false },
      feelings: { stance: "support", allowed: ["support"], fixed: true },
      risk: { stance: "gentle", allowed: ["gentle", "redirect"], fixed: false },
      violence: { stance: "gentle", allowed: ["gentle", "redirect"], fixed: false },
      people: { stance: "protect", allowed: ["protect"], fixed: true },
      beliefs: { stance: "neutral", allowed: ["neutral"], fixed: true },
    },
    family_stories: { default: "keep", names: ["Santa Claus", "the Tooth Fairy", "the Easter Bunny"] },
    hlc: "0:0:builtin",
  },
  teen: {
    band: "teen",
    dials: {
      profanity: "mild",
      sexual: "off",
      violence: "moderate",
      substances: "off",
      crime: "off",
      hate: "off",
      self_harm: "off",
      privacy: "public",
    },
    floor: FLOOR,
    topics: {
      bodies: { stance: "informative", allowed: ["informative", "redirect"], fixed: false },
      health: { stance: "informative", allowed: ["informative"], fixed: true },
      feelings: { stance: "support", allowed: ["support"], fixed: true },
      risk: { stance: "informative", allowed: ["informative", "redirect"], fixed: false },
      violence: { stance: "informative", allowed: ["informative"], fixed: true },
      people: { stance: "protect", allowed: ["protect"], fixed: true },
      beliefs: { stance: "neutral", allowed: ["neutral"], fixed: true },
    },
    hlc: "0:0:builtin",
  },
  adult: {
    band: "adult",
    dials: {
      profanity: "unrestricted",
      sexual: "unrestricted",
      violence: "unrestricted",
      substances: "discuss",
      crime: "discuss",
      hate: "fiction",
      self_harm: "discuss",
      privacy: "public",
    },
    floor: FLOOR,
    hlc: "0:0:builtin",
  },
};

// A code review (2026-09-06) found `Readonly<...>` above is compile-time
// only - nothing stopped a runtime mutation (an `as any` escape hatch, a
// JSON round-trip, plain untyped JS) from silently rewriting a band's
// dials or floor once TypeScript's own type erasure removes the check.
// Real, not decorative, enforcement for a safety-invariant-adjacent
// constant: `Object.freeze()` throws in strict mode (every module here
// runs as an ES module, always strict) on an attempted write, rather
// than silently no-opping the way a non-strict assignment to a frozen
// object would.
Object.freeze(FLOOR);
for (const ceiling of Object.values(CONTENT_CEILINGS)) {
  Object.freeze(ceiling.dials);
  for (const family of Object.values(ceiling.topics ?? {}) as { allowed: string[] }[]) {
    Object.freeze(family.allowed);
    Object.freeze(family);
  }
  if (ceiling.topics) Object.freeze(ceiling.topics);
  if (ceiling.family_stories) {
    Object.freeze(ceiling.family_stories.names);
    Object.freeze(ceiling.family_stories);
  }
  Object.freeze(ceiling);
}
Object.freeze(CONTENT_CEILINGS);

export function getCeilingForBand(band: AgeBand): ContentCeiling {
  return CONTENT_CEILINGS[band];
}

/** A child or teen record always carries `topics` (the spec leaves it optional because an adult has none): the one place that says so. */
export type MinorCeiling = ContentCeiling & { topics: NonNullable<ContentCeiling["topics"]> };
export function getMinorCeilingForBand(band: "child" | "teen"): MinorCeiling {
  const record = CONTENT_CEILINGS[band];
  if (!record.topics) throw new Error(`The ${band} content ceiling has no topics: the bundled ceiling records are incomplete; reinstall the app.`);
  return record as MinorCeiling;
}

/** Always false until session-f-platform-and-trust.md step 7 ships a
 * real grants table this can query - see this file's own header for
 * why "no grant reachable yet" is the correct, safe state for that gap
 * to be in, not a placeholder to silently work around. Takes a personId
 * (not yet used) so every real call site is already shaped correctly for
 * the day this stops being a stub. */
export function hasUnrestrictedGrant(_personId: string): boolean {
  return false;
}

// ---------------------------------------------------------------------------------------------------------
// CONTENT-POLICY-05: the dials as a projection of the pass (design "Settings and ceiling projection").
// Only the eight dials move. `topics`, `family_stories` and `floor` stay the person's own age group's
// (CONTENT_CEILINGS[pass.band]): C6 lists the topic block, its hard lines and family stories as role defaults only an
// admin's `topics.*` override changes. The dials guide the model; every deterministic check stays where it is.

export type ContentDials = ContentCeiling["dials"];
const DIAL_ROW: Readonly<Record<0 | 1 | 2 | 3 | 4, AgeBand>> = { 0: "child", 1: "teen", 2: "teen", 3: "adult", 4: "adult" };
const FILTER_KINDS = ["swearing", "drugs", "gambling", "gore", "sexual"] as const;
type DialFilter = (typeof FILTER_KINDS)[number];

/** The person's added content filters as the pass resolved them, in a fixed order. Anything that is not a known kind is ignored. */
function addedFiltersOf(pass: Pass): DialFilter[] {
  const raw = pass.settings["content.filters"];
  const have = new Set(Array.isArray(raw) ? raw : []);
  return FILTER_KINDS.filter((kind) => have.has(kind));
}

function oneStepTighter<T extends string>(order: readonly T[], value: T): T {
  return order[Math.max(0, order.indexOf(value) - 1)]!;
}

function applyFilters(start: ContentDials, filters: readonly DialFilter[]): ContentDials {
  const dials = { ...start };
  for (const kind of filters) {
    if (kind === "swearing") dials.profanity = "off";
    else if (kind === "sexual") dials.sexual = "off";
    else if (kind === "drugs") dials.substances = "off";
    else if (kind === "gore" && dials.violence === "unrestricted") dials.violence = "moderate"; // capped below graphic
    else if (kind === "gambling") dials.crime = oneStepTighter(["off", "discuss", "unrestricted"] as const, dials.crime);
  }
  return dials;
}

export interface DialProjection {
  dials: ContentDials;
  /** True when the dials equal the person's own age group's row, so the plain per-age-group caches may serve them. */
  plain: boolean;
  /** `p:<readerBand>:<startRow>:<sortedFilters>`: everything that shapes the dials, never equal to a plain age-group key. */
  key: string;
}

/** The eight dials for this pass and kind of content. They start from the row the pass's resolved ceiling for the kind gives (G the
 * child row, PG and PG-13 the teen row, R and X the adult row; an admin's override either way and a person's own lowering both move
 * it), then the person's added content filters tighten them. `chat` readers pass "chat", the news and article summaries "news". */
export function dialsFor(pass: Pass, kind: "chat" | "news"): ContentDials {
  return applyFilters(CONTENT_CEILINGS[DIAL_ROW[pass.ceiling[kind]]].dials, addedFiltersOf(pass));
}

export function projectionOf(pass: Pass, kind: "chat" | "news"): DialProjection {
  const startRow = DIAL_ROW[pass.ceiling[kind]];
  const filters = addedFiltersOf(pass);
  const dials = applyFilters(CONTENT_CEILINGS[startRow].dials, filters);
  const own = CONTENT_CEILINGS[pass.band].dials;
  const plain = (Object.keys(own) as (keyof ContentDials)[]).every((dial) => own[dial] === dials[dial]);
  return { dials, plain, key: `p:${pass.band}:${startRow}:${[...filters].sort().join(",")}` };
}

/** The ceiling record a summary prompt carries: the person's own age group's record with only the dials replaced. For a reader whose
 * projection is plain this is byte for byte `CONTENT_CEILINGS[band]`. */
export function ceilingRecordFor(pass: Pass | undefined, band: AgeBand, kind: "chat" | "news"): ContentCeiling {
  const record = CONTENT_CEILINGS[pass?.band ?? band];
  return pass ? { ...record, dials: dialsFor(pass, kind) } : record;
}
