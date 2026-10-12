// ROUTER-BUILD-01e: the search assist rescue hold. Adult written turns only,
// mode rescue only, bucket over only. The model's own tool call always wins; a
// plain-text round that reaches the end (or the budget) with no call is
// replaced by a search whose query the engine's query writer writes. Nothing
// the assist holds is ever shown, and nothing is held for any other person or mode.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { sqlite, db } from "@/db";
import { conversationTurns, people as peopleTable } from "@/db/schema";
import * as llm from "@/lib/llm";
import { embedQueryForRecall } from "@/lib/memory";
import { setHouseholdSettingValue } from "@/lib/settings";
import { useDefaultScriptedStack, SCRIPTED_EMBED_FILE } from "./stackFixture";
import { embedModelFromFile } from "@/lib/searchAssist/embedIdentity";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __setToolOfferOverridesForTests } from "@/lib/turnMachine/budget";
import { runTurnNextStream } from "@/lib/turnMachine/turnNext";
import { streamTurnEvents } from "@/routes/turn";
import { createBenchPeople, type BenchPeople } from "../scripts/bench/conversationRunner";
import { __setSearchAssistLoaderForTests } from "@/lib/searchAssist/shadow";
import { __resetSearchAssistCountersForTests, searchAssistCounters } from "@/lib/searchAssist/counters";
import { __setSearchAssistHoldClockForTests, SEARCH_ASSIST_HOLD_LIMIT_MS, SEARCH_ASSIST_RESCUE_BUDGET_MS } from "@/lib/turnMachine/nodes/model";
import { newPersonId } from "@/lib/id";
import type { SearchAssistManifest } from "@/lib/searchAssist/weights";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";

let people: BenchPeople;
let teen: BenchPeople["owner"];
let embedSpy: ReturnType<typeof spyOn<typeof llm, "embed">>;

const UTTERANCE = "who won the quokka marathon yesterday";
const PLAIN = "I believe the quokka marathon was won by a local runner last week.";

async function manifestForStubSpace(threshold: number): Promise<SearchAssistManifest> {
  const q = await embedQueryForRecall("probe");
  if (!q) throw new Error("the scripted embedder is unavailable");
  const row = (seed: number) => Array.from({ length: q.dims }, (_, i) => Math.sin(seed + i) * 0.3);
  return {
    embed: { model: embedModelFromFile(SCRIPTED_EMBED_FILE)!, dims: q.dims, preprocess: q.preprocess, prefix: "" },
    features: "alone",
    classes: ["no_tool", "recency", "stable"],
    coef: [row(1), row(2), row(3)],
    intercept: [0, 0, 0],
    thresholds: { websearch: { class: "recency", value: threshold } },
    label_spec_version: "test",
    dataset_sha256: "0".repeat(64),
    bench_record: "test",
  };
}

async function setThreshold(value: number) {
  const manifest = await manifestForStubSpace(value);
  __setSearchAssistLoaderForTests(async () => manifest);
}

beforeEach(async () => {
  resetDb();
  useDefaultScriptedStack();
  __resetSearchAssistCountersForTests();
  people = createBenchPeople();
  const id = newPersonId();
  const now = new Date().toISOString();
  sqlite.query("INSERT INTO people (id, display_name, role, avatar_seed, source, local_only, created_at, updated_at, hlc) VALUES (?, 'Indigo', 'teen', 'seedseedseed', 'bench', 0, ?, ?, 'h')").run(id, now, now);
  teen = db.select().from(peopleTable).where(eq(peopleTable.id, id)).get()!;
  await setThreshold(0); // every adult turn scores "over"
  setHouseholdSettingValue("chat.search_assist", "rescue");
  embedSpy = spyOn(llm, "embed");
});

afterEach(() => {
  embedSpy.mockRestore();
  __setSearchAssistLoaderForTests(null);
  __setSearchAssistHoldClockForTests(null);
  __setToolOfferOverridesForTests(null);
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
  __resetLlmSupervisorForTests();
});

interface Script {
  reply?: string;
  /** The model's own call on the main request (a request carrying tools). */
  call?: { name: string; args: string };
  reasoning?: string;
  /** The query writer's reply (default: a good expression). */
  writer?: string;
}

async function run(actor: BenchPeople["owner"], script: Script) {
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const requests: ChatCompletionRequest[] = [];
  let mainSeen = 0;
  let callSent = false;
  const stub = startStubLlmServer(0, {
    scriptedChatReply: (req: ChatCompletionRequest) => {
      requests.push(req);
      if ((req as { response_format?: unknown }).response_format) return script.writer ?? JSON.stringify({ expression: "quokka marathon winner" });
      mainSeen += 1;
      // Round 1 is the scripted reply; any later round is the answer after the search.
      return mainSeen === 1 ? (script.reply ?? "Done.") : "Final answer from the search.";
    },
    scriptedToolCalls: (req: ChatCompletionRequest) => {
      if (!script.call || !req.tools || req.tools.length === 0 || (req as { response_format?: unknown }).response_format) return undefined;
      if (callSent) return undefined;
      callSent = true;
      return [{ id: "call-0", type: "function" as const, function: { name: script.call.name, arguments: script.call.args } }];
    },
    scriptedReasoning: script.reasoning ? (req: ChatCompletionRequest) => ((req as { response_format?: unknown }).response_format ? undefined : script.reasoning) : undefined,
  });
  process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
  __resetLlmSupervisorForTests();
  try {
    const started = performance.now();
    const stream = await runTurnNextStream(actor, "chat", UTTERANCE);
    if (!stream.ok || stream.kind !== "stream") throw new Error("expected a stream result");
    const events: Array<{ type: string; text?: string; value?: unknown }> = [];
    let firstDeltaMs: number | null = null;
    for await (const event of streamTurnEvents(stream, actor.id)) {
      const e = event as { type: string; text?: string; value?: unknown };
      if (firstDeltaMs === null && (e.type === "delta" || e.type === "reasoning_delta")) firstDeltaMs = performance.now() - started;
      events.push(e);
    }
    const done = events.find((e) => e.type === "done")?.value as { turn_id?: string; reply?: { text: string } } | undefined;
    const row = done?.turn_id ? db.select().from(conversationTurns).where(eq(conversationTurns.id, done.turn_id)).get() : undefined;
    const stats = row?.stats ? (JSON.parse(row.stats) as { search_assist?: { action: string } }) : {};
    const mainRequests = requests.filter((r) => !(r as { response_format?: unknown }).response_format && r.tools && r.tools.length > 0);
    const writerRequests = requests.filter((r) => (r as { response_format?: unknown }).response_format);
    const deltaText = events.filter((e) => e.type === "delta").map((e) => e.text).join("");
    return { events, deltaText, action: stats.search_assist?.action, mainRequests, writerRequests, firstDeltaMs, reply: done?.reply?.text };
  } finally {
    await stub.stop();
  }
}

describe("search assist rescue hold", () => {
  test("plain text on an over turn is rescued: a writer query, nothing of the held text shown", async () => {
    const r = await run(people.owner, { reply: PLAIN });
    expect(r.action).toBe("rescued");
    expect(r.writerRequests.length).toBe(1);
    expect(r.deltaText).not.toContain("quokka marathon was won");
    expect(searchAssistCounters()["search_assist.rescued"]).toBe(1);
    expect(searchAssistCounters()["search_assist.rescued_at_budget"] ?? 0).toBe(0);
  });

  test("the model's own websearch call wins: no writer, no rescue", async () => {
    const r = await run(people.owner, { call: { name: "websearch", args: JSON.stringify({ expression: "quokka marathon" }) } });
    expect(r.action).toBe("declined_tool_call");
    expect(r.writerRequests.length).toBe(0);
    expect(searchAssistCounters()["search_assist.rescued"] ?? 0).toBe(0);
  });

  test("an other-tool call also wins and is not rescued", async () => {
    const r = await run(people.owner, { call: { name: "get_time", args: "{}" } });
    expect(r.action).toBe("declined_tool_call");
    expect(r.writerRequests.length).toBe(0);
  });

  test("under the threshold nothing is armed: the text is shown as today", async () => {
    await setThreshold(1);
    const r = await run(people.owner, { reply: PLAIN });
    expect(r.action ?? "none").toBe("none");
    expect(r.writerRequests.length).toBe(0);
    expect(r.deltaText).toContain("quokka marathon was won");
  });

  test("shadow and off modes never hold", async () => {
    for (const mode of ["shadow", "off"] as const) {
      setHouseholdSettingValue("chat.search_assist", mode);
      const r = await run(people.owner, { reply: PLAIN });
      expect(r.action ?? "none").toBe("none");
      expect(r.writerRequests.length).toBe(0);
      expect(r.deltaText).toContain("quokka marathon was won");
    }
  });

  test("a child and a teen are never held or rescued", async () => {
    for (const actor of [people.child, teen]) {
      const r = await run(actor, { reply: PLAIN });
      expect(r.action ?? "none").toBe("none");
      expect(r.writerRequests.length).toBe(0);
      expect(r.deltaText).toContain("quokka marathon was won");
    }
    expect(searchAssistCounters()["search_assist.rescued"] ?? 0).toBe(0);
  });

  test("a query writer that gives no expression is not counted as a rescue", async () => {
    const r = await run(people.owner, { reply: PLAIN, writer: JSON.stringify({ expression: null }) });
    expect(r.writerRequests.length).toBe(1);
    expect(r.action === "rescued").toBe(false);
    expect(searchAssistCounters()["search_assist.rescued"] ?? 0).toBe(0);
  });

  test("a stream that dies while text is held never shows the held text", async () => {
    let mainRequests = 0;
    const encoder = new TextEncoder();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname !== "/v1/chat/completions") return Response.json({ data: [{ embedding: new Array(8).fill(0.1) }] });
        const body = (await req.json()) as ChatCompletionRequest;
        if ((body as { response_format?: unknown }).response_format) return Response.json({ choices: [{ message: { content: JSON.stringify({ expression: "x" }) }, finish_reason: "stop" }] });
        mainRequests += 1;
        if (mainRequests > 1) {
          const ok = `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "Second try works." }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;
          return new Response(ok, { headers: { "content-type": "text/event-stream" } });
        }
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "Held words that never show" }, finish_reason: null }] })}\n\n`));
            setTimeout(() => c.error(new Error("engine dropped")), 20);
          },
        });
        return new Response(stream, { headers: { "content-type": "text/event-stream" } });
      },
    });
    process.env.MAIPAI_LLAMA_SERVER_URL = `http://127.0.0.1:${server.port}`;
    __resetLlmSupervisorForTests();
    try {
      const stream = await runTurnNextStream(people.owner, "chat", UTTERANCE);
      if (!stream.ok || stream.kind !== "stream") throw new Error("expected a stream result");
      const texts: string[] = [];
      for await (const event of streamTurnEvents(stream, people.owner.id)) {
        const e = event as { type: string; text?: string };
        if (e.type === "delta" && e.text) texts.push(e.text);
      }
      expect(texts.join("")).not.toContain("Held words that never show");
      expect(mainRequests).toBeGreaterThan(0);
    } finally {
      await server.stop(true);
    }
  });

  test("an envelope that ends as text is rescued", async () => {
    const r = await run(people.owner, { reply: '{"answer": "a local runner won"}' });
    expect(r.action).toBe("rescued");
    expect(r.deltaText).not.toContain("local runner");
  });

  test("a tag start is left to the normal path", async () => {
    const r = await run(people.owner, { reply: "<think>hmm</think>A local runner won." });
    expect(r.action === "rescued").toBe(false);
  });

  test("reasoning streams live while the content channel is held", async () => {
    const r = await run(people.owner, { reply: PLAIN, reasoning: "thinking about the marathon" });
    expect(r.action).toBe("rescued");
    expect(r.events.some((e) => e.type === "reasoning_delta" || e.type === "reasoning")).toBe(true);
  });

  test("text past the budget is cut and rescued, counted as rescued_at_budget", async () => {
    let calls = 0;
    __setSearchAssistHoldClockForTests(() => (calls++ === 0 ? 0 : SEARCH_ASSIST_RESCUE_BUDGET_MS + 1));
    const r = await run(people.owner, { reply: "one two three four five six seven eight nine ten" });
    expect(r.action).toBe("rescued");
    expect(r.writerRequests.length).toBe(1);
    expect(searchAssistCounters()["search_assist.rescued_at_budget"]).toBe(1);
  });

  test("whitespace held past the limit is flushed and the hold stands down", async () => {
    let t = 0;
    __setSearchAssistHoldClockForTests(() => (t += SEARCH_ASSIST_HOLD_LIMIT_MS));
    const r = await run(people.owner, { reply: "  \n  \n  \n  a local runner won the marathon yesterday" });
    expect(r.writerRequests.length).toBe(0);
    expect(r.action === "rescued").toBe(false);
  });

  test("the rescue costs no extra embed and no query writer call off the rescue path", async () => {
    setHouseholdSettingValue("chat.search_assist", "off");
    embedSpy.mockClear();
    await run(people.owner, { reply: PLAIN });
    const offEmbeds = embedSpy.mock.calls.length;
    setHouseholdSettingValue("chat.search_assist", "rescue");
    embedSpy.mockClear();
    const r = await run(people.owner, { reply: PLAIN });
    expect(r.action).toBe("rescued");
    expect(embedSpy.mock.calls.length).toBe(offEmbeds);
    const tool = await run(people.owner, { call: { name: "websearch", args: JSON.stringify({ expression: "x" }) } });
    expect(tool.writerRequests.length).toBe(0);
  });

  test("the hold budget is a named, bounded constant and a held turn still ends", async () => {
    expect(SEARCH_ASSIST_HOLD_LIMIT_MS).toBeLessThanOrEqual(250);
    expect(SEARCH_ASSIST_RESCUE_BUDGET_MS).toBeGreaterThan(0);
    expect(SEARCH_ASSIST_RESCUE_BUDGET_MS).toBeLessThanOrEqual(6000);
  });

  test("time to first visible output, rescue off vs armed-but-not-needed (printed, p50/p95)", async () => {
    const sample = async (mode: "off" | "rescue", n: number) => {
      setHouseholdSettingValue("chat.search_assist", mode);
      const times: number[] = [];
      for (let i = 0; i < n; i++) {
        const r = await run(people.owner, { call: { name: "websearch", args: JSON.stringify({ expression: "x" }) }, reasoning: "check the news" });
        if (r.firstDeltaMs !== null) times.push(r.firstDeltaMs);
      }
      times.sort((a, b) => a - b);
      return { p50: times[Math.floor(times.length * 0.5)] ?? -1, p95: times[Math.min(times.length - 1, Math.floor(times.length * 0.95))] ?? -1, n: times.length };
    };
    const off = await sample("off", 12);
    const on = await sample("rescue", 12);
    console.log(`TTFV tool-first turn (ms) off p50=${off.p50.toFixed(1)} p95=${off.p95.toFixed(1)} | rescue p50=${on.p50.toFixed(1)} p95=${on.p95.toFixed(1)} (n=${off.n}/${on.n})`);
    expect(on.p95).toBeLessThan(off.p95 + 250);
    // A rescued turn waits for the end of the round (or the budget) before its first visible output.
    const plain = async (mode: "off" | "rescue") => {
      setHouseholdSettingValue("chat.search_assist", mode);
      const t: number[] = [];
      for (let i = 0; i < 12; i++) t.push((await run(people.owner, { reply: PLAIN })).firstDeltaMs ?? -1);
      t.sort((a, b) => a - b);
      return `p50=${t[6]!.toFixed(1)} p95=${t[11]!.toFixed(1)}`;
    };
    console.log(`TTFV plain-text turn (ms, stub is instant) off ${await plain("off")} | rescued ${await plain("rescue")}`);
  });
});
