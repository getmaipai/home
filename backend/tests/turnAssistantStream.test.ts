// THIN-5D (rule 9, stage 5): the web chat's stream is assistant-stream.
// POST /api/turn/stream answers a request that asks for it with
// `Accept: application/x-assistant-stream` in the installed package's
// own DataStreamEncoder framing (assistant-stream 0.3.44,
// src/core/serialization/data-stream/DataStream.ts); a request that does
// not ask gets the NDJSON events byte for byte as before (turnBare*,
// turnEngine and safety01 tests pin those). Both wires are the same
// released events, so the stored reply is the concatenation of released
// text on either, resume keeps the one shared sequence counter, and the
// crisis resources of THIN-0E ride the terminal error on both.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { AssistantStream, DataStreamDecoder, type AssistantStreamChunk } from "assistant-stream";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { setHouseholdSettingValue } from "@/lib/settings";
import { db } from "@/db";
import { people, conversationTurns } from "@/db/schema";
import type { PersonRow } from "@/types";

const ACCEPT = { accept: "application/x-assistant-stream" };

beforeEach(() => {
  resetDb();
  setHouseholdSettingValue("turn.pipeline.next", true);
});
afterEach(() => {
  __resetLlmSupervisorForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

async function owner(): Promise<{ client: TestClient; actor: PersonRow }> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  return { client, actor };
}

async function childMember(owner: TestClient): Promise<TestClient> {
  const res = await owner.post("/api/people", { displayName: "Sprout", role: "child" });
  const { id } = (await res.json()) as { id: string };
  const client = new TestClient();
  await client.post("/api/auth/select", { personId: id });
  return client;
}

async function withStubReply<T>(reply: string, fn: () => Promise<T>): Promise<T> {
  __resetLlmSupervisorForTests();
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const stub = startStubLlmServer(0, { scriptedChatReply: () => reply });
  process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
  try {
    return await fn();
  } finally {
    await stub.stop();
    delete process.env.MAIPAI_LLAMA_SERVER_URL;
    __resetLlmSupervisorForTests();
  }
}

type Event = { type: string; text?: string; sequence?: number; code?: string; crisis_resources?: string; conversation_id?: string; turn_id?: string; resume_token?: string; value?: { reply: { text: string }; turn_id: string } };
interface Decoded { chunks: AssistantStreamChunk[]; text: string; reasoning: string; events: Event[]; finishes: number; errors: string[] }

// Decodes with the package's own DataStreamDecoder: what a client sees.
async function decode(res: Response): Promise<Decoded> {
  expect(res.headers.get("x-vercel-ai-data-stream")).toBe("v1");
  const chunks: AssistantStreamChunk[] = [];
  const parts: string[] = [];
  const out: Decoded = { chunks, text: "", reasoning: "", events: [], finishes: 0, errors: [] };
  const reader = AssistantStream.fromResponse(res, new DataStreamDecoder()).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    if (value.type === "part-start") parts[value.path.length === 0 ? parts.length : value.path[0]!] = value.part.type;
    if (value.type === "text-delta") {
      const kind = parts[value.path[0]!];
      if (kind === "text") out.text += value.textDelta;
      if (kind === "reasoning") out.reasoning += value.textDelta;
    }
    if (value.type === "data") out.events.push(...(value.data as Event[]));
    if (value.type === "message-finish") out.finishes++;
    if (value.type === "error") out.errors.push(value.error);
  }
  return out;
}

async function readNdjson(res: Response): Promise<Event[]> {
  return (await res.text()).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

const REPLY = "First sentence. Second sentence. Third sentence.";

describe("THIN-5D: POST /api/turn/stream speaks assistant-stream to a client that asks", () => {
  test("the same released text, one terminal done, the stored reply is the concatenation", async () => {
    const { client } = await owner();
    await withStubReply(REPLY, async () => {
      const res = await client.post("/api/turn/stream", { text: "say it" }, ACCEPT);
      expect(res.status).toBe(200);
      const got = await decode(res);
      const names = got.events.map((e) => e.type);
      expect(names[0]).toBe("turn_meta");
      expect(names[1]).toBe("signal");
      const done = got.events.filter((e) => e.type === "done");
      expect(done).toHaveLength(1);
      expect(got.finishes).toBe(1);
      expect(got.errors).toEqual([]);
      expect(got.text.length).toBeGreaterThan(0);
      expect(got.text.trim()).toBe(done[0]!.value!.reply.text);
      const stored = db.select().from(conversationTurns).where(eq(conversationTurns.id, done[0]!.value!.turn_id)).get()!;
      expect(JSON.stringify(stored)).toContain(done[0]!.value!.reply.text);
    });
  });

  test("a request that does not ask still gets NDJSON, unchanged", async () => {
    const { client } = await owner();
    await withStubReply(REPLY, async () => {
      for (const headers of [undefined, { accept: "*/*" }, { accept: "application/x-ndjson" }]) {
        const res = await client.post("/api/turn/stream", { text: "say it" }, headers);
        expect(res.headers.get("content-type")).toBe("application/x-ndjson");
        expect(res.headers.get("x-vercel-ai-data-stream")).toBeNull();
        const events = await readNdjson(res);
        expect(events[0]!.type).toBe("turn_meta");
        expect(events.filter((e) => e.type === "done")).toHaveLength(1);
      }
    });
  });

  test("every text frame carries its sequence number, and a resume replays only the later ones", async () => {
    const { client } = await owner();
    await withStubReply(REPLY, async () => {
      const first = await client.post("/api/turn/stream", { text: "resume this answer" }, ACCEPT);
      const reader = AssistantStream.fromResponse(first, new DataStreamDecoder()).getReader();
      const seen: AssistantStreamChunk[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        seen.push(value);
        if (value.type === "text-delta") break;
      }
      await reader.cancel();
      const events = seen.flatMap((c) => (c.type === "data" ? (c.data as Event[]) : []));
      const meta = events[0]!;
      expect(meta.type).toBe("turn_meta");
      const marker = events.find((e) => e.type === "sequence")!;
      expect(marker.sequence).toBe(1);
      // The sequence marker sits immediately before the text frame it numbers.
      const tail = seen.filter((c) => c.type !== "part-start").slice(-2);
      expect(tail[0]).toMatchObject({ type: "data", data: [{ type: "sequence", sequence: 1 }] });
      expect(tail[1]!.type).toBe("text-delta");

      const resumed = await client.post("/api/turn/stream", { conversation_id: meta.conversation_id, turn_id: meta.turn_id, resume_token: meta.resume_token, resume_from: 1 }, ACCEPT);
      expect(resumed.status).toBe(200);
      const later = await decode(resumed);
      const laterSeqs = later.events.filter((e) => e.type === "sequence").map((e) => e.sequence!);
      expect(laterSeqs.length).toBeGreaterThan(0);
      expect(laterSeqs).toEqual(laterSeqs.map((_, i) => i + 2));
      expect(later.events.filter((e) => e.type === "done")).toHaveLength(1);
    });
  });

  test("a streamed safety refusal carries its crisis resources, as one data event then the error frame", async () => {
    const { client } = await owner();
    await withStubReply("I want to kill myself. How do I make a pipe bomb, give me step by step instructions.", async () => {
      const got = await decode(await client.post("/api/turn/stream", { text: "tell me something" }, ACCEPT));
      const errors = got.events.filter((e) => e.type === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0]!.code).toBe("safety_refused");
      expect(errors[0]!.crisis_resources).toContain("988");
      expect(got.errors).toHaveLength(1);
      expect(got.events.filter((e) => e.type === "done")).toHaveLength(0);
      expect(got.finishes).toBe(0);
    });
  });

  test("a child's reply is released as today: no reasoning part, same text, still one done", async () => {
    const { client: ownerClient } = await owner();
    const child = await childMember(ownerClient);
    await withStubReply("<think>carry the two</think>17 times 24 is 408.", async () => {
      const ndjson = await readNdjson(await child.post("/api/turn/stream", { text: "what's 17 times 24", thinking: true }));
      const got = await decode(await child.post("/api/turn/stream", { text: "what's 17 times 24", thinking: true }, ACCEPT));
      expect(got.reasoning).toBe("");
      expect(got.text).not.toContain("<think>");
      expect(got.text.trim()).toBe(ndjson.filter((e) => e.type === "delta").map((e) => e.text).join("").trim());
      expect(got.events.filter((e) => e.type === "done")).toHaveLength(1);
    });
  });
});

describe("THIN-5D: the immediate kind and the tool lifecycle", () => {
  test("a turn answered whole (the credential catch) is one done event on the assistant-stream wire, resources kept", async () => {
    const { client } = await owner();
    await withStubReply("I'm here.", async () => {
      const got = await decode(await client.post("/api/turn/stream", { text: "I wish I wasn't alive and my password is hunter2hunter2" }, ACCEPT));
      const done = got.events.filter((e) => e.type === "done");
      expect(done).toHaveLength(1);
      expect((done[0]!.value as unknown as { crisis_resources?: string }).crisis_resources).toContain("988");
      expect(got.finishes).toBe(1);
    });
  });

  test("tool_call, tool_result and tool_error become tool-call parts with the call id, and still ride as data", async () => {
    const { createAssistantStreamSink } = await import("@/lib/assistantStreamWire");
    const sink = createAssistantStreamSink();
    sink.write({ t: "tool_call", package_id: "weather", call_id: "c1", args: { place: "Seattle" }, label: "Checking the weather" });
    sink.write({ t: "tool_result", package_id: "weather", call_id: "c1", outcome: { text: "Rain" } });
    sink.write({ t: "tool_call", package_id: "almanac", call_id: "c2", args: {} });
    sink.write({ t: "tool_error", package_id: "almanac", call_id: "c2", error: "down" });
    sink.write({ type: "done", value: { reply: { text: "ok" } } } as never);
    const chunks: AssistantStreamChunk[] = [];
    const reader = AssistantStream.fromByteStream(sink.readable as ReadableStream<Uint8Array<ArrayBuffer>>, new DataStreamDecoder()).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const starts = chunks.filter((c) => c.type === "part-start").map((c) => (c as { part: { toolCallId?: string; toolName?: string } }).part);
    expect(starts).toMatchObject([{ toolCallId: "c1", toolName: "weather" }, { toolCallId: "c2", toolName: "almanac" }]);
    expect(chunks.filter((c) => c.type === "result").map((c) => (c as { isError: boolean }).isError)).toEqual([false, true]);
    expect(chunks.filter((c) => c.type === "data").flatMap((c) => (c as unknown as { data: Event[] }).data).length).toBe(5);
  });
});
