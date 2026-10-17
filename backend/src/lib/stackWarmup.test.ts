import { expect, test } from "bun:test";
import { warmStack } from "@/lib/stackWarmup";

test("warming the Stack never throws when no Stack is configured or reachable", async () => {
  expect(typeof (await warmStack())).toBe("boolean");
});

test("while the Stack says warming, chat reads starting even though the role is installed; ready clears it", async () => {
  const { warmStack, warmupInFlight, __resetWarmupForTests } = await import("@/lib/stackWarmup");
  const { __setStackClientForTests, __resetStackEngineForTests } = await import("@/lib/stackEngine");
  const { roleHealth } = await import("@/lib/roleHealth");
  let warm: "warming" | "ready" = "warming";
  __resetWarmupForTests();
  __setStackClientForTests({
    warmup: async () => ({ state: warm, trigger: "test" }),
    roles: async () => ({ roles: [{ id: "chat", state: { state: "installed", since: "" }, reason: null, model: null }] }),
  } as never);
  try {
    expect(await warmStack()).toBe(true);
    expect(warmupInFlight()).toBe(true);
    expect((await roleHealth("chat")).availability).toBe("starting");
    warm = "ready";
    await warmStack();
    expect(warmupInFlight()).toBe(false);
    expect((await roleHealth("chat")).availability).toBe("ready");
  } finally {
    __resetWarmupForTests();
    __resetStackEngineForTests();
  }
});

test("warmupInFlight expires after WARM_MAX_MS", async () => {
  const { warmupInFlight, __resetWarmupForTests, WARM_MAX_MS } = await import("@/lib/stackWarmup");
  __resetWarmupForTests();
  expect(warmupInFlight(Date.now() + WARM_MAX_MS + 1)).toBe(false);
});
