// CODE-API-01: the deterministic safety floor (SAFETY.md, rule 1 and 10) as the coding door uses it. It is the same floor every door uses
// (lib/safety.ts evaluateSafety), with one scoping decision: an ADULT's coding traffic is checked for the non-removable categories only
// (self-harm, harmful requests, credible threats, csam, grooming). The prompt-injection, jailbreak and personal-information detectors guard a
// chat against being steered; an agent's prompts and a repository's text trip them as a matter of course and would refuse ordinary adult work.
// A child or teen is checked for every category. The floor never reads code for style.
import { evaluateSafety, forOutput } from "@/lib/safety";
import { notifyIfFlagged } from "@/lib/notifications";
import { CRISIS_RESOURCES_TEXT, SAFETY_REFUSAL_COPY } from "@/lib/failureCopy";
import { speakerAgeBand, type AgeBand } from "@/lib/ageBand";
import { REFUSE_CATEGORIES } from "@maipai/spec/safety/ts/classifier.js";
import type { SafetyResult } from "@maipai/spec/gen/ts/safety-result.js";
import type { PersonRow } from "@/types";

const ADULT_CATEGORIES = new Set<string>(["self_harm", "harmful_request", "credible_threat", "csam", "grooming"]);

export type FloorVerdict = { action: SafetyResult["action"]; crisis: boolean; result: SafetyResult };

/** The floor on `text` for `band`. `direction` "out" reads a reply (a refuse category refuses even beside self-harm), "in" reads the person's words. */
export function codingFloor(text: string, band: AgeBand, direction: "in" | "out"): FloorVerdict {
  // CSAM-TEXT-01 (owner's ruling 2026-10-19): an adult's typed message and the model's reply carry no minor-word-plus-sexual-word rule. Passing the direction
  // selects that mode for an adult; a teen, a child and the robot keep the full floor exactly as before (evaluateSafety ignores it for them).
  let result = evaluateSafety(text, band, direction === "in" ? "message" : "reply");
  if (band === "adult" && result.flagged) {
    const categories = result.categories.filter(c => ADULT_CATEGORIES.has(c));
    const action: SafetyResult["action"] = categories.length === 0 ? "allow"
      : categories.includes("self_harm") ? "allow_with_resources"
      : categories.some(c => REFUSE_CATEGORIES.has(c)) ? "refuse" : "allow_with_resources";
    result = { ...result, flagged: categories.length > 0, categories, action };
  }
  if (direction === "out") result = forOutput(result);
  return { action: result.action, crisis: result.categories.includes("self_harm"), result };
}

export const bandOf = (person: PersonRow): AgeBand => speakerAgeBand(person, new Date());
export const crisisText = (): string => CRISIS_RESOURCES_TEXT;
export const inputRefusalLine = (band: AgeBand): string => band === "child"
  ? "I can't help with that one, so let's pick something else."
  : "Home stopped this request because it breaks a safety rule. Ask for something different.";
export const outputRefusalLine = (band: AgeBand): string => SAFETY_REFUSAL_COPY[band];

/** A minor's flagged request tells the household's admins the same text-free alert a flagged chat turn does (design 3.7 floor 5). */
export function alertIfMinor(person: PersonRow, result: SafetyResult): void {
  if (result.notify_parent) notifyIfFlagged(person, result, "[code]");
}
