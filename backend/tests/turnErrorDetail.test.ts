// THIN-1E (rule 6): the admin-only error detail of a turn whose lookup or
// generation failed, and the proof that the raw text reaches nobody else.
import { describe, expect, test, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { child, owner, teen } from "./support/testAuth";
import { db } from "@/db";
import { conversationTurns, people } from "@/db/schema";
import { newConversationTurnId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { createConversation, exportPerson, list, listConversationTurns } from "@/lib/conversationHistory";
import { toolNode } from "@/lib/turnMachine/nodes/tool";
import type { ActionProposal, TurnState } from "@/lib/turnMachine/contract";
import type { PersonRow } from "@/types";
import type { TurnStats, TurnValue } from "@/wire";
import { valueForViewer } from "@/lib/turnErrorDetail";

beforeEach(() => resetDb());

const RAW = "SearXNG answered 502 at http://10.0.0.7:8080/search?q=weather";
const GEN_RAW = "chat model unavailable: engine returned 500 {\"detail\":\"slot crashed\"}";
const SECRET = "sk-live-abcdef0123456789abcdef0123456789";

function stats(): TurnStats {
  return {
    prompt_tokens: 1, predicted_tokens: 1, tokens_per_second: 1, time_to_first_token_ms: 1, total_time_ms: 1, context_tokens: 1,
    cache_reuse_tokens: null, cache_reuse_percent: null, engine: "x", stop_reason: "stop", thinking: false,
    generations: [{
      reason: "answer", thinking: false, max_tokens: null, prompt_n: null, cache_n: null, prompt_ms: null, predicted_n: null, predicted_ms: null,
      request_sent_ms: 0, first_delta_ms: null, tool_call_raw_args: null, envelope_parsed: false, error: GEN_RAW,
      offline_reason: "The chat engine waited 15 s for memory and gave up.",
    }],
  };
}

function insertFailedTurn(personId: string, conversationId: string | null): string {
  const id = newConversationTurnId();
  db.insert(conversationTurns).values({
    id, personId, conversationId, surface: "chat", userText: "weather?", replyText: "I could not look that up.", source: "model",
    safetyAction: "allow", minorSpeaker: false, createdAt: new Date().toISOString(), hlc: nextHlc(),
    outcomes: JSON.stringify([{ callId: "c1", packageId: "websearch", status: "failed", via: "tool_call", at: "2026-10-04T10:00:00.000Z", durationMs: 812, errorCode: "search_unavailable", userMessage: `${RAW} token=${SECRET}` }]),
    stats: JSON.stringify(stats()),
  }).run();
  return id;
}

async function owned() {
  const { client, row } = await owner();
  return { client, row, turnId: insertFailedTurn(row.id, null) };
}

describe("GET /api/turn-error-detail/:id", () => {
  test("an admin reads the stored outcome detail: tool, kind, raw text, timing and the Stack's reason", async () => {
    const { client, turnId } = await owned();
    const res = await client.get(`/api/turn-error-detail/${turnId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.turn_id).toBe(turnId);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0]).toMatchObject({ tool_id: "websearch", kind: "unavailable", error_code: "search_unavailable", duration_ms: 812, at: "2026-10-04T10:00:00.000Z" });
    expect(body.tools[0].error_text).toContain("SearXNG answered 502");
    expect(body.generations[0]).toMatchObject({ reason: "answer", offline_reason: "The chat engine waited 15 s for memory and gave up." });
    expect(body.generations[0].error).toContain("slot crashed");
  });

  test("secrets and tokens are redacted from the detail", async () => {
    const { client, turnId } = await owned();
    const text = await (await client.get(`/api/turn-error-detail/${turnId}`)).text();
    expect(text).not.toContain(SECRET);
  });

  test("a turn with no failure reads as an empty detail, an unknown id is 404", async () => {
    const { client, row } = await owner();
    const id = newConversationTurnId();
    db.insert(conversationTurns).values({ id, personId: row.id, surface: "chat", userText: "hi", replyText: "hello", source: "model", safetyAction: "allow", minorSpeaker: false, createdAt: new Date().toISOString(), hlc: nextHlc() }).run();
    expect(await (await client.get(`/api/turn-error-detail/${id}`)).json()).toEqual({ turn_id: id, tools: [], generations: [] });
    expect((await client.get(`/api/turn-error-detail/${newConversationTurnId()}`)).status).toBe(404);
  });

  test("a teen, a child and a signed-out caller get no detail", async () => {
    const { client, turnId } = await owned();
    const teenClient = await teen(client);
    const { client: childClient } = await child(client);
    for (const who of [teenClient, childClient]) {
      const res = await who.get(`/api/turn-error-detail/${turnId}`);
      expect(res.status).toBe(403);
      expect(await res.text()).not.toContain("SearXNG");
    }
    expect([401, 403]).toContain((await new TestClient().get(`/api/turn-error-detail/${turnId}`)).status);
  });
});

describe("whose turns an admin may open", () => {
  test("an admin reads a child's failed turn but never a teen's", async () => {
    const { client } = await owner();
    await teen(client);
    await child(client);
    const teenRow = db.select().from(people).where(eq(people.displayName, "Bramble")).get()! as PersonRow;
    const childRow = db.select().from(people).where(eq(people.displayName, "Poppy")).get()! as PersonRow;
    const teenTurn = insertFailedTurn(teenRow.id, null);
    const childTurn = insertFailedTurn(childRow.id, null);
    const refused = await client.get(`/api/turn-error-detail/${teenTurn}`);
    expect(refused.status).toBe(403);
    expect(await refused.text()).not.toContain("SearXNG");
    expect((await client.get(`/api/turn-error-detail/${childTurn}`)).status).toBe(200);
  });
});

describe("the raw text never rides a payload a non-admin gets", () => {
  test("the per-person export for a teen and a child carries neither the tool error nor the generation error, and an admin's keeps both", async () => {
    const { client, row } = await owner();
    await teen(client);
    await child(client);
    for (const name of ["Bramble", "Poppy"]) {
      const person = db.select().from(people).where(eq(people.displayName, name)).get()! as PersonRow;
      insertFailedTurn(person.id, null);
      const exported = exportPerson(person, person.id);
      if (!exported.ok) throw new Error("no export");
      const wire = JSON.stringify(exported.value);
      expect(wire).not.toContain("SearXNG");
      expect(wire).not.toContain("slot crashed");
      expect(wire).not.toContain("memory and gave up");
      expect(exported.value).toHaveLength(1);
    }
    insertFailedTurn(row.id, null);
    const own = exportPerson(row, row.id);
    if (!own.ok) throw new Error("no export");
    expect(JSON.stringify(own.value)).toContain("slot crashed");
  });

  test("a stored turn listing for a teen and a child carries neither the tool error nor the generation error", async () => {
    const { client } = await owner();
    await teen(client);
    await child(client);
    for (const name of ["Bramble", "Poppy"]) {
      const person = db.select().from(people).where(eq(people.displayName, name)).get()! as PersonRow;
      const conversation = createConversation(person, { surface: "chat" });
      if (!conversation.ok) throw new Error("no conversation");
      insertFailedTurn(person.id, conversation.value.id);
      const listed = listConversationTurns(person, conversation.value.id);
      if (!listed.ok) throw new Error("no listing");
      const wire = JSON.stringify(listed.value);
      expect(wire).not.toContain("SearXNG");
      expect(wire).not.toContain("slot crashed");
      expect(wire).not.toContain("memory and gave up");
      expect(listed.value).toHaveLength(1);
      // the flat, cross-conversation list the chat history reloads through
      const flat = JSON.stringify(list(person));
      expect(flat).not.toContain("SearXNG");
      expect(flat).not.toContain("slot crashed");
    }
  });

  test("an admin's own stored listing keeps its shape", async () => {
    const { row } = await owner();
    const conversation = createConversation(row, { surface: "chat" });
    if (!conversation.ok) throw new Error("no conversation");
    insertFailedTurn(row.id, conversation.value.id);
    const listed = listConversationTurns(row, conversation.value.id);
    if (!listed.ok) throw new Error("no listing");
    expect(listed.value[0]!.stats?.generations[0]?.error).toBe(GEN_RAW);
  });

  test("the done value sent to a non-admin drops the generation error and the Stack's reason; an admin's is untouched", async () => {
    const { row } = await owner();
    const value = { stats: stats() } as unknown as TurnValue;
    const adult = { ...row, role: "adult" } as PersonRow;
    const forAdult = JSON.stringify(valueForViewer(value, adult));
    expect(forAdult).not.toContain("slot crashed");
    expect(forAdult).not.toContain("memory and gave up");
    expect(JSON.stringify(valueForViewer(value, row))).toContain("slot crashed");
  });

  test("the tool_error line on the stream carries the failure kind, not the tool's error text", async () => {
    const state = { turnId: "t", conversationId: "c", actor: {} } as unknown as TurnState;
    const proposal: ActionProposal = { kind: "read_only", request: { tool: "not-a-real-package", args: {}, callId: "call-1" } };
    const { output } = await toolNode(state, { proposals: [proposal] }, new AbortController().signal);
    const failed = output.outcomes[0]!;
    expect(failed.userMessage).toBeTruthy();
    const line = output.toolEvents.find((e) => (e as { t: string }).t === "tool_error") as { error: string };
    expect(line.error).not.toContain(failed.userMessage!);
    expect(["unavailable", "timed_out", "found_nothing", "errored"]).toContain(line.error);
    expect(typeof failed.durationMs).toBe("number");
  });
});
