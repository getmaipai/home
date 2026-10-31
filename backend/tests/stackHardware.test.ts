import { afterEach, expect, test } from "bun:test";
import { createStackClient } from "@/lib/stack/client";
import { __setStackClientForTests } from "@/lib/stackEngine";
import { __setHardwareForTests, currentHardware, refreshStackHardware } from "@/lib/jobs/stackHardware";

const reply = {
  totalMemoryBytes: 8_000_000_000, capBytes: 6_000_000_000, freeMemoryBytes: 0, availablePercent: 0,
  pressure: "normal" as const, memoryReadingDegraded: false, margin_bytes: 1_000_000_000, profile: null,
  slots: [{ category: "chat" as const, tier: "standard" as const, model: "fixture", peak_bytes: 2_000_000_000, verified: true }],
  loaded: [], queue: [],
};

afterEach(() => { __setStackClientForTests(null); __setHardwareForTests(null); });

test("refresh stores budget hardware and preserves it when a later request fails", async () => {
  let failing = false;
  __setStackClientForTests(createStackClient({
    baseUrl: "http://127.0.0.1:8770",
    fetch: (async () => failing ? new Response("offline", { status: 503 }) : Response.json(reply)) as unknown as typeof fetch,
  }));
  await refreshStackHardware();
  const first = currentHardware();
  expect(first?.budgetGb).toBe(5.59);
  failing = true;
  await refreshStackHardware();
  expect(currentHardware()).toEqual(first);
});
