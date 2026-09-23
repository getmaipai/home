// PARITY-BISECT-04's own pure stage-building logic (dev.md's
// PARITY-BISECT-03 finding: nine of twelve isolated stable-prefix
// pieces halve the reply on their own - not one villain fragment).
// Tests four candidate composition shapes for PREFIX-CLASS-01, plus a
// ceiling row, each as its own arm, five reps each at a fixed seed per
// rep shared across every arm and the floor (parity-bisect4.ts pins
// the seed via benchSampling.ts's __setSamplingSeedForBench before
// each call - this file only builds the requests).
//
// Split from parity-bisect4.ts for the same reason the earlier bisect
// stages files are: no `import "./setup"` at module scope, so a test
// can import buildStages4() directly.
import type { LlmMessage, LlmCompleteOptions, ToolSpec } from "@/lib/llm";
import {
  type Persona,
  FORMALITY_FRAGMENT_WRITTEN,
  COMPLEXITY_FRAGMENT,
  ENGAGEMENT_FRAGMENT_WRITTEN,
  FILLER_FRAGMENT,
  WRITTEN_POLICY,
  INFORMATION_HANDLING_POLICY,
} from "@/lib/persona";
import { identityLine, STABLE_SYSTEM_SUFFIX, STABLE_SYSTEM_SUFFIX_SENTENCES, buildStablePrefix } from "@/lib/turnEngine";
import { resolveTurnBudget } from "@/lib/turnMachine/budget";
import { loadManifestOnly } from "@/lib/plugins";

export const QUESTION = "how does a prompt cache make a language model faster and why does that matter";

// Jesse's own benchmarking words (dev.md's "benchmarking-typed-adult"
// replay row), added as a second prompt per Fable's own extension: now
// that OPENER-01 has landed, this question is no longer blocked by the
// wildcard-command hijack, and it carries its own live failure mode
// (the new path read "why do you need it" as about MaiPai, not the
// person asking - "I don't actually use a computer" - where the bare
// floor and ChatGPT both read it as the person's own "you").
export const BENCHMARKING_QUESTION = "what is technical benchmarking and why do you need it";
export const ENGINE_DEFAULT_TEMPERATURE = 0.8;

// Arm f's own max_tokens: the exact number a real written-adult,
// thinking-on turn gets (nodes/model.ts's replyMaxTokensFor:
// reply_ceiling_tokens + thinking_budget_tokens_toggled), read from the
// resident model's own catalog entry (modelCatalog.ts's
// "qwen3-8b-instruct-q4-k-m", confirmed against the live engine's own
// identity string in every bisect log) rather than copied by hand, so
// it can never drift from production if the catalog entry changes.
// Runs at module scope (a review flagged this): a bad or renamed
// RESIDENT_MODEL_ID would fail every importer of this file, including
// the unit test, rather than only a live run - accepted here since the
// id is a fixed literal against a real catalog entry, not computed, and
// this file already resolves several other module-scope constants the
// same eager way.
const RESIDENT_MODEL_ID = "qwen3-8b-instruct-q4-k-m";
const RESIDENT_BUDGET = resolveTurnBudget(RESIDENT_MODEL_ID);
export const THINKING_ON_MAX_TOKENS = RESIDENT_BUDGET.reply_ceiling_tokens + RESIDENT_BUDGET.thinking_budget_tokens_toggled;

// The real, ordinary-turn tool block (nodes/model.ts's own
// `state.budget.tools_offered.slice().sort().map(toolSpecFor)`, the
// non-forced, non-interim-rule branch) - Fable's own ruling names it
// explicitly for arm e ("five-tool block present"): an isolated bench
// without it would not be testing the shape a real turn actually sends.
// Built the same way toolSpecFor() does (loadManifestOnly()),
// filesystem-only, no DB - safe at module scope here too. Does NOT
// mirror toolSpecFor's ANSWER_FROM_CONTEXT_TOOL_ID special case (that
// ToolSpec constant is private to model.ts, not exported, and this
// file makes no production source changes to get at it) - the assert
// below turns that gap into a loud failure instead of a silent one if
// this budget's own answer_from_context_tool ever flips true. A
// manifest that fails to load is a loud failure too, never a silently
// shorter tool list: "five-tool block present" is the ruling's own
// literal test condition, not "up to five."
function productionTools(): ToolSpec[] {
  if (RESIDENT_BUDGET.answer_from_context_tool) {
    throw new Error("productionTools() does not build the answer-from-context tool - RESIDENT_BUDGET.answer_from_context_tool is now true, so this bench's tool block no longer matches production's");
  }
  const tools = RESIDENT_BUDGET.tools_offered
    .slice()
    .sort()
    .map((id) => {
      const loaded = loadManifestOnly(id);
      if (!loaded.ok) throw new Error(`productionTools(): manifest for "${id}" failed to load (${loaded.status} ${loaded.error}) - the tool block would be silently short of the ruling's "five-tool block present"`);
      return { id, description: loaded.value.description, args: loaded.value.args };
    });
  if (tools.length !== RESIDENT_BUDGET.tools_offered.length) {
    throw new Error(`productionTools(): expected ${RESIDENT_BUDGET.tools_offered.length} tools, built ${tools.length}`);
  }
  return tools;
}

// Fable's own sentence, prepended ahead of the real prefix in arms a
// and c: names the floor as an instruction, not a hope.
export const FLOOR_SENTENCE = "Answer as completely and as well structured as you would with no instructions at all; everything below is about voice, never about length.";

// The three suffix sentences PARITY-BISECT-03 found do NOT collapse
// the reply alone (indices 1, 2, 3 of STABLE_SYSTEM_SUFFIX_SENTENCES:
// the safety-blocked-requests line, the world-knowledge/lookup lines,
// the can't-watch-taste-visit line).
const SURVIVING_SUFFIX_INDICES = [1, 2, 3] as const;
function survivingSuffixSentences(): string {
  return SURVIVING_SUFFIX_INDICES.map((i) => STABLE_SYSTEM_SUFFIX_SENTENCES[i]).join(" ");
}

/** Arm b/c's own preamble: the persona dials and the two policies, out
 * of the system message and onto the user message ahead of the
 * question, exactly as buildStablePrefix's own order composes them. */
function howToSoundPreamble(persona: Persona): string {
  return [
    FORMALITY_FRAGMENT_WRITTEN[persona.formality],
    COMPLEXITY_FRAGMENT[persona.complexity],
    ENGAGEMENT_FRAGMENT_WRITTEN[persona.engagement],
    FILLER_FRAGMENT[persona.filler_density],
    INFORMATION_HANDLING_POLICY,
    WRITTEN_POLICY,
  ].join(" ");
}

// Arm d: every written-class fragment rewritten as a third-person
// description of the companion, same sentences, same order, no
// commands. The household-facts sentence is Fable's own given text,
// verbatim; the rest follow the identical transformation (second-
// person imperative to third-person description) by hand, in the same
// order buildStablePrefix composes them. The identity sentence is also
// Fable's own given text (not the real identityLine()): it states
// outright that "you" in the question refers to the person asking,
// never to MaiPai, aimed straight at the benchmarking question's own
// failure (the new path read "why do you need it" as about itself).
// It is intentionally NOT persona-dependent like identityLine() is -
// arm d measures whether naming the "you" referent fixes the reading,
// not persona variation, so every persona sees the identical sentence
// here; a real fix would still need identityLine()'s own per-persona
// name and role.
const IDENTITY_DESCRIPTIVE =
  "MaiPai is this household's own assistant; it answers \"you\" as the person it is talking to, and a question about what \"you\" need is about them, never about MaiPai.";

function descriptivePrefix(persona: Persona): string {
  const suffixDescriptive = [
    "MaiPai is warm and honest, and nothing it says leaves this house.",
    "Requests already blocked by the household's safety rules never reach MaiPai; it answers anything else helpfully and honestly.",
    "MaiPai knows a lot about the world: films, places, dates, how things work. It answers those from what it knows, and when it's unsure, it uses the lookup tool it was offered instead of guessing or declining.",
    "MaiPai can't watch, taste or visit things itself; if someone asks whether it has, it says so, and still tells them what it knows about it.",
    "When someone tells MaiPai what they're doing or watching, it responds the way a friend would, with something it knows about it or a question about it, not a sign-off.",
    // Fable's own given text, verbatim.
    "Facts about this household's own people, plans and home come only from what it was told here; anything about the world it answers from what it knows.",
  ].join(" ");
  return [IDENTITY_DESCRIPTIVE, suffixDescriptive, voiceDescriptive(persona)].join(" ");
}

// Arm e's own "descriptive voice fragments": the same six persona-dial
// and policy rewrites descriptivePrefix() uses, WITHOUT its identity or
// suffix sentences (arm e supplies those separately, in their real,
// non-descriptive form). Pulled out as its own function so arm d and
// arm e share one rewritten wording rather than two copies that could
// drift from each other.
function voiceDescriptive(persona: Persona): string {
  const formalityDescriptive: Record<Persona["formality"], string> = {
    casual: "MaiPai writes in a relaxed, friendly tone, with contractions (it's, doesn't, isn't).",
    neutral: "MaiPai writes in a natural, unforced tone, with contractions, neither stiff nor overly casual.",
    formal: "MaiPai writes in complete, well-formed sentences without contractions, polite and precise, never stiff or robotic.",
  };
  const complexityDescriptive: Record<Persona["complexity"], string> = {
    simple: "MaiPai uses short sentences and everyday words a young child would understand, and explains anything unfamiliar in the simplest possible terms.",
    standard: "MaiPai uses plain, everyday language: no unexplained jargon, no unnecessarily complex sentence structure.",
    advanced: "MaiPai may use precise, subject-specific vocabulary and more nuanced sentence structure when it genuinely helps explain something well.",
  };
  const engagementDescriptive: Record<Persona["engagement"], string> = {
    brief: "MaiPai answers the exact question completely, then stops - it never cuts a genuinely complete answer short for the sake of being brief; brief means no padding, not less substance.",
    balanced: "MaiPai answers the question directly and completely, and offers one natural follow-up only if it would genuinely help, never as a matter of habit.",
    curious: "MaiPai answers completely; when someone shares something personal or emotional, it shows it noticed - a brief, genuine follow-up or something caring before moving on, the way someone who cares about them would.",
  };
  const fillerDescriptive: Record<Persona["filler_density"], string> = {
    none: "MaiPai's wording is clean and direct, without casual filler phrases.",
    light: "A little casual phrasing here and there (\"honestly,\" \"I mean\") is natural for MaiPai, never forced.",
    frequent: "MaiPai talks casually, the way a teenager texting a friend would: casual asides like \"honestly,\" \"I mean,\" and \"like\" come naturally, not sprinkled in at random.",
  };
  const infoPolicyDescriptive = [
    "MaiPai skips detail nobody asked for (exact decimals, timezones, a full date when only the day matters) and rounds the way people round in conversation (\"about thirty\", \"low seventies\") unless the exact number genuinely matters, like money or an appointment time.",
    "MaiPai talks about anything uncertain or secondhand as uncertain, never as flat fact: forecasts, predictions and guesses get hedged (\"it's supposed to\", \"I think\", \"probably\"), not asserted outright.",
  ].join(" ");
  const writtenPolicyDescriptive = [
    "MaiPai says numbers and dates exactly as they read written down.",
    "MaiPai's replies on a screen use headings and lists where they make an answer clearest.",
  ].join(" ");
  return [
    formalityDescriptive[persona.formality],
    complexityDescriptive[persona.complexity],
    engagementDescriptive[persona.engagement],
    fillerDescriptive[persona.filler_density],
    infoPolicyDescriptive,
    writtenPolicyDescriptive,
  ].join(" ");
}

export interface Stage4 {
  name: string;
  messages: LlmMessage[];
  opts: LlmCompleteOptions;
}

function stage(name: string, systemContent: string | null, userContent: string, optsOverride?: Partial<LlmCompleteOptions>): Stage4 {
  const messages: LlmMessage[] = systemContent !== null ? [{ role: "system", content: systemContent }, { role: "user", content: userContent }] : [{ role: "user", content: userContent }];
  return { name, messages, opts: { temperature: ENGINE_DEFAULT_TEMPERATURE, thinking: false, ...optsOverride } };
}

/** Pure: builds every PARITY-BISECT-04 stage's own request, no live
 * call, no seed (parity-bisect4.ts pins the seed per rep at the live
 * call site, not here - the same request shape runs once per seed).
 * `question` defaults to the prompt-cache question; parity-bisect4.ts
 * also calls this with BENCHMARKING_QUESTION for the second table. */
export function buildStages4(persona: Persona, question: string = QUESTION): Stage4[] {
  const identity = identityLine(persona);

  // Floor: re-measured with the same seeds as every arm (BISECT-03's
  // own no-seed floor moved between rounds, 736 to 574, too wide to
  // read an 0.8x bar through).
  const floor = stage("floor-bare-thinking-off", null, question);

  // Arm a: the floor sentence first, the full real prefix as landed
  // below it, unreduced.
  const armA = stage("arm-a-floor-sentence-plus-full-prefix", `${FLOOR_SENTENCE} ${buildStablePrefix(persona, "written")}`, question);

  // Arm b: the system message reduced to identity, the floor line and
  // the three surviving suffix sentences; everything else (the dials,
  // the information policy, WRITTEN_POLICY) moved to a preamble on the
  // final user message.
  const armB = stage(
    "arm-b-reduced-system-preamble-user",
    `${identity} ${FLOOR_SENTENCE} ${survivingSuffixSentences()}`,
    `How to sound: ${howToSoundPreamble(persona)}\n\n${question}`,
  );

  // Arm c ("(a)+(b) both"): the floor sentence and the full, unreduced
  // suffix stay in the system message (arm a's own shape); the dials
  // and the two policies move to the user-message preamble (arm b's
  // own relocation) rather than staying in the system message too.
  const armC = stage(
    "arm-c-floor-sentence-full-suffix-preamble-user",
    `${FLOOR_SENTENCE} ${identity} ${STABLE_SYSTEM_SUFFIX}`,
    `How to sound: ${howToSoundPreamble(persona)}\n\n${question}`,
  );

  // Arm d: describe, never instruct - every written-class fragment
  // rewritten as a third-person description, same content and order,
  // no floor sentence (testing whether the descriptive frame alone
  // avoids the collapse without it).
  const armD = stage("arm-d-descriptive-never-instructive", descriptivePrefix(persona), question);

  // The ceiling: identity plus the three surviving suffix sentences
  // only - nothing else, no floor sentence, no dials, no policies.
  const ceiling = stage("ceiling-identity-plus-surviving-suffix", `${identity} ${survivingSuffixSentences()}`, question);

  // Arm e: no system message at all - the identity line, the three
  // surviving suffix sentences, and the descriptive voice fragments
  // (arm d's own rewrites, minus its identity and suffix sentences,
  // which arm e supplies in their real form instead) all folded into
  // one preamble at the top of the final user message, above the
  // person's own words. Fable's own ruling names this arm's real test
  // condition explicitly: "five-tool block present" - the ordinary
  // turn's real tool definitions (productionTools() above), not a bare
  // completion call, since a real turn always carries them when tools
  // are allowed.
  const armE = stage("arm-e-no-system-preamble-only", null, `${identity} ${survivingSuffixSentences()} ${voiceDescriptive(persona)}\n\n${question}`, { tools: productionTools() });

  // Arm f: the full prefix exactly as landed (buildStablePrefix, no
  // floor sentence, no reduction - the real production system
  // message), with thinking ON and max_tokens set to the exact number
  // a real written-adult thinking-on turn gets (THINKING_ON_MAX_TOKENS
  // above). Tests whether this 8B's own reasoning pass, not a prompt
  // change, is what a written adult question needs (PARITY-BISECT-01's
  // own control: the bare thinking-on floor was 1836 against 806.8
  // thinking-off on this question). Carries the same real tool block as
  // arm e, for the same reason: "the full prefix as landed" means the
  // real turn shape, and an ordinary written-adult turn always offers
  // tools.
  const armF = stage("arm-f-full-prefix-thinking-on", buildStablePrefix(persona, "written"), question, { thinking: true, max_tokens: THINKING_ON_MAX_TOKENS, tools: productionTools() });

  return [floor, armA, armB, armC, armD, ceiling, armE, armF];
}
