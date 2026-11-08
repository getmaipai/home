import { describe, expect, test } from "bun:test";
import { completeWithFallback } from "@/lib/judgeFallback";

describe("judge fallback", () => {
  const messages = [{ role: "user" as const, content: "hello" }];
  test("returns the judge result when available", async () => {
    const result = await completeWithFallback(messages, {}, { completeJudge: async () => ({ ok: true, text: "judge" }), judgeTimeoutMs: 20 });
    expect(result).toEqual({ ok: true, text: "judge", via: "judge" });
  });
  test("falls back to chat once", async () => {
    const result = await completeWithFallback(messages, {}, { completeJudge: async () => ({ ok: false, unavailable: true, failureKind: "offline" }), completeChat: (async () => ({ ok: true, data: { choices: [{ message: { content: "chat" } }] } })) as never, chatTimeoutMs: 20 });
    expect(result).toEqual({ ok: true, text: "chat", via: "chat" });
  });
  test("reports both attempts and never throws on rejection", async () => {
    await expect(completeWithFallback(messages, {}, { completeJudge: async () => { throw new Error("down"); }, completeChat: (async () => { throw new Error("down"); }) as never, judgeTimeoutMs: 20, chatTimeoutMs: 20 })).resolves.toMatchObject({ ok: false, unavailable: true, tried: ["judge", "chat"] });
  });
});
