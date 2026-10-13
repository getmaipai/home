// SEARCH-ANSWER-06: a generation that streams text AND calls a tool policy refuses
// (ungrounded_args, unknown_tool) keeps its text as the answer; the canned refusal
// line is only for a generation that produced no text. A failed tool never fails the answer.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "../reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetPortOwnershipForTests } from "@/lib/sidecars";
import { setHouseholdSettingValue } from "@/lib/settings";
import { runTurnNext } from "@/lib/turnMachine/turnNext";
import { __setToolOfferOverridesForTests } from "@/lib/turnMachine/budget";
import { createBenchPeople, type BenchPeople } from "../../scripts/bench/conversationRunner";
import { useDefaultScriptedStack } from "../stackFixture";
import { withStub } from "./toolHarness";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";
import { db } from "@/db";
import { conversationTurns } from "@/db/schema";

const REFUSAL = "I don't actually have that in this conversation, so I won't guess.";
const TEXT = "Casablanca is a 1942 film with Humphrey Bogart.";
let people: BenchPeople;

beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  __resetRateLimiterForTests();
  people = createBenchPeople();
  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
  __setToolOfferOverridesForTests(["show_images"]);
});

afterEach(() => {
  __setToolOfferOverridesForTests(null);
  __resetLlmSupervisorForTests();
  __resetPortOwnershipForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

const call = (name: string, args: object) => [{ id: "call-1", name, args: JSON.stringify(args) }];
const isFirst = (request: { tool_choice?: unknown; messages: { role: string }[] }) => request.tool_choice !== "none" && !request.messages.some((m) => m.role === "tool");

/** An engine whose first tool-bearing round streams `text` and then a tool call in one generation (the stub's own tool-call reply carries no text). */
async function withTextAndCall<T>(text: string, call: { name: string; args: object }, fn: () => Promise<T>): Promise<T> {
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const stub = startStubLlmServer(0, { scriptedChatReply: () => "ok" });
  const enc = new TextEncoder();
  const front = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const raw = req.method === "POST" ? await req.text() : undefined;
      if (raw && url.pathname.endsWith("/chat/completions")) {
        const body = JSON.parse(raw) as ChatCompletionRequest;
        if ((body.tools?.length ?? 0) > 0 && isFirst(body)) {
          const line = (choice: unknown) => enc.encode(`data: ${JSON.stringify({ id: "x", model: "stub-chat", choices: [choice] })}\n\n`);
          const chunks = [
            line({ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }),
            line({ index: 0, delta: { tool_calls: [{ index: 0, id: "call-1", type: "function", function: { name: call.name } }] }, finish_reason: null }),
            line({ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(call.args) } }] }, finish_reason: null }),
            line({ index: 0, delta: {}, finish_reason: "tool_calls" }),
            enc.encode("data: [DONE]\n\n"),
          ];
          return new Response(new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(x)); c.close(); } }), { headers: { "content-type": "text/event-stream" } });
        }
      }
      return fetch(stub.url + url.pathname + url.search, { method: req.method, headers: req.headers, body: raw });
    },
  });
  process.env.MAIPAI_LLAMA_SERVER_URL = `http://127.0.0.1:${front.port}`;
  __resetLlmSupervisorForTests();
  try {
    return await fn();
  } finally {
    front.stop(true);
    await stub.stop();
  }
}
type Stats = { nodes?: { node: string; outcome?: { code?: string; arg?: string; message?: string; draft_discarded?: boolean } }[] };
const statsOf = (turnId: string) => JSON.parse(db.select().from(conversationTurns).where(eq(conversationTurns.id, turnId)).get()!.stats as unknown as string) as Stats;

describe("SEARCH-ANSWER-06: a refused tool call never wipes a streamed answer", () => {
  test("text plus a show_images call with an ungrounded subject keeps the text and stores no argument text", async () => {
    const result = await withTextAndCall(
      TEXT, { name: "show_images", args: { subject: "Zanzibar Quartz" } },
      () => runTurnNext(people.owner, "chat", "tell me about that old film"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    expect(result.value.reply.text).toBe(TEXT);
    const nodes = statsOf(result.value.turn_id).nodes ?? [];
    const policy = nodes.find((n) => n.node === "policy")?.outcome;
    expect(policy?.code).toBe("ungrounded_args");
    // PRIVACY / GROUND-01: traces record the branch and the argument name, never the terms.
    expect(policy?.arg).toBe("subject");
    expect(JSON.stringify(statsOf(result.value.turn_id))).not.toContain("Zanzibar");
    expect(nodes.find((n) => n.node === "model")?.outcome?.draft_discarded).toBe(true);
  });

  test("an unknown tool plus text also keeps the text", async () => {
    const result = await withTextAndCall(
      TEXT, { name: "no_such_tool", args: { x: "y" } },
      () => runTurnNext(people.owner, "chat", "tell me about that old film"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    expect(result.value.reply.text).toBe(TEXT);
  });

  test("a refused call with no streamed text still gets the refusal line", async () => {
    const result = await withStub(
      { reply: () => "", calls: (request) => (isFirst(request) ? call("show_images", { subject: "Zanzibar Quartz" }) : undefined) },
      () => runTurnNext(people.owner, "chat", "tell me about that old film"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    expect(result.value.reply.text).toBe(REFUSAL);
  });
});
