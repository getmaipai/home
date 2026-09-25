// U6a (docs/plans/simple-turn-pipeline-2026-09-22.md; the coordinator's
// ruling, 2026-09-23): one boundary, no second one. routes/turn.ts reads
// turn.pipeline.next per request (POST / and POST /stream both) and
// calls runTurnNext when it is on, runTurnStream (or runTurn) otherwise -
// the same setting conversationRunner.ts's bench harness already reads
// the same way. Proven here at the route: with the setting off, a turn
// runs the frozen path (spied by the absence of the new path's own
// stats.nodes[] trace, the one thing only runTurnNext's machine writes);
// with it on, the new path (the trace present, all eight node names);
// the response's own event shape (turn_meta, signal, at least one
// delta, done, in that order - STREAM-NEXT-01's own real streaming for
// the new path too) is identical either way.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { setHouseholdSettingValue } from "@/lib/settings";
import { db } from "@/db";
import { people, conversationTurns } from "@/db/schema";
import type { PersonRow } from "@/types";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";

beforeEach(() => resetDb());
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

async function withStubReply<T>(reply: string, fn: (seen: { requests: ChatCompletionRequest[] }) => Promise<T>): Promise<T> {
  __resetLlmSupervisorForTests();
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const seen = { requests: [] as ChatCompletionRequest[] };
  const stub = startStubLlmServer(0, {
    scriptedChatReply: (request) => {
      seen.requests.push(request);
      return reply;
    },
  });
  process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
  try {
    return await fn(seen);
  } finally {
    await stub.stop();
    delete process.env.MAIPAI_LLAMA_SERVER_URL;
    __resetLlmSupervisorForTests();
  }
}

async function readNdjson(res: Response): Promise<Array<{ type: string; value?: { turn_id?: string } }>> {
  const body = await res.text();
  return body
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

function storedNodeNames(turnId: string): string[] | undefined {
  const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, turnId)).get();
  if (!row || row.stats === null) return undefined;
  const stats = JSON.parse(row.stats as unknown as string) as { nodes?: { node: string }[] };
  return stats.nodes?.map((n) => n.node);
}

describe("POST /api/turn/stream - U6a, the one path-deciding boundary", () => {
  test("with turn.pipeline.next off, a turn runs the frozen path - no stats.nodes trace at all", async () => {
    setHouseholdSettingValue("turn.pipeline.next", false);
    const { client } = await owner();
    await withStubReply("Hello! How can I help?", async () => {
      const res = await client.post("/api/turn/stream", { surface: "chat", text: "hi" });
      const events = await readNdjson(res);
      const types = events.map((e) => e.type);
      // A real streamed reply can arrive in one or several delta chunks,
      // depending on the stub's own chunking - never asserted as an exact
      // count, only the contract's own fixed shape: turn_meta first,
      // signal next, at least one delta, done last.
      expect(types[0]).toBe("turn_meta");
      expect(types[1]).toBe("signal");
      expect(types.at(-1)).toBe("done");
      expect(types).toContain("delta");
      const turnId = (events.find((e) => e.type === "done") as { value?: { turn_id: string } })?.value?.turn_id;
      expect(storedNodeNames(turnId!)).toBeUndefined();
    });
  });

  // STREAM-NEXT-01: this used to assert exactly ["turn_meta", "signal",
  // "done"] - true only because runTurnNext() always resolved
  // "immediate" and the whole reply arrived as one batched blob, the
  // defect STREAM-NEXT-01 exists to fix. The route now calls
  // runTurnNextStream(), so the new path's own event shape genuinely
  // matches the off case's (turn_meta, signal, at least one delta,
  // done) - proven the identical way the off case's own test above
  // already does, never asserting an exact delta count (the stub's own
  // chunking, never this route's contract).
  test("with turn.pipeline.next on, the same turn runs the new path - stats.nodes carries all eight nodes, and the event shape is turn_meta/signal/delta.../done, the same shape the off case has", async () => {
    setHouseholdSettingValue("turn.pipeline.next", true);
    setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
    const { client } = await owner();
    await withStubReply("Hello! How can I help?", async () => {
      const res = await client.post("/api/turn/stream", { surface: "chat", text: "hi" });
      const events = await readNdjson(res);
      const types = events.map((e) => e.type);
      expect(types[0]).toBe("turn_meta");
      expect(types[1]).toBe("signal");
      expect(types.at(-1)).toBe("done");
      expect(types).toContain("delta");
      const turnId = (events.find((e) => e.type === "done") as { value?: { turn_id: string } })?.value?.turn_id;
      const nodeNames = storedNodeNames(turnId!);
      for (const expected of ["safety", "commands", "context", "model", "policy", "tool", "answer", "output_gate"]) {
        expect(nodeNames).toContain(expected);
      }
    });
  });
});

describe("POST /api/turn/stream - bare mode stays on the frozen path regardless of the setting", () => {
  // A code review caught this before landing: checking newPathOn() before
  // body.bare would silently route a bare-mode admin-comparison request
  // (ADMIN-COMPARE-01: the raw model, no persona, no routing, no
  // packages) through the full new-path pipeline instead - a debug
  // feature quietly comparing against the wrong thing, no error at all.
  test("bare: true with turn.pipeline.next on still runs the frozen bare path, never the new one", async () => {
    setHouseholdSettingValue("turn.pipeline.next", true);
    setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
    const { client } = await owner();
    await withStubReply("hi", async () => {
      const res = await client.post("/api/turn/stream", { surface: "chat", text: "hi", bare: true });
      const events = await readNdjson(res);
      // turnBareStream.ts's own construction is the only place that ever
      // sets `bare: true` on a TurnValue (turnBareStream.ts, not
      // routes/turn.ts) - runTurnNext has no concept of bare mode at all,
      // so its presence on the done event is direct proof the frozen
      // bare path ran, not the new one, whatever the setting says.
      const value = (events.find((e) => e.type === "done") as { value?: { bare?: boolean } })?.value;
      expect(value?.bare).toBe(true);
    });
  });
});

describe("POST /api/turn - U6a's non-stream twin", () => {
  test("with turn.pipeline.next off, the response is the ordinary TurnValue shape", async () => {
    setHouseholdSettingValue("turn.pipeline.next", false);
    const { client } = await owner();
    await withStubReply("Hello! How can I help?", async () => {
      const res = await client.post("/api/turn", { surface: "chat", text: "hi" });
      const value = (await res.json()) as { reply: { text: string }; turn_id: string };
      expect(value.reply.text.length).toBeGreaterThan(0);
      expect(storedNodeNames(value.turn_id)).toBeUndefined();
    });
  });

  test("with turn.pipeline.next on, the response is the identical TurnValue shape, from the new path", async () => {
    setHouseholdSettingValue("turn.pipeline.next", true);
    setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
    const { client } = await owner();
    await withStubReply("Hello! How can I help?", async () => {
      const res = await client.post("/api/turn", { surface: "chat", text: "hi" });
      const value = (await res.json()) as { reply: { text: string }; turn_id: string };
      expect(value.reply.text.length).toBeGreaterThan(0);
      expect(storedNodeNames(value.turn_id)).toBeDefined();
    });
  });

  // THINK-DEFAULT-01 (dev.md "U6 rerun ruling" (b) 1): the new path's
  // default is 0 (thinking off) just like the old path's own
  // RunTurnOpts.thinking, absent unless the request's own body.thinking
  // asks for it - proven here at the route, the same boundary this
  // file's own header names.
  test("with turn.pipeline.next on and no body.thinking, the new path sends thinking:false", async () => {
    setHouseholdSettingValue("turn.pipeline.next", true);
    setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
    const { client } = await owner();
    await withStubReply("Hello! How can I help?", async (seen) => {
      const res = await client.post("/api/turn", { surface: "chat", text: "hi" });
      expect(res.status).toBe(200);
      expect(seen.requests[0]?.chat_template_kwargs?.enable_thinking).toBe(false);
    });
  });

  test("with turn.pipeline.next on and body.thinking: true, the new path sends thinking:true", async () => {
    setHouseholdSettingValue("turn.pipeline.next", true);
    setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
    const { client } = await owner();
    await withStubReply("Hello! How can I help?", async (seen) => {
      const res = await client.post("/api/turn", { surface: "chat", text: "hi", thinking: true });
      expect(res.status).toBe(200);
      expect(seen.requests[0]?.chat_template_kwargs?.enable_thinking).toBe(true);
    });
  });
});
