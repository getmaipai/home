// STT-SMARTTURN-01 (speculative start, docs/design/speculative-start-2026-11-11.md): a spoken turn begun on the edge partial is
// held privately; the final transcript's exact match confirms it (storage, speech and tools proceed) or discards it (nothing
// stored, nothing spoken, no tool, no heard prefix, lease released). The architect's conditions each have a test here.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { conversationTurns, people } from "@/db/schema";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __setRoleHealthForTests } from "@/lib/roleHealth";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __resetSpeculationForTests, newSpeculationHold, speculationConfirmed, speculationCounters, speculationRefusal, SPECULATIVE_START_KEY } from "@/lib/speculation";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
  __resetRateLimiterForTests();
  __resetSpeculationForTests();
});

afterEach(() => {
  __setRoleHealthForTests({});
  __resetLlmSupervisorForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

async function owner(): Promise<{ client: TestClient; id: string }> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const row = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  return { client, id: row.id };
}

async function withEngine<T>(firstTokenMs: number, reply: string, fn: () => Promise<T>): Promise<T> {
  __resetLlmSupervisorForTests();
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const stub = startStubLlmServer(0, { scriptedChatReply: async () => { await new Promise((r) => setTimeout(r, firstTokenMs)); return reply; } });
  process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
  try { return await fn(); } finally { await stub.stop(); }
}

async function ndjson(res: Response): Promise<Array<Record<string, unknown>>> {
  return (await res.text()).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

const storedTurns = () => db.select().from(conversationTurns).all().length;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("STT-SMARTTURN-01: the refusal (rule 0 gates first)", () => {
  const adult = { role: "owner", birthdate: null } as never;
  test("off by default: a speculative request is refused with 400 and nothing runs", async () => {
    const { client } = await owner();
    const res = await client.post("/api/turn/stream", { text: "what time is it", spoken: true, speculative: true });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("speculation_refused");
    expect(speculationCounters.refused).toBe(1);
    expect(speculationCounters.started).toBe(0);
  });

  test("a minor, a robot surface, a written turn, a pending ask, an active turn and a long message are each refused", () => {
    const base = { actor: adult, surface: "chat", spoken: true, wordCount: 5, pendingAsk: false, activeTurns: 0, enabled: true };
    expect(speculationRefusal(base)).toBeNull();
    expect(speculationRefusal({ ...base, actor: { role: "child", birthdate: null } as never })).toContain("adults");
    expect(speculationRefusal({ ...base, actor: { role: "teen", birthdate: null } as never })).toContain("adults");
    expect(speculationRefusal({ ...base, surface: "robot" })).toContain("surface");
    expect(speculationRefusal({ ...base, spoken: false })).toContain("spoken");
    expect(speculationRefusal({ ...base, pendingAsk: true })).toContain("confirmation");
    expect(speculationRefusal({ ...base, activeTurns: 1 })).toContain("already running");
    expect(speculationRefusal({ ...base, wordCount: 41 })).toContain("long");
    expect(speculationRefusal({ ...base, enabled: false })).toContain("off");
  });
});

describe("STT-SMARTTURN-01: the held run", () => {
  test("confirm: the held run stores nothing until the final confirms it, then streams its events and stores one row", async () => {
    const { client } = await owner();
    setHouseholdSettingValue(SPECULATIVE_START_KEY, true);
    await withEngine(100, "The held answer arrives.", async () => {
      const started = await client.post("/api/turn/stream", { text: "what is a good name for a grey cat", spoken: true, speculative: true });
      expect(started.status).toBe(200);
      const ids = (await started.json()) as { turn_id: string; resume_token: string; conversation_id: string };
      expect(ids.turn_id).toBeTruthy();
      expect(speculationCounters.started).toBe(1);
      await sleep(900); // the engine has answered by now; the row must still be absent
      expect(storedTurns()).toBe(0);
      const plain = await client.post("/api/turn/stream", { text: "what is a good name for a grey cat", spoken: true, resume_token: ids.resume_token, turn_id: ids.turn_id, conversation_id: ids.conversation_id, resume_from: 0 });
      expect(plain.status).toBe(503); // a resume without the confirmation never releases a held run
      const res = await client.post("/api/turn/stream", { text: "what is a good name for a grey cat", spoken: true, stt_ms: 750, resume_token: ids.resume_token, turn_id: ids.turn_id, conversation_id: ids.conversation_id, resume_from: 0, confirm: true });
      expect(res.status).toBe(200);
      const events = await ndjson(res);
      expect(events[0]?.type).toBe("turn_meta");
      expect(events.filter((e) => e.type === "delta").map((e) => e.text).join("")).toContain("held answer");
      expect(events.filter((e) => e.type === "done")).toHaveLength(1);
      await sleep(200);
      expect(storedTurns()).toBe(1);
      expect(speculationCounters.confirmed).toBe(1);
    });
  }, 20_000);

  test("discard: the held run is dropped whole, nothing is stored, and the next real turn starts at once", async () => {
    const { client } = await owner();
    setHouseholdSettingValue(SPECULATIVE_START_KEY, true);
    await withEngine(400, "An answer nobody hears.", async () => {
      const started = await client.post("/api/turn/stream", { text: "what is a good", spoken: true, speculative: true });
      expect(started.status).toBe(200);
      const ids = (await started.json()) as { turn_id: string; resume_token: string; conversation_id: string };
      const dropped = await client.post(`/api/turn/${encodeURIComponent(ids.turn_id)}/cancel`, { discard: true });
      expect(dropped.status).toBe(200);
      expect(((await dropped.json()) as { cancelled: boolean }).cancelled).toBe(true);
      expect(speculationCounters.discarded).toBe(1);
      const gone = await client.post("/api/turn/stream", { text: "what is a good", spoken: true, resume_token: ids.resume_token, turn_id: ids.turn_id, conversation_id: ids.conversation_id, resume_from: 0, confirm: true });
      expect(gone.status).toBe(503);
      await sleep(700);
      expect(storedTurns()).toBe(0);
      // The real message, right after: the lease was released by the discard, so it runs and is stored.
      const real = await client.post("/api/turn/stream", { text: "what is a good name for a grey cat", spoken: true, conversation_id: ids.conversation_id });
      expect(real.status).toBe(200);
      const events = await ndjson(real);
      expect(events.filter((e) => e.type === "done")).toHaveLength(1);
      await sleep(200);
      expect(storedTurns()).toBe(1);
    });
  }, 20_000);

  test("a tool proposal waits for the confirmation and gives up on a discard or an abort", async () => {
    const confirmed = newSpeculationHold();
    const later = speculationConfirmed(confirmed.promise, new AbortController().signal);
    confirmed.resolve(true);
    expect(await later).toBe(true);
    const discarded = newSpeculationHold();
    const gaveUp = speculationConfirmed(discarded.promise, new AbortController().signal);
    discarded.resolve(false);
    expect(await gaveUp).toBe(false);
    const aborted = new AbortController();
    const waiting = speculationConfirmed(newSpeculationHold().promise, aborted.signal);
    aborted.abort();
    expect(await waiting).toBe(false);
  });
});
