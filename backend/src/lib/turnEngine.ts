// The turn engine (platform plan 4.5): "One turn engine for every
// surface... safety first; the deterministic plugin floor; ...the model
// phrases, it does not judge." Full scope (six surfaces, prefix-cached
// prompt assembly, tier 2 native tool calling, remote candidates,
// `ask`-continuation) is documented in docs/dev.md as too large for one
// slice, the same judgment 4.11 made; this is the narrow real slice: one
// surface (`chat`), safety-first routing, a deterministic Tier 0 plugin
// floor (pattern match, or a keyword-overlap stand-in for routing.examples
// the same way memory.ts stands in for real embeddings), and a
// stable-first prompt handed to the real `chat` role as the fallback.
//
// What's deferred, and why, is repeated at the point it matters below;
// read docs/dev.md's turn engine section before extending this file.
import { evaluateSafety } from "@/lib/safety";
import { listPackageIds, loadPackage, meetsMinRole, runPlugin } from "@/lib/plugins";
import { ensureRoutingEmbeddings, embedUtterance, scoreByEmbedding, pickTier1WinnerAmong } from "@/lib/routing";
import { loadAllSkills, type LoadedSkill } from "@/lib/skills";
import { matchCommand, runCommand } from "@/lib/commands";
import { trigger } from "@/lib/notifications";
import { recall, bumpUsage, embedQueryForRecall, getProfileParagraph, type RecallMatch } from "@/lib/memory";
import { newConversationTurnId } from "@/lib/id";
import { complete, startCompleteStream, type LlmMessage, type ToolSpec, type ToolCall } from "@/lib/llm";
import { tokenize } from "@/lib/text";
import {
  logTurn,
  resolveOrCreateConversation,
  buildConversationWindow,
  maybeRefreshConversationSummary,
  getPendingAsk,
  setPendingAsk,
  type PendingAsk,
} from "@/lib/conversationHistory";
import { pickRefusalVariant, varyKnownConstant } from "@/lib/replyVariation";
import { normalizeForSpeech } from "@maipai/spec/voice/ts/normalizeForSpeech.js";
import { nextSentenceBoundary } from "@maipai/spec/safety/ts/sentenceChunker.js";
import { getPersonSettingValue, getHouseholdSettingValue } from "@/lib/settings";
import { listActivePeople } from "@/lib/access";
import { composePersonaPrompt, resolvePersona, DEFAULT_PERSONA, INFORMATION_HANDLING_POLICY, type Persona } from "@/lib/persona";
import type { Role } from "@/middleware/auth";
import type { PersonRow } from "@/types";
import type { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import type { PluginResult } from "@maipai/spec/interpreters/ts/recipe-interpreter.js";
import type { SafetyResult } from "@maipai/spec/gen/ts/safety-result.js";
// TurnReply/TurnValue moved to @/wire (alias-free, so a frontend client
// can import the real shape through the @maipai/home-backend workspace
// dependency instead of a hand-duplicated mirror); re-exported here since
// this is where callers already look for them.
import type { TurnValue } from "@/wire";
import type { Conversation } from "@maipai/spec/gen/ts/conversation.js";
export type { TurnReply, TurnValue } from "@/wire";

// 4.5 names six surfaces (chat, overlay, pod, robot, tv, phone), each
// changing memory sensitivity, discretion and presentation. Only `chat`
// has anything to render it (a curl caller today, same as every other
// core slice); the other five are a real, named gap the same shape as
// llm.ts's IMPLEMENTED_ROLES, not silently missing.
export type Surface = "chat" | "overlay" | "pod" | "robot" | "tv" | "phone";
const IMPLEMENTED_SURFACES: ReadonlySet<Surface> = new Set(["chat"]);

/** Shared by TurnOpResult and TurnStreamResult: runTurn() and
 * runTurnStream() run the identical validation/safety/plugin-floor logic
 * (prepareTurn(), below) and so must report the identical error
 * vocabulary for the identical failure states - a code review
 * (2026-09-04) found the two had drifted into independently-hand-typed
 * copies of the same union, one bad refactor away from silently
 * reporting different codes for what should be the same failure. */
export type TurnFailure = { ok: false; status: 400 | 503; code: "unsupported_surface" | "invalid_input" | "unavailable"; error: string };

export type TurnOpResult = { ok: true; value: TurnValue } | TurnFailure;

/** logTurn (conversationHistory.ts) is a real DB write, so it can fail on
 * its own (disk pressure, a lock) even after a completely correct
 * generation. A code review (2026-09-04) found every real caller below
 * let that failure propagate straight up, turning "the reply worked, its
 * own logging didn't" into "the reply failed" from the caller's point of
 * view - runTurn() would reject an otherwise-successful turn outright,
 * and runTurnStream()'s `finalize` closure would make streamTurnEvents.ts
 * (routes/turn.ts) report a mid-stream "error" event for a reply that had
 * already fully, correctly rendered to the household. There is nothing
 * useful left to retract at that point; the failure is real but belongs
 * in the server log, not in the household's chat thread. */
function logTurnSafely(actor: PersonRow, surface: Surface, userText: string, value: TurnValue): void {
  try {
    logTurn(actor, surface, userText, value);
  } catch (err) {
    console.error(`[turn] logTurn failed for an otherwise-successful turn: ${(err as Error).message}`);
  }
  // Post-turn, fire-and-forget (step 3: "it never runs in the request
  // path"): whether this conversation's rolling summary needs a refresh.
  // Never awaited and never allowed to affect the turn's own outcome,
  // the same posture safety.flagged_turn's notification already takes
  // just above prepareTurn() in this file.
  maybeRefreshConversationSummary(value.conversation_id).catch((err: unknown) =>
    console.error(`[turn] conversation summary refresh failed: ${(err as Error).message}`),
  );
}

const CRISIS_RESOURCES_TEXT =
  "If you're in crisis, the 988 Suicide & Crisis Lifeline is free and available 24/7: call or text 988.";

/** The one derivation of `crisis_resources` from a SafetyResult, shared
 * by prepareTurn()'s own input-side use below and step 9's two
 * output-side call sites (runTurn(), runTurnStream()'s finalize()) - a
 * review (2026-09-05) found the streaming path's own fix for "an
 * output-side flag needs its own crisis_resources, not just the input
 * side's" had no non-streaming twin, leaving runTurn() with the
 * identical silent-drop bug the review's other finding had just fixed
 * in the stream. */
function deriveCrisisResources(safety: SafetyResult): string | undefined {
  return safety.action === "allow_with_resources" ? CRISIS_RESOURCES_TEXT : undefined;
}

// Step 4: "identity and companion" are the first thing in the stable
// prefix, and the identity line itself now names the selected persona's
// display_name rather than a hardcoded "MaiPai" - a real gap the
// original version had (a household that picked "Buddy" still heard the
// model call itself MaiPai every turn). DEFAULT_PERSONA.display_name is
// literally "MaiPai", so this produces byte-identical text to the old
// constant for every household that never touches persona.active_id.
function identityLine(persona: Persona): string {
  return `You are ${persona.display_name}, a private, self-hosted AI assistant for this household.`;
}

const STABLE_SYSTEM_SUFFIX = [
  "Be warm, concise and honest. Nothing you say leaves this house.",
  "Requests already blocked by the household's safety rules never reach you; answer anything else helpfully and honestly.",
  "If you don't know something the household hasn't told you, say so instead of guessing.",
].join(" ");

// The speech register is now the selected Persona (lib/persona.ts,
// 2026-09-05): what used to be a single fixed NATURAL_REGISTER_POLICY
// constant is the "default" entry in `PERSONAS`, composed through the
// exact same mechanism every other persona uses, rather than a special
// case. Kept separate from STABLE_SYSTEM_SUFFIX for the same reason it
// always was: a persona's own fragment can change per person turn to
// turn while the identity/safety-posture prefix above it can't.

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
export function loadAllManifests(): LoadedManifest[] {
  const out: LoadedManifest[] = [];
  for (const id of [...listPackageIds()].sort()) {
    const loaded = loadPackage(id);
    if (loaded.ok) out.push({ id, manifest: loaded.value.manifest });
  }
  return out;
}

function pluginsListLine(loaded: LoadedManifest[]): string {
  if (loaded.length === 0) return "";
  const lines = loaded.map(({ manifest: m }) => `- ${m.display}: ${m.description}`);
  return `\n\nThings this household has set up:\n${lines.join("\n")}`;
}

// Carved out of a shared budget so "a prompt budget as a test" (4.5) has
// something concrete to assert: the assembled system prompt never grows
// unbounded just because a household has a lot of memories or packages.
export const PROMPT_SYSTEM_CHAR_BUDGET = 4000;
const MAX_MEMORY_SNIPPETS = 5;
const MAX_MEMORY_SECTION_CHARS = 800;
const MAX_PLUGINS_SECTION_CHARS = 800;
const MAX_SKILLS_SECTION_CHARS = 1200;
// Step 3: one line, so a generous cap is plenty; guards the same way
// every other section does against a runaway conversation summary ever
// dominating the prompt on its own.
const MAX_SUMMARY_SECTION_CHARS = 600;
// Step 4's own two: "rules" (INFORMATION_HANDLING_POLICY, currently 617
// chars) and "companion" (composePersonaPrompt()'s output, which
// genuinely varies per persona) each get their own cap too - the bot's
// test_prompt_budget.py precedent this step copies found rules alone
// once hit 68% of a prompt with no independent section cap to stop it.
const MAX_RULES_SECTION_CHARS = 800;
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
const MAX_COMPANION_SECTION_CHARS = 1200;

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
// A cap on how many matching skills compose into one turn, not just a
// character budget: even under budget, five unrelated skills all
// clearing the threshold on a short utterance is a real sign the
// threshold (or the examples) need tightening, not a reason to hand the
// model five instruction sets at once. Small on purpose - this is the
// first real slice of a genuinely new primitive (docs/dev.md's "Naming"
// entry), not tuned against real household use yet.
const MAX_MATCHING_SKILLS = 3;

// Skills compose into context by the SAME relevance mechanism plugins use
// to route deterministically (exampleScore/EXAMPLE_MATCH_THRESHOLD,
// below) - reused, not reinvented, since the underlying question is
// identical ("does this utterance look like what this package's
// routing.examples describe"). The real difference is what happens next:
// a plugin match runs a recipe and answers the turn outright; a skill
// match only ever ADDS its instruction body to the model's system
// prompt - it never fires on its own, never short-circuits the turn, and
// carries no permissions to do anything but shape phrasing. `text` here
// is the raw utterance, the same one route() scores plugins against.
// Shared by skillsSection() (below) and prepareTurn()'s plugin-vs-skill
// priority check: both need the same "which skills are relevant, most
// confident first" answer, just for different purposes (composing text
// vs. comparing the top score against a fuzzy-matched plugin's own).
// Uncapped and unsliced here on purpose - MAX_MATCHING_SKILLS is a
// composition-budget concern, not part of what "relevant" means, and the
// priority check only ever needs the single best score regardless of how
// many would eventually compose in.
export function matchingSkills(text: string, skills: LoadedSkill[]): { skill: LoadedSkill; score: number }[] {
  return skills
    .map((skill) => ({ skill, score: exampleScore(text, skill.manifest.routing?.examples) }))
    .filter((m) => m.score >= EXAMPLE_MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score);
}

function skillsSection(text: string, skills: LoadedSkill[]): string {
  const matching = matchingSkills(text, skills).slice(0, MAX_MATCHING_SKILLS);
  if (matching.length === 0) return "";
  return `\n\n${matching.map((m) => m.skill.body).join("\n\n")}`;
}

// Age band derivation (session-a-intelligence.md step 1). Deliberately
// narrow: just enough to calibrate the model's phrasing for the speaker
// in front of it, computed inline for the prompt only. This is NOT the
// wider `age_range`-on-Person-ctx question BACKLOG.md tracks separately
// under "roles versus grants" (a package-visible, schema-level field);
// nothing here is stored or exposed to a package. The three bands mirror
// the role ladder's own two minor bands (person.schema.json: "teen 13-17,
// child under 13") rather than inventing a finer taxonomy nothing in the
// spec or platform plan defines - a real, independent cross-check
// computed from birthdate when one is on file, falling back to the
// speaker's role (which already carries the same distinction) when it
// isn't.
type AgeBand = "child" | "teen" | "adult";

function ageInYears(birthdate: string, now: Date): number {
  const dob = new Date(birthdate);
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

function ageBandFromRole(role: string): AgeBand {
  if (role === "child") return "child";
  if (role === "teen") return "teen";
  return "adult"; // owner/admin/adult/guest: role carries no minor signal
}

function speakerAgeBand(actor: PersonRow, now: Date): AgeBand {
  if (!actor.birthdate) return ageBandFromRole(actor.role);
  const years = ageInYears(actor.birthdate, now);
  // A malformed birthdate (Person's generated Zod schema enforces
  // `.date()` today, so this shouldn't be reachable through any real
  // write path, but a code review, 2026-09-05, pointed out nothing here
  // defended against it anyway) must never silently fall through to
  // "adult": both `years < 13` and `years < 18` are false for NaN,
  // which is exactly the wrong direction for a safety-adjacent signal.
  if (Number.isNaN(years)) return ageBandFromRole(actor.role);
  if (years < 13) return "child";
  if (years < 18) return "teen";
  return "adult";
}

// No household timezone setting exists yet (3.2's clock/timezone key
// hasn't landed), so this renders in the hub process's own system
// timezone - correct for a self-hosted install physically in the house,
// revisit once a real timezone key exists. `household.locale` only
// changes date/time formatting conventions (4.5: "Friday 3:40 pm" style,
// never raw ISO UTC"), not the zone itself. Includes the full date (not
// just weekday/time): a code review, 2026-09-05, found the first cut
// dropped month/day/year entirely, a real loss versus the old raw-ISO
// line it replaced (a question near a month or year boundary, or "what's
// today's date", had nothing to go on) - "never raw ISO" doesn't mean
// "never the date", just formatted for a person, not a machine.
function formatLocalTime(now: Date, locale: string): string {
  const date = new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(now);
  const time = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", hour12: true })
    .format(now)
    .toLowerCase();
  return `${date}, ${time}`;
}

function speakerLine(actor: PersonRow, locale: string, now: Date): string {
  const nicknamePart = actor.nickname ? ` (goes by ${actor.nickname})` : "";
  const band = speakerAgeBand(actor, now);
  return `\n\nYou're talking with ${actor.displayName}${nicknamePart} right now: role ${actor.role}, age band ${band}, locale ${locale}.`;
}

// "Presence unknown for now" (step 1): no presence signal exists on the
// hub yet (that's the robot/ambient-context side, 4.16, not built here),
// so this lists who lives here, never who's home right now.
function householdLine(): string {
  const household = listActivePeople();
  if (household.length === 0) return "";
  const lines = household.map((p) => `- ${p.displayName} (${p.role})`);
  return `\n\nWho lives here:\n${lines.join("\n")}`;
}

// Step 4: "as of <date>, <n> days ago" on each memory line - legacy's
// own `formatMemoriesForPrompt`, ported because small models measurably
// drift toward the freshest tokens otherwise (docs/dev.md's BACKLOG
// entry on this). `record.created_at` (when the fact was first
// asserted), not `last_used_at` (when it was last recalled) - "as of"
// asks when the fact became true, not when it was last useful.
function formatShortDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(new Date(iso));
}

function daysAgoLabel(iso: string, now: Date): string {
  const days = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000));
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function memoryBulletLine(match: RecallMatch, locale: string, now: Date): string {
  return `- ${match.record.text} (as of ${formatShortDate(match.record.created_at, locale)}, ${daysAgoLabel(match.record.created_at, now)})`;
}

const MEMORY_TRUST_REMINDER = "Prefer these facts over guessing when they're relevant.";

// Step 4: "re-anchor the companion's one-line identity after the memory
// block" - legacy measured real drift (losing the persona's voice)
// after about eight turns with no repeat of who's speaking. Companions-
// as-packages don't exist yet (step 8), so this repeats the same
// display_name the stable identityLine() above already used - a real,
// if small, anchor today, and already the right shape for a companion
// package's own name once one exists.
function companionReanchorLine(persona: Persona): string {
  return `\n\nRemember: you are ${persona.display_name}.`;
}

// Stable-first (4.5, made real in step 4): identity and companion
// (identityLine + the persona's own voice fragment), information policy
// (INFORMATION_HANDLING_POLICY), then standing skills (the plugins
// list - every installed package, unconditionally, every turn, "skills"
// in 4.5's own loose sense of the word) all sit first for prefix
// caching. The volatile zone after it, in order: household, speaker,
// memory (with the dated suffix and trust reminder above), a companion
// re-anchor, the conversation summary, then this turn's own matched
// skills (utterance-dependent, so it can't be stable no matter what 4.5
// calls it), and finally local time - never truncated, per the
// existing "time last" protection below. 4.5 also names notes, methods
// and context in the volatile zone: notes/methods need persona/
// companion state beyond what step 8 will add; context needs the
// ambient-context wiring the robot side already has but the hub
// doesn't yet - both real gaps, not silently skipped.
export function buildSystemPrompt(
  actor: PersonRow,
  text: string,
  memoryMatches: RecallMatch[],
  loaded: LoadedManifest[] = loadAllManifests(),
  persona: Persona = DEFAULT_PERSONA,
  skills: LoadedSkill[] = loadAllSkills(),
  // Step 3: the conversation's own rolling summary (buildConversationWindow(),
  // lib/conversationHistory.ts), one line covering whatever fell out of
  // the verbatim window.
  conversationSummaryLine?: string,
): string {
  const now = new Date();
  const localeValue = getHouseholdSettingValue("household.locale");
  const locale = typeof localeValue === "string" ? localeValue : "en-US";

  // ── Stable prefix (step 4: "identity and companion, information
  // policy, standing skills") ──
  const companionSection = capSection(composePersonaPrompt(persona), MAX_COMPANION_SECTION_CHARS);
  const rulesSection = capSection(INFORMATION_HANDLING_POLICY, MAX_RULES_SECTION_CHARS);
  const pluginsSection = capSection(pluginsListLine(loaded), MAX_PLUGINS_SECTION_CHARS);
  const stablePrefix = `${identityLine(persona)} ${STABLE_SYSTEM_SUFFIX} ${companionSection} ${rulesSection}${pluginsSection}`;

  // ── Volatile zone (step 4: "household, speaker, memory, summary, time
  // last"; matched skills sit here too - utterance-dependent, so never
  // stable no matter what 4.5 calls it) ──
  // Step 7: the profile paragraph - "injected whole at the top of the
  // memory block before recalled items, counted inside the memory
  // section budget" (session-a-intelligence.md), not a separate cap of
  // its own. Unconditional lookup (a targeted query, not a recall()
  // candidate): whether it exists at all is the only gate, never whether
  // this turn happened to recall something else too.
  const profile = getProfileParagraph(actor);
  let memorySection = "";
  if (profile || memoryMatches.length > 0) {
    const profileLine = profile ? `${profile.text}\n` : "";
    const lines = memoryMatches.slice(0, MAX_MEMORY_SNIPPETS).map((m) => memoryBulletLine(m, locale, now));
    const bulletsBlock = lines.length > 0 ? `${lines.join("\n")}\n` : "";
    memorySection = `\n\nWhat you already know about this household:\n${profileLine}${bulletsBlock}${MEMORY_TRUST_REMINDER}`;
    memorySection = capSection(memorySection, MAX_MEMORY_SECTION_CHARS);
  }
  // Unconditional, not gated on whether any memory actually matched:
  // drift accumulates with turn count, not with whether this particular
  // turn happened to recall something (the plan's own "after the memory
  // block" names a POSITION, not a precondition).
  const reanchorSection = companionReanchorLine(persona);
  const summarySection = capSection(conversationSummaryLine ? `\n\n${conversationSummaryLine}` : "", MAX_SUMMARY_SECTION_CHARS);
  const skillsPart = capSection(skillsSection(text, skills), MAX_SKILLS_SECTION_CHARS);
  const volatileZone = householdLine() + speakerLine(actor, locale, now) + memorySection + reanchorSection + summarySection + skillsPart;

  const localTimeLine = `\n\nLocal time: ${formatLocalTime(now, locale)}`;

  // The time line is appended last (4.5: "...time last") and must never
  // itself be truncated: a review (2026-09-04) found the first cut
  // blind-sliced the *whole* assembled prompt to the budget after
  // appending the time line, which could cut the timestamp (or a memory
  // bullet) off mid-word once enough packages or memories pushed the
  // total over budget. Truncating the body first, then appending a
  // never-truncated time line, keeps every truncation boundary inside
  // prose meant to be cut, never inside the one line a caller might parse
  // (step 1's "the blocks shrink, not the budget", extended to every
  // section here since each already has its own independent cap above -
  // this outer slice is the last-resort safety net for the sum of them
  // all still somehow exceeding the whole-prompt budget).
  let body = stablePrefix + volatileZone;
  const bodyBudget = Math.max(0, PROMPT_SYSTEM_CHAR_BUDGET - localTimeLine.length);
  if (body.length > bodyBudget) body = body.slice(0, bodyBudget);

  return body + localTimeLine;
}

// Tier 1 of the deterministic plugin floor's FALLBACK (session-c-brain-
// and-voice.md step 1): route() below now scores Tier 1 by real cosine
// similarity through lib/routing.ts, falling back to this keyword-overlap
// function only when the embed backend is down (or a candidate has no
// stored embedding yet). Kept as a real, separate scoring path rather
// than deleted: `EXAMPLE_MATCH_THRESHOLD` was tuned for this scale
// specifically, and skillsSection()'s own composition retrieval below
// still uses it directly (a softer "which skills are worth composing in"
// signal, not the hard Tier 1 routing decision route() makes). Coverage
// of the *example*'s words (not Jaccard) since examples are short
// template sentences and the live utterance is often longer or shorter;
// a 0..1 score, not a claim of semantic matching.
function exampleScore(text: string, examples: readonly string[] | undefined): number {
  if (!examples || examples.length === 0) return 0;
  const words = tokenize(text);
  let best = 0;
  for (const example of examples) {
    const exampleWords = tokenize(example);
    if (exampleWords.size === 0) continue;
    const overlap = [...exampleWords].filter((w) => words.has(w)).length;
    best = Math.max(best, overlap / exampleWords.size);
  }
  return best;
}
const EXAMPLE_MATCH_THRESHOLD = 0.6;

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
export function matchPattern(text: string, pattern: string): string | null {
  const parts = pattern.split("*");
  if (parts.length > 2) return null;
  const trimmedText = text.trim();
  if (parts.length === 1) {
    return trimmedText.toLowerCase() === pattern.trim().toLowerCase() ? "" : null;
  }
  const escaped = parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`^${escaped[0]}(.+)${escaped[1]}$`, "is");
  const match = trimmedText.match(regex);
  return match ? match[1]!.trim() : null;
}

// A package's `args` schema declares its call arguments (manifest.schema.json:
// "a JSON Schema for this package's call arguments"), typed `unknown` by
// codegen since it's arbitrary. The deterministic floor can bind a call's
// inputs in exactly two shapes: no required args (fires with `{}`,
// ignoring any wildcard capture), or exactly one required string arg (the
// wildcard capture, when there is one, binds to it). Anything richer
// (multiple required args) is the same tier 2 gap `matchPattern` documents
// above: no capture to bind, so the floor doesn't fire and the turn falls
// through toward the model instead.
function deterministicArgs(args: unknown, captured: string | null): Record<string, unknown> | null {
  const schema = (args && typeof args === "object" ? args : {}) as {
    required?: unknown;
    properties?: Record<string, { type?: unknown }>;
  };
  const required = Array.isArray(schema.required) ? schema.required : [];
  if (required.length === 0) return {};
  if (required.length > 1 || captured === null) return null;
  const name = required[0];
  if (typeof name !== "string") return null;
  const prop = schema.properties?.[name];
  if (prop && prop.type !== undefined && prop.type !== "string") return null;
  if (captured.length === 0) return null;
  return { [name]: captured };
}

interface RoutedPlugin {
  id: string;
  args: Record<string, unknown>;
  score: number;
  /** True only for a real `routing.patterns` match - an unambiguous,
   * deliberately-set-up trigger phrase, never a guess. Tracked as its own
   * flag rather than inferred from `score === 1`, since a fuzzy
   * `exampleScore` could in principle also reach 1.0 on total word
   * overlap; a pattern match's "always wins, no exceptions" guarantee
   * (2026-09-05, prepareTurn()'s skill-vs-plugin priority check) must
   * never depend on that coincidence. */
  viaPattern: boolean;
  /** Session C step 1: which Tier 1 scoring actually produced `score`
   * when `viaPattern` is false - real cosine ("embedding") or the
   * keyword-overlap fallback ("embedding" candidate had no stored rows
   * yet, or the embed backend is down this turn). Meaningless when
   * `viaPattern` is true (always "embedding" by construction, never
   * read). */
  viaEmbedding: boolean;
}

// The deterministic plugin floor (4.5). A `consequential` package (4.9's
// manifest field) "raises the routing bar": it only fires on a real
// pattern match, never on a fuzzy example score, however high. A tie
// between two pattern matches goes to whichever package sorts first by
// id (loadAllManifests()'s deterministic order), a deliberately simple
// tie-break, not a claim of ranking by pattern specificity. Tier 0
// (patterns) always wins outright over Tier 1, checked first and
// returned immediately - a real, deliberately-authored trigger phrase
// never competes with a fuzzy score, however confident.
//
// Tier 1 (session-c-brain-and-voice.md step 1) is a real embedding
// ranking now, not a single package's own score against a fixed bar: the
// live-found bug this step's own goal names ("'bedtime story' reaches
// the storytime skill, not the joke plugin") came from two candidates
// landing close together purely from shared filler words ("tell me a"),
// which a bare per-candidate threshold cannot tell apart from a genuine
// match - lib/routing.ts's `pickTier1Winner()` requires the best
// candidate to also clear the runner-up by a real margin, not just its
// own bar. A candidate with no stored embedding yet (a package just
// added, or the embed backend down) falls back to `exampleScore()` for
// itself alone; the ranking runs on whatever mix of real and fallback
// scores the turn actually has, never all-or-nothing.
// Session C step 2's own pre-filter sizes: "offer only the top few Tier 1
// candidates as tools" (a small, tunable number of candidates shown to
// the model, not the whole catalog) and "capped at two calls per turn"
// (the model's own decision, enforced independently of the grammar's
// own maxItems - lib/llm.ts's parseToolCalls() already refuses more than
// two, this is belt-and-suspenders at the call site too).
const MAX_TIER2_TOOLS_OFFERED = 3;
const MAX_TIER2_CALLS_PER_TURN = 2;

export interface RankedCandidate {
  id: string;
  score: number;
  manifest: PackageManifest;
}

export interface RouteResult {
  /** Tier 0 or Tier 1's own firing decision - unchanged meaning from
   * before this step. */
  winner: RoutedPlugin | null;
  /** Every candidate Tier 1 scored (never populated when a Tier 0
   * pattern already fired - `winner` is returned immediately in that
   * case, `ranked` stays empty), best score first. Session C step 2's
   * own Tier 2 pre-filter reads this when `winner` is null: "offer only
   * the top few Tier 1 candidates as tools." Deliberately includes
   * `consequential` packages (excluded from ever WINNING Tier 1 by
   * `canFire` below, but still real candidates to OFFER - the model may
   * PROPOSE one, gated on confirmation before it runs). */
  ranked: RankedCandidate[];
}

export async function route(text: string, actor: PersonRow, loaded: LoadedManifest[]): Promise<RouteResult> {
  const eligible: LoadedManifest[] = [];
  for (const { id, manifest } of loaded) {
    if (!meetsMinRole(actor.role, manifest.min_role)) continue;

    for (const pattern of manifest.routing?.patterns ?? []) {
      const captured = matchPattern(text, pattern);
      if (captured === null) continue;
      const args = deterministicArgs(manifest.args, captured);
      if (!args) continue;
      // Tier 0 always wins, immediately - no Tier 1 ranking to report.
      return { winner: { id, args, score: 1, viaPattern: true, viaEmbedding: true }, ranked: [] };
    }

    eligible.push({ id, manifest });
  }
  if (eligible.length === 0) return { winner: null, ranked: [] };

  await ensureRoutingEmbeddings(eligible.map(({ id, manifest }) => ({ id, examples: manifest.routing?.examples })));
  const utteranceVector = await embedUtterance(text);
  const embeddingScores = utteranceVector ? scoreByEmbedding(utteranceVector, eligible.map(({ id }) => id)) : new Map<string, number>();

  const scored = eligible.map(({ id, manifest }) => ({
    id,
    score: embeddingScores.get(id) ?? exampleScore(text, manifest.routing?.examples),
    viaEmbedding: embeddingScores.has(id),
  }));
  const ranked: RankedCandidate[] = [...scored]
    .sort((a, b) => b.score - a.score)
    .map((s) => ({ id: s.id, score: s.score, manifest: eligible.find((e) => e.id === s.id)!.manifest }));

  // A consequential package never WINS Tier 1 (examples alone never
  // clear its raised bar) - folded into canFire alongside the existing
  // arg-binding check, rather than excluded from `eligible`/`scored`
  // outright, so it still appears in `ranked` for Tier 2 to offer.
  const canFire = (id: string) => {
    const manifest = eligible.find((e) => e.id === id)!.manifest;
    if (manifest.consequential) return false;
    return deterministicArgs(manifest.args, null) !== null;
  };
  const tier1Winner = pickTier1WinnerAmong(scored, canFire);
  if (!tier1Winner) return { winner: null, ranked };

  const manifest = eligible.find((e) => e.id === tier1Winner.id)!.manifest;
  const args = deterministicArgs(manifest.args, null)!; // canFire already proved this binds
  const viaEmbedding = scored.find((s) => s.id === tier1Winner.id)!.viaEmbedding;
  return { winner: { id: tier1Winner.id, args, score: tier1Winner.score, viaPattern: false, viaEmbedding }, ranked };
}

type PreparedTurn =
  | { kind: "immediate"; value: TurnValue; turnId: string }
  | { kind: "model"; messages: LlmMessage[]; safety: SafetyResult; crisisResources?: string; turnId: string };

// Session C step 2: a plain word-list, not a model call - a pendingAsk
// confirmation is exactly the kind of turn that must resolve
// deterministically and instantly (a "yes" waiting on an LLM round trip
// to be recognized as "yes" is its own small reliability problem to
// invite for no reason).
// Matched at the START of the trimmed reply, not the whole string: "no
// thanks" and "yeah, go for it" are exactly as real as a bare "yes" or
// "no" and shouldn't need to match it exactly to be understood.
const AFFIRMATIVE_RE = /^(yes|yeah|yep|yup|sure|ok|okay|go ahead|do it|please do|confirmed?)\b/i;
const NEGATIVE_RE = /^(no|nope|nah|cancel|never ?mind|don'?t|stop)\b/i;

/** Session C step 2's pendingAsk continuation, either trigger
 * (Tier 2 proposing a `consequential` package, or a recipe result's own
 * `confirm`/`ask` - unbuilt on the producing side, see the `conversations.
 * pending_ask` column's own comment). Matched against the utterance
 * BEFORE the floor (Tier 0/1/2, commands) and always cleared after one
 * try, whether it matched or not - a stale confirmation waiting
 * indefinitely for a "yes" that never comes is worse than dropping it.
 * Returns null (proceed with normal routing for this utterance) when
 * nothing pending exists, the reply is ambiguous, or an "ask" can't bind
 * (no manifest, or the wrong arg shape to bind free text to). */
// spec/interpreters/ts/recipe-interpreter.ts's own hand-written
// `PluginResult` (Session D's file) only declares `reply`/`actions` -
// `confirm`/`ask` are real, generated spec fields
// (spec/schemas/result.schema.json, spec/gen/ts/result.ts) that no
// current recipe `Step` can actually set, so the interpreter's own
// narrower type doesn't type them at all. Widened locally rather than
// editing D's file: today's real runtime objects simply don't have
// either key (accessing an absent optional property is always safe,
// just `undefined`), and the cast stays exactly forward-compatible with
// whatever D eventually ships.
export type PluginResultWithConfirmAsk = PluginResult & {
  confirm?: { prompt?: string; on_confirm?: Record<string, unknown> };
  ask?: { prompt?: string; expects?: string };
};

/** A successful runPlugin() result carrying `confirm`/`ask` (spec/schemas/
 * result.schema.json, typed since session-a-intelligence.md step 6) does
 * not answer the turn with its own `.reply` - it asks the person
 * instead, storing a PendingAsk for the same resolvePendingAsk() flow a
 * Tier 2 consequential proposal (below) also feeds. No bundled recipe
 * can set either field yet (spec/interpreters/**'s `Step` union has no
 * op for it - Session D's file, not this session's to add): real and
 * tested against a hand-built PluginResult, not reachable by any real
 * package today. Returns null for the ordinary case (neither field
 * set) - the caller uses `.reply` as usual. */
export function pendingAskFromPluginResult(packageId: string, args: Record<string, unknown>, result: PluginResultWithConfirmAsk, conversationId: string): { prompt: string } | null {
  if (result.confirm) {
    const prompt = result.confirm.prompt ?? `Go ahead with ${packageId}?`;
    setPendingAsk(conversationId, { kind: "confirm", prompt, packageId, args });
    return { prompt };
  }
  if (result.ask) {
    const prompt = result.ask.prompt ?? "";
    setPendingAsk(conversationId, { kind: "ask", prompt, packageId, args, expects: result.ask.expects });
    return { prompt };
  }
  return null;
}

export async function resolvePendingAsk(
  text: string,
  actor: PersonRow,
  conversation: Conversation,
  loaded: LoadedManifest[],
  turnId: string,
  safety: SafetyResult,
  crisisResources: string | undefined,
): Promise<TurnValue | null> {
  const pending = getPendingAsk(conversation.id);
  if (!pending) return null;

  if (pending.kind === "confirm") {
    if (AFFIRMATIVE_RE.test(text.trim())) {
      setPendingAsk(conversation.id, null);
      const result = await runPlugin(pending.packageId, actor, pending.args, turnId);
      if (result.ok) {
        return { reply: result.value.reply ?? { text: "Done." }, source: "plugin", plugin_id: pending.packageId, safety, crisis_resources: crisisResources, conversation_id: conversation.id, turn_id: turnId };
      }
      return { reply: { text: "Sorry, I couldn't do that." }, source: "plugin_error", plugin_id: pending.packageId, safety, crisis_resources: crisisResources, conversation_id: conversation.id, turn_id: turnId };
    }
    if (NEGATIVE_RE.test(text.trim())) {
      setPendingAsk(conversation.id, null);
      return { reply: { text: "Okay, I won't do that." }, source: "confirm", safety, crisis_resources: crisisResources, conversation_id: conversation.id, turn_id: turnId };
    }
    // Ambiguous: cleared anyway (single-shot), utterance falls through
    // to normal routing rather than being force-fit as an answer.
    setPendingAsk(conversation.id, null);
    return null;
  }

  // kind: "ask" - the raw utterance is the answer; deterministicArgs()
  // (already exported above) is the exact "bind one required string arg,
  // no wildcard capture needed" logic this needs, reused rather than a
  // second copy of it.
  setPendingAsk(conversation.id, null);
  const manifest = loaded.find((l) => l.id === pending.packageId)?.manifest;
  const boundArg = manifest ? deterministicArgs(manifest.args, text) : null;
  if (!boundArg) return null; // can't bind - fall through to normal routing rather than guess
  const result = await runPlugin(pending.packageId, actor, { ...pending.args, ...boundArg }, turnId);
  if (!result.ok) return null; // the continuation attempt failed - fall through rather than report a confusing error for an utterance that wasn't really about this
  return { reply: result.value.reply ?? { text: "Done." }, source: "plugin", plugin_id: pending.packageId, safety, crisis_resources: crisisResources, conversation_id: conversation.id, turn_id: turnId };
}

/** Safety-first routing and the deterministic plugin floor (4.5), shared
 * by runTurn() and runTurnStream(): identical for both, and the only real
 * difference between "a normal reply" and "a streamed one" is how the
 * `chat` role's own answer gets to the caller, never whether safety ran
 * or which plugin matched. Only the `kind: "model"` branch differs between
 * the two callers - runTurn() awaits complete(), runTurnStream() awaits
 * startCompleteStream() instead.
 *
 * Generates this turn's own id once, up front (step 2's provenance rule:
 * "createHost() receives the turn id... Host.memory.remember writes
 * source: <turn id>"), and hands it to runPlugin() (so anything a plugin
 * remembers via the package host is attributed to this exact turn) and
 * back to the caller (so runTurn()/runTurnStream() log this turn's own
 * conversation_turns row under that SAME id, not a second freshly-minted
 * one) - one id names both "the turn that happened" and "the provenance
 * of anything it wrote to memory". */
async function prepareTurn(
  actor: PersonRow,
  surface: Surface,
  text: string,
  loaded: LoadedManifest[],
  conversation: Conversation,
  skills: LoadedSkill[] = loadAllSkills(),
): Promise<PreparedTurn> {
  const turnId = newConversationTurnId();
  // Stamps conversation_id/turn_id exactly once, rather than at each of
  // this function's five immediate-return sites (a code review,
  // 2026-09-05, found the two fields copy-pasted into every one of
  // them - a future branch added here is a copy-paste-and-forget site
  // waiting to happen).
  const immediate = (value: Omit<TurnValue, "conversation_id" | "turn_id">): PreparedTurn => ({
    kind: "immediate",
    value: { ...value, conversation_id: conversation.id, turn_id: turnId },
    turnId,
  });
  const safety = evaluateSafety(text, actor.role as Role);
  if (safety.notify_parent) {
    // SafetyResult's own schema comment named this exact wiring as a
    // "later hub release" gap the day the field was written: notify_parent
    // has been computed correctly since safety.ts shipped, but nothing
    // before lib/notifications.ts existed to deliver it - it only ever
    // reached a console.log line. Fired regardless of `action`
    // (allow_with_resources and refuse can both flag a minor's turn), and
    // BEFORE the refuse branch below returns, so a refused turn still
    // notifies. Never awaited: notifying a parent must never add latency
    // to, or ever be able to fail, the turn itself (this function's own
    // "never throws" contract - notifications.ts's trigger() already
    // upholds it, this just doesn't block on it too).
    trigger("safety.flagged_turn", { childName: actor.displayName, categories: safety.categories.join(", ") }).catch((err: unknown) =>
      console.error(`[turn] safety.flagged_turn notification failed: ${(err as Error).message}`),
    );
  }
  if (safety.action === "refuse") {
    // The text here is never actually seen: finalizeReply() unconditionally
    // replaces it via pickRefusalVariant() for every `safety_refuse`
    // source, the one source that always gets a real, varied phrasing
    // rather than a fixed constant (a code review, 2026-09-05, found a
    // now-deleted REFUSAL_TEXT constant here, which looked editable but
    // silently wasn't). Any placeholder works; this one just reads
    // sensibly in a debugger or log before finalizeReply runs.
    return immediate({ reply: { text: "I can't help with that." }, source: "safety_refuse", safety });
  }
  const crisisResources = deriveCrisisResources(safety);

  // Session C step 2: matched against the utterance before the floor
  // (commands, Tier 0/1/2) - a pendingAsk from an earlier turn always
  // gets first refusal on what this utterance means.
  const pendingAskValue = await resolvePendingAsk(text, actor, conversation, loaded, turnId, safety, crisisResources);
  if (pendingAskValue) return { kind: "immediate", value: pendingAskValue, turnId };

  // Checked before the plugin floor: a command is household-authored,
  // deliberate, and exact-match-only (never fuzzy) - the identical "a
  // real trigger always wins" property a plugin's own pattern match has,
  // just for a phrase the household chose for itself rather than one a
  // bundled package shipped with. A household member customizing "tell
  // me a joke" with their own command is exactly that: a deliberate
  // override, not a collision to prevent.
  const matchedCommand = matchCommand(text, actor);
  if (matchedCommand) {
    const result = await runCommand(matchedCommand);
    if (result.ok) {
      return immediate({
        reply: { text: result.value.text, speech: result.value.speech },
        source: "command",
        command_id: matchedCommand.id,
        safety,
        crisis_resources: crisisResources,
      });
    }
    console.log(`[turn] command ${matchedCommand.id} matched but failed to run: ${result.error}`);
    return immediate({
      reply: { text: "Sorry, I couldn't do that." },
      source: "command_error",
      command_id: matchedCommand.id,
      safety,
      crisis_resources: crisisResources,
    });
  }

  const { winner: routed, ranked } = await route(text, actor, loaded);
  // A real trigger phrase always wins outright (see RoutedPlugin's own
  // comment on why `viaPattern`, not `score === 1`, is the real signal).
  // Only a FUZZY plugin match is subject to being outscored - found live
  // (2026-09-05, docs/dev.md's "The real skill kind, shipped" entry):
  // "tell me a bedtime story about a fox" hijacked by the `joke` plugin's
  // own keyword-overlap placeholder scoring "tell me a dad joke" at
  // exactly the match threshold, purely from the shared filler words
  // "tell me a" - with a much more confident, genuinely relevant skill
  // match sitting right there unused. A weak, accidental plugin match
  // should not get to preempt a stronger, more specific skill match for
  // the identical turn; a household member's own deliberately-authored
  // trigger phrase always still can.
  const routedViaFuzzyMatch = routed && !routed.viaPattern;
  const bestSkillScore = routedViaFuzzyMatch ? (matchingSkills(text, skills)[0]?.score ?? 0) : 0;
  if (routed && !(routedViaFuzzyMatch && bestSkillScore > routed.score)) {
    const result = await runPlugin(routed.id, actor, routed.args, turnId);
    if (result.ok) {
      const pending = pendingAskFromPluginResult(routed.id, routed.args, result.value as PluginResultWithConfirmAsk, conversation.id);
      if (pending) {
        return immediate({ reply: { text: pending.prompt }, source: "confirm", plugin_id: routed.id, safety, crisis_resources: crisisResources });
      }
      const reply = result.value.reply ?? { text: "Done." };
      return immediate({
        reply,
        source: "plugin",
        plugin_id: routed.id,
        safety,
        crisis_resources: crisisResources,
        routing: { tier: routed.viaPattern ? "pattern" : routed.viaEmbedding ? "embedding" : "keyword", score: routed.score },
      });
    }
    // A pre-filtered deterministic match failing at runPlugin is a real, if
    // rare, gap (a role change or a bad manifest between the router's
    // check and the run); surfaced as a plain apology rather than leaking
    // the internal error string to a household member, logged for anyone
    // debugging it. `source: "plugin_error"` on the returned `TurnValue` is
    // the intended way to detect it, not the top-level `ok` flag (a review,
    // 2026-09-04, flagged this could otherwise look indistinguishable from
    // a real success to a caller branching on `.ok` alone).
    console.log(`[turn] plugin ${routed.id} matched but failed to run: ${result.error}`);
    return immediate({
      reply: { text: "Sorry, I couldn't do that." },
      source: "plugin_error",
      plugin_id: routed.id,
      safety,
      crisis_resources: crisisResources,
    });
  }

  // selfOnly: true (step 2's privacy fix) - a person's own turn must
  // never surface another person's person-scope memories into the
  // model's context, regardless of role. Usage is bumped separately
  // below, only on the subset that actually reached the prompt, not on
  // every one of recall()'s top-20 candidates. The query is embedded
  // here (step 5), before the sync recall() call, so real cosine
  // scoring runs whenever the embed backend is up; embedQueryForRecall()
  // degrades to undefined on any failure, which recall() already treats
  // as "fall back to keyword overlap" - no separate handling needed here.
  const queryVector = await embedQueryForRecall(text);
  const memoryMatches = recall(actor, text, { selfOnly: true, bumpUsage: false, queryVector });
  const persona = resolvePersona(getPersonSettingValue(actor, "persona.active_id"));
  // The follow-up-turn context (step 3): "and tomorrow?" needs the prior
  // exchange in the messages array, not just in the system prompt's own
  // text - buildConversationWindow() returns both the verbatim
  // user/assistant messages AND, when older turns exist beyond them, one
  // summary line for the system prompt's volatile zone.
  const window = buildConversationWindow(conversation);
  const systemPrompt = buildSystemPrompt(actor, text, memoryMatches, loaded, persona, skills, window.summaryLine);
  // Bumping the top MAX_MEMORY_SNIPPETS candidates unconditionally was
  // wrong (a code review, 2026-09-05): buildSystemPrompt's own
  // MAX_MEMORY_SECTION_CHARS truncation, or the outer PROMPT_SYSTEM_CHAR_
  // BUDGET slice, can still cut one of those candidates' bullet lines
  // short (or drop it entirely) before it reaches the model, exactly the
  // "bump only on records that reached the prompt" case this was meant
  // to fix. Checking the bullet line's exact text is a real proof, not a
  // re-derivation of buildSystemPrompt's own truncation math in a second
  // place: a candidate only counts as "reached the prompt" if its whole,
  // untruncated `- <text>` line is actually still there in the string the
  // model was sent.
  const actuallyInjected = memoryMatches
    .slice(0, MAX_MEMORY_SNIPPETS)
    .filter((m) => systemPrompt.includes(`- ${m.record.text}`));
  bumpUsage(actuallyInjected);
  const messages: LlmMessage[] = [
    { role: "system", content: systemPrompt },
    ...window.messages,
    { role: "user", content: text },
  ];
  // Session C step 2: Tier 2, native tool calling. Only reached when
  // Tier 0/1 found no winner - `ranked` (route()'s own Tier 1 scoring)
  // is the pre-filter this step's own text asks for ("offer only the
  // top few Tier 1 candidates as tools"). Extracted as its own function
  // (rather than inlined here) specifically so it's directly unit-
  // testable without a full runTurn() and a fixture package on disk -
  // see its own comment.
  const tier2 = await attemptTier2Tools(text, actor, ranked, messages, turnId, conversation.id, safety, crisisResources);
  if (tier2) return { kind: "immediate", value: tier2, turnId };

  return { kind: "model", messages, safety, crisisResources, turnId };
}

/** Session C step 2's Tier 2: offers `ranked`'s top few candidates
 * (including `consequential` ones - the model may PROPOSE one, gated on
 * confirmation before it runs) as tools, and either runs what it
 * proposes, asks for confirmation, or returns null to fall through to
 * the ordinary conversational reply using the SAME `messages` already
 * built (no separate retry call, no second grammar attempt) - the exact
 * "ask again, never a silent drop" contract for an unparseable or fully-
 * invalid proposal. Extracted as its own function so it's testable
 * directly: `ranked` can be a hand-built list (a `consequential` fixture
 * manifest needs no file on disk - the confirmation path never reaches
 * runPlugin() at all), while the "a proposed call actually runs" path
 * exercises a real bundled package. */
export async function attemptTier2Tools(
  text: string,
  actor: PersonRow,
  ranked: RankedCandidate[],
  messages: LlmMessage[],
  turnId: string,
  conversationId: string,
  safety: SafetyResult,
  crisisResources: string | undefined,
): Promise<TurnValue | null> {
  if (ranked.length === 0) return null; // nothing here has any routing.examples at all - nothing to offer

  const offered: ToolSpec[] = ranked.slice(0, MAX_TIER2_TOOLS_OFFERED).map((r) => ({ id: r.id, description: r.manifest.description, args: r.manifest.args }));
  const toolResult = await complete("chat", messages, { tools: offered, tool_choice: "auto" });
  const calls = toolResult.ok ? toolResult.value.tool_calls : undefined;
  // `undefined` (a reply that didn't parse as the requested shape at all
  // - lib/llm.ts's own "ask again, never a silent drop" contract) and
  // `[]` (the model looked and genuinely found nothing worth calling)
  // both fall straight through to null (the caller's normal
  // conversational reply).
  if (!calls || calls.length === 0) return null;

  const capped = calls.slice(0, MAX_TIER2_CALLS_PER_TURN);
  const rankedById = new Map(ranked.map((r) => [r.id, r]));
  // A `consequential` proposal never runs on the model's say-so alone
  // (4.9: "raises the routing bar") - the turn engine itself asks first,
  // the identical PendingAsk flow a recipe's own `confirm` field feeds.
  // Any OTHER call proposed in the same batch is dropped for this turn
  // (a documented simplification: one confirmation question at a time,
  // not "yes, and also...").
  const consequential = capped.find((c) => rankedById.get(c.tool)?.manifest.consequential);
  if (consequential) {
    const manifest = rankedById.get(consequential.tool)!.manifest;
    const prompt = `Do you want me to ${manifest.description.replace(/\.$/, "").toLowerCase()}?`;
    const args = (consequential.args ?? {}) as Record<string, unknown>;
    setPendingAsk(conversationId, { kind: "confirm", prompt, packageId: consequential.tool, args });
    return { reply: { text: prompt }, source: "confirm", plugin_id: consequential.tool, safety, crisis_resources: crisisResources, conversation_id: conversationId, turn_id: turnId };
  }

  // Two independent calls, run in parallel - never chained (a result
  // feeding another is a recipe, not this step's job).
  const ran = await Promise.all(
    capped.map(async (c) => ({ call: c, result: await runPlugin(c.tool, actor, (c.args ?? {}) as Record<string, unknown>, turnId) })),
  );
  const oks = ran.filter((r): r is { call: ToolCall; result: Extract<(typeof r)["result"], { ok: true }> } => r.result.ok);
  // Every proposed call failed (invalid args - "verify every call with
  // the package's args schema before acting" - or a runtime error): "ask
  // again," never a silent drop, means null (a normal conversational
  // reply), not fabricating a plugin success or reporting a confusing
  // tool-shaped error.
  if (oks.length === 0) return null;

  const withPending = oks.find((r) => (r.result.value as PluginResultWithConfirmAsk).confirm || (r.result.value as PluginResultWithConfirmAsk).ask);
  if (withPending) {
    const args = (withPending.call.args ?? {}) as Record<string, unknown>;
    const pending = pendingAskFromPluginResult(withPending.call.tool, args, withPending.result.value as PluginResultWithConfirmAsk, conversationId);
    if (pending) {
      // A code review (2026-09-06) found this discarding any OTHER
      // call's own reply text outright - two independent calls, one
      // that already ran with a real side effect and a real answer, the
      // other asking to be confirmed, and only the confirmation prompt
      // ever reached the person, silently dropping the first one's
      // result. Both are real information about the same turn.
      const otherText = oks
        .filter((r) => r !== withPending)
        .map((r) => r.result.value.reply?.text)
        .filter((t): t is string => !!t)
        .join(" ");
      const text = otherText ? `${otherText} ${pending.prompt}` : pending.prompt;
      return { reply: { text }, source: "confirm", plugin_id: withPending.call.tool, safety, crisis_resources: crisisResources, conversation_id: conversationId, turn_id: turnId };
    }
  }
  const replyText = oks.map((r) => r.result.value.reply?.text ?? "Done.").join(" ");
  const pluginIds = oks.map((r) => r.call.tool).join("+");
  const bestScore = Math.max(...oks.map((r) => rankedById.get(r.call.tool)?.score ?? 0));
  return {
    reply: { text: replyText },
    source: "plugin",
    plugin_id: pluginIds,
    safety,
    crisis_resources: crisisResources,
    routing: { tier: "embedding", score: bestScore },
    conversation_id: conversationId,
    turn_id: turnId,
  };
}

/** The one central point every TurnValue passes through before it reaches
 * a caller or gets logged (2026-09-05, `spec/voice/README.md`'s
 * "Speech normalization... fills reply.speech centrally, never per
 * recipe"): varies a known constant reply so the same person doesn't hear
 * the exact same sentence forever (replyVariation.ts), then fills
 * reply.speech with the mechanically normalized spoken form
 * (normalizeForSpeech.ts) - numbers, times, dates read the way a person
 * says them, while reply.text (what's displayed) is never touched.
 *
 * A package that authored its OWN speech string (genuinely different
 * from its text - the interpreter's default is `speech === text`, a real
 * override never is) opts out of BOTH: checked first and returned
 * completely untouched, on the theory that a package which already chose
 * its own words for both channels has made its own call, not a partial
 * one for text alone. A code review (2026-09-05) found the original
 * version varied `text` even under an override, leaving a stale `speech`
 * tied to the pre-variation wording once a real override ever exists.
 *
 * Rotation itself only ever runs for the sources that can actually
 * PRODUCE one of these known constants (`plugin`/`plugin_error`, and now
 * `command`/`command_error` - a `home_call_service` command's own success
 * text is literally "Done.", the exact same pool entry a plugin's own
 * home.call_service reply already hits) plus the safety refusal's own
 * dedicated path - never `model`. The same review found the original
 * version called `varyKnownConstant()` unconditionally for every
 * non-refusal source, so a model reply that happened to say "Done." or
 * "I don't remember anything about that." in its own words got silently
 * swapped for an unrelated pool phrase. */
function finalizeReply(actor: PersonRow, value: TurnValue): TurnValue {
  const { text, speech } = value.reply;
  if (speech !== undefined && speech !== text) return value;

  // Resolved fresh here rather than threaded in from prepareTurn(): an
  // immediate (plugin/refusal) reply never goes through prepareTurn()'s
  // own "model" branch at all, so there's no persona already in scope by
  // the time any TurnValue reaches this function - a plain settings
  // lookup, not I/O, so re-resolving it here costs nothing real. A code
  // review (2026-09-05) named the real, narrow consequence of resolving
  // it fresh rather than threading it through: if the person changes
  // persona.active_id via a concurrent request while THIS turn is still
  // in flight, the per-companion confirmation pool below could pick the
  // NEW persona's own phrasing for a reply whose system prompt (for a
  // "model" source) was actually built under the OLD one - one
  // confirmation sentence voiced as the just-switched-to companion, at
  // most, never a data or safety correctness issue. Accepted rather than
  // threading persona through prepareTurn()'s return value for it: the
  // race requires the same person to change their own setting mid-turn,
  // and its worst outcome is one word choice sounding like the wrong
  // companion for one reply.
  const personaId = resolvePersona(getPersonSettingValue(actor, "persona.active_id")).id;
  const variedText =
    value.source === "safety_refuse"
      ? pickRefusalVariant(actor.id)
      : value.source === "plugin" ||
          value.source === "plugin_error" ||
          value.source === "command" ||
          value.source === "command_error"
        ? varyKnownConstant(actor.id, text, personaId)
        : text;
  return { ...value, reply: { text: variedText, speech: normalizeForSpeech(variedText) } };
}

/** Runs one conversation turn end to end: safety first, then the
 * deterministic plugin floor, then the chat model as the phrasing fallback. */
export async function runTurn(
  actor: PersonRow,
  surface: Surface,
  text: string,
  opts: { thinking?: boolean; conversationId?: string } = {},
): Promise<TurnOpResult> {
  if (!IMPLEMENTED_SURFACES.has(surface)) {
    return {
      ok: false,
      status: 400,
      code: "unsupported_surface",
      error: `the ${surface} surface is not implemented on this host build yet (4.5)`,
    };
  }
  if (typeof text !== "string" || text.trim().length === 0) {
    return { ok: false, status: 400, code: "invalid_input", error: "text is required" };
  }

  // Resolved before prepareTurn() runs (step 3's contract: "conversation_id
  // absent means the actor's open conversation for that surface, created
  // if none"): a given but invalid/foreign id is a real 400, the same
  // "validate first, prepareTurn assumes valid inputs" shape this
  // function's own surface/text checks above already establish.
  const conversationResult = resolveOrCreateConversation(actor, surface, opts.conversationId);
  if (!conversationResult.ok) {
    return { ok: false, status: 400, code: "invalid_input", error: conversationResult.error };
  }
  const conversation = conversationResult.value;

  const loaded = loadAllManifests(); // one catalog scan, shared below
  const prepared = await prepareTurn(actor, surface, text, loaded, conversation);

  let value: TurnValue;
  if (prepared.kind === "immediate") {
    value = prepared.value;
  } else {
    const completion = await complete("chat", prepared.messages, { thinking: opts.thinking });
    if (!completion.ok) {
      return { ok: false, status: 503, code: "unavailable", error: completion.error };
    }
    // Step 9's own principle (spec/safety/ts/classifier.ts's promise to
    // run "again on every streamed sentence") applied to this function's
    // non-streaming twin: a completed reply here always arrives as one
    // atomic block, so a single whole-text check is exactly as strong as
    // per-sentence checking and needs no chunker at all - the plan's own
    // text names runTurnStream specifically, but leaving this function
    // with literally no output-side check at all (worse than
    // runTurnStream had before this step: at least that one only lacked
    // the PER-SENTENCE granularity) would be a real, undocumented
    // asymmetry between the two callers of the exact same model role.
    // Never weakens the INPUT check above (prepareTurn()'s own
    // evaluateSafety() call) - purely additive.
    const outputSafety = evaluateSafety(completion.value.text, actor.role as Role);
    if (outputSafety.notify_parent) {
      trigger("safety.flagged_turn", { childName: actor.displayName, categories: outputSafety.categories.join(", ") }).catch((err: unknown) =>
        console.error(`[turn] safety.flagged_turn notification failed: ${(err as Error).message}`),
      );
    }
    value =
      outputSafety.action === "refuse"
        ? {
            // A non-streaming reply is atomic - nothing was ever shown to
            // the caller before this point, so replacing the WHOLE reply
            // with a canned refusal (finalizeReply()'s own existing
            // "safety_refuse" handling, unchanged) is exactly as clean
            // here as it is for an input-side refusal, unlike
            // runTurnStream()'s own partial-delivery case above.
            reply: { text: "" },
            source: "safety_refuse",
            safety: outputSafety,
            crisis_resources: prepared.crisisResources,
            conversation_id: conversation.id,
            turn_id: prepared.turnId,
          }
        : {
            reply: { text: completion.value.text },
            source: "model",
            safety: outputSafety.flagged ? outputSafety : prepared.safety,
            crisis_resources: outputSafety.flagged ? deriveCrisisResources(outputSafety) : prepared.crisisResources,
            conversation_id: conversation.id,
            turn_id: prepared.turnId,
          };
  }

  value = finalizeReply(actor, value);
  logTurnSafely(actor, surface, text, value);
  return { ok: true, value };
}

export type TurnStreamResult =
  | TurnFailure
  | { ok: true; kind: "immediate"; value: TurnValue }
  | {
      ok: true;
      kind: "stream";
      /** Known before a single token streams (the conversation is
       * resolved and the turn id minted up front, step 2/3): routes/
       * turn.ts's contract requires these as the very first NDJSON line
       * ("turn_meta"), before any delta. */
      conversationId: string;
      turnId: string;
      /** The generator's own return value (step 9), read from the final
       * `iterator.next()` result once `done` is true on a NORMAL
       * completion (never reached on a thrown StreamSafetyRefusal, which
       * rejects instead): the most recently flagged, non-refuse
       * SafetyResult gateOutputSafety() saw, if any - a self_harm mention
       * in the model's own output, say. `undefined` when nothing was
       * ever flagged. The caller passes this into `finalize()` the same
       * way it passes a caught refusal's own SafetyResult, so a flag
       * that never refuses still reaches the logged turn and its
       * `crisis_resources` instead of being silently dropped once the
       * notification fires. */
      tokens: AsyncGenerator<string, SafetyResult | undefined, void>;
      /** Builds the final TurnValue once the caller has drained `tokens`
       * to completion and knows the full reply text - also logs the turn
       * (conversationHistory.ts), the same "log once the real reply is
       * known" timing runTurn() already has, just triggered by the
       * caller finishing the stream instead of by this function awaiting
       * it directly. `outputSafety` (step 9): passed by the caller's own
       * catch block when `tokens` threw a `StreamSafetyRefusal`, so the
       * logged/returned TurnValue's `safety` field reflects what
       * actually cut the stream rather than only ever the input-side
       * result computed before generation started. */
      finalize: (replyText: string, outputSafety?: SafetyResult) => TurnValue;
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

/** Wraps a raw token-delta generator with a per-sentence safety gate:
 * buffers deltas until `spec/safety/ts/sentenceChunker.ts`'s own boundary
 * detection has one complete sentence, checks THAT ONE sentence with the
 * IDENTICAL `evaluateSafety()` the input path uses (never a weaker check
 * - the plan's own "never weaken the input check" applies symmetrically
 * to not inventing a laxer one for output), and only then yields it -
 * one sentence at a time, never batched, so a review (2026-09-05) found
 * batching them (checking every newly-ready sentence in a loop, then
 * yielding the whole group at once) had a real bug: if the SECOND of two
 * sentences that became ready in the same delta refused, the throw fired
 * before the group's own combined yield ever ran, silently dropping the
 * FIRST sentence too, even though it had already cleared its own check
 * and the plan's own contract says earlier sentences were delivered.
 * `notify_parent` fires independently of `action`, the exact shape
 * prepareTurn()'s own input-side check already has (self_harm flags and
 * notifies without ever blocking - CLAUDE.md's "Crisis resources: offer,
 * never block" - so an output-side self_harm mention must behave
 * identically, not accidentally cut a reply that should only ever be
 * augmented with resources, never refused). A `refuse` category throws
 * `StreamSafetyRefusal` immediately, before yielding the offending
 * sentence at all: nothing from it, or anything the model might have
 * generated after it, ever reaches a caller. A non-refuse flag (self_harm)
 * is tracked and returned as this generator's own return value once
 * generation ends normally - the second half of the same review's
 * finding: a flag that never refuses was being silently dropped
 * entirely once checkAndNotify() fired the notification, never reaching
 * the caller's own finalize() call, so `crisis_resources` never made it
 * onto a turn whose OUTPUT (not input) was what actually mentioned
 * self-harm. Yields the RAW consumed substring for each sentence, not
 * `nextSentenceBoundary()`'s own implicit trimmed span: blindly
 * concatenating trimmed chunks back together would silently swallow the
 * whitespace between sentences - a real, separate bug an early version
 * of this function had, caught by two existing tests asserting the
 * reassembled text matches what was actually generated. Delta
 * granularity changes from raw model tokens to whole sentences/clauses
 * as a direct, necessary consequence of gating at all - a sentence can't
 * be judged safe before it's complete, so it can't be delivered before
 * that either. */
export async function* gateOutputSafety(
  tokens: AsyncGenerator<string, void, void>,
  actor: PersonRow,
): AsyncGenerator<string, SafetyResult | undefined, void> {
  let pending = "";
  let isFirstChunk = true;
  let lastFlagged: SafetyResult | undefined;

  const checkAndNotify = (chunk: string): SafetyResult => {
    const safety = evaluateSafety(chunk, actor.role as Role);
    if (safety.notify_parent) {
      trigger("safety.flagged_turn", { childName: actor.displayName, categories: safety.categories.join(", ") }).catch((err: unknown) =>
        console.error(`[turn] safety.flagged_turn notification failed: ${(err as Error).message}`),
      );
    }
    if (safety.flagged) lastFlagged = safety;
    return safety;
  };

  for await (const delta of tokens) {
    pending += delta;
    for (;;) {
      const end = nextSentenceBoundary(pending, isFirstChunk);
      if (end < 0) break;
      isFirstChunk = false;
      const rawSpan = pending.slice(0, end);
      pending = pending.slice(end);
      const trimmed = rawSpan.trim();
      if (!trimmed) continue; // a boundary with nothing but whitespace before it - nothing to check or yield
      const safety = checkAndNotify(trimmed);
      if (safety.action === "refuse") throw new StreamSafetyRefusal(safety);
      yield rawSpan;
    }
  }

  // Whatever's left after the model's own generation ends is the final
  // chunk, complete or not (there's no more text coming to complete it
  // with) - checked and yielded the same way, since a short, unterminated
  // final clause is exactly as capable of being unsafe as a properly
  // punctuated sentence. Checked trimmed (clean text for the
  // classifier), yielded raw (pending itself, not the trimmed copy) for
  // the identical whitespace-fidelity reason as the loop above.
  const remainder = pending.trim();
  if (remainder) {
    const safety = checkAndNotify(remainder);
    if (safety.action === "refuse") throw new StreamSafetyRefusal(safety);
    yield pending;
  }

  return lastFlagged;
}

/** Same safety-first routing and deterministic plugin floor as runTurn(),
 * but the `chat` role's own answer streams token by token instead of
 * arriving as one blocking call - the real prerequisite for speaking a
 * reply sentence by sentence as it's generated (spec/voice/README.md's
 * "what Jesse actually meant by streamed"), not just a byte-chunked
 * `POST /api/tts`. `kind: "immediate"` still covers safety refusals and
 * plugin replies: both are already complete, deterministic text with
 * nothing to gain from streaming, so they answer in one line instead of
 * pretending to trickle in. */
export async function runTurnStream(
  actor: PersonRow,
  surface: Surface,
  text: string,
  opts: { thinking?: boolean; conversationId?: string } = {},
): Promise<TurnStreamResult> {
  if (!IMPLEMENTED_SURFACES.has(surface)) {
    return {
      ok: false,
      status: 400,
      code: "unsupported_surface",
      error: `the ${surface} surface is not implemented on this host build yet (4.5)`,
    };
  }
  if (typeof text !== "string" || text.trim().length === 0) {
    return { ok: false, status: 400, code: "invalid_input", error: "text is required" };
  }

  const conversationResult = resolveOrCreateConversation(actor, surface, opts.conversationId);
  if (!conversationResult.ok) {
    return { ok: false, status: 400, code: "invalid_input", error: conversationResult.error };
  }
  const conversation = conversationResult.value;

  const loaded = loadAllManifests();
  const prepared = await prepareTurn(actor, surface, text, loaded, conversation);

  if (prepared.kind === "immediate") {
    const value = finalizeReply(actor, prepared.value);
    logTurnSafely(actor, surface, text, value);
    return { ok: true, kind: "immediate", value };
  }

  const started = await startCompleteStream("chat", prepared.messages, { thinking: opts.thinking });
  if (!started.ok) {
    // Collapsed to "unavailable", the same as runTurn()'s own handling of
    // complete()'s failure: llm.ts's own "unsupported_role"/"invalid_input"
    // codes describe a role/messages problem this function's own prior
    // validation already ruled out for `chat` - by the time startCompleteStream
    // fails, it's a real down-engine case, not a request-shape one.
    return { ok: false, status: 503, code: "unavailable", error: started.error };
  }

  return {
    ok: true,
    kind: "stream",
    conversationId: conversation.id,
    turnId: prepared.turnId,
    tokens: gateOutputSafety(started.tokens, actor),
    finalize: (replyText: string, outputSafety?: SafetyResult): TurnValue => {
      // A safety cut with nothing safe delivered before it (the very
      // first sentence was itself the unsafe one, replyText === "") gets
      // treated as a real safety_refuse, the same clean "nothing shown
      // yet, replace the whole thing with a canned refusal"
      // finalizeReply() already gives an input-side refusal - runTurn()'s
      // own non-streaming twin makes the identical call. A cut with real
      // partial content already streamed stays source: "model" so that
      // content survives in the log rather than being erased by a canned
      // phrase the household never actually heard replace it.
      const refusedWithNothingDelivered = outputSafety?.action === "refuse" && replyText === "";
      // A review (2026-09-05) found this always used prepared.crisis
      // Resources (the INPUT check's own derivation) even when
      // `outputSafety` was the one actually flagged - so a self_harm
      // mention in the MODEL's own words (never a refuse, so it never
      // threw and reached this function only via gateOutputSafety()'s
      // own return value) got `value.safety.action ===
      // "allow_with_resources"` with no `crisis_resources` attached at
      // all, the exact silent drop CLAUDE.md's non-configurable "offer,
      // never block" invariant exists to prevent. A second review pass
      // found the first fix then dropped the INPUT's own crisis
      // resources whenever `outputSafety` was present at all, even an
      // output refusal for a category that has nothing to do with
      // self-harm: a message that itself mentioned self-harm
      // (`prepared.crisisResources` set) whose reply then got cut for an
      // unrelated refuse category lost the 988 text entirely.
      // `?? prepared.crisisResources` keeps the input's own resources as
      // the fallback whenever the output side isn't itself the
      // allow_with_resources case, matching runTurn()'s own refuse
      // branch, which never had this bug.
      const crisisResources = (outputSafety && deriveCrisisResources(outputSafety)) ?? prepared.crisisResources;
      const value: TurnValue = finalizeReply(actor, {
        reply: { text: replyText },
        source: refusedWithNothingDelivered ? "safety_refuse" : "model",
        safety: outputSafety ?? prepared.safety,
        crisis_resources: crisisResources,
        conversation_id: conversation.id,
        turn_id: prepared.turnId,
      });
      logTurnSafely(actor, surface, text, value);
      return value;
    },
  };
}

// Not built this pass, deliberately (see docs/dev.md):
// - Every surface but `chat` (overlay, pod, robot, tv, phone).
// - Tier 2 native tool calling: the model choosing and calling a plugin
//   when the deterministic floor doesn't clear (needs the chat contract's
//   tools support, deferred in spec/llm/README.md, and a real engine).
// - Remote candidates when no local plugin clears the bar (no remote
//   backend configured anywhere in this repo).
// - `ask`-continuation: PluginResult.ask exists in the spec (result.schema.json)
//   but the recipe interpreter has no step that ever produces one
//   (runRecipe always sets `reply`, never `ask`), an interpreter-level gap
//   the same shape as the scheduler's input-carrying gap and
//   host.llm.complete's sync/async gap. Nothing routes a follow-up
//   deterministically today.
// - A real Persona/style record: 2026-09-05 built a first, narrow slice
//   (lib/persona.ts) - a small in-code catalog, a person-scope settings
//   key to pick one, and composePersonaPrompt() rendering the pick into
//   this prompt. NOT built: a database table or authoring/selection UI
//   (a household can't create a custom persona, only pick from the
//   catalog), regional dialect, a "candor" dial (deliberately kept out,
//   see lib/persona.ts's own comment on why), and per-persona voice/
//   speech rate. See docs/dev.md's persona entry for the full scope.
// - Cross-surface context and 90-day summarization (4.14: conversation
//   history itself is real now, see lib/conversationHistory.ts; a turn's
//   own *reasoning* is still stateless beyond what memory.recall()
//   surfaces fresh, the recalled history isn't fed back into the prompt
//   as prior conversational context yet).
