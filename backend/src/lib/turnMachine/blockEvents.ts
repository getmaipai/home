// GENUI-02 and GENUI-05: the one place a turn accepts the answer blocks a
// package returned. Every path that runs a package inside a turn (the model's
// tool round, a closed-intent command match) calls this, so the manifest allowlist, the spec check, the age
// band, the output floor and the crisis overlay are decided once.
import type { AnswerBlock as AnswerBlockValue } from "@maipai/spec/gen/ts/answer-block.js";
import type { TurnStreamEvent as ToolStreamEvent } from "@maipai/spec/stack/ts/turn-stream-event.js";
import { loadManifestOnly } from "@/lib/plugins";
import { filterAnswerBlocks } from "@/lib/answerBlocks";
import { carriesCrisisSignal } from "@/lib/safety";
import type { TurnState } from "./contract";
import { turnAgeBand } from "./speaker";

/** The blocks of `raw` that pass for this package and this person, never
 * throwing: a malformed or unsafe visual is dropped and the answer is whole.
 * `seenIds` are the block ids already accepted this turn. */
export function acceptPackageBlocks(state: TurnState, packageId: string, raw: unknown, seenIds: ReadonlySet<string>): AnswerBlockValue[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  try {
    const loaded = loadManifestOnly(packageId);
    const allowedKinds = loaded.ok ? loaded.value.returns_blocks ?? [] : [];
    return filterAnswerBlocks(
      raw,
      packageId,
      allowedKinds,
      turnAgeBand(state.surface, state.actor, state.speakerEvidence, new Date()),
      state.actor,
      seenIds,
      (safety) => {
        if (!carriesCrisisSignal(safety)) return;
        const prior = state.blockSafety;
        state.blockSafety = prior
          ? {
              ...safety,
              action: "allow_with_resources",
              flagged: prior.flagged || safety.flagged,
              categories: [...new Set([...prior.categories, ...safety.categories])],
              matched_signals: [...new Set([...prior.matched_signals, ...safety.matched_signals])],
              notify_parent: prior.notify_parent || safety.notify_parent,
            }
          : { ...safety, action: "allow_with_resources" };
      },
    );
  } catch {
    // A visual filter is deliberately best-effort with respect to delivery:
    // malformed package data can never fail its answer.
    console.warn("[answer-block] block processing failed; answer retained");
    return [];
  }
}

/** The `block` stream events for the blocks of one package result, in order,
 * each after the ids already in `events`. */
export function blockEventsFor(state: TurnState, packageId: string, callId: string, raw: unknown, events: readonly ToolStreamEvent[]): ToolStreamEvent[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const seenIds = new Set(events.flatMap((event) => (event.t === "block" ? [event.block.id] : [])));
  return acceptPackageBlocks(state, packageId, raw, seenIds).map((block) => ({ t: "block" as const, call_id: callId, block }));
}
