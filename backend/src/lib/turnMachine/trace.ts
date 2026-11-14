// U2b (turn-machine-state-record-2026-09-22.md, "What every turn
// writes"): "one NodeExecution per node that ran or was skipped, in
// order." A small recorder machine.ts calls directly around every node
// invocation (see machine.ts's own runNode() wrapper) - XState v5's own
// `inspect` callback could derive the same list from its generic
// @xstate.snapshot stream, but a direct call at the one place every
// node actually runs is simpler to prove correct and to unit test than
// reconstructing per-node timing from a framework-generic event feed
// built for devtools, not a stored trace.
import type { NodeExecution, NodeName, NodeOutcome } from "./contract";

export class TraceRecorder {
  private entries: NodeExecution[] = [];

  record(node: NodeName, impl: string, version: string, startMs: number, endMs: number, outcome: NodeOutcome): void {
    this.entries.push({ node, impl, version, startMs, endMs, outcome });
  }

  skip(node: NodeName, reason: string): void {
    const now = Date.now();
    this.entries.push({ node, impl: "none", version: "0", startMs: now, endMs: now, outcome: { skipped: true, reason } });
  }

  nodes(): NodeExecution[] {
    return this.entries;
  }

  setStages(node: NodeName, stages: NonNullable<NodeExecution["stages"]>): void {
    const entry = [...this.entries].reverse().find((item) => item.node === node);
    if (entry) entry.stages = stages;
  }

  setStageValue(node: NodeName, key: keyof NonNullable<NodeExecution["stages"]>, value: number): void {
    const entry = [...this.entries].reverse().find((item) => item.node === node);
    if (entry) entry.stages = { ...entry.stages, [key]: value };
  }

  setSceneCounts(node: NodeName, counts: Omit<NonNullable<NodeExecution["scene"]>, "matched" | "disagreed" | "unavailable" | "skipped"> & Partial<Pick<NonNullable<NodeExecution["scene"]>, "matched" | "disagreed" | "unavailable" | "skipped">>): void {
    const entry = [...this.entries].reverse().find((item) => item.node === node);
    if (entry) entry.scene = { ...counts, scene_tokens: Number.isFinite(counts.scene_tokens) ? counts.scene_tokens : 0, matched: Number.isFinite(counts.matched) ? counts.matched! : 0, disagreed: Number.isFinite(counts.disagreed) ? counts.disagreed! : 0, unavailable: Number.isFinite(counts.unavailable) ? counts.unavailable! : 0, skipped: Number.isFinite(counts.skipped) ? counts.skipped! : 0 };
  }
}
