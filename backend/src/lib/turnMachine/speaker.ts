// THIN-0D (rule 12, port before delete; fixes part of #204): whether the
// turn's speaker is unidentified. The same derivation the old path uses
// (turnContext.ts's effectiveBand(): a robot turn is anonymous unless
// speaker_evidence names the signed-in person), read by every node that
// would otherwise reach the signed-in person's memories: context
// (recall and the profile), commands and policy (the recall package).
import { effectiveBand } from "@/lib/turnContext";
import type { TurnState } from "./contract";

export function speakerIsAnonymous(state: Pick<TurnState, "surface" | "actor" | "speakerEvidence">): boolean {
  if (state.surface !== "robot") return false;
  return effectiveBand(state.surface, state.actor, state.speakerEvidence, new Date()).basis === "unknown_speaker_default";
}

/** A package that reads memory (the manifest declares memory:read) reads
 * the signed-in person's records, so an anonymous speaker never reaches it. */
export function readsMemory(manifest: { permissions?: readonly string[] }): boolean {
  return manifest.permissions?.includes("memory:read") === true;
}
