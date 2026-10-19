import { describe, expect, test } from "bun:test";
import { formatTable, guardLoopbackUrl, redactKeys } from "./coding-e2e";

describe("coding e2e pure helpers", () => {
  test("URL guard accepts scratch loopback and rejects shared or remote services", () => {
    expect(guardLoopbackUrl("http://127.0.0.1:8893", "Home").port).toBe("8893");
    expect(() => guardLoopbackUrl("http://127.0.0.1:8787", "Home")).toThrow("scratch 88xx");
    expect(() => guardLoopbackUrl("http://127.0.0.1:3000", "Home")).toThrow("scratch 88xx");
    expect(() => guardLoopbackUrl("https://example.com:8893", "Home")).toThrow("127.0.0.1");
    expect(() => guardLoopbackUrl("http://[::1]:8893", "Home")).toThrow("127.0.0.1");
    expect(() => guardLoopbackUrl("http://user:pass@localhost:8893", "Home")).toThrow("credentials");
  });

  test("table shows pass state and measured values", () => {
    const table = formatTable([{ name: "chat", pass: true, detail: "coder; 12 output tokens", latencyMs: 100, tokensPerSecond: 120 }]);
    expect(table).toContain("| chat");
    expect(table).toContain("PASS");
    expect(table).toContain("100 ms");
    expect(table).toContain("120.0");
  });

  test("redaction masks secrets and recognizable key material", () => {
    const secret = "synthetic-secret-42";
    const shapedKey = `${"maipai_" + "key_deadbeef_"}${"A".repeat(52)}`;
    const input = `created ${secret} and ${shapedKey}`;
    const safe = redactKeys(input, [secret]);
    expect(safe).not.toContain(secret);
    expect(safe).not.toContain(shapedKey);
    expect(safe.match(/\[REDACTED_KEY\]/g)).toHaveLength(2);
  });
});
