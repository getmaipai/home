// U2b, the `safety` node (turn-machine-state-record-2026-09-22.md's
// state table): "the safety check, unchanged" - calls the existing
// safety.ts and memoryContentPolicy.ts floors exactly as the old path
// does, wrapped in the node contract. This is the one node this repo's
// safety architecture (docs/SAFETY.md) says must never become a
// judgment: it stays a direct call to the deterministic floor, not a
// reimplementation of it.
import { evaluateSafety, carriesCrisisSignal } from "@/lib/safety";
import { detectCredential } from "@/lib/memoryContentPolicy";
import { speakerAgeBand } from "@/lib/ageBand";
import { notifyOncePerTurn } from "@/lib/turnEngine";
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
  const band = speakerAgeBand(state.actor, new Date());
  const safety = evaluateSafety(input.utterance, band);
  // SAFETY-NOTIFY-NEXT-01: the identical input-side call turnEngine.ts's
  // own prepareTurn() makes (CHAT-02: "the input side shares the per-turn
  // dedupe with the output side") - fired regardless of `action`
  // (allow_with_resources and refuse can both flag a minor's turn), and
  // before a refusal is even decided, exactly as the old path does.
  notifyOncePerTurn(state.actor, safety, state.turnId, "[turn]");
  const crisis = carriesCrisisSignal(safety);
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

export function applySafety(state: TurnState, output: SafetyOutput): void {
  state.safety = output.safety;
  state.crisis = output.crisis;
}
