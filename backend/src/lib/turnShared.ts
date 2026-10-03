// THIN-0H (rule 12, ported before deleted): the pieces of the old turn
// engine that the default path (turnMachine/) still imports, moved here
// unchanged so nothing under turnMachine/ depends on turnEngine.ts and the
// old file can be deleted (THIN-7D). turnEngine.ts imports these back and
// re-exports them, so every existing caller keeps working. Behaviour is
// identical; only the file moved.
import { evaluateSafety, carriesCrisisSignal } from "@/lib/safety";
import { listPackageIds, loadManifestOnly } from "@/lib/plugins";
import { recentTurnSafety } from "@/lib/conversationHistory";
import { commandOpenersFrom } from "@/lib/routing";
import { COMPUTED_WILDCARD_RESOLVERS } from "@/lib/manifestLint";
import { notifyIfFlagged } from "@/lib/notifications";
import { hasEligibleClause } from "@/lib/turnSignal";
import { splitIntoSentences } from "@/lib/guards";
import { pickRefusalVariant, varyKnownConstant } from "@/lib/replyVariation";
import { StatusChannel } from "@/lib/statusChannel";
import { composePersonaPrompt, DEFAULT_PERSONA, INFORMATION_HANDLING_POLICY, NATURALNESS_POLICY, type Persona } from "@/lib/persona";
import { normalizeForSpeech } from "@maipai/spec/voice/ts/normalizeForSpeech.js";
import type { SurfaceClass } from "@/lib/surfaceClass";
import type { PersonRow } from "@/types";
import type { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import type { SafetyResult } from "@maipai/spec/gen/ts/safety-result.js";
import type { TurnSignal } from "@maipai/spec/gen/ts/turn-signal.js";
import type { TurnStreamEvent as ToolStreamEvent } from "@maipai/spec/stack/ts/turn-stream-event.js";
import type { TurnValue } from "@/wire";

// 4.5 names six surfaces (chat, overlay, pod, robot, tv, phone), each
// changing memory sensitivity, discretion and presentation. Only `chat`
// has anything to render it (a curl caller today, same as every other
// core slice); the other five are a real, named gap the same shape as
// llm.ts's IMPLEMENTED_ROLES, not silently missing.
export type Surface = "chat" | "overlay" | "pod" | "robot" | "tv" | "phone";
const IMPLEMENTED_SURFACES: ReadonlySet<Surface> = new Set(["chat", "robot"]);

/** Shared by TurnOpResult and TurnStreamResult: runTurn() and
 * runTurnStream() run the identical validation/safety/plugin-floor logic
 * (prepareTurn(), below) and so must report the identical error
 * vocabulary for the identical failure states - a code review
 * (2026-09-04) found the two had drifted into independently-hand-typed
 * copies of the same union, one bad refactor away from silently
 * reporting different codes for what should be the same failure. */
// APPROVE-CARD-01: 409 (`ask_stale`) is a real, deliberate addition to
// this otherwise narrow vocabulary, not the usual "map it onto 400/503
// instead" call turnBareStream.ts's own comment makes for an
// unreachable code - a stale/mismatched `ask_answer` genuinely isn't
// "invalid input" (the request is well-formed) or "the engine is
// unavailable" (nothing about the engine failed); it's a real conflict
// with server-side state the client needs to tell apart from either,
// so it could show "that ask already expired" rather than a generic
// error. New path only (turnMachine/turnNext.ts's beginTurn()) - the
// old path (runTurn()/runTurnStream() below) has no `ask_answer` field
// to ever produce one.
export type TurnFailure = { ok: false; status: 400 | 409 | 503; code: "unsupported_surface" | "invalid_input" | "unavailable" | "engine_unavailable" | "temporary_mismatch" | "ask_stale"; error: string };

/** Shared by runTurn() and runTurnStream() (a review, 2026-09-06, found
 * this exact trio of checks copy-pasted between them - the same
 * duplication class this file's own notifyIfFlagged() extraction just
 * fixed for the notify_parent blocks). Both callers' own failure shape is
 * this identical TurnFailure, so one function serves either. */
// Exported for turnBareStream.ts (ADMIN-COMPARE-01 b): the identical
// surface/length checks every turn gets, unrelated to persona/routing.
export function validateTurnInput(surface: Surface, text: string): TurnFailure | null {
  if (!IMPLEMENTED_SURFACES.has(surface)) {
    return { ok: false, status: 400, code: "unsupported_surface", error: `the ${surface} surface is not implemented on this host build yet (4.5)` };
  }
  if (typeof text !== "string" || text.trim().length === 0) {
    return { ok: false, status: 400, code: "invalid_input", error: "text is required" };
  }
  if (text.length > MAX_TURN_TEXT_LENGTH) {
    return { ok: false, status: 400, code: "invalid_input", error: `text must be ${MAX_TURN_TEXT_LENGTH} characters or fewer` };
  }
  return null;
}

/** ACT-01 (section 12 part 6): the judge's queue is keyed on the stored
 * signal. A turn with no eligible clause (only questions, directives,
 * greetings, closings, backchannels, or quoted, hypothetical, joking or
 * unknown clauses) is skipped before it is queued, about a third of
 * turns; a safety refusal and a credential turn (its text redacted)
 * are never the judge's whatever the clauses say. Null leaves the turn
 * for the judge. */
export function judgeStatusAtInsert(value: Pick<TurnValue, "source">, signal: TurnSignal): "skipped" | null {
  if (value.source === "safety_refuse" || value.source === "policy") return "skipped";
  return hasEligibleClause(signal) ? null : "skipped";
}

export type SpeakerEvidence = { person: string | null; basis: "signed_in" | "voice" | "face" | "voice_and_face" | "claimed" | "unknown"; level: "confirmed" | "tentative" | "unknown" };
export type PresentPerson = SpeakerEvidence;

export const CRISIS_RESOURCES_TEXT =
  "If you're in crisis, the 988 Suicide & Crisis Lifeline is free and available 24/7: call or text 988.";

/** The one derivation of `crisis_resources` from a SafetyResult, shared
 * by prepareTurn()'s own input-side use below and step 9's two
 * output-side call sites (runTurn(), runTurnStream()'s finalize()) - a
 * review (2026-09-05) found the streaming path's own fix for "an
 * output-side flag needs its own crisis_resources, not just the input
 * side's" had no non-streaming twin, leaving runTurn() with the
 * identical silent-drop bug the review's other finding had just fixed
 * in the stream. */
// Exported for turnBareStream.ts (ADMIN-COMPARE-01 b): crisis resources
// ("offer, never block") are the safety floor's own promise, not a
// persona flavor, so a bare turn's own minimal finalize still needs
// this - unlike finalizeReply() below, which a bare turn must NOT call
// (it persona-varies refusal and constant-reply text).
export function deriveCrisisResources(safety: SafetyResult): string | undefined {
  // CHAT-02: the crisis text follows the self_harm category, not only the
  // allow_with_resources action, so a refused reply that also mentioned
  // self-harm keeps its resources ("offer, never block").
  return carriesCrisisSignal(safety) ? CRISIS_RESOURCES_TEXT : undefined;
}

// Step 4: "identity and companion" are the first thing in the stable
// prefix, and the identity line itself now names the selected persona's
// display_name rather than a hardcoded "MaiPai" - a real gap the
// original version had (a household that picked "Buddy" still heard the
// model call itself MaiPai every turn). DEFAULT_PERSONA.display_name is
// literally "MaiPai", so this produces byte-identical text to the old
// constant for every household that never touches persona.active_id.
// Exported (PARITY-BISECT-02): scripts/bench/parity-bisect2.ts isolates
// the stable prefix's own fragments one at a time, including the
// identity line and this suffix on their own, ahead of the persona's
// dials - it needs the exact real text, never a re-typed copy.
export function identityLine(persona: Persona): string {
  return `You are ${persona.display_name}, a private, self-hosted AI assistant for this household.`;
}

// TRUEUP-01 (docs/plans/chat-trueup-2026-09-23.md, the owner's rule of
// 2026-09-23 evening: anything the new path sends without a design
// behind it comes out): the verdict table on STABLE_SYSTEM_SUFFIX_
// SENTENCES found a design behind exactly one clause of one sentence -
// the privacy promise ("Nothing you say leaves this house.") is the
// product; "concise" contradicts the reply floor; the safety-blocked
// sentence announces code that already runs and needs no announcement;
// the #67 lookup sentence and the can't-watch sentence were live
// patches for gaps the forced call (state record, the interim rule)
// and the reply floor now close by design; the remaining sentence has
// no design cited for it at all. So stableSuffixFor() now returns the
// privacy sentence alone, for both classes - PREFIX-CLASS-01's own
// written-class carve-out (indices 1, 2, 3) is superseded, not
// extended. STABLE_SYSTEM_SUFFIX and STABLE_SYSTEM_SUFFIX_SENTENCES
// above stay exactly as they are for the old path's buildSystemPrompt()
// (buildPromptParts() below no longer calls this function at all,
// inlining STABLE_SYSTEM_SUFFIX directly instead), frozen until the old
// path's own deletion (plan section 2).
export const PRIVACY_SENTENCE = "Nothing you say leaves this house.";
export function stableSuffixFor(_surfaceClass: SurfaceClass): string {
  return PRIVACY_SENTENCE;
}

export interface LoadedManifest {
  id: string;
  manifest: PackageManifest;
}

// One catalog scan per turn, shared by route() and buildSystemPrompt()'s
// plugins list, instead of each loading (readFileSync + JSON.parse + Zod
// safeParse) every bundled package's manifest independently (a review,
// 2026-09-04, found the first cut doing this twice per turn, or three
// times for a turn that also fires a plugin). Sorted by id: `route()`'s
// tie-break among equally-scored candidates depends on this order, so it
// needs to be deterministic and independent of `readdirSync`'s
// OS-dependent enumeration order, not just "whatever order the disk
// returns," even though only one bundled package exists to tie against
// today.
//
// `loadManifestOnly()`, not `lib/plugins.ts`'s own `loadPackage()`: a
// real bug found by code review (session-d-packages-and-store.md step
// 7, the first time a routing-corpus row ever named a Tier 1 package) -
// `loadPackage()` deliberately REJECTS anything but `tier: 0` (its own
// header: "use runPlugin(), not loadPackage(), for a Tier 1 one"), so
// every Tier 1 package (knowledge, and now every almanac-* one) was
// silently invisible to route() and to buildSystemPrompt()'s own
// plugins list from the day Tier 1 shipped (step 5) - nothing caught it
// because no routing-corpus row had ever named one until now.
// route()/buildSystemPrompt() only ever need the manifest (routing
// examples/patterns, args, description), never the recipe -
// loadManifestOnly() is the tier-agnostic read both actually want;
// runPlugin() (this file's own execution call, not this listing) is
// still what branches by tier to load the recipe or reach into
// lib/denoHost.ts.
export function loadAllManifests(): LoadedManifest[] {
  const out: LoadedManifest[] = [];
  for (const id of [...listPackageIds()].sort()) {
    const loaded = loadManifestOnly(id);
    if (loaded.ok) out.push({ id, manifest: loaded.value });
  }
  return out;
}

// Code review, 2026-09-06 (SEC-5): nothing bounded an incoming turn's raw
// text before it reached the safety classifier's regex families, the
// tokenizer and the model request - a household member could send tens
// of megabytes and stall the whole event loop (the classifier and the
// request body itself have no other size limit upstream of here).
// Generous for a real conversational turn (voice transcripts and typed
// chat both run a few sentences to a couple of paragraphs, never this
// long) while completely closing that DoS - the same shape as
// lib/tts.ts's own MAX_TEXT_LENGTH for the identical reason on the
// output side.
export const MAX_TURN_TEXT_LENGTH = 8_000;
// LAT-01 (docs/plans/simple-turn-pipeline-2026-09-22.md, unit U3): with
// thinking on, the visible-reply budget alone (max_words*1.6 + 32 - 56
// tokens for a greeting) left no room for the think block itself, so a
// turn that actually needed to think ran out of cap before any visible
// text arrived and had to regenerate from scratch with thinking off
// (LAT-00's own diagnosis: a hidden second generation on "hi"). A flat
// allowance on top of the same visible budget, not a separate
// thinking-only cap, so a longer plan still gets more room to think,
// not just this fixed extra.
const THINKING_ALLOWANCE = 512;

/** LAT-01: the one formula for a visible reply's own max_tokens, shared
 * by the streaming and the blocking model-call sites so they can't drift
 * into two different answers for "how much room does thinking need".
 * FORCED-CALL-01 (dev.md "The owner's three live turns", (1)): exported
 * so the new path's own phrasing round reads this exact formula too,
 * retiring `nodes/model.ts`'s own `maxTokensFor` - one formula, not two
 * that can quietly drift apart. */
export function visibleReplyMaxTokens(maxWords: number, thinking: boolean | undefined): number {
  return Math.ceil(maxWords * 1.6) + 32 + (thinking ? THINKING_ALLOWANCE : 0);
}

// FORCED-CALL-01/CONTEXT-RECALL-01 style: exported so nodes/context.ts
// caps its own recall the same way, one constant, not two that can
// drift (the row: "five rows (MAX_MEMORY_SNIPPETS)").
export const MAX_MEMORY_SNIPPETS = 5;

// Step 4's own two: "rules" (INFORMATION_HANDLING_POLICY, currently 648
// chars - CORRECTION-02 added one sentence, dev.md "Design pass over
// the reserved items") and "companion" (composePersonaPrompt()'s output, which
// genuinely varies per persona) each get their own cap too - the bot's
// test_prompt_budget.py precedent this step copies found rules alone
// once hit 68% of a prompt with no independent section cap to stop it.
export const MAX_RULES_SECTION_CHARS = 800;
// Session C step 4: NATURALNESS_POLICY's own budget, separate from
// MAX_RULES_SECTION_CHARS above - a distinct concern (how something
// sounds spoken aloud, not what information handling is allowed) added
// after INFORMATION_HANDLING_POLICY was already sized against real
// content, so it gets its own headroom rather than silently eating into
// a cap measured before it existed.
// Sized like every other section here: real content (383 chars) plus
// headroom, the same ~30% margin INFORMATION_HANDLING_POLICY's own
// real/800-cap ratio already uses (648/800 as of CORRECTION-02,
// 2026-09-26; 617/800 when this comment was written) - a code review (2026-09-06)
// pointed out this pushes the worst-case stable prefix (every section
// simultaneously at its own max) to roughly 3,600 of PROMPT_SYSTEM_
// CHAR_BUDGET's 4,000, leaving under 400 for the whole volatile zone
// (household, speaker, memory, re-anchor, summary, matched skills) on a
// household with a verbose persona and several installed packages.
// Real, and worth knowing, but not a new failure mode: nothing in that
// zone was ever protected against the same naive concatenate-then-slice
// truncation except "time last" (this function's own header comment) -
// a maxed-out household already relied on graceful degradation there,
// not a guarantee every section fits. This section's fixed content
// (hardcoded prose, not household data) can never itself exceed 383
// regardless of the cap, so the actual, not worst-case, cost of this
// addition is exactly those 383 chars.
export const MAX_NATURALNESS_SECTION_CHARS = 500;
// Step 8 (session-a-intelligence.md) added each companion's own
// few-shot examples to this section (composePersonaPrompt()'s own
// examplesBlock()), which pushed the real catalog's longest fragment
// (composePersonaPrompt("tutor")) from ~645 chars to ~941 - re-measured
// against real content rather than assumed unchanged, the same step-4
// lesson ("sized from real content with headroom, not picked arbitrarily
// and then found too small") applying a second time to the same
// constant. 1200 gives real headroom above that, matching
// MAX_SKILLS_SECTION_CHARS's own budget for the section most likely to
// grow with real content.
export const MAX_COMPANION_SECTION_CHARS = 1200;

// PREFIX-CLASS-01: the written class's own composePersonaPrompt() output
// now folds what used to be three separate capped sections (companion,
// rules, naturalness) into one - capped at their combined budget rather
// than inventing a new one, so the written branch's worst case is no
// larger than the spoken branch's already-accepted worst case above.
// A code review (2026-09-23) flagged a single combined cap as riskier
// than three independent ones: if the joined string ever ran long,
// capSection's own slice-and-append-"..." would land inside whichever
// fragment happens to be last (today, WRITTEN_VOICE_POLICY), silently
// dropping the structure-permission policy rather than truncating
// persona-specific text the way the old three-cap version could only
// ever do to the companion section. On the written class specifically
// this is unreachable by construction, not just unreached today:
// composePersonaPrompt(persona, "written") never includes the few-shot
// examples block (spoken-only, examplesBlock() is skipped entirely on
// written) or any other free-text, household-varying content - every
// component is one of a small number of fixed strings selected from a
// Record by dial value, so the output's maximum possible length is a
// fixed, computable bound (measured under 1200 chars across every
// bundled persona), nowhere near this cap. The cap stays as defensive
// headroom, not a guard against real growth; a future written-class
// addition that DOES add free text would need its own reasoning about
// truncation order, the same way this comment now flags for the next
// reader.
const MAX_WRITTEN_VOICE_SECTION_CHARS = MAX_COMPANION_SECTION_CHARS + MAX_RULES_SECTION_CHARS + MAX_NATURALNESS_SECTION_CHARS;

/** Shared by every capped section below (a code review pass on this
 * step found the same "slice then append '...'" logic repeated inline
 * five times, each one actually allowing the result to run 3 chars past
 * its own declared cap for the ellipsis) - one place, and the ellipsis
 * now counts INSIDE maxChars, so "each section has a cap" is a real,
 * exact guarantee a test can assert on directly, not an approximation. */
export function capSection(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 3) return text.slice(0, maxChars);
  return text.slice(0, maxChars - 3) + "...";
}

/** The stable-prefix half of buildSystemPrompt() below (step 4:
 * "identity and companion, information policy, standing skills") -
 * factored out (issue #15, session-f-platform-and-trust.md step 3) so a
 * FUTURE engine warm-up in llmSupervisor.ts can prime a freshly-spawned
 * chat backend's prefix cache with EXACTLY what a real turn will send.
 * No warm-up call site exists yet (that's Session F's own separate,
 * not-yet-built step - this issue's own scope was only the export and
 * the drift test below, "not blocking Session F's other step 3 work,
 * which proceeds without this piece until it lands"). Archived legacy's
 * own chat-latency numbers (200-900ms first-token warm) depend on the
 * prefix cache actually hitting once that warm-up exists, which needs
 * byte-for-byte identity between the warm-up call and the real one - any
 * drift (a plugins-list change, a companion-section edit) would silently
 * reintroduce a cold prefix on every real turn. Called by
 * buildSystemPrompt() itself below, never reimplemented, so the two can
 * never drift apart by construction whenever that warm-up does land. */
/** `surfaceClass` defaults "spoken" - this is the NEW path's own
 * builder for both classes (`turnMachine/messages.ts`'s only caller);
 * the old path's own construction (`buildPromptParts` below) no longer
 * calls this function at all, since TRUEUP-01 (docs/plans/chat-
 * trueup-2026-09-23.md) needed the two to diverge on exactly the
 * suffix piece - it inlines its own frozen composition directly
 * instead, so the two paths can never silently drift onto the same
 * suffix again.
 *
 * PREFIX-CLASS-01, decided (dev.md "The written prompt on tier 1,
 * decided", the coordinator's own design record, 2026-09-23): the
 * written branch is the ceiling's own shape - identity plus
 * stableSuffixFor("written")'s own sentence, nothing else - the one
 * composition, alongside arm e, that ever measured close to the bare
 * floor across this whole chain; every shape that added persona or
 * policy prose measured 0.12x to 0.48x regardless of role, wording, or
 * the plan line's presence. composePersonaPrompt's own written voice
 * section returns "" while WRITTEN_VOICE_PROSE (persona.ts) is false,
 * so voiceSection below is empty by default - kept as a real
 * conditional, not assumed empty, so EVAL-03/WRITTEN-VOICE-TIER-01 can
 * flip the switch later without touching this function.
 *
 * TRUEUP-01: the spoken branch's own suffix shrinks from
 * STABLE_SYSTEM_SUFFIX's six sentences to stableSuffixFor("spoken")'s
 * one - the verdict table's own account (dev.md, the same record) - so
 * this branch is no longer byte-identical to before that item; the
 * companion/rules/naturalness sections it composes with are unchanged
 * (the spoken persona fragments stay, as the designed fallback until
 * EVAL-03). */
export function buildStablePrefix(persona: Persona = DEFAULT_PERSONA, surfaceClass: SurfaceClass = "spoken"): string {
  if (surfaceClass === "written") {
    const base = `${identityLine(persona)} ${stableSuffixFor("written")}`;
    const voiceSection = capSection(composePersonaPrompt(persona, "written"), MAX_WRITTEN_VOICE_SECTION_CHARS);
    return voiceSection.length > 0 ? `${base} ${voiceSection}` : base;
  }
  const companionSection = capSection(composePersonaPrompt(persona, surfaceClass), MAX_COMPANION_SECTION_CHARS);
  const rulesSection = capSection(INFORMATION_HANDLING_POLICY, MAX_RULES_SECTION_CHARS);
  const naturalnessSection = capSection(NATURALNESS_POLICY, MAX_NATURALNESS_SECTION_CHARS);
  return `${identityLine(persona)} ${stableSuffixFor(surfaceClass)} ${companionSection} ${rulesSection} ${naturalnessSection}`;
}

// A `routing.patterns` entry is a literal string with at most one `*`
// wildcard (docs/PACKAGES.md: "routing.patterns (linted)"); this is the
// first real consumer, so the wildcard semantics are this slice's own
// judgment call, documented rather than assumed: `*` captures the rest of
// the utterance after the literal prefix/suffix, case-insensitive,
// whitespace-trimmed. A pattern with no `*` at all is a real exact match
// (case-insensitive, trimmed), returning an empty capture rather than
// null: a review (2026-09-04) found the first cut rejected every
// zero-wildcard pattern outright, which combined with `route()`'s
// consequential guard (examples never checked for a raised-bar package)
// meant a consequential package with a plain literal trigger and no
// argument to capture (e.g. "lock the front door") could never fire
// deterministically at all. A pattern with more than one `*` still has no
// single capture to bind to an arg and is treated as non-matching (falls
// through to the fuzzy example score, or ultimately to the model): real
// multi-slot extraction needs tier 2 native tool calling (4.5), not built.
// getmaipai/home#77 (2026-09-13), two rules a code review added with the
// trailing "please remember" patterns: sentence-final punctuation is
// stripped before matching, so "..., please remember it." (typed chat
// and the speech path both end sentences with a period) still matches a
// suffix-anchored pattern, and "what's the weather in Boston?" captures
// "Boston" rather than "Boston?"; and a LEADING wildcard's capture must
// be at least three words, so "yes, please remember it" answering "I'll
// make sure to remember it" and "can you please remember that" fall
// through to the model instead of storing "yes" or "can you" as the
// fact (a two-word fact falls through too, offered to the model with
// `remember` as before). getmaipai/home#98 (2026-09-13): a present-time
// adverb at the sentence's end ("...in Seattle, WA today?", "right
// now", "at the moment") is not part of the capture, since the floor
// binds the capture whole to the package's one argument and "Seattle,
// WA today" is no place. Only for a wildcard that follows a locative
// preposition (in, at, near, around), which captures a place; every
// other capture keeps its time word, since "search the web for
// election results today" wants the "today" and "remember that the
// trash goes out today" is the fact (the review of this diff walked
// every bundled pattern). A word that changes the ask ("tomorrow") is left
// in, so the pattern for today's weather does not fire a forecast
// question with a wrong place either.
const TRAILING_PRESENT_TIME = String.raw`(?:[,\s]+(?:today|tonight|right now|now|at the moment|currently|this (?:morning|afternoon|evening)))?`;
const PLACE_WILDCARD_RE = /\b(?:in|at|near|around)\s*$/i;

export function matchPattern(text: string, pattern: string): string | null {
  const parts = pattern.split("*");
  if (parts.length > 2) return null;
  const trimmedText = text.trim().replace(/[.!?]+$/, "").trimEnd();
  if (parts.length === 1) {
    return trimmedText.toLowerCase() === pattern.trim().toLowerCase() ? "" : null;
  }
  const escaped = parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const trailing = PLACE_WILDCARD_RE.test(parts[0]!) ? TRAILING_PRESENT_TIME : "";
  const regex = new RegExp(`^${escaped[0]}(.+?)${escaped[1]}${trailing}$`, "is");
  const match = trimmedText.match(regex);
  if (!match) return null;
  const captured = match[1]!.trim();
  if (parts[0] === "" && captured.split(/\s+/).length < 3) return null;
  return captured;
}

/** The installed packages' own command verbs for the shape guard
 * (routing.ts's commandOpenersFrom()); a few dozen first words per
 * turn, cheaper than any cache would be worth. */
export function commandOpeners(loaded: LoadedManifest[]): ReadonlySet<string> {
  return commandOpenersFrom(loaded.flatMap((l) => l.manifest.routing?.patterns ?? []));
}

/** SIGNAL-02: whether a compute or clock package's own manifest
 * `routing.patterns` matches this text AND its resolver accepts the
 * captured remainder - the identical two-part gate `nodes/commands.ts`'s
 * own OPENER-01 loop already applies (`matchPattern`, then
 * `COMPUTED_WILDCARD_RESOLVERS`), read here only to decide the turn
 * signal's own `target` (`turnSignal.ts`'s injected `computedPatternMatch`
 * - that file never imports this one, to avoid the circular import this
 * one already has the other way), never to fire the package itself
 * (still only ever the commands node's own job - a `true` here changes
 * nothing about whether OPENER-01 actually runs it). Only a wildcard
 * pattern is ever a candidate: a resolver only ever keys a wildcard
 * entry (`matchPattern`'s own whole-string branch returns `""` for a
 * fixed phrase, never a real captured value a resolver could accept or
 * reject). */
export function computedPatternMatch(loaded: LoadedManifest[], text: string): boolean {
  for (const { id, manifest } of loaded) {
    for (const pattern of manifest.routing?.patterns ?? []) {
      if (!pattern.includes("*")) continue;
      const resolver = COMPUTED_WILDCARD_RESOLVERS[`${id}:${pattern}`];
      if (!resolver) continue;
      const captured = matchPattern(text, pattern);
      if (captured !== null && resolver(captured)) return true;
    }
  }
  return false;
}

// CHAT-02: parent notifications once per turn and category. The
// streaming gate evaluates every sentence and the cumulative reply, and
// the boundary below evaluates the whole reply again at the end, so one
// unsafe stretch would otherwise notify several times. Bounded: the
// last few hundred turns' keys, oldest dropped.
export const notifiedThisTurn = new Set<string>();
const NOTIFIED_KEYS_MAX = 512;
export function notifyOncePerTurn(actor: PersonRow, safety: SafetyResult, turnId: string | undefined, logPrefix: string): void {
  if (!safety.notify_parent) return;
  if (!turnId) {
    notifyIfFlagged(actor, safety, logPrefix);
    return;
  }
  const fresh = safety.categories.filter((c) => !notifiedThisTurn.has(`${turnId}:${c}`));
  if (fresh.length === 0) return;
  for (const c of fresh) {
    notifiedThisTurn.add(`${turnId}:${c}`);
    if (notifiedThisTurn.size > NOTIFIED_KEYS_MAX) {
      const oldest = notifiedThisTurn.values().next().value;
      if (oldest !== undefined) notifiedThisTurn.delete(oldest);
    }
  }
  notifyIfFlagged(actor, { ...safety, categories: fresh }, logPrefix);
}
export function __resetOutputNotificationsForTests(): void {
  notifiedThisTurn.clear();
}

/** The reply pools for a known constant reply, keyed by source: a
 * safety refusal rotates through replyVariation.ts's first/repeat pool,
 * a package or command reply that is exactly one of the known constant
 * confirmations rotates through the active companion's own pool (or the
 * shared one when that companion has none), and every other source
 * passes through unchanged. finalizeReply() below and the default
 * path's turnMachine/turnNext.ts call this same function (THIN-0I, rule
 * 12: ported, not copied), so the two paths cannot drift apart on which
 * reply gets which pool. */
export function variedConstantReply(personId: string, source: TurnValue["source"], text: string, personaId: string): string {
  if (source === "safety_refuse") return pickRefusalVariant(personId);
  if (source === "plugin" || source === "plugin_error" || source === "command" || source === "command_error") return varyKnownConstant(personId, text, personaId);
  return text;
}

/** The server-side speech text for a reply whose authored speech, if
 * any, repeats its visible text: the robot with no authored speech gets
 * the first sentence alone, links dropped (the projection its speaker
 * reads), every other surface gets the whole text normalized for
 * speaking (numbers, times, units, abbreviations and markdown read the
 * way a person says them). finalizeReply() above and the default path's
 * turnMachine/turnNext.ts call this same function (THIN-0J, rule 12:
 * ported, not copied). The output is for TTS only; the visible text is
 * never replaced by it. */
export function speechTextFor(surface: Surface, text: string, authoredSpeech: string | undefined): string {
  return surface === "robot" && authoredSpeech === undefined ? splitIntoSentences(text)[0]?.replace(/https?:\/\/\S+|www\.\S+/g, "").replace(/\s+/g, " ").trim() ?? "" : normalizeForSpeech(text);
}

/** FAST-04: what a turn's token stream resolves to once its deltas are
 * spent. Either the most recently flagged, non-refuse SafetyResult
 * gateOutputSafety() saw (or undefined when nothing was flagged), or
 * `{ resolved }`: the model answered with a tool call instead of text,
 * the package ran, and this is its complete TurnValue, which never went
 * through gateOutputSafety()/gateGuards() (a grounded package reply
 * like "It is 72 degrees in Boston." must not be cut by the invention
 * guard, and its speech, plugin_id and routing fields must survive
 * intact). The stream yields no deltas at all in that case. */
export type StreamOutcome = SafetyResult | { resolved: TurnValue } | undefined;

export type TurnStreamResult =
  | TurnFailure
  // TOOL-EVENTS-01(b): only the new path (turnMachine/turnNext.ts)
  // ever populates toolEvents, and only when this turn actually ran
  // one - the old path's own "immediate" results (a safety refusal, a
  // deterministic plugin reply) never carry it.
  | { ok: true; kind: "immediate"; value: TurnValue; signal: TurnSignal; toolEvents?: ToolStreamEvent[] }
  | {
      ok: true;
      kind: "stream";
      /** Known before a single token streams (the conversation is
       * resolved and the turn id minted up front, step 2/3): routes/
       * turn.ts's contract requires these as the very first NDJSON line
       * ("turn_meta"), before any delta. */
      conversationId: string;
      turnId: string;
      signal: TurnSignal;
      /** FAST-04: `Date.now()` at the top of runTurnStream(), before
       * prepareTurn() ran. streamTurnEvents() counts its 900 ms
       * spoken-cue timer from here, not from its own first `.next()`,
       * so the cue means "900 ms since the utterance arrived with
       * nothing said yet", whatever routing and prefill cost. */
      startedAt: number;
      cueSuppressed: boolean;
      bannedPhrases: string[];
      /** The generator's own return value (step 9), read from the final
       * `iterator.next()` result once `done` is true on a NORMAL
       * completion (never reached on a thrown StreamSafetyRefusal, which
       * rejects instead): see StreamOutcome. The caller passes this into
       * `finalize()` the same way it passes a caught refusal's own
       * SafetyResult, so a flag that never refuses still reaches the
       * logged turn and its `crisis_resources` instead of being silently
       * dropped once the notification fires. */
      tokens: AsyncGenerator<string, StreamOutcome, void>;
      status: StatusChannel;
      /** STREAM-NEXT-01 (b) left this out of the "stream" kind entirely
       * (only the "immediate" kind above got it, TOOL-EVENTS-01(b)'s
       * own original scope, before this route ever returned "stream" for
       * a live turn) - found live, TOOL-EVENTS-02: a real search on the
       * streaming path never carried a tool_call/tool_result at all,
       * only the "immediate" bench/test path did. Optional, like the
       * "immediate" variant's own field above (`undefined` for every
       * hand-built test fixture that predates this, and for the old
       * path's own builder, both unaffected) - the new path's own
       * `state.toolEvents` (turnMachine/contract.ts) is the one real
       * producer: a live array reference, not a snapshot, so it already
       * holds every event the tool node pushed by the time
       * `streamTurnEvents()` (routes/turn.ts) reads it, right after the
       * tool round's single synchronous machine transition and strictly
       * before the phrasing round's first delta. */
      toolEvents?: ToolStreamEvent[];
      /** Builds the final TurnValue once the caller has drained `tokens`
       * to completion and knows the full reply text - also logs the turn
       * (conversationHistory.ts), the same "log once the real reply is
       * known" timing runTurn() already has, just triggered by the
       * caller finishing the stream instead of by this function awaiting
       * it directly. `outcome`: the stream's own return value, or the
       * SafetyResult from a caught `StreamSafetyRefusal` (step 9), so
       * the logged/returned TurnValue's `safety` field reflects what
       * actually cut the stream rather than only ever the input-side
       * result computed before generation started. A `{ resolved }`
       * outcome is returned as-is: the package's reply, not rebuilt from
       * `replyText` (which is empty on that path). */
      finalize: (replyText: string, outcome?: StreamOutcome) => TurnValue;
    };

// Step 9 (session-a-intelligence.md): "spec/safety/ts/classifier.ts
// promises 'again on every streamed sentence'... on a refuse category cut
// the stream." Thrown by gateOutputSafety() below, from inside the
// `tokens` generator runTurnStream() hands back - the ONE place a
// generator can signal "stop, and here is why" to whatever is iterating
// it. Carries the real SafetyResult so the caller (routes/turn.ts's
// streamTurnEvents()) can both emit spec/errors/errors.json's
// "safety_refused" code on the wire and pass the same result into
// finalize() so the logged turn reflects the real reason, not a generic
// failure message.
export class StreamSafetyRefusal extends Error {
  constructor(public readonly safety: SafetyResult) {
    super("the model's own reply was flagged by the safety classifier mid-stream");
  }
}

// THIN-7C (ADMIN-COMPARE-01 b, moved from turnBareStream.ts so the default
// path owns it): bare mode is for an owner or admin who is an adult, and no
// caller can make it otherwise. routes/turn.ts checks both first and returns
// a clean 403; this throw is the structural backstop inside the turn itself,
// unreachable in practice, asserting that a future caller that forgets the
// route-level check still cannot construct a bare turn for anyone else.
export class BareModeForbidden extends Error {
  constructor(message: string) {
    super(message);
  }
}

// THIN-7C: the document attachment types, moved from turnEngine.ts (which
// re-exports them) so the default path owns them.
export type DocumentTurnAttachment = { name: string; mediaType: string; data: string };
export class DocumentAttachmentError extends Error {}

// THIN-7C: the continuation pieces, moved from turnEngine.ts (which imports
// them back) so the default path owns them.
export type TurnContinuation = { fromTurnId?: string; assistantText: string };
export const CONTINUATION_INSTRUCTION = "Continue the incomplete answer above. Do not repeat any text already given. Start at the first missing point and finish the answer clearly.";
export function validateContinuationInput(continuation: TurnContinuation | undefined): TurnFailure | null {
  if (!continuation) return null;
  if (typeof continuation.assistantText !== "string" || continuation.assistantText.trim().length === 0) {
    return { ok: false, status: 400, code: "invalid_input", error: "continuation_text is required" };
  }
  if (continuation.assistantText.length > MAX_TURN_TEXT_LENGTH) {
    return { ok: false, status: 400, code: "invalid_input", error: `continuation_text must be ${MAX_TURN_TEXT_LENGTH} characters or fewer` };
  }
  return null;
}

/** The one plain system prompt bare mode sends (moved from bareCompletion.ts). */
export const BARE_SYSTEM_PROMPT = "You are a helpful assistant.";

// FAST-04: the streaming twin of runTurnStream()'s own `{ ok: false,
// code: "unavailable" }` return. Once the stream result has been handed
// back (before the first token is read), an engine failure inside the
// generator can no longer become an HTTP status - turn_meta is already
// on the wire - so it travels as a typed throw, the same shape as
// StreamSafetyRefusal, and routes/turn.ts emits `code: "unavailable"`
// on the error event. Connectivity failures use `engine_unavailable`; the
// turn's lease releases as the throw passes through holdLease() (CHAT-18).
export class StreamUnavailable extends Error {
  readonly code: "unavailable" | "engine_unavailable";
  constructor(message: string, code: "unavailable" | "engine_unavailable" = "unavailable") {
    super(message);
    this.code = code;
  }
}

/** SAFETY-01 (finding 26, the live chat of 2026-09-14): how many of the
 * conversation's latest turns a self-harm signal keeps the conversation
 * in the crisis state for. While the state holds, every reply carries
 * the crisis overlay, no lookup and no package dispatches, and a "stop"
 * gets one short acknowledgment and then the overlay alone. */
export const CRISIS_STATE_TURNS = 10;
/** The conversation is in the crisis state when one of its last
 * CRISIS_STATE_TURNS turns carried the self-harm category on its input
 * or its output (the row's crisis_signal, kept whatever the reply's
 * own action: a refused reply keeps it). A new conversation starts
 * clear. */
export function conversationInCrisis(conversationId: string): boolean {
  return recentTurnSafety(conversationId, CRISIS_STATE_TURNS).some((t) => t.crisisSignal);
}
