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
import type { SurfaceClass } from "@/lib/surfaceClass";
import { quoteForPrompt } from "@/lib/composer";

export type LookupFailureKind = "unavailable" | "timed_out" | "found_nothing" | "errored";

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
  if (outcome.errorCode === "search_unavailable") return "unavailable";
  if (outcome.errorCode === "deadline_exceeded") return "timed_out";
  return "errored";
}

const KIND_PHRASE: Record<LookupFailureKind, string> = {
  unavailable: "the search was unavailable",
  timed_out: "the lookup timed out",
  found_nothing: "the search found nothing",
  errored: "the lookup errored",
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
