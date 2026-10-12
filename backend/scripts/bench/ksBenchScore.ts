// KS-BENCH-01 scorer: turns the websearch calls a turn made into the call
// shapes named in datasets/ks-bench-01.json ("arms") and checks them against
// the row's category. Pure functions, no database, so a test can import it.
// A recorded turn is described here; nothing in this file takes part in a
// live turn (rule 1: the model picks the scope, nothing else does).

export type CallShape = "no_tool" | "other_tool" | "scope_reference" | "scope_web" | "scope_omitted" | "scope_reference_only" | "rescued_search";
export interface ToolCall { name: string; arguments: string }
export interface CategoryRule { acceptable: string[]; forbidden: string[] }

/** The `scope` a websearch call carried: "reference", "web", or null when absent or any other value. */
export function scopeOf(call: ToolCall): "reference" | "web" | null {
  try {
    const args = JSON.parse(call.arguments || "{}") as { scope?: unknown };
    return args.scope === "reference" || args.scope === "web" ? args.scope : null;
  } catch {
    return null;
  }
}

/**
 * Call shapes of one turn.
 * @param firstRound the tool calls of the model's first answer-bearing request
 * @param later the tool calls of every later request of the turn (retries, follow-ups)
 * `scope_reference_only` is added when the first round used the library and no
 * later websearch call went to the web or omitted the scope.
 * `rescued` (ROUTER-BUILD-01i): the first round made no call and the hub then ran a search itself (see
 * `wasRescued`); the shape is `rescued_search` instead of `no_tool`, so a forced search counts as a search.
 */
export function callShapes(firstRound: readonly ToolCall[], later: readonly ToolCall[], rescued = false): Set<CallShape> {
  const shapes = new Set<CallShape>();
  const searches = firstRound.filter((c) => c.name === "websearch");
  if (firstRound.length === 0) return new Set<CallShape>([rescued ? "rescued_search" : "no_tool"]);
  if (searches.length === 0) return new Set<CallShape>(["other_tool"]);
  for (const call of searches) {
    const scope = scopeOf(call);
    shapes.add(scope === "reference" ? "scope_reference" : scope === "web" ? "scope_web" : "scope_omitted");
  }
  const laterEscalated = later.some((c) => c.name === "websearch" && scopeOf(c) !== "reference");
  if (shapes.size === 1 && shapes.has("scope_reference") && !laterEscalated) shapes.add("scope_reference_only");
  return shapes;
}

export interface Verdict { pass: boolean; forbidden: boolean }

/** Pass: some shape is acceptable and none is forbidden. Forbidden: any shape is on the forbidden list. */
export function judge(shapes: ReadonlySet<CallShape>, rule: CategoryRule): Verdict {
  const forbidden = [...shapes].some((s) => rule.forbidden.includes(s));
  const acceptable = [...shapes].some((s) => rule.acceptable.includes(s));
  return { pass: acceptable && !forbidden, forbidden };
}

export interface ScopeUse { searches: number; scoped: number }

/** Of every websearch call in the turn, how many carried a `scope` (reference or web). A rescued search carries none. */
export function scopeUse(calls: readonly ToolCall[], rescuedSearches = 0): ScopeUse {
  const searches = calls.filter((c) => c.name === "websearch");
  return { searches: searches.length + rescuedSearches, scoped: searches.filter((c) => scopeOf(c) !== null).length };
}

/**
 * ROUTER-BUILD-01i: whether the hub, not the model, made this turn's search. The forced call is never in the
 * model's output, so the recorded wire alone cannot show it; the signature is a first round with no tool call,
 * no websearch call in any later round, and at least one query answered by the search backend. A first round
 * with another tool is never a rescue (the model's own call always wins, and that tool may itself query the
 * backend, which is why `other_tool` turns are excluded).
 * @param backendQueries queries the search backend (the bench stand-in) answered during the turn
 */
export function wasRescued(firstRound: readonly ToolCall[], later: readonly ToolCall[], backendQueries: number): boolean {
  return firstRound.length === 0 && backendQueries > 0 && !later.some((c) => c.name === "websearch");
}

/** Removes the `scope` property from a chat request body's websearch tool (the "plain federation" arm). Returns the body unchanged when there is none. */
export function stripScopeFromBody(bodyText: string): { body: string; stripped: boolean } {
  try {
    const parsed = JSON.parse(bodyText) as { tools?: { function?: { name?: string; parameters?: { properties?: Record<string, unknown>; required?: string[] } } }[] };
    let stripped = false;
    for (const tool of parsed.tools ?? []) {
      const params = tool.function?.parameters;
      if (tool.function?.name !== "websearch" || !params?.properties || !("scope" in params.properties)) continue;
      delete params.properties.scope;
      if (Array.isArray(params.required)) params.required = params.required.filter((r) => r !== "scope");
      stripped = true;
    }
    return stripped ? { body: JSON.stringify(parsed), stripped } : { body: bodyText, stripped };
  } catch {
    return { body: bodyText, stripped: false };
  }
}

/** The fields of a recorded run that scoring reads (a search-recency-02 RunRecord has them all). */
export interface RecordedRun {
  category: string;
  error: string | null;
  firstRound: { calls: ToolCall[] } | null;
  laterCalls: ToolCall[];
  fixtureQueries: number;
  shapes: string[];
  pass: boolean | null;
  forbidden: boolean | null;
  searches: number;
  rescued?: boolean;
}

/**
 * ROUTER-BUILD-01i: scores a recorded run again so a rescued search counts as a search. Runs saved before
 * this field existed (the 01g and 01h results) are fixed up without the engine; a run that already carries
 * `rescued` is returned as it is. A run with no first round recorded (an engine that never answered) is
 * left alone.
 */
export function rescoreRecorded<T extends RecordedRun>(run: T, rules: Record<string, CategoryRule>): T {
  if (run.rescued !== undefined || run.firstRound === null) return run;
  if (run.error) return { ...run, rescued: false };
  if (!wasRescued(run.firstRound.calls, run.laterCalls, run.fixtureQueries)) return { ...run, rescued: false };
  const shapes = callShapes(run.firstRound.calls, run.laterCalls, true);
  const rule = rules[run.category];
  const verdict = run.error || !rule ? null : judge(shapes, rule);
  return { ...run, rescued: true, shapes: [...shapes], pass: verdict?.pass ?? null, forbidden: verdict?.forbidden ?? null, searches: run.searches + 1 };
}
