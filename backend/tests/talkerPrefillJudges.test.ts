import { describe, expect, test } from "bun:test";
import { judgeContinued, judgeRepeatedOpener, leadingSpace } from "../scripts/bench/talkerPrefill";

describe("assistant prefill judges", () => {
  test("accepts clean text and tool-call-only continuation", () => {
    expect(judgeContinued({ choices: [{ message: { content: "That makes sense because..." } }] })).toBe(true);
    expect(judgeContinued({ choices: [{ message: { content: "", tool_calls: [{ function: { name: "websearch" } }] } }] })).toBe(true);
  });

  test("rejects a repeated opener and detects it", () => {
    const content = "Okay, so. The first thing to understand is...";
    const reply = { choices: [{ message: { content } }] };
    expect(judgeContinued(reply)).toBe(false);
    expect(judgeRepeatedOpener(content, "Okay, so.")).toBe(true);
    expect(judgeRepeatedOpener(" The first thing to understand is...", "Okay, so.")).toBe(false);
  });

  test("rejects role and chat-template prefixes", () => {
    expect(judgeContinued({ choices: [{ message: { content: "<|im_start|>assistant hello" } }] })).toBe(false);
    expect(judgeContinued({ choices: [{ message: { content: "assistant: hello" } }] })).toBe(false);
    expect(judgeContinued({ choices: [{ message: { content: "<think>private thought</think>answer" } }] })).toBe(false);
  });

  test("detects a leading space and its absence", () => {
    expect(leadingSpace(" continuation")).toBe(true);
    expect(leadingSpace("continuation")).toBe(false);
  });
});
