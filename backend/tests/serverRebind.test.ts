import { describe, expect, test } from "bun:test";
import { rebindWithRetry } from "@/lib/serverRebind";

// COR-3 (code review, 2026-09-06): index.ts's onLeafRenewed() listener
// used to run its Bun.serve() rebind with no try/catch at all, called
// synchronously from inside ensureHouseholdLeaf()'s own listener loop -
// a bind failure threw straight out of whichever caller awaited
// ensureHouseholdLeaf() (GET /api/setup/ca, unauthenticated), leaving the
// hub with no listener until a manual restart. index.ts itself is never
// imported by the test suite (app.ts/routes stay import-only so booting
// the app under test never starts a real listener), so this proves the
// extracted retry mechanism directly instead.
describe("rebindWithRetry", () => {
  test("returns the result of the first successful attempt, with attempts: 1", async () => {
    const result = await rebindWithRetry(() => "server-handle");
    expect(result).toEqual({ server: "server-handle", attempts: 1 });
  });

  test("retries after a failure and succeeds once the transient condition clears", async () => {
    let calls = 0;
    const result = await rebindWithRetry(() => {
      calls++;
      if (calls < 3) throw new Error("EADDRINUSE (simulated)");
      return "server-handle";
    }, 5, 1);
    expect(result).toEqual({ server: "server-handle", attempts: 3 });
  });

  test("throws the LAST attempt's own error after exhausting every retry, not a generic wrapper", async () => {
    let calls = 0;
    await expect(
      rebindWithRetry(() => {
        calls++;
        throw new Error(`bad PEM attempt ${calls}`);
      }, 3, 1),
    ).rejects.toThrow("bad PEM attempt 3");
    expect(calls).toBe(3);
  });

  test("never retries more than maxAttempts times", async () => {
    let calls = 0;
    await expect(
      rebindWithRetry(() => {
        calls++;
        throw new Error("always fails");
      }, 2, 1),
    ).rejects.toThrow();
    expect(calls).toBe(2);
  });
});
