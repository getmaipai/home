import { describe, expect, test } from "bun:test";
import { readAssistantTurnStream } from "@/lib/assistantTurnStream";
import { assistantStreamBody, ASSISTANT_STREAM_HEADERS } from "../../tests/assistantStreamBody";

const respond = (events: Record<string, unknown>[]) => new Response(assistantStreamBody(events), { status: 200, headers: ASSISTANT_STREAM_HEADERS });
async function drain(response: Response) {
  const out: Record<string, unknown>[] = [];
  for await (const event of readAssistantTurnStream(response)) out.push(event as unknown as Record<string, unknown>);
  return out;
}
const META = { type: "turn_meta", conversation_id: "c1", turn_id: "t1", resume_token: "r1" };

describe("readAssistantTurnStream", () => {
  test("text and reasoning deltas come back as delta and reasoning events with their sequence, in order", async () => {
    const events = await drain(respond([
      META,
      { type: "reasoning", text: "hmm ", sequence: 1 },
      { type: "delta", text: "Hello ", sequence: 2 },
      { type: "delta", text: "Oliver.", sequence: 3 },
      { type: "done", value: { reply: { text: "Hello Oliver." } } },
    ]));
    expect(events.map((e) => [e.type, e.text, e.sequence])).toEqual([
      ["turn_meta", undefined, undefined],
      ["reasoning", "hmm ", 1],
      ["delta", "Hello ", 2],
      ["delta", "Oliver.", 3],
      ["done", undefined, undefined],
    ]);
  });

  test("control events ride the data chunk unchanged", async () => {
    const status = { type: "status", stage: "lookup", text: "Looking that up" };
    const cue = { type: "spoken_cue", text: "One moment." };
    const events = await drain(respond([META, { type: "signal", signal: "chat" }, status, cue, { type: "done", value: { reply: { text: "ok" } } }]));
    expect(events).toContainEqual(status);
    expect(events).toContainEqual(cue);
    expect(events).toContainEqual(META);
  });

  test("tool lines arrive once each, in step order, as the NDJSON `t` objects", async () => {
    const call = { t: "tool_call", call_id: "k1", package_id: "websearch", args: { q: "rain" } };
    const result = { t: "tool_result", call_id: "k1", outcome: { sites: [{ host: "a.example", url: "https://a.example" }] } };
    const events = await drain(respond([META, call, result, { type: "delta", text: "Rain.", sequence: 1 }, { type: "done", value: { reply: { text: "Rain." } } }]));
    expect(events.filter((e) => "t" in e)).toEqual([call, result]);
    expect(events.map((e) => e.type ?? e.t)).toEqual(["turn_meta", "tool_call", "tool_result", "delta", "done"]);
  });

  test("an error ends the stream with the error event carrying code and crisis_resources, once", async () => {
    const error = { type: "error", error: "refused", code: "safety_refused", crisis_resources: "Call or text 988." };
    const events = await drain(respond([META, { type: "delta", text: "x", sequence: 1 }, error]));
    expect(events.filter((e) => e.type === "error")).toEqual([error]);
    expect(events.at(-1)).toEqual(error);
  });

  test("a body that ends with neither done nor error yields neither", async () => {
    const events = await drain(respond([META, { type: "delta", text: "partial", sequence: 1 }]));
    expect(events.some((e) => e.type === "done" || e.type === "error")).toBe(false);
  });
});
