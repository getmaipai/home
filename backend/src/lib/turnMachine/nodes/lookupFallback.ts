// THIN-1D (docs/design/RULES.md rule 6, amended 2026-10-03): a failed tool
// never fails the answer. When search or any tool is down, errors, times out
// or finds nothing, the answering round is told only the KIND of failure and
// writes the note that the lookup did not happen in its own words, fresh each
// time. No sentence for it is stored anywhere, and the tool's raw error text
// never reaches the prompt. The note is part of the model's reply text, so the
// output gate treats it like any reply. Policy refusals (consent, crisis,
// temporary mode, ungrounded arguments) are not tool failures and never come
// through here.
import type { ToolExecutionOutcome } from "../contract";
import type { FailureKind } from "@/lib/turnContext";
import type { SurfaceClass } from "@/lib/surfaceClass";
import type { ToolCall, ToolSpec } from "@/lib/llm";
import { quoteForPrompt } from "@/lib/composer";
import { loadManifestOnly } from "@/lib/plugins";
import { START_PROJECT_TOOL_ID } from "@/lib/projects/tool";
import { modelFacingArgs } from "./tool";

export type LookupFailureKind = FailureKind;

/** Whether this outcome is a lookup that did not give the model anything:
 * a tool that failed (unavailable, errored, timed out), or a search that
 * succeeded with zero rows. A fixed read of the outcome's own status and
 * rows, never of any text. */
export function lookupMissed(outcome: ToolExecutionOutcome): boolean {
  if (outcome.status === "failed") return true;
  if (outcome.status !== "succeeded") return false;
  // Zero rows is "the search found nothing" only for a search: another tool
  // (a list, a schedule) can truthfully return an empty list, and that is
  // its answer, not a missed lookup.
  if (outcome.packageId !== "websearch") return false;
  const rows = (outcome.result?.data as { rows?: unknown } | undefined)?.rows;
  return Array.isArray(rows) && rows.length === 0;
}

/** The failure kind of a missed lookup, read from the outcome's status and
 * fixed code only, never from its error text. */
export function lookupFailureKind(outcome: ToolExecutionOutcome): LookupFailureKind {
  if (outcome.status === "succeeded") return "found_nothing";
  if (outcome.failureKind) return outcome.failureKind;
  if (outcome.errorCode === "search_unavailable") return "unavailable";
  if (outcome.errorCode === "deadline_exceeded") return "timed_out";
  return "errored";
}

const KIND_PHRASE: Record<LookupFailureKind, string> = {
  unavailable: "the search was unavailable",
  timed_out: "the lookup timed out",
  found_nothing: "the search found nothing",
  errored: "the lookup errored",
  bad_arguments: "the call was malformed (bad_arguments)",
};

function kindsPhrase(kinds: readonly LookupFailureKind[]): string {
  return [...new Set(kinds)].map((k) => KIND_PHRASE[k]).join("; ");
}

/** The clause a round that still has other results appends: only the failure
 * kind, never the failed call's own result (model.ts leaves that pair out). */
export function lookupMissedClause(kinds: readonly LookupFailureKind[]): string {
  return (
    ` One lookup for this did not happen (${kindsPhrase(kinds)}); so say plainly, in your own words and in your usual voice, that you could not look that part up, ` +
    "and leave out any specific current fact you cannot know rather than guessing it."
  );
}

/** The answering round's instruction when no lookup result survives to
 * ground it: told the failure kind and nothing else about it, answer from
 * what you know, say in your own words that you could not look it up, leave
 * out any specific current fact. Mirrors phrasingInstruction()'s length
 * clause so a spoken turn stays 1 to 3 sentences, note included. */
export function lookupMissedInstruction(surfaceClass: SurfaceClass, utterance: string, kinds: readonly LookupFailureKind[]): string {
  const lengthClause = surfaceClass === "written" ? "structured where it helps" : "in one to three sentences, the note included";
  return (
    `The lookup for this did not happen (${kindsPhrase(kinds)}), so there are no results. Answer this question of mine completely from what you know, ${lengthClause}: "${quoteForPrompt(utterance)}". ` +
    "Say plainly, in your own words and in your usual voice, that you could not look that up, fresh wording each time. " +
    "Any specific current fact - who holds an office, a date, a number, a price, a score, what is latest - is left out rather than guessed."
  );
}

// T5 / THIN-2G (tools design, 2026-10-03): when every tool call in a round
// failed, the model gets at most one more offered round before the phrasing
// round. The model decides what to do with it (rule 1); these are only the
// fixed floors around that round.

/** Whether a tool writes. A package flagged `consequential` always does (until
 * consequence classes exist, the design's own stand-in for write and
 * physical). `strict` adds what a temporary chat must not offer or re-run: the
 * virtual start_project tool and any package holding a `:write` permission. */
function toolWrites(id: string, strict: boolean): boolean {
  if (id === START_PROJECT_TOOL_ID) return strict;
  const loaded = loadManifestOnly(id);
  if (!loaded.ok) return false;
  return loaded.value.consequential === true || (strict && (loaded.value.permissions ?? []).some((p) => p.endsWith(":write")));
}

/** A retry round follows a round only when every call in it missed (a failed
 * run, a malformed call, a search that found nothing) and none of the failed
 * tools writes: a write tool is never run a second time without the person. */
export function retryEligible(outcomes: readonly ToolExecutionOutcome[]): boolean {
  return outcomes.length > 0 && outcomes.every(lookupMissed) && !outcomes.some((o) => toolWrites(o.packageId, true));
}

/** The retry round's tools block: the failed round's block unchanged (the same
 * array, for the cache prefix) unless it holds a tool that writes, which is
 * dropped; a temporary chat drops every tool that writes. */
export function retryTools(tools: ToolSpec[], temporary: boolean): ToolSpec[] {
  const kept = tools.filter((t) => !toolWrites(t.id, temporary));
  return kept.length === tools.length ? tools : kept;
}

/** The same tool may be called again with changed arguments; only a call
 * byte-identical to one that already failed this turn is forbidden. */
export function isRepeatOfFailed(call: Pick<ToolCall, "tool" | "args">, failed: readonly ToolExecutionOutcome[]): boolean {
  const key = (tool: string, args: unknown) => `${tool}\0${JSON.stringify(sorted(args))}`;
  const mine = key(call.tool, modelFacingArgs(call.tool, (call.args ?? {}) as Record<string, unknown>));
  return failed.some((o) => key(o.packageId, o.args ?? {}) === mine);
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, sorted(v)]));
  return value;
}

/** The retry round's one instruction: names each failed tool and its failure
 * kind (never the error text), allows another tool or the same tool with
 * different arguments, never the identical call, and otherwise asks for the
 * THIN-1D note. A spoken turn stays 1 to 3 sentences. */
export function retryInstruction(surfaceClass: SurfaceClass, utterance: string, failures: readonly { tool: string; kind: LookupFailureKind }[]): string {
  const lengthClause = surfaceClass === "written" ? "structured where it helps" : "in one to three sentences, the note included";
  const named = failures.map((f) => `${f.tool} (${KIND_PHRASE[f.kind]})`).join("; ");
  return (
    `The lookup for this did not happen: ${named}. You may try once more: call another tool, or the same tool with different arguments, but never the same call again. ` +
    `If no tool fits, answer this question of mine completely from what you know, ${lengthClause}: "${quoteForPrompt(utterance)}". ` +
    "When you answer without a lookup, say plainly, in your own words and in your usual voice, that you could not look that up, fresh wording each time, " +
    "and leave out any specific current fact you cannot know rather than guessing it."
  );
}
