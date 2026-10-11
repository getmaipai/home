// KS-BENCH-01 scorer: turns the websearch calls a turn made into the call
// shapes named in datasets/ks-bench-01.json ("arms") and checks them against
// the row's category. Pure functions, no database, so a test can import it.
// A recorded turn is described here; nothing in this file takes part in a
// live turn (rule 1: the model picks the scope, nothing else does).

export type CallShape = "no_tool" | "other_tool" | "scope_reference" | "scope_web" | "scope_omitted" | "scope_reference_only";
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
 */
export function callShapes(firstRound: readonly ToolCall[], later: readonly ToolCall[]): Set<CallShape> {
  const shapes = new Set<CallShape>();
  const searches = firstRound.filter((c) => c.name === "websearch");
  if (firstRound.length === 0) return new Set<CallShape>(["no_tool"]);
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

/** Of every websearch call in the turn, how many carried a `scope` (reference or web). */
export function scopeUse(calls: readonly ToolCall[]): ScopeUse {
  const searches = calls.filter((c) => c.name === "websearch");
  return { searches: searches.length, scoped: searches.filter((c) => scopeOf(c) !== null).length };
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
