// UI-SHOWCASE: /api/dev/ui-fixtures, the admin-only deterministic turns the
// Chat showcase page (/dev/ui) plays through the real chat UI. Each fixture is
// an array of the turn's own events run through the real assistant-stream sink.
import { describe, expect, test, beforeEach } from "bun:test";
import { DataStreamDecoder, type AssistantStreamChunk } from "assistant-stream";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { owner, teen, child } from "./support/testAuth";
import { UI_FIXTURES } from "@/lib/uiFixtures";
import { SHOWCASE_BLOCKS } from "@/lib/uiFixtureBlocks";
import { AnswerBlock } from "@maipai/spec/gen/ts/answer-block.js";

beforeEach(() => resetDb());

async function chunks(res: Response): Promise<AssistantStreamChunk[]> {
  const reader = res.body!.pipeThrough(new DataStreamDecoder({ strict: false })).getReader();
  const out: AssistantStreamChunk[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out;
    out.push(value);
  }
}
const play = (client: TestClient, id: string, body: Record<string, unknown> = { pace: "instant" }) =>
  client.post(`/api/dev/ui-fixtures/${id}/stream`, body, { accept: "application/x-assistant-stream" });

describe("/api/dev/ui-fixtures", () => {
  test("lists every scenario with its one-line description for an admin", async () => {
    const { client } = await owner();
    const res = await client.get("/api/dev/ui-fixtures");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fixtures: { id: string; title: string; description: string }[] };
    expect(body.fixtures.map((f) => f.id)).toEqual(UI_FIXTURES.map((f) => f.id));
    for (const f of body.fixtures) expect(f.description.length).toBeGreaterThan(10);
  });

  test("a non-admin gets 403 on the list and on a stream", async () => {
    const { client: ownerClient } = await owner();
    const teenClient = await teen(ownerClient);
    expect((await teenClient.get("/api/dev/ui-fixtures")).status).toBe(403);
    expect((await play(teenClient, "table")).status).toBe(403);
    const { client: childClient } = await child(ownerClient);
    expect((await play(childClient, "table")).status).toBe(403);
  });

  test("a temporary (Incognito) request is refused even for the admin", async () => {
    const { client } = await owner();
    expect((await play(client, "table", { pace: "instant", temporary: true })).status).toBe(403);
  });

  test("an unknown fixture is a 404", async () => {
    const { client } = await owner();
    expect((await play(client, "nope")).status).toBe(404);
  });

  test("a stream is the assistant-stream wire: a text part, a data chunk per control event, one terminal", async () => {
    const { client } = await owner();
    const res = await play(client, "table");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-vercel-ai-data-stream")).toBe("v1");
    const all = await chunks(res);
    const text = all.filter((c) => c.type === "text-delta").map((c) => (c as { textDelta: string }).textDelta).join("");
    expect(text).toContain("| Name |");
    const data = all.filter((c) => c.type === "data").flatMap((c) => (c as unknown as { data: { type: string }[] }).data);
    expect(data[0]!.type).toBe("turn_meta");
    expect(data.filter((d) => d.type === "done")).toHaveLength(1);
    expect(all.filter((c) => c.type === "message-finish")).toHaveLength(1);
  });

  test("every fixture streams to exactly one terminal event", async () => {
    const { client } = await owner();
    for (const f of UI_FIXTURES) {
      const all = await chunks(await play(client, f.id));
      const data = all.filter((c) => c.type === "data").flatMap((c) => (c as unknown as { data: { type: string }[] }).data);
      expect(data.filter((d) => d.type === "done" || d.type === "error").length, f.id).toBe(1);
    }
  });
});

describe("the web chat's own reader", () => {
  test("every fixture, through the real route and the chat's DataStreamDecoder reader, yields its own events in order", async () => {
    const { readAssistantTurnStream } = await import("../../frontend/src/lib/assistantTurnStream");
    const { client } = await owner();
    for (const f of UI_FIXTURES) {
      const read: Record<string, unknown>[] = [];
      for await (const event of readAssistantTurnStream(await play(client, f.id))) read.push(event as unknown as Record<string, unknown>);
      const strip = (e: Record<string, unknown>) => ({ ...e, sequence: undefined });
      expect(read.map(strip), f.id).toEqual(f.events.map((e) => strip(e as unknown as Record<string, unknown>)));
    }
  });
});

// GENUI-03b: the answer-blocks scenario shows each v1 kind once, every block a
// valid AnswerBlock, streamed as tool_call, tool_result, block in that order.
describe("the answer-blocks scenario", () => {
  test("one valid block of each of the eight v1 kinds, streamed after its tool result", () => {
    expect(SHOWCASE_BLOCKS.map((b) => b.kind)).toEqual(["spec_sheet", "data_table", "chart", "timeline", "todo_list", "image_gallery", "schedule_card", "comparison"]);
    for (const block of SHOWCASE_BLOCKS) expect(AnswerBlock.safeParse(block).success, block.id).toBe(true);
    const events = UI_FIXTURES.find((f) => f.id === "answer-blocks")!.events as unknown as { t?: string; call_id?: string; block?: { id: string } }[];
    const toolEvents = events.filter((e) => e.t);
    expect(toolEvents.map((e) => e.t)).toEqual(SHOWCASE_BLOCKS.flatMap(() => ["tool_call", "tool_result", "block"]));
    expect(toolEvents.filter((e) => e.t === "block").map((e) => e.block!.id)).toEqual(SHOWCASE_BLOCKS.map((b) => b.id));
  });
});
