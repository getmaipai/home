// ROUTER-BUILD-03: the four deciders of ROUTER-BUILD-02 as pure functions (no engine, no embedder, no database).
//   A  the shipped head's score against its threshold.     C  the tuned 3-class classifier's P(recency) against its threshold.
//   B  one short generation, SEARCH or NO_SEARCH.          D  C above `high` is SEARCH, below `low` is NO_SEARCH, between asks B.
// Every decider sits at the rescue position: written adult turn, the model made no tool call. It never runs for a child, a teen
// or a spoken turn, and it fails open (NO_SEARCH, nothing forced) on a timeout, an error, an unparsed answer or a pin mismatch.
// Measurement only: nothing here is imported by product code.
import { parseRouterAnswer } from "./searchRecency02Score";

export type DeciderArm = "A" | "B" | "C" | "D";
export type DeciderBand = "adult" | "child" | "teen" | "spoken";
export type Decision = "SEARCH" | "NO_SEARCH";
export type DecisionReason = "ok" | "not_eligible" | "pin_mismatch" | "no_score" | "timeout" | "error" | "unparsed";

export interface DeciderTurn {
  band: DeciderBand;
  /** A spoken turn is never decided, whatever its band says. */
  spoken?: boolean;
  /** How many tool calls the model's own round made; the decider runs only at zero. */
  modelToolCalls: number;
  text: string;
  prior?: { user: string; assistant: string } | null;
}

export interface DeciderConfig {
  arm: DeciderArm;
  /** A, C and D: the score for this turn (A: the shipped head, C and D: the tuned classifier's P(recency)). */
  score?: number | null;
  /** A and C: SEARCH at or above this. D: SEARCH at or above `high`, NO_SEARCH below `low`, B between. */
  threshold?: number;
  low?: number;
  high?: number;
  /** False when the weights, embedder or prompt differ from the pre-registration. */
  pinOk?: boolean;
  /** B and D: the decision pass. Returns the model's raw text, or rejects. */
  /** `signal` is aborted when the decider gives up, so a timed-out request does not keep running against the engine. */
  ask?: (messages: DecisionMessage[], signal?: AbortSignal) => Promise<string>;
  variant?: PromptVariant;
  timeoutMs?: number;
}

export interface DecisionMessage { role: "system" | "user" | "assistant"; content: string }

export interface DecisionResult {
  decision: Decision;
  /** True when the decider actually ran for this turn (eligible, pin fine). The M5 counter: it must stay 0 for minors and spoken turns. */
  activated: boolean;
  reason: DecisionReason;
  /** B was asked (arm B, or arm D inside its band). */
  askedB: boolean;
  raw?: string;
  ms?: number;
}

export type PromptVariant = 1 | 2 | 3;

/** Worked examples are invented for this file; none is a row of any dataset or the lock box. */
const SYSTEM_BASE =
  "You decide whether the user's latest message needs a live web search, because the answer could have changed since your training or you are not sure of it. Answer with exactly one word and nothing else: SEARCH or NO_SEARCH.";

const EXAMPLES_V2: [string, Decision][] = [
  ["what's the weather in Lisbon this weekend", "SEARCH"],
  ["who won the game last night", "SEARCH"],
  ["what is the boiling point of water", "NO_SEARCH"],
  ["write me a limerick about a cat", "NO_SEARCH"],
];

const EXAMPLES_V3: [string, Decision][] = [
  ...EXAMPLES_V2,
  ["how much is a PlayStation 5 right now", "SEARCH"],
  ["is the new Zelda game out yet", "SEARCH"],
  ["who was the first person to walk on the moon", "NO_SEARCH"],
  ["what's 15 percent of 240", "NO_SEARCH"],
];

const render = (examples: [string, Decision][]): string => examples.map(([q, a]) => `Message: ${q}\nAnswer: ${a}`).join("\n\n");

/** The three prompt variants the dev pool picks from. Variant 1 is the SEARCH-RECENCY-02 arm 0 wording unchanged. */
export function systemPrompt(variant: PromptVariant): string {
  if (variant === 1) return SYSTEM_BASE;
  const guide = " Facts that are stable (history, science, definitions, how things work), arithmetic, writing and chat, and questions about the household or the conversation need no search. Things that change (news, scores, prices, weather, releases, who currently holds a role, whether something is out yet) do.";
  if (variant === 2) return `${SYSTEM_BASE}${guide}\n\n${render(EXAMPLES_V2)}`;
  return `${SYSTEM_BASE}${guide} A follow-up inherits the need of the question before it.\n\n${render(EXAMPLES_V3)}`;
}

/** The decision pass sees what the chat turn sees: the last exchange, if any, then the new message. */
export function buildDecisionMessages(variant: PromptVariant, turn: Pick<DeciderTurn, "text" | "prior">): DecisionMessage[] {
  return [
    { role: "system", content: systemPrompt(variant) },
    ...(turn.prior ? [{ role: "user" as const, content: turn.prior.user }, { role: "assistant" as const, content: turn.prior.assistant }] : []),
    { role: "user", content: turn.text },
  ];
}

export const parseDecision = parseRouterAnswer;

/** The only turns a decider may touch: written adult turns where the model called no tool. */
export function eligible(turn: DeciderTurn): boolean {
  return turn.band === "adult" && turn.spoken !== true && turn.modelToolCalls === 0;
}

const FAIL = (reason: DecisionReason, activated: boolean, askedB = false, extra: Partial<DecisionResult> = {}): DecisionResult => ({ decision: "NO_SEARCH", activated, reason, askedB, ...extra });

async function askB(turn: DeciderTurn, cfg: DeciderConfig): Promise<DecisionResult> {
  if (!cfg.ask) return FAIL("error", true, true);
  const t0 = performance.now();
  const timeoutMs = cfg.timeoutMs ?? 5_000;
  let raw: string;
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    raw = await Promise.race([
      cfg.ask(buildDecisionMessages(cfg.variant ?? 2, turn), ctl.signal),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { reject(new Error("decider timeout")); ctl.abort(); }, timeoutMs); }),
    ]);
  } catch (err) {
    return FAIL(/timeout/i.test((err as Error).message) ? "timeout" : "error", true, true, { ms: performance.now() - t0 });
  } finally {
    clearTimeout(timer);
  }
  const answer = parseDecision(raw);
  const ms = performance.now() - t0;
  if (answer === null) return FAIL("unparsed", true, true, { raw, ms });
  return { decision: answer, activated: true, reason: "ok", askedB: true, raw, ms };
}

/** One decision. Never throws; every failure is NO_SEARCH with its reason. */
export async function decide(turn: DeciderTurn, cfg: DeciderConfig): Promise<DecisionResult> {
  if (!eligible(turn)) return FAIL("not_eligible", false);
  if (cfg.pinOk === false) return FAIL("pin_mismatch", false);
  const scored = (): number | null => (typeof cfg.score === "number" && Number.isFinite(cfg.score) ? cfg.score : null);
  if (cfg.arm === "B") return askB(turn, cfg);
  const s = scored();
  if (s === null) return FAIL("no_score", true);
  if (cfg.arm === "A" || cfg.arm === "C") {
    if (cfg.threshold === undefined) return FAIL("no_score", true);
    return { decision: s >= cfg.threshold ? "SEARCH" : "NO_SEARCH", activated: true, reason: "ok", askedB: false };
  }
  if (!Number.isFinite(cfg.low) || !Number.isFinite(cfg.high) || cfg.low! > cfg.high!) return FAIL("no_score", true);
  if (s >= cfg.high!) return { decision: "SEARCH", activated: true, reason: "ok", askedB: false };
  if (s < cfg.low!) return { decision: "NO_SEARCH", activated: true, reason: "ok", askedB: false };
  return askB(turn, cfg);
}
