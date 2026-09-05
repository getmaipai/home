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
import { loadAllSkills, type LoadedSkill } from "@/lib/skills";
import { matchCommand, runCommand } from "@/lib/commands";
import { trigger } from "@/lib/notifications";
import { recall, bumpUsage, type RecallMatch } from "@/lib/memory";
import { newConversationTurnId } from "@/lib/id";
import { complete, startCompleteStream, type LlmMessage } from "@/lib/llm";
import { tokenize } from "@/lib/text";
import { logTurn, resolveOrCreateConversation, buildConversationWindow, maybeRefreshConversationSummary } from "@/lib/conversationHistory";
import { pickRefusalVariant, varyKnownConstant } from "@/lib/replyVariation";
import { normalizeForSpeech } from "@maipai/spec/voice/ts/normalizeForSpeech.js";
import { getPersonSettingValue, getHouseholdSettingValue } from "@/lib/settings";
import { listActivePeople } from "@/lib/access";
import { composePersonaPrompt, resolvePersona, DEFAULT_PERSONA, INFORMATION_HANDLING_POLICY, type Persona } from "@/lib/persona";
import type { Role } from "@/middleware/auth";
import type { PersonRow } from "@/types";
import type { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
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

const STABLE_SYSTEM_PREFIX = [
  "You are MaiPai, a private, self-hosted AI assistant for this household. Be warm, concise and honest. Nothing you say leaves this house.",
  "Requests already blocked by the household's safety rules never reach you; answer anything else helpfully and honestly.",
  "If you don't know something the household hasn't told you, say so instead of guessing.",
].join(" ");

// The speech register is now the selected Persona (lib/persona.ts,
// 2026-09-05): what used to be a single fixed NATURAL_REGISTER_POLICY
// constant is the "default" entry in `PERSONAS`, composed through the
// exact same mechanism every other persona uses, rather than a special
// case. Kept separate from STABLE_SYSTEM_PREFIX for the same reason it
// always was: a persona's own fragment can change per person turn to
// turn while the identity/safety-posture prefix above it can't.

interface LoadedManifest {
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
function loadAllManifests(): LoadedManifest[] {
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
function matchingSkills(text: string, skills: LoadedSkill[]): { skill: LoadedSkill; score: number }[] {
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

// Stable-first (4.5): persona/rules/content-policy/standing-instructions
// and the plugins list are the same for every turn on this install, so they
// sit first for prefix caching; the volatile zone (speaker, household,
// memory, then time) comes after. Matching skills sit with memory in the
// volatile zone, not with the stable prefix: unlike the plugins list
// (every installed plugin, unconditionally, every turn), which skills
// compose in genuinely depends on this turn's own utterance. 4.5 also
// names notes, methods, summary and context in the volatile zone:
// notes/methods need persona/companion state (not built); summary needs
// an LLM to distill conversation history into one (the raw history now
// exists for real, lib/conversationHistory.ts, but nothing summarizes it,
// 4.11's other roles); context needs the ambient-context wiring the robot
// side already has but the hub doesn't yet: all three are real gaps, not
// silently skipped. Full stable-first re-ordering with a persona
// re-anchor and per-section budgets is step 4's job, not this one -
// today's order (persona/policy, speaker/household, plugins, memory,
// skills, time) is step 1's minimum: get the actor and the blocks in,
// keep the overall budget honest.
export function buildSystemPrompt(
  actor: PersonRow,
  text: string,
  memoryMatches: RecallMatch[],
  loaded: LoadedManifest[] = loadAllManifests(),
  persona: Persona = DEFAULT_PERSONA,
  skills: LoadedSkill[] = loadAllSkills(),
  // Step 3: the conversation's own rolling summary (buildConversationWindow(),
  // lib/conversationHistory.ts), one line covering whatever fell out of
  // the verbatim window - 4.5 names "summary" in the volatile zone; full
  // stable-first re-ordering and per-section budgets are step 4's job,
  // not this one.
  conversationSummaryLine?: string,
): string {
  const now = new Date();
  const localeValue = getHouseholdSettingValue("household.locale");
  const locale = typeof localeValue === "string" ? localeValue : "en-US";

  let pluginsSection = pluginsListLine(loaded);
  if (pluginsSection.length > MAX_PLUGINS_SECTION_CHARS) {
    pluginsSection = pluginsSection.slice(0, MAX_PLUGINS_SECTION_CHARS) + "...";
  }

  let memorySection = "";
  if (memoryMatches.length > 0) {
    const lines = memoryMatches.slice(0, MAX_MEMORY_SNIPPETS).map((m) => `- ${m.record.text}`);
    memorySection = `\n\nWhat you already know about this household:\n${lines.join("\n")}`;
    if (memorySection.length > MAX_MEMORY_SECTION_CHARS) {
      memorySection = memorySection.slice(0, MAX_MEMORY_SECTION_CHARS) + "...";
    }
  }

  let skillsPart = skillsSection(text, skills);
  if (skillsPart.length > MAX_SKILLS_SECTION_CHARS) {
    skillsPart = skillsPart.slice(0, MAX_SKILLS_SECTION_CHARS) + "...";
  }

  let summarySection = conversationSummaryLine ? `\n\n${conversationSummaryLine}` : "";
  if (summarySection.length > MAX_SUMMARY_SECTION_CHARS) {
    summarySection = summarySection.slice(0, MAX_SUMMARY_SECTION_CHARS) + "...";
  }

  const speakerAndHousehold = speakerLine(actor, locale, now) + householdLine();
  const localTimeLine = `\n\nLocal time: ${formatLocalTime(now, locale)}`;

  // The time line is appended last (4.5: "...time last") and must never
  // itself be truncated: a review (2026-09-04) found the first cut
  // blind-sliced the *whole* assembled prompt to the budget after
  // appending the time line, which could cut the timestamp (or a memory
  // bullet) off mid-word once enough packages or memories pushed the
  // total over budget. Truncating the body first, then appending a
  // never-truncated time line, keeps every truncation boundary inside
  // prose meant to be cut, never inside the one line a caller might parse.
  // The same protection now covers the speaker/household blocks too (step
  // 1: "if it cannot [keep the budget], the blocks shrink, not the
  // budget") by including them in the truncatable body rather than
  // appending them after the slice the way the time line is.
  const registerFragment = composePersonaPrompt(persona) + " " + INFORMATION_HANDLING_POLICY;
  let body =
    STABLE_SYSTEM_PREFIX + " " + registerFragment + speakerAndHousehold + pluginsSection + memorySection + summarySection + skillsPart;
  const bodyBudget = Math.max(0, PROMPT_SYSTEM_CHAR_BUDGET - localTimeLine.length);
  if (body.length > bodyBudget) body = body.slice(0, bodyBudget);

  return body + localTimeLine;
}

// Tier 1 of the deterministic plugin floor (4.5: "tier 1 example-embedding
// match"). No embedder exists (4.11's embed role), so `routing.examples`
// is matched by keyword overlap against the utterance instead, the same
// documented-placeholder move memory.ts's recall() already made for
// "scored vectors." Coverage of the *example*'s words (not Jaccard) since
// examples are short template sentences and the live utterance is often
// longer or shorter; a 0..1 score, not a claim of semantic matching.
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
}

// The deterministic plugin floor (4.5). A `consequential` package (4.9's
// manifest field) "raises the routing bar": it only fires on a real
// pattern match, never on a fuzzy example score, however high. Among
// everything that clears its own bar, the highest-scoring candidate wins
// (a pattern match always outranks a fuzzy one); a tie between two pattern
// matches goes to whichever package sorts first by id (loadAllManifests()'s
// deterministic order), a deliberately simple tie-break, not a claim of
// ranking by pattern specificity.
function route(text: string, actor: PersonRow, loaded: LoadedManifest[]): RoutedPlugin | null {
  let best: { id: string; args: Record<string, unknown>; score: number; viaPattern: boolean } | null = null;

  for (const { id, manifest } of loaded) {
    if (!meetsMinRole(actor.role, manifest.min_role)) continue;

    for (const pattern of manifest.routing?.patterns ?? []) {
      const captured = matchPattern(text, pattern);
      if (captured === null) continue;
      const args = deterministicArgs(manifest.args, captured);
      if (!args) continue;
      if (!best || best.score < 1) best = { id, args, score: 1, viaPattern: true };
    }

    if (manifest.consequential) continue; // examples alone never clear a raised bar
    const score = exampleScore(text, manifest.routing?.examples);
    if (score >= EXAMPLE_MATCH_THRESHOLD) {
      const args = deterministicArgs(manifest.args, null);
      if (!args) continue; // a fuzzy match has no capture to bind a required arg to
      if (!best || best.score < score) best = { id, args, score, viaPattern: false };
    }
  }

  return best;
}

type PreparedTurn =
  | { kind: "immediate"; value: TurnValue; turnId: string }
  | { kind: "model"; messages: LlmMessage[]; safety: SafetyResult; crisisResources?: string; turnId: string };

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
  const crisisResources = safety.action === "allow_with_resources" ? CRISIS_RESOURCES_TEXT : undefined;

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

  const routed = route(text, actor, loaded);
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
      const reply = result.value.reply ?? { text: "Done." };
      return immediate({ reply, source: "plugin", plugin_id: routed.id, safety, crisis_resources: crisisResources });
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
  // every one of recall()'s top-20 candidates.
  const memoryMatches = recall(actor, text, { selfOnly: true, bumpUsage: false });
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
  return { kind: "model", messages, safety, crisisResources, turnId };
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

  const variedText =
    value.source === "safety_refuse"
      ? pickRefusalVariant(actor.id)
      : value.source === "plugin" ||
          value.source === "plugin_error" ||
          value.source === "command" ||
          value.source === "command_error"
        ? varyKnownConstant(actor.id, text)
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
    value = {
      reply: { text: completion.value.text },
      source: "model",
      safety: prepared.safety,
      crisis_resources: prepared.crisisResources,
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
      tokens: AsyncGenerator<string, void, void>;
      /** Builds the final TurnValue once the caller has drained `tokens`
       * to completion and knows the full reply text - also logs the turn
       * (conversationHistory.ts), the same "log once the real reply is
       * known" timing runTurn() already has, just triggered by the
       * caller finishing the stream instead of by this function awaiting
       * it directly. */
      finalize: (replyText: string) => TurnValue;
    };

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
    tokens: started.tokens,
    finalize: (replyText: string): TurnValue => {
      const value: TurnValue = finalizeReply(actor, {
        reply: { text: replyText },
        source: "model",
        safety: prepared.safety,
        crisis_resources: prepared.crisisResources,
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
