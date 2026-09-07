import { describe, expect, test, afterEach } from "bun:test";
import { runPostLoadCheck } from "@/lib/enginePostLoadCheck";
import { resolveLaunchFlags } from "@/lib/engineAutotune";
import { CATALOG } from "@/lib/modelCatalog";
import type { HardwareInfo } from "@/lib/hardware";
import { LlamaServerClient } from "@maipai/spec/llm/ts/client.js";
import { startStubLlmServer, type StubLlmServerHandle } from "@maipai/spec/llm/ts/stubServer.js";

const qwen3_8b = CATALOG.find((m) => m.id === "qwen3-8b-instruct-q4-k-m")!;

function hw(): HardwareInfo {
  return { platform: "darwin", arch: "arm64", totalRamGb: 24, cpuCount: 8, isAppleSilicon: true, unifiedMemoryGb: 24, cudaDevices: [] };
}

let server: StubLlmServerHandle | undefined;
afterEach(() => {
  server?.stop();
  server = undefined;
});

// Fix E (docs/dev.md's "Chat reliability" - native tool calling): E2's
// own post-load check, proven directly against a real stub server
// (never the real engine - a spawn's own liveness has nothing to do
// with what this file is testing) rather than only through
// llmSupervisor.ts's much heavier real-spawn tests. `toolCallingOk`
// never gates the spawn (Jesse, 2026-09-07: chat is the core capability,
// tool calling a Tier 2 extra) - proven here by BOTH directions
// returning normally (never throwing) regardless of which way it goes.
describe("runPostLoadCheck() (Fix E's own tool-calling check)", () => {
  test("a model that answers tools with a real tool_calls reply: toolCallingOk true", async () => {
    server = startStubLlmServer(0, {
      scriptedToolCalls: (req) =>
        req.tools && req.tools.length > 0
          ? [{ id: "call-1", type: "function", function: { name: "add", arguments: '{"a":2,"b":2}' } }]
          : undefined,
    });
    const client = new LlamaServerClient(server.url);
    const result = await runPostLoadCheck(client, 1, qwen3_8b, resolveLaunchFlags(qwen3_8b, hw()), hw());
    expect(result.toolCallingOk).toBe(true);
  });

  test("a model that never proposes a tool call: toolCallingOk false, spawn still succeeds (no throw)", async () => {
    // No scriptedToolCalls at all - the stub's own default echo reply
    // answers every request, tool-offered or not, exactly like a real
    // model that ignores `tools` entirely would.
    server = startStubLlmServer(0);
    const client = new LlamaServerClient(server.url);
    const result = await runPostLoadCheck(client, 1, qwen3_8b, resolveLaunchFlags(qwen3_8b, hw()), hw());
    expect(result.toolCallingOk).toBe(false);
    expect(result.replyOk).toBe(true); // the core chat check is unaffected
  });
});
