import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { conversationTurns, conversations, people } from "@/db/schema";
import { createConversation } from "@/lib/conversationHistory";
import type { TurnStats } from "@/wire";
import type { PersonRow } from "@/types";
import { newConversationTurnId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { owner, child, teen } from "./support/testAuth";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());

const nodeNames = ["safety", "commands", "context", "model", "policy", "tool", "answer", "output_gate"] as const;
const createdAt = "2026-10-06T18:00:00.000Z";

function traceStats(): TurnStats {
  const nodes = nodeNames.map((node, index) => ({
    node,
    impl: `${node}-impl`,
    version: "v1",
    startMs: index * 10,
    endMs: index * 10 + 5,
    outcome: index === 3
      ? { ok: false as const, code: "engine_fault_code", arg: "PRIVATE-ARG", message: "PRIVATE-DIAGNOSTIC" }
      : index === 5
        ? { ok: false as const, code: "tool_internal", arg: "PRIVATE-TOOL-ARG", message: "PRIVATE-TOOL-DIAGNOSTIC" }
        : index === 1
        ? { skipped: true as const, reason: "PRIVATE-SKIP-REASON" }
        : { ok: true as const },
    ...(index === 3 ? { reasoning: { emitted: true, withheld_for: null } } : {}),
  }));
  return {
    prompt_tokens: 10, predicted_tokens: 5, tokens_per_second: 3, time_to_first_token_ms: 20, total_time_ms: 100, context_tokens: 20,
    cache_reuse_tokens: null, cache_reuse_percent: null, engine: "local", stop_reason: "stop", thinking: false,
    generations: [{
      reason: "answer", thinking: false, max_tokens: null, prompt_n: null, cache_n: null, prompt_ms: 10, predicted_n: 3, predicted_ms: 15,
      request_sent_ms: 40, first_delta_ms: 60, error: null, tool_call_raw_args: "PRIVATE-GENERATION-ARGS",
    }],
    nodes: nodes as unknown as TurnStats["nodes"],
  };
}

function insertTrace(person: PersonRow, conversationId: string, minorSpeaker: boolean): string {
  const id = newConversationTurnId();
  db.insert(conversationTurns).values({
    id,
    personId: person.id,
    conversationId,
    surface: "chat",
    userText: "PRIVATE-USER-TEXT",
    replyText: "PRIVATE-REPLY-TEXT",
    source: "model",
    safetyAction: "allow",
    minorSpeaker,
    createdAt,
    hlc: nextHlc(),
    status: "done",
    stats: JSON.stringify(traceStats()),
    outcomes: JSON.stringify([{ callId: "PRIVATE-CALL-ID", packageId: "private-package", status: "failed", args: { prompt: "PRIVATE-TOOL-ARGS" }, result: { text: "PRIVATE-TOOL-RESULT" }, errorCode: "tool_fault", durationMs: 9, at: "2026-10-06T18:00:00.090Z" }]),
  }).run();
  return id;
}

function conversationFor(person: PersonRow): string {
  const result = createConversation(person, { surface: "chat" });
  if (!result.ok) throw new Error("conversation fixture failed");
  return result.value.id;
}

describe("GET /api/admin/turns/:id/trace", () => {
  test("403 for every role except owner and admin", async () => {
    const { client } = await owner();
    const row = db.select().from(people).where(eq(people.displayName, "Sage")).get()! as PersonRow;
    const turnId = insertTrace(row, conversationFor(row), false);
    for (const [role, name] of [["adult", "Adult"], ["teen", "Teen"], ["child", "Child"], ["guest", "Guest"]] as const) {
      const created = await client.post("/api/people", { displayName: name, role, ...(role === "adult" ? { secret: "0000" } : {}) });
      expect(created.status).toBe(201);
      const { id } = await created.json() as { id: string };
      const caller = new TestClient();
      if (role === "adult") {
        expect((await caller.post("/api/auth/verify-secret", { personId: id, secret: "0000" })).status).toBe(200);
      } else {
        await caller.post("/api/auth/select", { personId: id });
      }
      const response = await caller.get(`/api/admin/turns/${turnId}/trace`);
      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain("PRIVATE");
    }
    expect((await new TestClient().get(`/api/admin/turns/${turnId}/trace`)).status).toBe(401);
  });

  test("adult admin gets every recorded node and timing-only generation/tool spans", async () => {
    const { client, row } = await owner();
    const turnId = insertTrace(row, conversationFor(row), false);
    const response = await client.get(`/api/admin/turns/${turnId}/trace`);
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.spans).toHaveLength(10);
    expect(body.spans.filter((span: any) => span.depth === 0)).toHaveLength(8);
    expect(body.spans.filter((span: any) => span.depth === 1)).toHaveLength(2);
    expect(body.spans.find((span: any) => span.name.startsWith("commands"))).toMatchObject({ status: "skipped", startMs: 10, durationMs: 5 });
    expect(body.spans.find((span: any) => span.name.startsWith("model"))).toMatchObject({ status: "failed", error_code: "engine_fault_code" });
    expect(body.spans.find((span: any) => span.name === "Model generation")).toMatchObject({ status: "completed", startMs: 40, durationMs: 35 });
    expect(body.spans.find((span: any) => span.name === "Tool call")).toMatchObject({ status: "failed", startMs: 81, durationMs: 9 });
    const wire = JSON.stringify(body);
    for (const forbidden of ["PRIVATE", "tool_fault", "private-package", "PRIVATE-CALL-ID", "reasoning", "personId", "conversationId", "turnId"]) {
      expect(wire).not.toContain(forbidden);
    }
    expect(body.spans.find((span: any) => span.name.startsWith("model")).error_code).toBe("engine_fault_code");
    expect(body.spans.find((span: any) => span.name === "Tool call")).not.toHaveProperty("error_code");
  });

  test("real recorded child and teen turns return only allowed statuses and no content or identity", async () => {
    const { client } = await owner();
    const { row: childRow } = await child(client);
    const teenClient = await teen(client);
    const teenRow = db.select().from(people).where(eq(people.displayName, "Bramble")).get()! as PersonRow;
    for (const minor of [childRow, teenRow]) {
      const turnId = insertTrace(minor, conversationFor(minor), true);
      const response = await client.get(`/api/admin/turns/${turnId}/trace`);
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.spans.some((span: any) => span.status === "skipped")).toBe(true);
      expect(body.spans.every((span: any) => ["completed", "failed", "skipped"].includes(span.status))).toBe(true);
      expect(body.spans.every((span: any) => !("error_code" in span))).toBe(true);
      const wire = JSON.stringify(body);
      for (const forbidden of ["PRIVATE", "engine_fault_code", "tool_fault", "private-package", minor.id, "Bramble", "Poppy", "conversationId", "personId"]) {
        expect(wire).not.toContain(forbidden);
      }
    }
    expect(teenClient).toBeTruthy();
  });

  test("unknown, temporary, and Incognito turn rows return 404", async () => {
    const { client, row } = await owner();
    expect((await client.get("/api/admin/turns/unknown-turn/trace")).status).toBe(404);
    for (const mode of ["temporary", "incognito"]) {
      const conversationId = conversationFor(row);
      db.update(conversations).set({ mode }).where(eq(conversations.id, conversationId)).run();
      const id = insertTrace(row, conversationId, false);
      const response = await client.get(`/api/admin/turns/${id}/trace`);
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain("PRIVATE");
    }
  });
});
