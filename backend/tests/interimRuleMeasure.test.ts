// GROUND-01 step 4 (docs/plans/turn-machine-state-record-2026-09-22.md,
// "The live grounding refusals..."): interimRuleMeasure.ts must count a
// search by the tool node's own outcome, not by its presence in the
// trace - U2e's trace-completeness fix (TraceRecorder.skip()) means a
// "tool" entry always exists in stats.nodes[], skipped or not, so
// reading presence alone made every row look searched regardless of
// what actually ran. Direct unit test of the exported, pure function,
// the same reason ownerReplay.test.ts/policy.test.ts test their own
// scripts' pure pieces directly rather than through a live hub call.
import { describe, expect, test } from "bun:test";
import { hasWebsearchOutcome } from "../scripts/bench/interimRuleMeasure";

describe("hasWebsearchOutcome(): counts by outcome, never by node presence", () => {
  test("a scripted trace with a skipped tool node counts as not searched", () => {
    const nodes = [
      { node: "model", outcome: { ok: true } },
      { node: "policy", outcome: { ok: true } },
      { node: "tool", outcome: { skipped: true } },
      { node: "answer", outcome: { ok: true } },
    ];
    expect(hasWebsearchOutcome(nodes)).toBe(false);
  });

  test("a tool node that actually ran (ok present) counts as searched", () => {
    const nodes = [
      { node: "model", outcome: { ok: true } },
      { node: "policy", outcome: { ok: true } },
      { node: "tool", outcome: { ok: true } },
      { node: "answer", outcome: { ok: true } },
    ];
    expect(hasWebsearchOutcome(nodes)).toBe(true);
  });

  test("a tool node that ran and failed still counts as searched (ok: false is still present)", () => {
    const nodes = [{ node: "tool", outcome: { ok: false } }];
    expect(hasWebsearchOutcome(nodes)).toBe(true);
  });

  test("no tool node at all counts as not searched", () => {
    const nodes = [{ node: "model", outcome: { ok: true } }];
    expect(hasWebsearchOutcome(nodes)).toBe(false);
  });
});
