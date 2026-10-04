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

  test("a body that arrives in tiny, delayed pieces still yields every delta before done, in order, each with its own sequence", async () => {
    const wire = await new Response(assistantStreamBody([
      META,
      { type: "reasoning", text: "think ", sequence: 1 },
      { type: "delta", text: "A", sequence: 2 },
      { type: "status", stage: "lookup", text: "Looking" },
      { type: "delta", text: "B", sequence: 3 },
      { type: "delta", text: "C", sequence: 4 },
      { type: "done", value: { reply: { text: "ABC" } } },
    ])).text();
    const bytes = new TextEncoder().encode(wire);
    let at = 0;
    const slow = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (at >= bytes.length) return controller.close();
        await new Promise((r) => setTimeout(r, 1));
        controller.enqueue(bytes.slice(at, at + 5));
        at += 5;
      },
    });
    const events = await drain(new Response(slow, { status: 200, headers: ASSISTANT_STREAM_HEADERS }));
    expect(events.map((e) => [e.type, e.text, e.sequence])).toEqual([
      ["turn_meta", undefined, undefined],
      ["reasoning", "think ", 1],
      ["delta", "A", 2],
      ["status", "Looking", undefined],
      ["delta", "B", 3],
      ["delta", "C", 4],
      ["done", undefined, undefined],
    ]);
  });

  test("stopping early cancels the body so the connection is released", async () => {
    let cancelled = false;
    const wire = await new Response(assistantStreamBody([META, { type: "delta", text: "A", sequence: 1 }])).text();
    const bytes = new TextEncoder().encode(wire);
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); }, pull() {}, cancel() { cancelled = true; } });
    const reader = readAssistantTurnStream(new Response(body, { status: 200, headers: ASSISTANT_STREAM_HEADERS }));
    expect((await reader.next()).done).toBe(false);
    await reader.return(undefined);
    await new Promise((r) => setTimeout(r, 5));
    expect(cancelled).toBe(true);
  });
});
