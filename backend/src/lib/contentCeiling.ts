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
  Object.freeze(ceiling);
}
Object.freeze(CONTENT_CEILINGS);

export function getCeilingForBand(band: AgeBand): ContentCeiling {
  return CONTENT_CEILINGS[band];
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
