// U2b, the `safety` node (turn-machine-state-record-2026-09-22.md's
// state table): "the safety check, unchanged" - calls the existing
// safety.ts and memoryContentPolicy.ts floors exactly as the old path
// does, wrapped in the node contract. This is the one node this repo's
// safety architecture (docs/SAFETY.md) says must never become a
// judgment: it stays a direct call to the deterministic floor, not a
// reimplementation of it.
import { checkSafety } from "@maipai/spec/safety/ts/classifier.js";
import { evaluateSafety, carriesCrisisSignal } from "@/lib/safety";
import { detectCredential } from "@/lib/memoryContentPolicy";
import { turnAgeBand } from "../speaker";
import { notifyOncePerTurn, conversationInCrisis } from "@/lib/turnShared";
import type { Node, TurnState, NodeOutcome } from "../contract";

export interface SafetyInput {
  utterance: string;
}

export interface SafetyOutput {
  safety: ReturnType<typeof evaluateSafety>;
  crisis: boolean;
  credentialBlock: boolean;
}

export const safetyNode: Node<SafetyInput, SafetyOutput> = async (state, input) => {
  // THIN-0N: the speaker's effective band, as the old path's prepareTurn().
  const band = turnAgeBand(state.surface, state.actor, state.speakerEvidence, new Date());
  const safety = evaluateSafety(input.utterance, band);
  // SAFETY-NOTIFY-NEXT-01: the identical input-side call the old engine file's
  // own prepareTurn() makes (CHAT-02: "the input side shares the per-turn
  // dedupe with the output side") - fired regardless of `action`
  // (allow_with_resources and refuse can both flag a minor's turn), and
  // before a refusal is even decided, exactly as the old path does.
  notifyOncePerTurn(state.actor, safety, state.turnId, "[turn]");
  // THIN-0L (SAFETY-01, the old path's `inCrisis`): this turn's own
  // self-harm signal, or one on any of the conversation's last
  // CRISIS_STATE_TURNS turns (a temporary session included). The state
  // keeps the overlay on every reply and stops packages and lookups.
  const crisis = carriesCrisisSignal(safety) || conversationInCrisis(state.conversationId);
  const credential = detectCredential(input.utterance);
  const outcome: NodeOutcome = { ok: true };
  return {
    outcome,
    output: { safety, crisis, credentialBlock: credential.detected },
  };
};

/** The state table's own routing for this node's result: `refused` for
 * a refuse action, `blocked` for a credential line, else `commands`. */
export function safetyRoute(output: SafetyOutput): "refused" | "blocked" | "commands" {
  if (output.safety.action === "refuse") return "refused";
  if (output.credentialBlock) return "blocked";
  return "commands";
}

/** THIN-0M: when this node itself throws, the turn is refused with no
 * result to read. The spec's classifier is called directly (not through
 * the failing evaluateSafety()) so an input that stated self-harm still
 * gets the crisis resources, which cannot be configured off, and the
 * logged turn still marks the conversation (THIN-0L). Returns the
 * classifier's result as a refusal, or undefined when a second failure
 * leaves nothing to read: the refusal stands, never a thrown error. */
export function inputSafetyAfterFailure(utterance: string): ReturnType<typeof evaluateSafety> | undefined {
  try {
    const result = checkSafety(utterance, { isMinor: true });
    return { ...result, action: "refuse" };
  } catch {
    return undefined;
  }
}

export function applySafety(state: TurnState, output: SafetyOutput): void {
  state.safety = output.safety;
  state.crisis = output.crisis;
}
