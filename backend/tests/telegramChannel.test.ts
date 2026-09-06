import { describe, expect, test, beforeEach, mock } from "bun:test";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { setHouseholdSettingValue } from "@/lib/settings";
import { sendTelegramMessage } from "@/lib/telegramChannel";

beforeEach(() => {
  __resetRateLimiterForTests();
  setHouseholdSettingValue("notifications.telegram.bot_token", "test-token");
});

// Session F, step 3/step 0's deferred fallback (docs/plans/wave-2.md: "F
// ships the fetch half" of A's unshipped per-person-limits step): every
// send now goes through lib/rateLimiter.ts's tryConsume() at its one
// choke point, CLAUDE.md's "every integration gets a rate limiter... and
// all traffic to that service goes through it."
describe("sendTelegramMessage rate limiting", () => {
  test("a burst within capacity all send", async () => {
    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => {
      calls++;
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
    try {
      for (let i = 0; i < 10; i++) {
        expect(await sendTelegramMessage("12345", `message ${i}`)).toBe(true);
      }
      expect(calls).toBe(10);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("exceeding the burst is rate-limited: no fetch fires, and the send reports false rather than throwing", async () => {
    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => {
      calls++;
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
    try {
      for (let i = 0; i < 10; i++) await sendTelegramMessage("12345", `message ${i}`);
      expect(calls).toBe(10);

      const result = await sendTelegramMessage("12345", "one too many");
      expect(result).toBe(false);
      expect(calls).toBe(10); // no 11th fetch attempt at all
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("the limit is shared across chat ids (one household bot, one budget)", async () => {
    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => {
      calls++;
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
    try {
      for (let i = 0; i < 10; i++) await sendTelegramMessage("chat-a", `message ${i}`);
      const result = await sendTelegramMessage("chat-b", "a different recipient");
      expect(result).toBe(false);
      expect(calls).toBe(10);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
