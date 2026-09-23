import type { ReplyPlan } from "@maipai/spec/gen/ts/reply-plan.js";
import type { TurnSignal } from "@maipai/spec/gen/ts/turn-signal.js";
import type { Persona } from "@/lib/persona";
import type { Surface } from "@/lib/turnEngine";
import type { SurfaceClass } from "@/lib/surfaceClass";

type Move = keyof ReplyPlan["moves"];
type Status = ReplyPlan["moves"][Move];

export interface PlanInput {
  signal: TurnSignal;
  surface: Surface;
  // Optional, defaulting to "spoken" (today's act table, unchanged) so
  // every existing caller - turnEngine.ts's four call sites, the frozen
  // path - compiles and behaves exactly as before with no edit. Only
  // the new path (turnNext.ts) passes "written" or "spoken" explicitly.
  surfaceClass?: SurfaceClass;
  brevity: boolean;
  evidence: { choices: number; sources: number; deliverable: boolean };
  companion: {
    directness: "direct" | "diplomatic";
    engagement: Persona["engagement"];
    vocabulary?: Persona["complexity"];
    complexity?: Persona["complexity"];
  };
  band: TurnSignal["age_band"];
  deferred: boolean;
  disclosureWithheld: boolean;
}

const moves: Move[] = ["react", "care", "say", "pick", "point", "ask_back", "close", "defer"];

// RESP-01's written budget (state record, "The budget record" is a
// different thing - this is the ReplyPlan's own length budget, the one
// place length is decided, ARCH-LAYERS-01's accepted design). A written
// turn on a typed screen has no act cap: the budget comes from the
// evidence, sized so a fact stays short and a comparison, a list or a
// how-to gets room. Named constants, not inline numbers, so a later
// measurement changes one line each.
const WRITTEN_GREETING_WORDS = 15;
const WRITTEN_GREETING_SENTENCES = 1;
const WRITTEN_CLOSING_WORDS = 8;
const WRITTEN_CLOSING_SENTENCES = 1;
const WRITTEN_BACKCHANNEL_WORDS = 25;
const WRITTEN_BACKCHANNEL_SENTENCES = 2;
const WRITTEN_INFORM_WORDS = 90;
const WRITTEN_INFORM_SENTENCES = 6;
const WRITTEN_COMMISSIVE_WORDS = 40;
const WRITTEN_COMMISSIVE_SENTENCES = 3;
const WRITTEN_DIRECTIVE_WORDS = 160;
const WRITTEN_DIRECTIVE_SENTENCES = 10;
const WRITTEN_QUESTION_WORDS = 220;
const WRITTEN_QUESTION_SENTENCES = 14;
const WRITTEN_QUESTION_EVIDENCE_WORDS = 360;
const WRITTEN_QUESTION_EVIDENCE_SENTENCES = 24;

/** True when the evidence gives a written question room to grow (a
 * comparison, a list, a how-to, a sourced answer) - the same test named
 * in RESP-01: `evidence.sources >= 1`, `evidence.deliverable`, or
 * `evidence.choices >= 2`. */
function writtenQuestionHasRoom(evidence: PlanInput["evidence"]): boolean {
  return evidence.sources >= 1 || evidence.deliverable || evidence.choices >= 2;
}

/** The written budget by act - the evidence-sized table RESP-01 names,
 * with no act cap in the sense the spoken table has one: every number
 * here is generous headroom, not a ceiling tuned for "the way a person
 * talking out loud would." Falls back to the spoken numbers for an act
 * this table doesn't size specially (there are none today; every act
 * the base switch handles gets its own written row). */
function writtenBudgetFor(act: TurnSignal["primary_act"], evidence: PlanInput["evidence"]): { maxSentences: number; maxWords: number } {
  switch (act) {
    case "greeting":
      return { maxSentences: WRITTEN_GREETING_SENTENCES, maxWords: WRITTEN_GREETING_WORDS };
    case "closing":
      return { maxSentences: WRITTEN_CLOSING_SENTENCES, maxWords: WRITTEN_CLOSING_WORDS };
    case "backchannel":
      return { maxSentences: WRITTEN_BACKCHANNEL_SENTENCES, maxWords: WRITTEN_BACKCHANNEL_WORDS };
    case "inform":
      return { maxSentences: WRITTEN_INFORM_SENTENCES, maxWords: WRITTEN_INFORM_WORDS };
    case "commissive":
      return { maxSentences: WRITTEN_COMMISSIVE_SENTENCES, maxWords: WRITTEN_COMMISSIVE_WORDS };
    case "directive":
      return { maxSentences: WRITTEN_DIRECTIVE_SENTENCES, maxWords: WRITTEN_DIRECTIVE_WORDS };
    case "question":
      return writtenQuestionHasRoom(evidence)
        ? { maxSentences: WRITTEN_QUESTION_EVIDENCE_SENTENCES, maxWords: WRITTEN_QUESTION_EVIDENCE_WORDS }
        : { maxSentences: WRITTEN_QUESTION_SENTENCES, maxWords: WRITTEN_QUESTION_WORDS };
  }
}

export function planFor(input: PlanInput): ReplyPlan {
  const { signal } = input;
  const plan: ReplyPlan["moves"] = Object.fromEntries(moves.map((move) => [move, "forbidden"])) as ReplyPlan["moves"];
  const allow = (...names: Move[]) => names.forEach((name) => { if (plan[name] !== "required") plan[name] = "allowed"; });
  const require = (...names: Move[]) => names.forEach((name) => { plan[name] = "required"; });
  const forbid = (...names: Move[]) => names.forEach((name) => { if (plan[name] !== "required") plan[name] = "forbidden"; });
  const marked = signal.expressed_emotion !== "neutral";
  let playfulness: ReplyPlan["playfulness"] = "allowed";

  // Section 12 part 3: the base table by primary act.
  let maxSentences = 1;
  let maxWords = 30;
  switch (signal.primary_act) {
    case "inform":
      allow("react", "say");
      if (marked) require("react");
      allow("ask_back");
      maxSentences = 2; maxWords = 30;
      break;
    case "question":
      require("say");
      if (input.evidence.choices >= 2) require("pick");
      if (input.evidence.sources >= 1 || input.evidence.deliverable) allow("point");
      maxSentences = input.surface === "robot" ? 1 : 2; maxWords = 60;
      break;
    case "directive":
      require("say");
      if (input.evidence.deliverable) allow("point");
      maxWords = 25;
      break;
    case "commissive":
      require("react"); allow("say"); maxWords = 20;
      break;
    case "greeting":
      require("react"); maxWords = 15; break;
    case "closing":
      require("close"); maxWords = 8; break;
    case "backchannel":
      allow("react", "say"); maxWords = 20; break;
  }

  // RESP-01: the written class has no act cap - the budget comes from
  // the evidence instead, applied on top of the base switch above so
  // every move decided there (require/allow/forbid) stands unchanged;
  // only the length numbers move. `brevity: true` on the written class
  // uses the spoken table for that turn ("shorter" means shorter, not a
  // second written table) - the base switch's own numbers already are
  // that table, so brevity simply skips this override.
  if ((input.surfaceClass ?? "spoken") === "written" && !input.brevity) {
    const written = writtenBudgetFor(signal.primary_act, input.evidence);
    maxSentences = written.maxSentences;
    maxWords = written.maxWords;
  }

  // Section 12 part 3: emotion overrides.
  if (signal.expressed_emotion === "sadness" || signal.expressed_emotion === "fear") {
    require("care"); forbid("react");
    playfulness = "forbidden";
  } else if (signal.expressed_emotion === "anger") {
    playfulness = "forbidden";
    if (signal.target === "hub") forbid("react", "say", "pick", "point", "ask_back");
  } else {
    playfulness = "allowed";
  }
  if (signal.emotion_intensity === "high") maxSentences = Math.max(1, maxSentences - 1);

  // Section 12 part 3: companion modulation only removes optional moves.
  if (input.companion.directness === "direct") forbid("react", "point", "ask_back");
  if (input.companion.engagement === "brief") forbid("ask_back");
  if (input.companion.engagement === "balanced") allow("ask_back");
  if (input.companion.engagement === "curious" && (signal.primary_act === "inform" || signal.primary_act === "commissive")) allow("ask_back");
  if (input.brevity) forbid("react", "ask_back");
  if (signal.expressed_emotion === "anger" && signal.target === "hub") {
    plan.react = "forbidden";
    forbid("say", "pick", "point", "ask_back");
  }

  // Section 12 part 3 and section 13: protocol, evidence and band fields.
  if (signal.primary_act !== "closing") forbid("close");
  if (input.deferred) require("defer"); else forbid("defer");
  if (signal.primary_act !== "question" || input.evidence.choices < 2) {
    if (plan.pick !== "required") forbid("pick");
  }
  if (input.evidence.sources < 1 && !input.evidence.deliverable && plan.point !== "required") forbid("point");
  if (input.band === "child") {
    forbid("point"); maxWords = Math.min(maxWords, 40);
  }
  const vocabulary = input.band === "child" ? "simple" : input.band === "teen" ? "standard" : (input.companion.vocabulary ?? input.companion.complexity ?? "standard");
  const explanation_style = input.band === "child" ? "concrete" : input.band === "teen" ? "plain" : "full";
  return {
    moves: plan,
    playfulness,
    max_sentences: maxSentences,
    max_words: maxWords,
    age_band: input.band,
    vocabulary_level: vocabulary,
    explanation_style,
    trusted_adult_move: input.deferred ? "offer_to_ask" : "none",
    content_disclosure: input.disclosureWithheld ? "some_withheld" : "full",
  };
}

/** `surfaceClass` optional, defaulting to "spoken" - the same default
 * `PlanInput.surfaceClass` uses, so turnEngine.ts's one call site (the
 * frozen path) needs no edit and reads exactly today's wording. On the
 * written class the length clause names no sentence count ("as long as
 * it needs, structured where it helps"): a written turn's budget is
 * evidence-sized, not act-capped, so a fixed "one or two sentences"
 * would be a written-register lie the moment it applied to an inform
 * or a directive. */
export function planLine(plan: ReplyPlan, signal: TurnSignal, surfaceClass: SurfaceClass = "spoken"): string {
  const act = signal.primary_act === "inform" ? "a statement" : `a ${signal.primary_act}`;
  const emotion = signal.expressed_emotion === "neutral" ? "neutral" : signal.expressed_emotion;
  const required = Object.entries(plan.moves).filter(([, value]) => value === "required").map(([move]) => move.replace("_", " "));
  const forbidden = Object.entries(plan.moves).filter(([, value]) => value === "forbidden").map(([move]) => move);
  const length = surfaceClass === "written" ? "as long as it needs, structured where it helps" : `${plan.max_sentences === 1 ? "one" : "one or two"} sentence${plan.max_sentences === 1 ? "" : "s"}`;
  const requirements = required.length ? required.join(", ") : "no required move";
  const bans = [forbidden.includes("ask_back") || required.includes("care") ? "no question" : "", forbidden.includes("point") ? "no tasks" : "", plan.playfulness === "forbidden" ? "no playfulness" : ""].filter(Boolean).join(", ");
  const lead = required.includes("care") ? "acknowledge the feeling first" : requirements;
  return `${act} about themselves, ${emotion}, ${signal.emotion_intensity}: ${lead}, ${length}, ${bans || "no unnecessary follow-up"}.`;
}
