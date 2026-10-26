// ANALYSIS-LEAK-01: a model that writes its own task analysis ("The user is asking ...") as the reply, with no think tags,
// is not talking to the person. Seen live 2026-10-26: Qwen3.6 with thinking off answered a picture request for a named living
// person with its policy reasoning as the whole reply (441 characters), stored as reply_text with an empty reasoning field.
import { describe, expect, test } from "bun:test";
import { analysisLead, extractReasoningText, visibleText } from "@/lib/wellFormed";
import { StreamGate } from "@/lib/turnMachine/nodes/outputGate";
import type { PersonRow } from "@/types";

const ACTOR = { id: "person-juniper", displayName: "Juniper", role: "owner", birthdate: null } as unknown as PersonRow;
const LEAK = "The user is asking for a \"sexiest most provocative\" image of a living person with explicit sexual connotations. This violates the safety policy regarding sexual content involving real people. I must refuse this request.\n\nI will decline the request.";

function stream(pieces: string[]): { released: string; result: ReturnType<StreamGate["result"]> } {
  const released: string[] = [];
  const gate = new StreamGate("adult", ACTOR, "turn-leak", (t) => released.push(t), () => {}, () => {}, { grain: "arrival" });
  for (const piece of pieces) gate.push(piece);
  gate.finish();
  return { released: released.join(""), result: gate.result() };
}
const chunks = (text: string, size: number) => text.match(new RegExp(`[\\s\\S]{1,${size}}`, "g")) ?? [];

describe("analysisLead", () => {
  test.each([
    "The user is asking for a picture of a famous person.",
    "  The user wants a recipe.",
    "The person is requesting a refund.",
    "The user asked about the weather.",
    "The user's request is about a real person.",
  ])("%s is the model talking to itself", (text) => expect(analysisLead(text)).toBe("leak"));

  test.each([
    "Here is the picture.",
    "The weather today is mild.",
    "The user is the account that signs in on the Mac.",
    "I can help with that.",
    "",
  ])("%s is a reply", (text) => expect(["clear", "undecided"]).toContain(analysisLead(text)));

  test("a short opening that could still become the analysis voice waits, a plain one does not", () => {
    expect(analysisLead("The us")).toBe("undecided");
    expect(analysisLead("The user is")).toBe("undecided");
    expect(analysisLead("The cat")).toBe("clear");
    expect(analysisLead("Hello there")).toBe("clear");
  });
});

describe("the leaked analysis is reasoning, not the reply", () => {
  test("visibleText drops it and extractReasoningText keeps it", () => {
    expect(visibleText(LEAK)).toBe("");
    expect(extractReasoningText(LEAK)).toBe(LEAK.trim());
  });
  test("a reply that merely mentions the user later is untouched", () => {
    const text = "Sure. The user is asking for it, so here it is.";
    expect(visibleText(text)).toBe(text);
    expect(extractReasoningText(text)).toBeUndefined();
  });
  test("real think blocks still work as before", () => {
    expect(visibleText("<think>plan</think>Done.")).toBe("Done.");
    expect(extractReasoningText("<think>plan</think>Done.")).toBe("plan");
  });
});

describe("the stream gate never shows it", () => {
  test.each([1, 3, 7, 40])("pieces of %i characters release nothing", (size) => {
    const out = stream(chunks(LEAK, size));
    expect(out.released).toBe("");
    expect(out.result.text).toBe("");
  });
  test("an ordinary reply still streams whole, in small pieces too", () => {
    const text = "The weather today is mild, so a light jacket is enough.";
    for (const size of [1, 4, 100]) expect(stream(chunks(text, size)).released).toBe(text);
  });
  test("a reply that starts like the analysis voice and turns out to be prose is released", () => {
    const text = "The user is the account that signs in on the Mac, and a person is someone in the household.";
    expect(stream(chunks(text, 5)).released).toBe(text);
  });
});
