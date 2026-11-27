// ACT-POLICY-ALLOWLIST-01: an unattended (scheduled or background) run may call only tools on the explicit read list or tools granted for
// that run. An unlisted tool, including a brand-new one nobody classified, is refused with a plain sentence. The grant is re-read per call.
import { describe, expect, test, beforeEach } from "bun:test";
import { resetDb } from "../reset-db";
import { createBenchPeople } from "../../scripts/bench/conversationRunner";
import { policyNode } from "@/lib/turnMachine/nodes/policy";
import { backgroundToolDecision, BACKGROUND_READ_TOOLS } from "@/lib/toolBrake";
import { policyRefusalLine } from "@/lib/turnMachine/nodes/answer";
import type { TurnState } from "@/lib/turnMachine/contract";

beforeEach(() => resetDb());

describe("backgroundToolDecision", () => {
  test("a read-list tool runs; an unlisted tool is refused", () => {
    expect(backgroundToolDecision({ tool: "weather", grants: [], band: "adult", tainted: false })).toEqual({ allow: true });
    expect(backgroundToolDecision({ tool: "brand-new-tool", grants: [], band: "adult", tainted: false })).toEqual({ allow: false, reason: "background_not_allowed" });
  });
  test("a granted tool runs for an adult on a clean run, never for a child or after outside content", () => {
    expect(backgroundToolDecision({ tool: "remind", grants: ["remind"], band: "adult", tainted: false }).allow).toBe(true);
    expect(backgroundToolDecision({ tool: "remind", grants: ["remind"], band: "child", tainted: false }).allow).toBe(false);
    expect(backgroundToolDecision({ tool: "remind", grants: ["remind"], band: "adult", tainted: true }).allow).toBe(false);
  });
  test("the read list names no tool that changes something", () => {
    for (const changing of ["remind", "timer", "lists", "house", "lock-doors", "remember", "make_film"]) expect(BACKGROUND_READ_TOOLS.has(changing)).toBe(false);
  });
});

describe("policyNode in a background turn", () => {
  function state(ownerId: string, grants: () => readonly string[]): TurnState {
    return { actor: { id: ownerId, role: "adult" }, surface: "chat", speakerEvidence: { kind: "person" }, context: [], crisis: false, temporary: false, utterance: "run my morning check", background: { grants } } as unknown as TurnState;
  }
  test("a tool with no classification is refused, with a sentence that says not to retry", async () => {
    const owner = createBenchPeople().owner;
    const out = await policyNode(state(owner.id, () => []), { calls: [{ id: "c1", tool: "brand-new-tool", args: {} }] }, new AbortController().signal);
    expect(out.output.entries[0]?.decision).toMatchObject({ allow: false, reason: "background_not_allowed" });
    expect(policyRefusalLine("background_not_allowed")).toContain("Don't try");
  });
  test("a grant is re-read on every call: revoked between two calls, the second is refused", async () => {
    const owner = createBenchPeople().owner;
    let granted: readonly string[] = ["brand-new-tool"];
    const s = state(owner.id, () => granted);
    const first = await policyNode(s, { calls: [{ id: "c1", tool: "brand-new-tool", args: {} }] }, new AbortController().signal);
    expect(first.output.entries[0]?.decision).not.toMatchObject({ reason: "background_not_allowed" });
    granted = [];
    const second = await policyNode(s, { calls: [{ id: "c2", tool: "brand-new-tool", args: {} }] }, new AbortController().signal);
    expect(second.output.entries[0]?.decision).toMatchObject({ allow: false, reason: "background_not_allowed" });
  });
  test("a turn with no background marker is unchanged", async () => {
    const owner = createBenchPeople().owner;
    const s = { ...state(owner.id, () => []), background: undefined } as TurnState;
    const out = await policyNode(s, { calls: [{ id: "c1", tool: "brand-new-tool", args: {} }] }, new AbortController().signal);
    expect(out.output.entries[0]?.decision).toMatchObject({ reason: "unknown_tool" });
  });
});
