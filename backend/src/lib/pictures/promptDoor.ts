// CONTENT-POLICY-03: a picture or clip request meets the filter door (RULES.md C5) and the door's verdict becomes today's typed refusal.
// The denials (guest, minor with the kids switch off, spoken, shared screen, household off) are access, not content, and stay with the callers.
// `promptCheck` is synchronous because the turn's policy node and the tool's refusal helpers are; it reads the door through `releaseSync`
// (the same raters, the request point). `promptCheckAsync` is the awaited form for the code that already awaits (`checkRequest`).
import { checkRequest, releaseSync, type DoorVerdict } from "@/lib/filter/door";
import { asksToUndress, type PictureAudience, type PromptRefusal } from "./policy";
import { childPromptClass, laneOf, type Lane } from "./lane";

export type PromptSurface = "picture" | "clip";

/** The door's audience for a request: the person and the lane (the stricter of the turn's band and the person's own), so the door's ceiling is the lane's. */
export function doorAudience(audience: Pick<PictureAudience, "actor" | "band">): { actor: PictureAudience["actor"]; band: Lane } {
  return { actor: audience.actor, band: laneOf(audience) };
}
function itemFor(text: string, lane: Lane, surface: PromptSurface) {
  return { kind: "text" as const, text, field: "prompt" as const, lane, point: "request" as const, surface };
}

/** The typed refusal the verdict stands for, or null when it released. `minor-line` is `minor_sexual`; the lane rater says its own code; any other hold (the content rules,
 * an unrated or not-ready hold) is the lane's line: `child_content` for a child, `teen_content` for everyone else. */
export function refusalOfVerdict(verdict: DoorVerdict, lane: Lane): PromptRefusal | null {
  if (verdict.verdict === "released") return null;
  if (verdict.held_by === "minor-line") return "minor_sexual";
  if (verdict.held_by === "lane-prompt" && (verdict.detail === "minor_sexual" || verdict.detail === "child_content" || verdict.detail === "teen_content")) return verdict.detail;
  return lane === "child" ? "child_content" : "teen_content";
}

/** Whether a child's held request is one of the two the record lets be rewritten (something scary, a non-graphic pretend fight): the lane rater held it, every
 * unsafe word it has is tagged `scary` or `pretend_fight`, it does not ask to undress, and no other rater (the minor line, the content rules) holds the original words. */
function softHold(text: string, verdict: DoorVerdict): boolean {
  if (verdict.held_by !== "lane-prompt" || verdict.detail !== "child_content") return false;
  const kind = childPromptClass(text);
  return (kind === "scary" || kind === "pretend_fight") && !asksToUndress(text);
}

export type PromptCheck = { refusal: PromptRefusal | null; verdict: DoorVerdict; lane: Lane; softHold: boolean };

function resultOf(text: string, lane: Lane, verdict: DoorVerdict): PromptCheck {
  const refusal = refusalOfVerdict(verdict, lane);
  return { refusal, verdict, lane, softHold: lane === "child" && refusal === "child_content" && softHold(text, verdict) };
}

export function promptCheck(audience: PictureAudience, surface: PromptSurface, text: string): PromptCheck {
  const lane = laneOf(audience);
  return resultOf(text, lane, releaseSync({ surface, audience: doorAudience(audience), item: itemFor(text, lane, surface) }));
}
export async function promptCheckAsync(audience: Pick<PictureAudience, "actor" | "band">, surface: PromptSurface, text: string): Promise<PromptCheck> {
  const lane = laneOf(audience);
  return resultOf(text, lane, await checkRequest({ surface, audience: doorAudience(audience), request: itemFor(text, lane, surface) }));
}
