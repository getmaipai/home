import { chatCatalogEntry } from "@/lib/modelCatalog";

export const EMPTY_LENGTH_RETRY_EXTRA_TOKENS = 1024;
const learned = new Set<string>();
let engineKey = "";
export function setCeilingEngineIdentity(identity: unknown): void {
  const engine = identity as { host?: string; build?: string; model?: string } | null;
  const key = JSON.stringify(engine ? [engine.host, engine.build, engine.model] : null);
  if (key !== engineKey) { learned.clear(); engineKey = key; }
}
export function rememberCeilingSpentInvisibly(modelId: string | undefined): void {
  // A catalog declaration wins. Only an unknown build can teach us that
  // it reasons compulsorily; switchable models keep their caller ceiling.
  if (modelId && !chatCatalogEntry(modelId)) learned.add(modelId);
}
export function __resetLearnedCeilingsForTests(): void { learned.clear(); engineKey = ""; retryCount = 0; }
export interface ReasoningContext { contextTokens?: number; promptTokens?: number }
type ReasoningModel = string | { thinking_mode?: string } | undefined;

/** Callers supply visible answer tokens. Unknown windows get a finite reserve;
 * measured windows bound the total to the room remaining after the prompt. */
export function reasoningReserveFor(model: ReasoningModel, answerBudget: number, context: ReasoningContext = {}, multiplier = 1): number {
  const record = typeof model === "string" ? chatCatalogEntry(model) : model;
  const always = record?.thinking_mode === "always" || (typeof model === "string" && learned.has(model));
  if (!always || !Number.isFinite(answerBudget) || answerBudget <= 0) return 0;
  const reserve = Math.min(32768, Math.max(EMPTY_LENGTH_RETRY_EXTRA_TOKENS, 2 * answerBudget) * multiplier);
  return Math.max(0, Math.min(reserve, availableAnswerTokens(context) - answerBudget));
}
export function availableAnswerTokens(context: ReasoningContext): number {
  return context.contextTokens !== undefined && context.promptTokens !== undefined
    ? Math.max(0, context.contextTokens - context.promptTokens) : Infinity;
}

/** Typed failure for an empty non-streaming completion. */
export class EmptyLengthError extends Error {
  readonly code = "empty_length";
  constructor() { super("The AI used its generation room without answering. Try again with a shorter conversation."); this.name = "EmptyLengthError"; }
}
let retryCount = 0;
export function emptyLengthRetryCount(): number { return retryCount; }
export function logEmptyLengthRetry(role: string, model: string | undefined, answerBudget: number, ceiling: number, retryCeiling: number): void {
  retryCount++;
  console.info(JSON.stringify({ event: "llm.empty_length_retry", role, model, answerBudget, ceiling, retryCeiling }));
}

export class ContextTooLargeError extends Error {
  readonly code = "context_too_large";
  constructor() { super("The conversation leaves too little answer room. Try a shorter conversation."); }
}
