import { describe, expect, test } from "bun:test";
import { comparePrompt } from "@/lib/promptPrefix";
import type { LlmMessage } from "@/lib/llm";

const sys = (text: string): LlmMessage => ({ role: "system", content: text });
const user = (text: string): LlmMessage => ({ role: "user", content: text });

describe("comparePrompt", () => {
  test("the first request has no previous", () => {
    expect(comparePrompt("c-first", [sys("a")], []).had_previous).toBe(false);
  });
  test("a changed system message is named and counts its shared characters", () => {
    comparePrompt("c-diff", [sys("clock 10:00"), user("hi")], []);
    const r = comparePrompt("c-diff", [sys("clock 10:01"), user("hi")], []);
    expect(r.first_diff).toBe("message 0 (system)");
    expect(r.shared_chars).toBeGreaterThan("[]".length);
    expect(r.shared_chars).toBeLessThan(r.request_chars);
  });
  test("an extension shares the whole previous request and names no difference", () => {
    comparePrompt("c-ext", [sys("s"), user("hi")], []);
    const r = comparePrompt("c-ext", [sys("s"), user("hi"), user("more")], []);
    expect(r.first_diff).toBeNull();
    expect(r.shared_chars).toBeGreaterThan(0);
  });
  test("conversations do not share history", () => {
    comparePrompt("c-a", [sys("s")], []);
    expect(comparePrompt("c-b", [sys("s")], []).had_previous).toBe(false);
  });
});
