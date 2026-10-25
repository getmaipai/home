import { afterEach, expect, test } from "bun:test";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { readStackMemoryLedger } from "@/lib/stackHealthSync";

afterEach(() => __resetStackEngineForTests());

test("reads the Stack memory ledger when the report includes it", async () => {
  const ledger = {
    reserved_bytes: 10, warm_bytes: 20, burst_bytes: 30, budget_bytes: 100,
    working_margin_bytes: 5, free_bytes: 40, queue_depth: { reserved: 1, warm: 2, burst: 3 }, chat_paged_out: false,
  };
  __setStackClientForTests({ memory: async () => ({ ledger }) } as never);
  expect(await readStackMemoryLedger()).toEqual(ledger);
});

test("an older Stack without the memory endpoint has no ledger row data", async () => {
  __setStackClientForTests({} as never);
  expect(await readStackMemoryLedger()).toBeUndefined();
});

test("a memory report without the additive ledger block has no ledger row data", async () => {
  __setStackClientForTests({ memory: async () => ({ level: "normal" }) } as never);
  expect(await readStackMemoryLedger()).toBeUndefined();
});
