// THIN-1B (docs/design/RULES.md rule 6): a failed tool never fails the
// answer. When search or any tool is down, errors, times out or finds
// nothing, the model answers from what it knows and the reply carries a
// fixed line saying the lookup did not happen, worded for the person's age
// band. The line is deterministic and never model-written; policy refusals
// (consent, crisis, temporary mode, ungrounded arguments) are not tool
// failures and never come through here.
import type { ToolExecutionOutcome } from "../contract";
import type { SurfaceClass } from "@/lib/surfaceClass";
import { quoteForPrompt } from "@/lib/composer";

export type LookupBand = "adult" | "teen" | "child";

/** The one table: one fixed line per age band. The child's and teen's
 * wording is their own, never a trimmed copy of the adult's. */
const LOOKUP_MISSED_LINE: Record<LookupBand, string> = {
  adult: "I couldn't look that up just now, so this is from what I already know.",
  teen: "I couldn't look that up this time, so that's from what I already know.",
  child: "I couldn't look that up right now, so I'm telling you what I already know.",
};

export function lookupMissedLine(band: LookupBand): string {
  return LOOKUP_MISSED_LINE[band];
}

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

/** The answering round's instruction when no lookup result survives to
 * ground it: answer from what you know, no mention of searching (the
 * fixed line is added after the answer). Mirrors phrasingInstruction()'s
 * length clause so a spoken turn stays short. */
export function lookupMissedInstruction(surfaceClass: SurfaceClass, utterance: string): string {
  const lengthClause = surfaceClass === "written" ? "structured where it helps" : "in one to three sentences";
  return (
    `The lookup for this did not happen, so there are no results. Answer this question of mine completely from what you know, ${lengthClause}: "${quoteForPrompt(utterance)}". ` +
    "Any specific current fact - who holds an office, a date, a number, a price, a score, what is latest - is left out rather than guessed. " +
    "Do not mention searching or looking things up; a note about that is added after your answer."
  );
}
