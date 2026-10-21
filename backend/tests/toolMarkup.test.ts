// RECENCY-02: tool-call markup written as text is never shown, in the stream or at rest.
import { describe, expect, test } from "bun:test";
import { markerPrefixTail, stripToolMarkup, toolMarkupStart } from "@/lib/toolMarkup";
import { envelopeToolCall } from "@/lib/llm";
import { claimsMedia } from "@/lib/mediaClaims";
import { StreamGate } from "@/lib/turnMachine/nodes/outputGate";
import type { PersonRow } from "@/types";

const ACTOR = { id: "person-juniper", displayName: "Juniper", role: "owner", birthdate: null } as unknown as PersonRow;
// The reply a person saw live on 2026-10-21 (Qwen3.6, chat surface), prose then the model's own tool call as text.
const LIVE = "I have generated a new artistic interpretation of what that latest Dune: Part Three poster looks like.\n\n<tool_call>\n<function=generate_image>\n<parameter=prompt>\nA dramatic movie poster. Timothee Chalamet as Paul Atreides on a dune.\n</parameter>\n<parameter=style>\nphotorealistic\n</parameter>\n</function>\n</tool_call>";

function stream(band: "adult" | "teen" | "child", pieces: string[]): { released: string; result: ReturnType<StreamGate["result"]> } {
  const released: string[] = [];
  const gate = new StreamGate(band, ACTOR, "turn-markup", (t) => released.push(t), () => {}, () => {}, { grain: band === "adult" ? "arrival" : "sentence" });
  for (const piece of pieces) gate.push(piece);
  gate.finish();
  return { released: released.join(""), result: gate.result() };
}
const chunks = (text: string, size: number) => text.match(new RegExp(`[\\s\\S]{1,${size}}`, "g")) ?? [];

describe("stripToolMarkup", () => {
  test("the live reply keeps its prose and loses every tag, function and parameter", () => {
    const out = stripToolMarkup(LIVE);
    expect(out.text).toBe("I have generated a new artistic interpretation of what that latest Dune: Part Three poster looks like.");
    expect(out.markup).toContain("<function=generate_image>");
    expect(out.text).not.toMatch(/<|>|parameter|function=/);
  });
  test.each([
    ["[TOOL_CALLS][{\"name\":\"websearch\",\"arguments\":{\"expression\":\"x\"}}]", ""],
    ["Let me check. <function=websearch><parameter=expression>x</parameter></function>", "Let me check."],
    ["Sure. <function_call>{\"name\":\"websearch\"}</function_call>", "Sure."],
    ["Checking now. {\"name\": \"websearch\", \"arguments\": {\"expression\": \"dune\"}}", "Checking now."],
  ])("%s", (input, text) => expect(stripToolMarkup(input).text).toBe(text));
  test("ordinary text, maths and a stray angle bracket are untouched", () => {
    for (const text of ["Use a < b and c > d.", "The function f(x) = x*2 is linear.", "Say <hello> to the tag.", "[1] is a source."]) expect(stripToolMarkup(text)).toEqual({ text, markup: "" });
  });
  test("a marker split across pieces is held back until it is known", () => {
    expect(markerPrefixTail("I will search <tool_c")).toBe("<tool_c".length);
    expect(markerPrefixTail("Done.")).toBe(0);
    expect(toolMarkupStart("a <tool_call>")).toBe(2);
  });
});

describe("the stream gate", () => {
  test.each(["adult", "teen", "child"] as const)("%s: the live reply streams its prose and never a tag, at any piece size", (band) => {
    for (const size of [1, 3, 7, 40, LIVE.length]) {
      const { released, result } = stream(band, chunks(LIVE, size));
      expect(released).not.toMatch(/<|tool_call|function=|parameter=/);
      expect(result.text).not.toMatch(/<|tool_call|function=|parameter=/);
      expect(result.text).toContain("Dune: Part Three poster looks like");
      expect(result.toolMarkup).toContain("<function=generate_image>");
      expect(released).toBe(result.text);
    }
  });
  test("a reply that is only a tool call releases nothing", () => {
    const { released, result } = stream("adult", chunks("<tool_call><function=websearch><parameter=expression>dune</parameter></function></tool_call>", 5));
    expect(released).toBe("");
    expect(result.toolMarkup).toContain("websearch");
  });
  test("a reply with a harmless angle bracket is released whole", () => {
    const { result } = stream("adult", chunks("Anything under 5 < 10 counts. Then <b> is bold.", 4));
    expect(result.text).toBe("Anything under 5 < 10 counts. Then <b> is bold.");
    expect(result.toolMarkup).toBe("");
  });
});

describe("a call that is the whole reply", () => {
  test("Qwen's XML call becomes a real call; with prose beside it, it does not", () => {
    const call = envelopeToolCall("<tool_call>\n<function=websearch>\n<parameter=expression>\ndune 3 poster\n</parameter>\n</function>\n</tool_call>");
    expect(call?.tool).toBe("websearch");
    expect(call?.args).toEqual({ expression: "dune 3 poster" });
    expect(envelopeToolCall(LIVE)).toBeUndefined();
  });
});

describe("a claim of having made a picture", () => {
  test("the live sentence counts as a claim", () => {
    expect(claimsMedia("I have generated a new artistic interpretation of what that latest Dune: Part Three poster looks like.")).toBe(true);
  });
});
