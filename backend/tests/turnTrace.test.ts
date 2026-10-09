import { beforeEach, describe, expect, test } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { child, owner, teen } from "./support/testAuth";
import { db } from "@/db";
import { conversationTurns, conversations, people } from "@/db/schema";
import { newConversationTurnId, newConversationId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import type { TurnStats } from "@/wire";

beforeEach(resetDb);

function addTurn(personId: string, minorSpeaker: boolean, mode: "chat" | "temporary" = "chat") {
  const conversationId = newConversationId();
  db.insert(conversations).values({ id: conversationId, personId, surface: "chat", mode, hlc: nextHlc(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).run();
  const id = newConversationTurnId();
  const stats: TurnStats = {
    prompt_tokens: 10, predicted_tokens: 2, tokens_per_second: 1, time_to_first_token_ms: 5, total_time_ms: 20,
    context_tokens: 10, cache_reuse_tokens: null, cache_reuse_percent: null, engine: "engine-private", stop_reason: "stop", thinking: false,
    generations: [{ reason: "private reason", thinking: false, max_tokens: 5, prompt_n: 10, cache_n: null, prompt_ms: 2, predicted_n: 2, predicted_ms: 5, request_sent_ms: 10, first_delta_ms: 12, error: "private generation detail" }],
    nodes: [{ node: "model", impl: "engine-internal", version: "4", startMs: 100, endMs: 120, outcome: { ok: false, code: "ENGINE_SECRET", message: "private message" }, reasoning: { emitted: false, withheld_for: "minor" } }],
  };
  db.insert(conversationTurns).values({ id, personId, conversationId, surface: "chat", userText: "private words", replyText: "private answer", source: "model", safetyAction: "allow", minorSpeaker, createdAt: new Date().toISOString(), hlc: nextHlc(), stats: JSON.stringify(stats), outcomes: JSON.stringify([{ packageId: "pkg-safe-name", args: { secret: "never" }, reason: "never", result: "never", status: "succeeded", durationMs: 8, at: new Date(110).toISOString() }]) }).run();
  return id;
}

describe("GET /api/admin/turns/:id/trace", () => {
  test("non-admin receives 403", async () => {
    const { client } = await owner();
    const teenClient = await teen(client);
    expect((await teenClient.get(`/api/admin/turns/${newConversationTurnId()}/trace`)).status).toBe(403);
  });

  test("missing and temporary turns are hidden", async () => {
    const { client, row } = await owner();
    expect((await client.get(`/api/admin/turns/${newConversationTurnId()}/trace`)).status).toBe(404);
    const temporary = addTurn(row.id, false, "temporary");
    expect((await client.get(`/api/admin/turns/${temporary}/trace`)).status).toBe(404);
  });

  test("adult admin sees timings and engine code, never stored content", async () => {
    const { client, row } = await owner();
    const id = addTurn(row.id, false);
    const response = await client.get(`/api/admin/turns/${id}/trace`);
    expect(response.status).toBe(200);
    const body = await response.json() as { spans: Array<{ depth: number }> };
    const serialized = JSON.stringify(body);
    expect(serialized).toContain("ENGINE_SECRET");
    for (const secret of ["private words", "private answer", "private message", "private generation detail", "never", "engine-private"]) expect(serialized).not.toContain(secret);
    expect(body.spans.map((span: any) => span.depth)).toEqual([0, 1, 1]);
  });

  test.each(["child", "teen"] as const)("%s recorded turn omits error codes", async (role) => {
    const { client, row: ownerRow } = await owner();
    const person = role === "child" ? await child(client) : null;
    if (role === "teen") await teen(client);
    const minorRow = role === "child" ? person!.row : db.select().from(people).all().find((entry) => entry.id !== ownerRow.id)!;
    const id = addTurn(minorRow!.id, true);
    const response = await client.get(`/api/admin/turns/${id}/trace`);
    expect(response.status).toBe(200);
    const serialized = JSON.stringify(await response.json());
    expect(serialized).not.toContain("ENGINE_SECRET");
    expect(serialized).not.toContain("private");
    expect(serialized).not.toContain("never");
  });
});
