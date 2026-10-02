// THIN-0D (rule 12, port before delete; fixes part of #204): whether the
// turn's speaker is unidentified. The same derivation the old path uses
// (turnContext.ts's effectiveBand(): a robot turn is anonymous unless
// speaker_evidence names the signed-in person), read by every node that
// would otherwise reach the signed-in person's memories: context
// (recall and the profile), commands and policy (the recall package).
import { effectiveBand } from "@/lib/turnContext";
import type { AgeBand } from "@/lib/ageBand";
import type { TurnState } from "./contract";

export function speakerIsAnonymous(state: Pick<TurnState, "surface" | "actor" | "speakerEvidence">): boolean {
  if (state.surface !== "robot") return false;
  return effectiveBand(state.surface, state.actor, state.speakerEvidence, new Date()).basis === "unknown_speaker_default";
}

/** THIN-0N (rules 0 and 12): the band every moderation and shaping read
 * uses, effectiveBand()'s own result exactly as the old engine file's
 * prepareTurn() derives it. An unidentified robot speaker is the child
 * band even when the signed-in person is an adult; every other turn is
 * the signed-in person's own band. Tightening only, never a loosening. */
export function turnAgeBand(surface: TurnState["surface"], actor: TurnState["actor"], speakerEvidence: TurnState["speakerEvidence"], now: Date): AgeBand {
  return effectiveBand(surface, actor, speakerEvidence, now).band;
}

/** A package that reads or writes memory (the manifest declares
 * memory:read or memory:write) acts on the signed-in person's records, so
 * an anonymous speaker never reaches it: no reading them, and no writing
 * a memory as that person either. */
export function touchesMemory(manifest: { permissions?: readonly string[] }): boolean {
  return manifest.permissions?.includes("memory:read") === true || manifest.permissions?.includes("memory:write") === true;
}
