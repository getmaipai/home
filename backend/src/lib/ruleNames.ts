// RVW-1 (docs/plans/chat-architecture-review-2026-09-16.md section 5,
// item 1; the org rule "no rule without a counter and a row"): the
// names of the engine's deterministic rules, the rung that answered a
// turn, and the pure readers that decide them. Every rule the engine
// fires on a turn is named here once and pushed onto the turn's
// `rules` list at the point it fires; the `[turn]` line prints the
// list and the turn row keeps it, so the weekly label export
// (scripts/bench/labels.ts) can count hits per rule and name the rules
// that never fired. A guard hit is a rule too, named `guard.<reason>`
// from the guard's own reason vocabulary (spec/vocab/defect-codes.json).
import type { TurnValue } from "@/wire";
import type { ToolExecutionOutcome } from "@/lib/turnContext";
import type { TurnSignal } from "@maipai/spec/gen/ts/turn-signal.js";

/** Which rung answered the turn: a typed source (a package whose
 * result is a typed record: the almanacs, the weather, the media and
 * knowledge lookups), the search, the model's own knowledge on a world
 * question with no lookup, a lookup ladder that ran and answered
 * nothing, or none of those (a chat turn, an action, a confirmation, a
 * refusal). */
export type Rung = "typed_source" | "search" | "model_knowledge" | "failed" | "none";

export const RUNGS: readonly Rung[] = ["typed_source", "search", "model_knowledge", "failed", "none"];

/** The packages whose answer is a typed record read from a source. An
 * action package (lights, a timer, the list) answers nothing about the
 * world, so its turn is `none`. */
const TYPED_SOURCE_PACKAGES: ReadonlySet<string> = new Set(["knowledge", "media-lookup", "weather", "news", "sports", "currency", "define", "convert", "math", "trivia"]);

export function isTypedSourcePackage(packageId: string): boolean {
  return TYPED_SOURCE_PACKAGES.has(packageId) || packageId.startsWith("almanac");
}

/** The lookup family whose ladder can fail: the search and the typed
 * sources the forced lookup runs. */
function isLookupPackage(packageId: string): boolean {
  return packageId === "websearch" || isTypedSourcePackage(packageId);
}

/** The rung, read from the delivered value, the turn's retained
 * outcomes and its signal. A K3 outcome marked `model_knowledge`
 * (evidence kind on the outcome) is read when present. */
export function rungOf(value: Pick<TurnValue, "source" | "plugin_id">, outcomes: readonly ToolExecutionOutcome[], signal: Pick<TurnSignal, "target" | "primary_act"> | undefined, opts: { householdSubject?: boolean } = {}): Rung {
  const succeededLookups = outcomes.filter((o) => o.status === "succeeded" && isLookupPackage(o.packageId));
  const answeredBySearch = succeededLookups.some((o) => o.packageId === "websearch");
  const answeredByTyped = succeededLookups.some((o) => o.packageId !== "websearch");
  if (value.source === "plugin") {
    const ids = (value.plugin_id ?? "").split("+").filter((id) => id.length > 0);
    if (ids.includes("websearch") || (ids.length === 0 && answeredBySearch)) return "search";
    if (ids.some(isTypedSourcePackage) || (ids.length === 0 && answeredByTyped)) return "typed_source";
    // A composed turn names every package; the search wins when its
    // rows were among them, a typed source when one answered.
    if (answeredBySearch) return "search";
    if (answeredByTyped) return "typed_source";
    return "none";
  }
  // A lookup ladder that ran (a forced rung, a decided lookup, a
  // consented one) and left no succeeded lookup: failed.
  const lookupRan = outcomes.some((o) => isLookupPackage(o.packageId) && o.status !== "rejected");
  if (lookupRan && succeededLookups.length === 0) return "failed";
  if (value.source === "plugin_error") return lookupRan ? "failed" : "none";
  if (value.source === "model") {
    const marked = outcomes.some((o) => (o as { evidence_kind?: unknown }).evidence_kind === "model_knowledge" || (o as { kind?: unknown }).kind === "model_knowledge");
    if (marked) return "model_knowledge";
    // A world question the model answered with no lookup on the turn;
    // a household subject's question (the lookup stood down for it) is
    // the household's, never the model's knowledge.
    if (signal && signal.primary_act === "question" && signal.target === "world" && succeededLookups.length === 0 && !opts.householdSubject) return "model_knowledge";
  }
  return "none";
}

/** The engine's deterministic rules by name. The value is the one-line
 * meaning; the key is what the `[turn]` line prints. A rule added to
 * the engine is added here in the same commit, or the export's
 * zero-hit list will not know it exists. */
export const RULES = {
  // The signal (lib/turnSignal.ts): its source, and the two freezes the
  // engine applies after routing.
  "signal.rule": "the act classifier's rule pass decided the signal",
  "signal.protocol": "the protocol layer (an answered ask, a consent) decided the signal",
  "signal.fallback": "the classifier's conservative fallback stood",
  "signal.head": "a trained head decided the signal",
  "signal.directive_freeze": "a pattern winner froze the act to directive",
  "signal.backchannel_on_subject": "a short comment on a live subject read as a backchannel",
  // The lookup decision (CHAT-13) and the draft's read (LOOKUP-01/02).
  "lookup.decided": "the lookup decision took the question before the model",
  "lookup.answered_recently": "a decided lookup stood down: the same query answered on the previous two turns",
  "lookup.household_subject": "a promise about a household subject was dropped, no lookup",
  "lookup.forced": "the forced lookup ran (a promise, a hedge, an invention, a decision)",
  "lookup.read.promise": "the draft promised a lookup",
  "lookup.read.offer": "the draft offered a lookup",
  "lookup.read.hedged_fact": "the draft hedged a checkable fact on a world question",
  "lookup.read.denial": "the draft denied a deliverable",
  "composition.grounded_fallback": "a lookup composition named a span absent from its rows and rendered the rows directly",
  "composition.empty_rows": "a lookup returned no rows and used the fixed empty-result line",
  "media.image_filtered": "image rows were filtered before inline media delivery",
  // The deliverable kinds (CHAT-16 part 4).
  "deliverable.link": "a link ask",
  "deliverable.picture": "a picture ask",
  "deliverable.video": "a video ask",
  "deliverable.back_reference": "a back-reference re-sent the last lookup's sources",
  // CONS-01's reply constraints.
  "constraint.banned_phrase": "a banned phrase was parsed and set",
  "constraint.shape": "a reply shape was parsed and set",
  "constraint.length": "a length budget was parsed and set",
  // ACT-03's plan and AGE-01's disclosure.
  "plan.deferred": "the plan deferred to a trusted adult",
  "disclosure.withheld": "a record was withheld from the band or the summary stood in",
  // The worrying class (AGE-02).
  "worrying": "the conversation read as worrying and the grown-up line was added",
  // The direct routes.
  "crisis.state": "the crisis state answered the turn",
  "crisis.stop": "a stop in the crisis state was acknowledged",
  "credential": "a credential in the utterance took the fixed line",
  "command.forget": "the forget command ran",
  "command.household": "a household command matched",
  "almanac": "the almanac answered a date or time question",
  "route.pattern": "a package's literal pattern won the floor",
  "route.embedding": "a package won the floor by embedding",
  "route.keyword": "a package won the floor by keyword overlap",
  "ask.who_answer": "an answer to the name question was parsed",
  "ask.world_answer": "the name question's answer made the name the world's",
  "ask.consent": "a consent word ran the pending lookup",
  "ask.confirm": "a yes or no resolved a pending confirmation",
  "ask.cancel": "a cancel cleared the pending ask",
  // U2c policy.ts's own grounding check (the owner's ruling, state
  // record "Grounding, stated exactly," 2a28e4e8): a string argument
  // passes on a shared content term, refuses on a bare pronoun or
  // zero overlap. Not yet pushed onto a turn's own rules list (no
  // rules-list mechanism exists on the new path yet); named here so
  // the two closed-vocabulary regexes it uses (a pure-number shape, a
  // pronoun-word split) satisfy the rule-budget lint's own marker
  // requirement honestly, not as a live-fired counter yet.
  "grounding.pure_number": "an argument token was dropped as a bare number, year, or date before the overlap check",
  "grounding.bare_pronoun": "a tool argument was refused for being a bare pronoun with no other content",
} as const;

export type RuleName = keyof typeof RULES;

export const RULE_NAMES: readonly RuleName[] = Object.keys(RULES) as RuleName[];

/** The guard reason's rule name. */
export function guardRule(reason: string): string {
  return `guard.${reason}`;
}

/** A turn's rule list: the signal's source first, the engine's rules in
 * the order they fired, then the guard hits, each once. */
export function rulesFired(engineRules: readonly string[], guardHits: readonly string[], signalSource?: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of [...(signalSource ? [`signal.${signalSource}`] : []), ...engineRules, ...guardHits.map(guardRule)]) {
    if (seen.has(r)) continue;
    seen.add(r);
    out.push(r);
  }
  return out;
}
