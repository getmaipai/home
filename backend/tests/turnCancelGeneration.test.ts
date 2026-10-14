import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { conversationTurns, people } from "@/db/schema";
import { eq } from "drizzle-orm";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { setHouseholdSettingValue } from "@/lib/settings";
import { startStackFixture, IDENTITY_HEADERS } from "./stackFixture";
import type { StackFixture } from "./stackFixture";
import { isStaleTurnGeneration, staleGenerationEvent } from "@/routes/turn";

beforeEach(() => { resetDb(); __resetLlmSupervisorForTests(); __resetRateLimiterForTests(); __resetThrottleForTests(); });
afterEach(() => { __resetStackEngineForTests(); });

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return { client, actor: db.select().from(people).where(eq(people.displayName, "Sage")).get()! };
}
async function readNdjson(res: Response) {
  const text = await res.text();
  return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, any>);
}
async function firstTurnId(res: Response) {
  const reader = res.body!.getReader();
  const chunk = await reader.read();
  const event = JSON.parse(new TextDecoder().decode(chunk.value).trim().split("\n")[0]!) as { turn_id: string };
  return event.turn_id;
}

describe("turn cancellation generations", () => {
  test("a done that races a cancel still closes the stream as cancelled", () => {
    expect(staleGenerationEvent({ type: "done", value: {} } as never, true)).toMatchObject({ type: "error", error: "cancelled", code: "turn_cancelled" });
  });

  test("after a cancel, no chunk of the cancelled generation is written to the socket", async () => {
    const { client } = await owner();
    const response = await client.post("/api/turn/stream", { text: "wait for me" });
    const reader = response.body!.getReader();
    const first = await reader.read();
    const meta = JSON.parse(new TextDecoder().decode(first.value).trim().split("\n")[0]!) as { turn_id: string };
    let beforeCancel = "";
    const waitDeadline = Date.now() + 5_000;
    while (!beforeCancel.includes('"type":"status"') && Date.now() < waitDeadline) {
      const item = await reader.read();
      if (item.done) break;
      beforeCancel += new TextDecoder().decode(item.value);
    }
    const cancelled = await client.post(`/api/turn/${meta.turn_id}/cancel`, {});
    expect(await cancelled.json()).toEqual({ cancelled: true });
    const remaining = await readNdjson(new Response(new ReadableStream({ async start(controller) { for (;;) { const item = await reader.read(); if (item.done) break; controller.enqueue(item.value); } controller.close(); } })));
    expect(remaining.filter((event) => event.type === "delta" || event.type === "reasoning" || event.type === "status" || event.type === "spoken_cue").filter((event) => event.generation === 0)).toEqual([]);
    expect(remaining.at(-1)).toMatchObject({ type: "error", code: "turn_cancelled" });
  }, 10_000);

  test("a cancel stores only text that reached the wire", async () => {
    const { client } = await owner();
    const response = await client.post("/api/turn/stream", { text: "say a short answer" });
    const reader = response.body!.getReader();
    let turnId = "";
    let released = "";
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      for (const line of new TextDecoder().decode(item.value).trim().split("\n")) {
        if (!line) continue;
        const event = JSON.parse(line) as { type: string; turn_id?: string; text?: string };
        if (event.type === "turn_meta") turnId = event.turn_id!;
        if (event.type === "delta") { released += event.text ?? ""; break; }
      }
      if (released) break;
    }
    expect(released.length).toBeGreaterThan(0);
    await client.post(`/api/turn/${turnId}/cancel`, {});
    await new Response(new ReadableStream({ async start(controller) { for (;;) { const item = await reader.read(); if (item.done) break; controller.enqueue(item.value); } controller.close(); } })).text();
    const stored = db.select().from(conversationTurns).where(eq(conversationTurns.id, turnId)).get();
    expect(stored?.replyText).toBe(released.trim());
  }, 10_000);

  test("a turn that is not cancelled stores byte-identical text to before", async () => {
    const { client } = await owner();
    const events = await readNdjson(await client.post("/api/turn/stream", { text: "say a short answer" }));
    const turnId = events.find((event) => event.type === "turn_meta")!.turn_id as string;
    const reply = events.find((event) => event.type === "done")!.value.reply.text as string;
    const stored = db.select().from(conversationTurns).where(eq(conversationTurns.id, turnId)).get();
    expect(stored?.replyText).toBe(reply);
  });

  test("a second cancel is a no-op", async () => {
    const { client } = await owner();
    const response = await client.post("/api/turn/stream", { text: "cancel twice and wait" });
    const turnId = await firstTurnId(response);
    expect(await (await client.post(`/api/turn/${turnId}/cancel`, {})).json()).toEqual({ cancelled: true });
    expect(await (await client.post(`/api/turn/${turnId}/cancel`, {})).json()).toEqual({ cancelled: false });
    expect(isStaleTurnGeneration(turnId, 0)).toBe(true);
    expect(isStaleTurnGeneration(turnId, 1)).toBe(false);
  });

  test("a cancel with nothing active is a no-op", async () => {
    const { client } = await owner();
    const finished = await client.post("/api/turn/stream", { text: "hello" });
    const events = await readNdjson(finished);
    const turnId = events.find((event) => event.type === "turn_meta")!.turn_id;
    expect(await (await client.post(`/api/turn/${turnId}/cancel`, {})).json()).toEqual({ cancelled: false });
    expect(await (await client.post("/api/turn/not-a-real-turn/cancel", {})).json()).toMatchObject({ error: "Turn not found" });
  });

  test("the done event carries latency fields on a scripted turn", async () => {
    const { client } = await owner();
    const events = await readNdjson(await client.post("/api/turn/stream", { text: "hello", stt_ms: 420 }));
    const latency = events.find((event) => event.type === "done")!.value.latency;
    expect(Object.keys(latency).sort()).toEqual(["e2e_ms", "first_token_ms", "stt_ms", "tts_ttfa_ms"]);
    expect(latency).toMatchObject({ stt_ms: 420, tts_ttfa_ms: null });
    expect(latency.first_token_ms === null || typeof latency.first_token_ms === "number").toBe(true);
    if (latency.first_token_ms !== null) expect(latency.e2e_ms).toBeGreaterThanOrEqual(latency.first_token_ms);
  });

  test("the turn log never contains transcript text", async () => {
    const { client } = await owner();
    const sentinel = "zq-sentinel-4471";
    const lines: string[] = [];
    const spies = [spyOn(console, "log"), spyOn(console, "info"), spyOn(console, "warn"), spyOn(console, "error")];
    spies.forEach((spy) => spy.mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(" ")); }));
    try { await client.post("/api/turn/stream", { text: `say ${sentinel}` }); }
    finally { spies.forEach((spy) => spy.mockRestore()); }
    expect(lines.join("\n")).not.toContain(sentinel);
  });

  test("tts drops a sentence from a stopped generation", async () => {
    const { client } = await owner();
    const scripted = (await import("./stackFixture")).getDefaultScriptedStack();
    const priorRequests = scripted.calls.filter((call) => call === "POST /v1/chat/completions").length;
    const response = await client.post("/api/turn/stream", { text: "wait for me" });
    const turnId = await firstTurnId(response);
    const deadline = Date.now() + 5_000;
    while (scripted.calls.filter((call) => call === "POST /v1/chat/completions").length === priorRequests && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    const cancel = await client.post(`/api/turn/${turnId}/cancel`, {});
    expect(cancel.status).toBe(200);
    expect(await cancel.json()).toEqual({ cancelled: true });
    expect(isStaleTurnGeneration(turnId, 0)).toBe(true);
    const tts = await client.post("/api/tts", { text: "sentence", turn_id: turnId, generation: 0 });
    expect(tts.status).toBe(409);
    expect(await tts.json()).toMatchObject({ code: "turn_cancelled", error: "That reply was stopped, so this sentence was not spoken. Ask again to hear a new answer." });
  });

  test("another person's turn id never changes what tts does", async () => {
    const { client } = await owner();
    let calls = 0;
    const fixture: StackFixture = startStackFixture({ "POST /v1/audio/speech": async () => { calls++; return new Response(new Uint8Array(44), { headers: { "content-type": "audio/wav", ...IDENTITY_HEADERS } }); } });
    setHouseholdSettingValue("engines.stack.url", fixture.url);
    __setStackClientForTests(fixture.client);
    try {
      const childRes = await client.post("/api/people", { displayName: "Bramble", role: "child" });
      const child = (await childRes.json() as { id: string }).id;
      const childClient = new TestClient();
      await childClient.post("/api/auth/select", { personId: child });
      const turnId = await firstTurnId(await childClient.post("/api/turn/stream", { text: "wait" }));
      const tts = await client.post("/api/tts", { text: "hello", turn_id: turnId, generation: 0 });
      expect(tts.status).toBe(200);
      expect(calls).toBe(1);
      expect(tts.headers.get("x-maipai-tts-ttfa-ms")).toMatch(/^\d+$/);
    } finally { fixture.stop(); }
  });
});
