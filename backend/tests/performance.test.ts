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
import { __setStackClientForTests } from "@/lib/stackEngine";

beforeEach(() => {
  resetDb();
  __setStackClientForTests(null);
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

  test("AUDIT-TOOLS-01: the turns panel reports the tool schema offered per turn, and skips turns stored before the field", async () => {
    const { client, row } = await owner();
    const today = new Date().toISOString();
    insertTurn(row.id, today, stats());
    insertTurn(row.id, today, stats({ tools_offered: { count: 4, chars: 2000 } }));
    insertTurn(row.id, today, stats({ tools_offered: { count: 10, chars: 6000 } }));
    insertTurn(row.id, today, stats({ tools_offered: { count: 16, chars: 40000 } }));
    const res = await client.get("/api/performance");
    const body = (await res.json()) as Record<string, any>;
    expect(body.turns.tools_offered).toEqual({ turns: 3, median_count: 10, median_chars: 6000, p95_chars: 40000, max_chars: 40000 });
  });

  test("AUDIT-TOOLS-01: with no recorded tools the panel says so with nulls, not zeros", async () => {
    const { client } = await owner();
    const res = await client.get("/api/performance");
    const body = (await res.json()) as Record<string, any>;
    expect(body.turns.tools_offered).toEqual({ turns: 0, median_count: null, median_chars: null, p95_chars: null, max_chars: null });
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

describe("queue counts come from SQL (AUDIT-PERF-01)", () => {
  test("pending judge turns, embeddings and ingestion work are counted, grouped by reason", async () => {
    const { client, row } = await owner();
    insertTurn(row.id, "2026-01-01T00:00:00.000Z", null);
    insertTurn(row.id, "2026-01-02T00:00:00.000Z", null);
    const { sqlite } = await import("@/db");
    sqlite.exec("PRAGMA foreign_keys = OFF");
    try {
      sqlite.query("INSERT INTO pending_memory_work (memory_id, reason, queued_at) VALUES ('m1','embed_failed','t'),('m2','embed_failed','t'),('m3','dedupe_failed','t')").run();
      sqlite.query("INSERT INTO pending_embeddings (memory_id, queued_at) VALUES ('m1','t'),('m2','t')").run();
    } finally { sqlite.exec("PRAGMA foreign_keys = ON"); }
    const body = (await (await client.get("/api/performance")).json()) as Record<string, any>;
    expect(body.queues.judge).toEqual({ pending: 2, oldest_created_at: "2026-01-01T00:00:00.000Z" });
    expect(body.queues.embedding.pending).toBe(2);
    expect(body.queues.ingestion.pending).toBe(3);
    expect([...body.queues.ingestion.by_reason].sort((a: any, b: any) => a.reason.localeCompare(b.reason))).toEqual([{ reason: "dedupe_failed", count: 1 }, { reason: "embed_failed", count: 2 }]);
  });
});
