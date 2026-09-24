// REASONING-03 (safety ruling, 2026-09-22): reasoning is a disclosure
// surface built for typed chat's own Reasoning Element, so it is the one
// exception to the turn-path freeze. Two route-level gates, both in
// routes/turn.ts: a minor's turn never even asks the model to think
// (thinking is forced off before runTurnStream() is called, regardless
// of what the client's own `thinking` field claims), and reasoning is
// never sent on a surface other than "chat" (voice/robot/tv/phone have
// no Reasoning Element to disclose it in), adult or not. This is the
// route's own wiring (isMinor/dropReasoning, computed from the real
// actor and the real surface) - turnEngine.test.ts's own "REASONING-01"
// describe block already proves streamTurnEvents() itself drops a
// reasoning event once told to; this file proves the route tells it to
// at the right times, the same "route gate, mirrored by a test one
// layer up from the engine's own" pattern temporaryChat.test.ts already
// uses for TEMP-CHAT-01.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { setHouseholdSettingValue } from "@/lib/settings";
import { db } from "@/db";
import { people } from "@/db/schema";
import type { PersonRow } from "@/types";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";

// U6: the flip, decided (home/docs/dev.md, 2026-09-24) - this file's
// own header names `runTurnStream()`, the old path, by name: pinned
// explicitly now that it is no longer the default.
beforeEach(() => {
  resetDb();
  setHouseholdSettingValue("turn.pipeline.next", false);
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

async function childMember(owner: TestClient, name = "Bramble"): Promise<{ client: TestClient; actor: PersonRow }> {
  const res = await owner.post("/api/people", { displayName: name, role: "child" });
  const { id } = (await res.json()) as { id: string };
  const client = new TestClient();
  await client.post("/api/auth/select", { personId: id });
  const actor = db.select().from(people).where(eq(people.id, id)).get()!;
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
    stub.stop();
    delete process.env.MAIPAI_LLAMA_SERVER_URL;
    __resetLlmSupervisorForTests();
  }
}

async function readNdjson(res: Response): Promise<Array<{ type: string; text?: string; value?: { reply?: { text?: string }; reasoning?: string } }>> {
  const body = await res.text();
  return body
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

const THINK_BLOCK_REPLY = "<think>carry the two</think>17 times 24 is 408.";

describe("POST /api/turn/stream - reasoning never reaches a minor", () => {
  test("a child's turn with thinking on streams no reasoning part and no <think> text, and the reply still arrives", async () => {
    const { client: ownerClient } = await owner();
    const { client: childClient } = await childMember(ownerClient);
    await withStubReply(THINK_BLOCK_REPLY, async () => {
      const res = await childClient.post("/api/turn/stream", { text: "what's 17 times 24", thinking: true });
      const events = await readNdjson(res);
      expect(events.some((e) => e.type === "reasoning")).toBe(false);
      const deltaText = events.filter((e) => e.type === "delta").map((e) => e.text ?? "").join("");
      expect(deltaText).not.toContain("<think>");
      expect(deltaText).toContain("17 times 24 is 408.");
      // The finalized/stored TurnValue.reply.text is unaffected by the
      // wire-level drop (REASONING-01's own engine test: "the stored row
      // still carries the real reasoning, the same as any other actor's
      // turn would") - only the reasoning event and TurnValue.reasoning
      // field are gated, proven below.
      const done = events.find((e) => e.type === "done");
      expect(done?.value?.reasoning).toBeUndefined();
    });
  });

  test("an adult's typed turn still streams reasoning", async () => {
    const { client } = await owner();
    await withStubReply(THINK_BLOCK_REPLY, async (seen) => {
      const res = await client.post("/api/turn/stream", { text: "what's 17 times 24", thinking: true });
      const events = await readNdjson(res);
      expect(seen.requests[0]?.chat_template_kwargs?.enable_thinking).toBe(true);
      const reasoningText = events.filter((e) => e.type === "reasoning").map((e) => e.text ?? "").join("");
      expect(reasoningText).toBe("carry the two");
      const deltaText = events.filter((e) => e.type === "delta").map((e) => e.text ?? "").join("");
      expect(deltaText).toBe("17 times 24 is 408.");
    });
  });

  // Belt and braces: the client is never trusted for this, so the model
  // itself is never asked to think for a minor - `chat_template_kwargs.
  // enable_thinking` (llm.ts's own `!!thinking` mapping onto the real
  // completion request) is the direct proof "runs as instant" means:
  // not just that reasoning never rode the wire, but that it was never
  // generated in the first place.
  test("a minor's turn with thinking: true in the body runs as instant - the model itself is never asked to think", async () => {
    const { client: ownerClient } = await owner();
    const { client: childClient } = await childMember(ownerClient);
    await withStubReply("17 times 24 is 408.", async (seen) => {
      const res = await childClient.post("/api/turn/stream", { text: "what's 17 times 24", thinking: true });
      const events = await readNdjson(res);
      expect(seen.requests[0]?.chat_template_kwargs?.enable_thinking).toBe(false);
      expect(events.some((e) => e.type === "reasoning")).toBe(false);
      const deltaText = events.filter((e) => e.type === "delta").map((e) => e.text ?? "").join("");
      expect(deltaText).toBe("17 times 24 is 408.");
    });
  });
});

describe("POST /api/turn/stream - reasoning never reaches a non-chat surface", () => {
  // "tv"/"phone"/"overlay" 400 with unsupported_surface today
  // (turnEngine.ts's IMPLEMENTED_SURFACES: only "chat" and "robot" are
  // live, 4.5) - robot is the one real non-chat surface to prove this
  // gate against; the others get the identical dropReasoning expression
  // the moment they're implemented, nothing surface-specific to retest.
  test("an adult's turn on the robot surface streams no reasoning part, even with thinking on", async () => {
    const { client } = await owner();
    await withStubReply(THINK_BLOCK_REPLY, async () => {
      const res = await client.post("/api/turn/stream", { text: "what's 17 times 24", thinking: true, surface: "robot" });
      const events = await readNdjson(res);
      expect(events.some((e) => e.type === "reasoning")).toBe(false);
      const deltaText = events.filter((e) => e.type === "delta").map((e) => e.text ?? "").join("");
      expect(deltaText).not.toContain("<think>");
      expect(deltaText).toContain("17 times 24 is 408.");
    });
  });
});

