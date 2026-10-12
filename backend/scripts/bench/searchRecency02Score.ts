// SEARCH-RECENCY-02 bench helpers (measurement only, nothing here ships): bench-only
// wire rewrites for the router / always-search / description / cutoff arms, the
// router answer parser, and the paired interval. Pure functions, no database.
// The router and always-search arms conflict with RULES.md rule 1 (no router or
// classifier); they are measured as a ceiling beside the best in-rules arm.

export const ROUTER_INSTRUCTION =
  "You decide whether the user's latest message needs a live web search, because the answer could have changed since your training or you are not sure of it. Answer with exactly one word and nothing else: SEARCH or NO_SEARCH.";

export const DESCRIPTION_SENTENCE = "Use this whenever the answer could have changed since your training or you are not sure; searching is cheap and a wrong stale answer is not.";

/** Knowledge-cutoff honesty block, verbatim from loki-doki commit e0d8c75e companionTurn.ts. */
export const CUTOFF_BLOCK =
  "Your built-in knowledge has a training cutoff in the past and the world has moved on " +
  "since. Tool results, the briefing, and other data in this prompt are LIVE and always " +
  "outrank your memory when they conflict. For anything that may have changed recently " +
  "(news, prices, releases, scores, people in the news) with no live data provided, say " +
  "your information may be out of date and offer to look it up. If the user mentions an " +
  "event you have no knowledge of, neither confirm nor deny it from memory, offer to " +
  "search instead. Never present remembered news as current.";

/** SEARCH / NO_SEARCH from the model's text; null when it is neither (counted as NO_SEARCH, reported). */
export function parseRouterAnswer(text: string): "SEARCH" | "NO_SEARCH" | null {
  const t = text.trim().toUpperCase().replace(/[^A-Z_ ]/g, " ").trim();
  if (/^NO[_ ]?SEARCH\b/.test(t)) return "NO_SEARCH";
  if (/^SEARCH\b/.test(t)) return "SEARCH";
  return null;
}

interface WireBody { tools?: { function?: { name?: string; description?: string } }[]; messages?: { role?: string; content?: unknown }[]; response_format?: unknown; tool_choice?: unknown; [k: string]: unknown }
const isFirstOffering = (b: WireBody): boolean => Array.isArray(b.tools) && b.tools.length > 0 && !b.response_format && !(b.messages ?? []).some((m) => m.role === "tool");

/** Forces the websearch function on the first tool-offering round. */
export function forceWebsearchBody(bodyText: string): { body: string; applied: boolean } {
  try {
    const b = JSON.parse(bodyText) as WireBody;
    if (!isFirstOffering(b) || !b.tools!.some((t) => t.function?.name === "websearch")) return { body: bodyText, applied: false };
    b.tool_choice = { type: "function", function: { name: "websearch" } };
    return { body: JSON.stringify(b), applied: true };
  } catch { return { body: bodyText, applied: false }; }
}

/** Appends the recency sentence to the websearch tool description (first round only). */
export function addDescriptionSentenceBody(bodyText: string): { body: string; applied: boolean } {
  try {
    const b = JSON.parse(bodyText) as WireBody;
    if (!isFirstOffering(b)) return { body: bodyText, applied: false };
    let applied = false;
    for (const t of b.tools!) if (t.function?.name === "websearch") { t.function.description = `${t.function.description ?? ""} ${DESCRIPTION_SENTENCE}`.trim(); applied = true; }
    return applied ? { body: JSON.stringify(b), applied } : { body: bodyText, applied };
  } catch { return { body: bodyText, applied: false }; }
}

/** Appends the cutoff block to the system message (first round only). */
export function addCutoffBlockBody(bodyText: string): { body: string; applied: boolean } {
  try {
    const b = JSON.parse(bodyText) as WireBody;
    if (!isFirstOffering(b)) return { body: bodyText, applied: false };
    const sys = (b.messages ?? []).find((m) => m.role === "system");
    if (!sys || typeof sys.content !== "string") return { body: bodyText, applied: false };
    sys.content = `${sys.content}\n\n${CUTOFF_BLOCK}`;
    return { body: JSON.stringify(b), applied: true };
  } catch { return { body: bodyText, applied: false }; }
}

export interface PairedInterval { n: number; meanDiffPct: number; lowPct: number; highPct: number }

/** Paired 95% interval (normal approximation), arm minus baseline, over per-row pass rates, in points. */
export function pairedInterval(arm: ReadonlyMap<string, number>, base: ReadonlyMap<string, number>): PairedInterval | null {
  const diffs = [...arm.entries()].filter(([row]) => base.has(row)).map(([row, v]) => v - base.get(row)!);
  const n = diffs.length;
  if (n < 2) return null;
  const mean = diffs.reduce((a, b) => a + b, 0) / n;
  const variance = diffs.reduce((a, d) => a + (d - mean) ** 2, 0) / (n - 1);
  const half = 1.96 * Math.sqrt(variance / n);
  const r = (x: number) => Math.round(1000 * x) / 10;
  return { n, meanDiffPct: r(mean), lowPct: r(mean - half), highPct: r(mean + half) };
}

/**
 * Multi-turn workaround (bench-only): the engine's chat template raises "System message must be
 * at the beginning" when the hub sends a system message after history turns. Every system message
 * after the first is folded into the first one, so follow-up rows can run at all.
 */
export function foldLateSystemMessages(bodyText: string): { body: string; folded: number } {
  try {
    const b = JSON.parse(bodyText) as WireBody;
    const msgs = b.messages ?? [];
    const late = msgs.map((m, i) => ({ m, i })).filter(({ m, i }) => i > 0 && m.role === "system" && typeof m.content === "string");
    if (late.length === 0) return { body: bodyText, folded: 0 };
    const first = msgs[0];
    if (!first || first.role !== "system" || typeof first.content !== "string") return { body: bodyText, folded: 0 };
    first.content = [first.content, ...late.map(({ m }) => m.content as string)].join("\n\n");
    b.messages = msgs.filter((_, i) => !late.some((l) => l.i === i));
    return { body: JSON.stringify(b), folded: late.length };
  } catch { return { body: bodyText, folded: 0 }; }
}
