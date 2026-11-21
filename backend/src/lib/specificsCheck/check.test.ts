import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as llm from "@/lib/llm";
import { __specificsCheckInstructionForTests, runSpecificsCheck } from "./check";

afterEach(() => { /* each spy is restored in its test */ });

describe("specifics check judge", () => {
  test("accepts only the true and false JSON verdicts and sends fixed instructions first", async () => {
    const spy = spyOn(llm, "completeBackground").mockResolvedValue({ ok: true, text: '{"specifics_without_basis":true}' });
    expect(await runSpecificsCheck({ question: "Who wrote it?", reply: "Mira wrote it in 1998.", memoryInjected: false })).toBe("flagged");
    const [messages, options] = spy.mock.calls[0]!;
    expect(messages[0]).toEqual({ role: "system", content: __specificsCheckInstructionForTests });
    expect(messages[1]!.content).toContain("Who wrote it?");
    expect(options).toMatchObject({ max_tokens: 40, thinking: false, timeoutMs: 1500 });
    spy.mockResolvedValue({ ok: true, text: '{"specifics_without_basis":false}' });
    expect(await runSpecificsCheck({ question: "q", reply: "a", memoryInjected: true })).toBe("clear");
    spy.mockRestore();
  });
  test("maps slow, failed, and malformed answers to unavailable", async () => {
    const spy = spyOn(llm, "completeBackground");
    spy.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ ok: true, text: '{"specifics_without_basis":false}' }), 1600)) as never);
    expect(await runSpecificsCheck({ question: "q", reply: "a", memoryInjected: false })).toBe("unavailable");
    spy.mockResolvedValue({ ok: false, unavailable: true });
    expect(await runSpecificsCheck({ question: "q", reply: "a", memoryInjected: false })).toBe("unavailable");
    spy.mockResolvedValue({ ok: true, text: "not json" });
    expect(await runSpecificsCheck({ question: "q", reply: "a", memoryInjected: false })).toBe("unavailable");
    spy.mockRestore();
  });
});
