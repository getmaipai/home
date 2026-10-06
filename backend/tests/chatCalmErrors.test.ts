// CHAT-CALM-ERRORS-01b (design data-scratch/research/chat-calm-errors.md
// sections 9 and 10; RULES.md rules 6 and 9): when the Stack refuses the
// chat role, or the engine dies mid-reply, the failed turn is kept, its raw
// facts (the Stack's error, state and reason, the HTTP status, the body,
// timing, the engine and model) reach an adult owner or admin, and nobody
// else: not a non-admin adult, a teen, a child or the model.
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { child, owner, teen } from "./support/testAuth";
import { IDENTITY_HEADERS, startStackFixture, useDefaultScriptedStack, type StackFixture } from "./stackFixture";
import { db } from "@/db";
import { conversationTurns, conversations } from "@/db/schema";
import { StackError } from "@/lib/stack/errors";
import { __resetStackEngineForTests, __setStackClientForTests, recordStackChatIdentity, stackRefusal } from "@/lib/stackEngine";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { roleHealth } from "@/lib/roleHealth";
import { collectHealth } from "@/lib/healthSnapshot";
import { listIssues } from "@/lib/issues";
import { FAILURE_COPY } from "@/lib/failureCopy";
import { buildConversationWindow, createConversation, lastTurnIds, logTurn, markPreviousTurnCorrected, recentTurnSafety } from "@/lib/conversationHistory";
import { judgeQueueStats } from "@/lib/memoryJudge";
import { newConversationTurnId } from "@/lib/id";
import type { PersonRow } from "@/types";
import type { TurnValue } from "@/wire";

// The exact body from the owner's report: the chat engine was stopped.
const STOPPED_BODY = { error: "No engine is ready for role 'chat'.", role: "chat", state: "installed", offline_reason: "The chat engine was stopped." };
// The exact body getmaipai/home#203 quotes (a 24 GB machine out of memory).
const ISSUE_203_BODY = {
  error: "No engine is ready for role 'chat'.",
  role: "chat",
  state: "offline",
  offline_reason: "The current memory budget cannot admit the request. It needs about 0.5 GB with 2.7 GB free, after the working margin the machine's tier keeps back; memory pressure is warn. The chat engine waited 15 s for memory and gave up.",
};
const NONE_HEADERS = { "x-maipai-engine": "none", "x-maipai-model": "none" };
const STOPPED_LINE = FAILURE_COPY.stopped.adult;

let fixture: StackFixture | null = null;

beforeEach(() => {
  resetDb();
  __resetStackEngineForTests();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  __resetRateLimiterForTests();
});

afterEach(() => {
  fixture?.stop();
  fixture = null;
  __resetStackEngineForTests();
  useDefaultScriptedStack();
});

/** A Stack whose role list still shows chat installed (so the precheck
 * lets the turn through, as in the owner's report) and whose chat route
 * answers 503 with `body`. The engine that answered before it stopped is
 * on record, as it is on a hub that has chatted before. */
function refusingStack(body: unknown = STOPPED_BODY): StackFixture {
  fixture = startStackFixture({
    "POST /v1/chat/completions": async () => Response.json(body, { status: 503, headers: NONE_HEADERS }),
    "GET /stack/v1/roles": async () => Response.json({ roles: [{ id: "chat", state: { state: "installed", since: "scripted-test" }, reason: null }] }),
  });
  __setStackClientForTests(fixture.client);
  recordStackChatIdentity({ host: "local", build: "b10797", model: "qwen3-8b-instruct-q4_k_m.gguf", healthy: null });
  return fixture;
}

type StreamEvent = { type?: string; t?: string; error?: string; code?: string; turn_id?: string; text?: string; detail?: Record<string, any> };

async function streamTurn(client: TestClient, body: Record<string, unknown> = { text: "hi" }): Promise<{ events: StreamEvent[]; raw: string }> {
  const res = await client.post("/api/turn/stream", body);
  expect(res.status).toBe(200);
  const raw = await res.text();
  return { raw, events: raw.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as StreamEvent) };
}

async function adult(ownerClient: TestClient): Promise<TestClient> {
  const created = await ownerClient.post("/api/people", { displayName: "Juniper", role: "adult", secret: "0000" });
  const { id } = (await created.json()) as { id: string };
  const client = new TestClient();
  await client.post("/api/auth/verify-secret", { personId: id, secret: "0000" });
  return client;
}

describe("(1) the Stack client keeps a refusal's facts", () => {
  async function refusal(body: string, contentType = "application/json"): Promise<StackError> {
    fixture = startStackFixture({ "POST /v1/chat/completions": async () => new Response(body, { status: 503, headers: { "content-type": contentType, ...NONE_HEADERS } }) });
    try {
      await fixture.client.chat({ model: "chat", messages: [{ role: "user", content: "hi" }] });
    } catch (err) {
      return err as StackError;
    }
    throw new Error("expected the Stack to refuse");
  }

  test("the stopped-engine body is an offline StackError with its reason, state, status and body", async () => {
    const err = await refusal(JSON.stringify(STOPPED_BODY));
    expect(err).toBeInstanceOf(StackError);
    expect(err).toMatchObject({ kind: "offline", status: 503, message: "No engine is ready for role 'chat'.", offline_reason: "The chat engine was stopped.", state: "installed" });
    expect(err.body).toBe(JSON.stringify(STOPPED_BODY));
    // The Stack sends "none" when no engine answered: no identity is invented.
    expect(err.engine).toBeUndefined();
    expect(err.model).toBeUndefined();
  });

  test("#203's memory body keeps its reason and state", async () => {
    const err = await refusal(JSON.stringify(ISSUE_203_BODY));
    expect(err).toMatchObject({ kind: "offline", status: 503, offline_reason: ISSUE_203_BODY.offline_reason, state: "offline" });
  });

  test("a body that is not JSON is kept as raw text, without a parse error", async () => {
    const err = await refusal("upstream exploded <html>", "text/html");
    expect(err).toMatchObject({ kind: "offline", status: 503, body: "upstream exploded <html>" });
    expect(err.offline_reason).toBeUndefined();
  });
});

describe("(2) the stream's error event carries the facts for an admin only", () => {
  test("an owner's error event names the stopped engine with the Stack's error, reason, status, state, timing, engine and model", async () => {
    refusingStack();
    const { client } = await owner();
    const { events } = await streamTurn(client);
    const meta = events.find((e) => e.type === "turn_meta")!;
    const error = events.find((e) => e.type === "error")!;
    expect(error).toMatchObject({ code: "engine_unavailable", error: STOPPED_LINE });
    expect(error.detail).toMatchObject({ turn_id: meta.turn_id, found: true, advice: { cause: "The chat engine was stopped, so the reply never started.", next_step: "Start the chat engine in Repairs.", repairs: true } });
    const generation = error.detail!.generations[0];
    expect(generation).toMatchObject({
      error: "No engine is ready for role 'chat'.",
      offline_reason: "The chat engine was stopped.",
      http_status: 503,
      state: "installed",
      engine_id: "local b10797",
      model_id: "qwen3-8b-instruct-q4_k_m.gguf",
    });
    expect(generation.raw_body).toBe(JSON.stringify(STOPPED_BODY));
    expect(typeof generation.request_sent_ms).toBe("number");
    expect(typeof generation.failed_ms).toBe("number");
    expect(Number.isNaN(Date.parse(generation.failed_at))).toBe(false);
  });

  test("a non-admin adult, a teen and a child get the same line with no detail key and none of the raw facts", async () => {
    refusingStack();
    const { client: ownerClient } = await owner();
    const members = [await adult(ownerClient), await teen(ownerClient), (await child(ownerClient)).client];
    for (const member of members) {
      const { events, raw } = await streamTurn(member);
      const error = events.find((e) => e.type === "error")!;
      expect(error.code).toBe("engine_unavailable");
      expect("detail" in error).toBe(false);
      for (const fact of ["No engine is ready", "chat engine was stopped", "installed", "b10797", "qwen3", "http_status", "raw_body"]) expect(raw).not.toContain(fact);
    }
  });

  test("(6) the person's line for a stopped engine is the stopped copy, never the busy one; a child gets the short line", async () => {
    refusingStack();
    const { client: ownerClient } = await owner();
    const adultError = (await streamTurn(ownerClient)).events.find((e) => e.type === "error")!;
    expect(adultError.error).toBe(STOPPED_LINE);
    expect(adultError.error).not.toBe(FAILURE_COPY.busy.adult);
    const childError = (await streamTurn((await child(ownerClient)).client)).events.find((e) => e.type === "error")!;
    expect(childError.error).toBe(FAILURE_COPY.stopped.minor);
  });
});

describe("(3) the failed turn is stored and the details route reads it", () => {
  test("the turn has a failed row and the owner's details carry the facts; a non-admin is refused", async () => {
    refusingStack();
    const { client } = await owner();
    const { events } = await streamTurn(client);
    const turnId = events.find((e) => e.type === "turn_meta")!.turn_id!;
    const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, turnId)).get();
    expect(row?.status).toBe("failed");
    expect(row?.replyText).toBe(STOPPED_LINE);
    expect(row?.judgeStatus).toBe("skipped");
    const res = await client.get(`/api/turn-error-detail/${turnId}`);
    expect(res.status).toBe(200);
    const detail = (await res.json()) as any;
    expect(detail.found).toBe(true);
    expect(detail.generations[0]).toMatchObject({ error: "No engine is ready for role 'chat'.", offline_reason: "The chat engine was stopped.", http_status: 503, state: "installed", engine_id: "local b10797" });
    expect(detail.advice.next_step).toBe("Start the chat engine in Repairs.");
    const member = await adult(client);
    const refused = await member.get(`/api/turn-error-detail/${turnId}`);
    expect(refused.status).toBe(403);
    expect(await refused.text()).not.toContain("No engine is ready");
  });

  test("a failed edit-and-resend keeps its place in the branch and supersedes nothing: the edited turn stays the household's history", async () => {
    refusingStack();
    const { client, row } = await owner();
    const created = createConversation(row, { surface: "chat" });
    if (!created.ok) throw new Error("no conversation");
    const editedId = newConversationTurnId();
    logTurn(row, "chat", "what is a comet", { reply: { text: "A comet is ice and dust." }, source: "model", safety: { flagged: false, categories: [], action: "allow", notify_parent: false, checked_at: new Date().toISOString() }, conversation_id: created.value.id, turn_id: editedId } as unknown as TurnValue);
    const { events } = await streamTurn(client, { text: "what is a comet, briefly", conversation_id: created.value.id, supersedes: editedId });
    const failedId = events.find((e) => e.type === "turn_meta")!.turn_id!;
    const failed = db.select().from(conversationTurns).where(eq(conversationTurns.id, failedId)).get();
    expect(failed?.status).toBe("failed");
    expect(failed?.supersedes).toBeNull();
    // It keeps the edit's place: a sibling of the edited turn, never the next exchange.
    const edited = db.select().from(conversationTurns).where(eq(conversationTurns.id, editedId)).get();
    expect(failed?.parentTurnId).toBe(edited!.parentTurnId);
    expect(db.select().from(conversationTurns).where(eq(conversationTurns.supersedes, editedId)).all()).toHaveLength(0);
  });

  test("the reloaded thread shows the failed reply to its owner, with the raw facts only in an admin's stats", async () => {
    refusingStack();
    const { client } = await owner();
    const { events } = await streamTurn(client);
    const meta = events.find((e) => e.type === "turn_meta") as StreamEvent & { conversation_id: string };
    const turns = (await (await client.get(`/api/conversations/${meta.conversation_id}/turns`)).json()) as Array<{ id: string; status: string; replyText: string; stats?: { generations: Array<Record<string, unknown>> } }>;
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ id: meta.turn_id, status: "failed", replyText: STOPPED_LINE });
    expect(turns[0]!.stats!.generations[0]).toMatchObject({ http_status: 503, state: "installed" });
  });
});

describe("(4) every reader that skips a running row skips a failed row", () => {
  function seedConversation(person: PersonRow): { conversationId: string; doneId: string; failedId: string } {
    const created = createConversation(person, { surface: "chat" });
    if (!created.ok) throw new Error("no conversation");
    const conversationId = created.value.id;
    const value = (turnId: string, text: string) => ({ reply: { text }, source: "model", safety: { flagged: false, categories: [], action: "allow", notify_parent: false, checked_at: new Date().toISOString() }, conversation_id: conversationId, turn_id: turnId } as unknown as TurnValue);
    const doneId = newConversationTurnId();
    logTurn(person, "chat", "what is a comet", value(doneId, "A comet is ice and dust."));
    const failedId = newConversationTurnId();
    logTurn(person, "chat", "FAILED-USER-TEXT", value(failedId, STOPPED_LINE), { judgeStatus: "skipped", status: "failed" });
    return { conversationId, doneId, failedId };
  }

  test("the model's window, recent safety, the last turns, the correction mark, the branch walk and the judge queue never see it", async () => {
    const { row } = await owner();
    const before = judgeQueueStats().pending;
    const { conversationId, doneId, failedId } = seedConversation(row);
    const conversation = db.select().from(conversations).where(eq(conversations.id, conversationId)).get()!;
    const window = JSON.stringify(await buildConversationWindow(conversation as never));
    expect(window).toContain("comet");
    expect(window).not.toContain("FAILED-USER-TEXT");
    expect(window).not.toContain(STOPPED_LINE);
    expect(recentTurnSafety(conversationId, 10)).toHaveLength(1);
    expect(lastTurnIds(conversationId, 5)).toEqual([doneId]);
    expect(markPreviousTurnCorrected(conversationId, "turn-next")).toBe(doneId);
    // The judge queue counts the done turn only.
    expect(judgeQueueStats().pending).toBe(before + 1);
    // The branch walk: the next turn hangs off the done turn, and the failed row is never the chosen branch.
    const nextId = newConversationTurnId();
    const next = logTurn(row, "chat", "and a meteor", { reply: { text: "A meteor is a rock." }, source: "model", safety: { flagged: false, categories: [], action: "allow", notify_parent: false, checked_at: new Date().toISOString() }, conversation_id: conversationId, turn_id: nextId } as unknown as TurnValue);
    expect(next.parentTurnId).toBe(doneId);
    const failedRow = db.select().from(conversationTurns).where(eq(conversationTurns.id, failedId)).get()!;
    expect(failedRow.branchChosen).toBe(false);
    expect(failedRow.status).toBe("failed");
  });

  test("every status filter on conversation_turns in the source reads done rows only, so failed rows are skipped wherever running ones are", () => {
    const src = join(import.meta.dir, "../src");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith(".ts")) files.push(path);
      }
    };
    walk(src);
    const filters: string[] = [];
    for (const file of files) {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        for (const match of line.matchAll(/(\w+)\(conversationTurns\.status, "(\w+)"\)/g)) filters.push(`${match[1]}:${match[2]}`);
      }
    }
    expect(filters.length).toBeGreaterThan(10);
    expect([...new Set(filters)]).toEqual(["eq:done"]);
  });
});

describe("(5) the status row and Repairs read the same refusal", () => {
  test("after the 503, roleHealth and the health row carry the stopped line, and Repairs holds a warning with the Stack's words", async () => {
    refusingStack();
    const { client } = await owner();
    await streamTurn(client);
    expect(stackRefusal("chat")?.kind).toBe("stopped");
    expect(await roleHealth("chat")).toMatchObject({ availability: "unavailable", detail: STOPPED_LINE });
    const health = await collectHealth();
    expect(health.engines.chat.detail).toBe(STOPPED_LINE);
    expect(JSON.stringify(health)).not.toContain("No engine is ready");
    const issue = listIssues().find((i) => i.source === "stack" && i.key === "offline.chat");
    expect(issue).toMatchObject({ severity: "warning", detail: "The chat engine was stopped." });
  });

  test("#203's memory refusal still says low on memory, and an offline state is an error in Repairs", async () => {
    refusingStack(ISSUE_203_BODY);
    const { client } = await owner();
    const error = (await streamTurn(client)).events.find((e) => e.type === "error")!;
    expect(error.error).toBe(FAILURE_COPY.memory.adult);
    expect(listIssues().find((i) => i.key === "offline.chat")?.severity).toBe("error");
  });
});

describe("(7) a temporary turn stores nothing and still carries the admin detail", () => {
  test("no row, and the owner's event detail says nothing was saved", async () => {
    refusingStack();
    const { client } = await owner();
    const before = db.select().from(conversationTurns).all().length;
    const { events } = await streamTurn(client, { text: "hi", temporary: true });
    const error = events.find((e) => e.type === "error")!;
    expect(error.code).toBe("engine_unavailable");
    expect(error.detail).toMatchObject({ found: false, generations: [{ http_status: 503, state: "installed" }] });
    expect(db.select().from(conversationTurns).all()).toHaveLength(before);
  });
});

describe("the engine dies mid-reply", () => {
  /** A Stack that opens the stream with its identity, sends one sentence,
   * then drops the connection; afterwards its role list says the chat
   * engine is offline and further chat calls are refused. */
  function dyingStack(): StackFixture {
    let died = false;
    fixture = startStackFixture({
      "POST /v1/chat/completions": async () => {
        if (died) return Response.json({ error: "No engine is ready for role 'chat'.", role: "chat", state: "offline", offline_reason: "The chat engine exited." }, { status: 503, headers: NONE_HEADERS });
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            const encoder = new TextEncoder();
            controller.enqueue(encoder.encode('data: {"choices":[{"index":0,"delta":{"content":"Comets are made of ice. "},"finish_reason":null}]}\n\n'));
            setTimeout(() => {
              died = true;
              controller.error(new Error("socket closed by the engine"));
            }, 20);
          },
        });
        return new Response(body, { headers: { "content-type": "text/event-stream", ...IDENTITY_HEADERS } });
      },
      "GET /stack/v1/roles": async () => Response.json({ roles: [{ id: "chat", state: died ? { state: "offline", since: "scripted-test", reason: "The chat engine exited." } : { state: "ready", since: "scripted-test" }, reason: null }] }),
    });
    __setStackClientForTests(fixture.client);
    return fixture;
  }

  test("the turn is stored as failed and the owner's details name the engine and model that were answering", async () => {
    dyingStack();
    const { client } = await owner();
    const { events } = await streamTurn(client, { text: "tell me about comets" });
    const turnId = events.find((e) => e.type === "turn_meta")!.turn_id!;
    const error = events.find((e) => e.type === "error")!;
    expect(error.code).toBe("engine_unavailable");
    const generation = error.detail!.generations[0];
    // The socket closed with no [DONE] and no finish reason: a cut-off reply, never a finished one.
    expect(generation.error).toContain("ended before the engine finished");
    expect(events.some((e) => e.type === "done")).toBe(false);
    expect(generation).toMatchObject({ engine_id: IDENTITY_HEADERS["x-maipai-engine"], model_id: IDENTITY_HEADERS["x-maipai-model"] });
    expect(typeof generation.failed_ms).toBe("number");
    const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, turnId)).get();
    expect(row?.status).toBe("failed");
    const detail = (await (await client.get(`/api/turn-error-detail/${turnId}`)).json()) as any;
    expect(detail.found).toBe(true);
    expect(detail.generations[0]).toMatchObject({ engine_id: IDENTITY_HEADERS["x-maipai-engine"], model_id: IDENTITY_HEADERS["x-maipai-model"] });
  });
});
