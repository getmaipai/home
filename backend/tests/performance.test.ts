// ADMIN-PERF-01: GET /api/performance, the admin dashboard's one
// aggregate read. No new collection - see docs/dev.md's design note and
// lib/performance.ts's own header for what each panel reads.
import { describe, expect, test, beforeEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { owner, teen } from "./support/testAuth";
import { db } from "@/db";
import { conversationTurns } from "@/db/schema";
import { newConversationTurnId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import type { TurnStats } from "@/wire";

beforeEach(() => {
  resetDb();
});

function insertTurn(personId: string, createdAt: string, stats: TurnStats | null): void {
  db.insert(conversationTurns)
    .values({
      id: newConversationTurnId(),
      personId,
      surface: "chat",
      userText: "hi",
      replyText: "hello",
      source: "model",
      safetyAction: "allow",
      minorSpeaker: false,
      createdAt,
      hlc: nextHlc(),
      stats: stats ? JSON.stringify(stats) : null,
    })
    .run();
}

function stats(overrides: Partial<TurnStats> = {}): TurnStats {
  return {
    prompt_tokens: 100,
    predicted_tokens: 50,
    tokens_per_second: 25,
    time_to_first_token_ms: 400,
    total_time_ms: 2000,
    context_tokens: 100,
    cache_reuse_tokens: null,
    cache_reuse_percent: null,
    engine: "local b1 qwen3-8b-instruct-q4-k-m",
    stop_reason: "stop",
    thinking: false,
    generations: [],
    ...overrides,
  };
}

describe("GET /api/performance", () => {
  test("non-admin gets 403", async () => {
    const { client: ownerClient } = await owner();
    const teenClient = await teen(ownerClient);
    const res = await teenClient.get("/api/performance");
    expect(res.status).toBe(403);
  });

  test("empty household: real zeros, not an error, and the stated retention", async () => {
    const { client } = await owner();
    const res = await client.get("/api/performance");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.turns.window_days).toBe(30);
    expect(body.turns.by_day).toHaveLength(30);
    expect(body.turns.by_day.every((d: any) => d.count === 0)).toBe(true);
    expect(body.turns.by_engine).toEqual([]);
    expect(body.queues.judge.pending).toBe(0);
    expect(body.queues.embedding.pending).toBe(0);
    expect(body.labels.turns).toBe(0);
    expect(body.layers.turns_with_trace).toBe(0);
    expect(body.layers.nodes).toEqual([]);
    expect(body.engines.configured).toBe(false);
    expect(body.hardware.configured).toBe(false);
    expect(body.retention_days).toBe(90);
  });

  test("turn stats aggregate into per-day and per-engine medians", async () => {
    const { client, row } = await owner();
    const today = new Date().toISOString();
    insertTurn(row.id, today, stats({ time_to_first_token_ms: 200, total_time_ms: 1000 }));
    insertTurn(row.id, today, stats({ time_to_first_token_ms: 400, total_time_ms: 2000 }));
    insertTurn(row.id, today, stats({ time_to_first_token_ms: 600, total_time_ms: 3000 }));

    const res = await client.get("/api/performance");
    const body = (await res.json()) as Record<string, any>;
    const todayRow = body.turns.by_day.at(-1);
    expect(todayRow.count).toBe(3);
    expect(todayRow.median_ttft_ms).toBe(400);
    expect(todayRow.median_total_ms).toBe(2000);
    expect(body.turns.by_engine).toHaveLength(1);
    expect(body.turns.by_engine[0].engine).toBe("local b1 qwen3-8b-instruct-q4-k-m");
    expect(body.turns.by_engine[0].count).toBe(3);
    const modelRoute = body.turns.by_route.find((r: any) => r.route === "model");
    expect(modelRoute.count).toBe(3);
  });

  test("layers panel is empty until a turn carries U2's per-node trace, then groups by node", async () => {
    const { client, row } = await owner();
    const today = new Date().toISOString();
    // No trace at all: an ordinary old-path turn.
    insertTurn(row.id, today, stats());
    let res = await client.get("/api/performance");
    let body = (await res.json()) as Record<string, any>;
    expect(body.layers.turns_with_trace).toBe(0);
    expect(body.layers.nodes).toEqual([]);

    insertTurn(
      row.id,
      today,
      stats({
        nodes: [
          { node: "safety", impl: "safety-1", version: "1", startMs: 0, endMs: 10, outcome: { ok: true } },
          { node: "model", impl: "model-1", version: "1", startMs: 10, endMs: 210, outcome: { ok: true } },
        ],
      }),
    );
    res = await client.get("/api/performance");
    body = (await res.json()) as Record<string, any>;
    expect(body.layers.turns_with_trace).toBe(1);
    const modelNode = body.layers.nodes.find((n: any) => n.node === "model");
    expect(modelNode.count).toBe(1);
    expect(modelNode.median_ms).toBe(200);
  });

  test("days query param sizes the window, clamped to 90", async () => {
    const { client } = await owner();
    const res7 = await client.get("/api/performance?days=7");
    const body7 = (await res7.json()) as Record<string, any>;
    expect(body7.turns.by_day).toHaveLength(7);

    const resTooBig = await client.get("/api/performance?days=500");
    const bodyTooBig = (await resTooBig.json()) as Record<string, any>;
    expect(bodyTooBig.turns.window_days).toBe(90);
  });
});
