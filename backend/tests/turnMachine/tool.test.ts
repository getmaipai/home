// TOOL-EVENTS-01(b): toolNode's own wire events (spec's tool_call/
// tool_result/tool_error, spec/schemas/turn-stream-event.schema.json),
// the backend producer half of TOOL-EVENTS-01 (the frontend consumer,
// chatModelAdapter.ts, landed first). turnNext.test.ts's own "a world
// question runs the search tool" covers the real, end-to-end success
// path (a real runPlugin() call through a fake searxng); these are the
// fast, direct unit tests of toolNode's own error path, an unknown
// package id needing no DB or actor fields at all (loadManifestOnly()
// fails on the filesystem check before runPlugin() ever reads actor).
import { describe, expect, test, spyOn } from "bun:test";
import { toolNode } from "@/lib/turnMachine/nodes/tool";
import type { TurnState, ActionProposal } from "@/lib/turnMachine/contract";
import { TurnStreamEvent as ToolTurnStreamEvent } from "@maipai/spec/stack/ts/turn-stream-event.js";

const STATE = { turnId: "test-turn", conversationId: "test-conv", actor: {} } as unknown as TurnState;
const SIGNAL = new AbortController().signal;

function proposal(tool: string, args: Record<string, unknown>, callId: string): ActionProposal {
  return { kind: "read_only", request: { tool, args, callId } };
}

describe("toolNode: wire events, validated against the spec's own schema", () => {
  const validBlock = {
    id: "blk-tool01",
    kind: "spec_sheet",
    schema_version: 1,
    producer: "almanac-date",
    alt: "A date facts sheet.",
    provenance: "almanac-date result",
    created_at: "2026-10-08T12:00:00.000Z",
    hlc: "1791478099338:0:abcdef",
    props: { title: "Date", rows: [{ label: "Date", value: "Thursday" }] },
  };

  test("emits an allowed block after its tool_result", async () => {
    const plugins = await import("@/lib/plugins");
    const manifest = spyOn(plugins, "loadManifestOnly").mockReturnValue({ ok: true, value: { id: "almanac-date", returns_blocks: ["spec_sheet"] } } as never);
    const run = spyOn(plugins, "runPlugin").mockResolvedValue({ ok: true, value: { reply: { text: "The package answer remains available." }, actions: [], blocks: [validBlock] } as never } as never);
    try {
      const state = { ...STATE, surface: "chat", actor: { displayName: "Sage", role: "adult", birthdate: null } } as unknown as TurnState;
      const { output } = await toolNode(state, { proposals: [proposal("almanac-date", {}, "call-block")] }, SIGNAL);
      expect(output.toolEvents.map((event) => event.t)).toEqual(["tool_call", "tool_result", "block"]);
      expect(output.toolEvents.map((event) => ToolTurnStreamEvent.parse(event).t)).toEqual(["tool_call", "tool_result", "block"]);
      expect(output.outcomes[0]?.result?.reply?.text).toBe("The package answer remains available.");
    } finally {
      run.mockRestore();
      manifest.mockRestore();
    }
  });

  test("an invalid block is dropped while the successful package answer remains", async () => {
    const plugins = await import("@/lib/plugins");
    const manifest = spyOn(plugins, "loadManifestOnly").mockReturnValue({ ok: true, value: { id: "almanac-date", returns_blocks: ["spec_sheet"] } } as never);
    const run = spyOn(plugins, "runPlugin").mockResolvedValue({ ok: true, value: { reply: { text: "The package answer remains available." }, actions: [], blocks: [{ kind: "spec_sheet", props: {} }] } as never } as never);
    try {
      const state = { ...STATE, surface: "chat", actor: { displayName: "Sage", role: "adult", birthdate: null } } as unknown as TurnState;
      const { output } = await toolNode(state, { proposals: [proposal("almanac-date", {}, "call-invalid-block")] }, SIGNAL);
      expect(output.toolEvents.map((event) => event.t)).toEqual(["tool_call", "tool_result"]);
      expect(output.outcomes[0]?.status).toBe("succeeded");
      expect(output.outcomes[0]?.result?.reply?.text).toBe("The package answer remains available.");
    } finally {
      run.mockRestore();
      manifest.mockRestore();
    }
  });

  test("an unknown package produces one tool_call, then one tool_error - not a tool_result with an error_code", async () => {
    const { output } = await toolNode(STATE, { proposals: [proposal("not-a-real-package", { x: 1 }, "call-1")] }, SIGNAL);
    expect(output.toolEvents.length).toBe(2);
    const [call, error] = output.toolEvents.map((e) => ToolTurnStreamEvent.parse(e));
    if (call!.t !== "tool_call") throw new Error(`expected tool_call, got ${call!.t}`);
    expect(call).toEqual({ t: "tool_call", package_id: "not-a-real-package", call_id: "call-1", args: { x: 1 } });
    if (error!.t !== "tool_error") throw new Error(`expected tool_error, got ${error!.t}`);
    expect(error!.call_id).toBe("call-1");
    expect(error!.package_id).toBe("not-a-real-package");
    expect(error!.error.length).toBeGreaterThan(0);
    // The outcome the rest of the turn actually composes from still
    // carries the same failure - toolEvents is an additive wire report
    // of it, never a second source of truth.
    expect(output.outcomes[0]?.status).toBe("failed");
  });

  test("two proposals produce four events in call/result order, one call_id per proposal", async () => {
    const { output } = await toolNode(
      STATE,
      { proposals: [proposal("not-a-real-package", {}, "call-1"), proposal("also-not-real", {}, "call-2")] },
      SIGNAL,
    );
    expect(output.toolEvents.map((e) => (e as { t: string }).t)).toEqual(["tool_call", "tool_error", "tool_call", "tool_error"]);
    expect(output.toolEvents.map((e) => (e as { call_id: string }).call_id)).toEqual(["call-1", "call-1", "call-2", "call-2"]);
  });

  test("no proposals produce no events", async () => {
    const { output } = await toolNode(STATE, { proposals: [] }, SIGNAL);
    expect(output.toolEvents).toEqual([]);
    expect(output.outcomes).toEqual([]);
  });
});
