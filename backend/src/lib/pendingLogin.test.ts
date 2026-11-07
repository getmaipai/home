import { beforeEach, describe, expect, test } from "bun:test";
import { consumePendingLogin, issuePendingLogin, __resetPendingLoginsForTests, __pendingLoginTtlForTests } from "@/lib/pendingLogin";

beforeEach(() => __resetPendingLoginsForTests());

describe("pending login tokens", () => {
  test("are random 32-byte base64url values and can be consumed once", () => {
    const token = issuePendingLogin("person-1");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(consumePendingLogin(token)).toBe("person-1");
    expect(consumePendingLogin(token)).toBeNull();
  });
  test("reject unknown tokens", () => expect(consumePendingLogin("unknown")).toBeNull());
  test("expires after five minutes", () => {
    const realNow = Date.now;
    let now = realNow();
    Date.now = () => now;
    try {
      const token = issuePendingLogin("person-1");
      now += __pendingLoginTtlForTests() + 1;
      expect(consumePendingLogin(token)).toBeNull();
    } finally { Date.now = realNow; }
  });
});
