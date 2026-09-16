import type { ReplyPlan } from "@maipai/spec/gen/ts/reply-plan.js";
import type { TurnSignal } from "@maipai/spec/gen/ts/turn-signal.js";
import type { Persona } from "@/lib/persona";
import type { Surface } from "@/lib/turnEngine";

type Move = keyof ReplyPlan["moves"];
type Status = ReplyPlan["moves"][Move];

export interface PlanInput {
  signal: TurnSignal;
  surface: Surface;
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

export function planLine(plan: ReplyPlan, signal: TurnSignal): string {
  const act = signal.primary_act === "inform" ? "a statement" : `a ${signal.primary_act}`;
  const emotion = signal.expressed_emotion === "neutral" ? "neutral" : signal.expressed_emotion;
  const required = Object.entries(plan.moves).filter(([, value]) => value === "required").map(([move]) => move.replace("_", " "));
  const forbidden = Object.entries(plan.moves).filter(([, value]) => value === "forbidden").map(([move]) => move);
  const length = `${plan.max_sentences === 1 ? "one" : "one or two"} sentence${plan.max_sentences === 1 ? "" : "s"}`;
  const requirements = required.length ? required.join(", ") : "no required move";
  const bans = [forbidden.includes("ask_back") || required.includes("care") ? "no question" : "", forbidden.includes("point") ? "no tasks" : "", plan.playfulness === "forbidden" ? "no playfulness" : ""].filter(Boolean).join(", ");
  const lead = required.includes("care") ? "acknowledge the feeling first" : requirements;
  return `${act} about themselves, ${emotion}, ${signal.emotion_intensity}: ${lead}, ${length}, ${bans || "no unnecessary follow-up"}.`;
}
