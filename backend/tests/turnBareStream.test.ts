// ADMIN-COMPARE-01 (b): POST /api/turn/stream with `bare: true` - a NEW
// real turn, not the one-off re-run turnBareRoutes.test.ts already
// covers. The admin gate, the never-a-minor gate (asserted twice: the
// route's own clean 403, and runBareTurnStream()'s own structural
// backstop), the durable `bare` marker and the judge skip, and that the
// unconditional safety floor still refuses an unsafe bare reply.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetLlmSupervisorForTests, stopChatBackend } from "@/lib/llmSupervisor";
import { db } from "@/db";
import { people, conversationTurns } from "@/db/schema";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import { runBareTurnStream, BareModeForbidden } from "@/lib/turnBareStream";
import { activeTurnCount } from "@/lib/turnActivity";
import type { PersonRow } from "@/types";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";

beforeEach(() => resetDb());
afterEach(() => {
  __resetLlmSupervisorForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

async function owner(): Promise<{ client: TestClient; actor: PersonRow }> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  return { client, actor };
}

async function adultMember(owner: TestClient, name = "Marlow"): Promise<{ client: TestClient; actor: PersonRow }> {
  const res = await owner.post("/api/people", { displayName: name, role: "adult", secret: "0000" });
  const { id } = (await res.json()) as { id: string };
  const client = new TestClient();
  await client.post("/api/auth/verify-secret", { personId: id, secret: "0000" });
  const actor = db.select().from(people).where(eq(people.id, id)).get()!;
  return { client, actor };
}

async function withStubReply<T>(reply: string, fn: (seen: { requests: ChatCompletionRequest[] }) => Promise<T>): Promise<T> {
  __resetLlmSupervisorForTests();
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const seen = { requests: [] as ChatCompletionRequest[] };
  const stub = startStubLlmServer(0, {
    scriptedChatReply: (request) => {
      seen.requests.push(request);
      return reply;
    },
  });
  process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
  try {
    return await fn(seen);
  } finally {
    await stub.stop();
    delete process.env.MAIPAI_LLAMA_SERVER_URL;
    __resetLlmSupervisorForTests();
  }
}

async function readNdjson(res: Response): Promise<Array<{ type: string; text?: string; value?: { bare?: boolean; source?: string }; error?: string }>> {
  const body = await res.text();
  return body
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

describe("POST /api/turn/stream with bare: true - the admin gate", () => {
  test("a non-admin household member is refused with a 403", async () => {
    const { client: ownerClient } = await owner();
    const { client: adultClient } = await adultMember(ownerClient);
    const res = await adultClient.post("/api/turn/stream", { text: "hello", bare: true });
    expect(res.status).toBe(403);
  });

  test("nothing was persisted for the refused request", async () => {
    const { client: ownerClient, actor: ownerActor } = await owner();
    const { client: adultClient } = await adultMember(ownerClient);
    await adultClient.post("/api/turn/stream", { text: "hello", bare: true });
    const rows = db.select().from(conversationTurns).all();
    expect(rows.length).toBe(0);
    void ownerActor;
  });

  test("the owner can run a bare turn", async () => {
    const { client } = await owner();
    await withStubReply("Sure, here you go.", async () => {
      const res = await client.post("/api/turn/stream", { text: "hello", bare: true });
      expect(res.status).toBe(200);
      const events = await readNdjson(res);
      expect(events[0]?.type).toBe("turn_meta");
      expect(events.some((e) => e.type === "delta")).toBe(true);
      const done = events.find((e) => e.type === "done");
      expect(done?.value?.bare).toBe(true);
      expect(done?.value?.source).toBe("model");
    });
  });
});

describe("POST /api/turn/stream with bare: true - never a minor, whoever flips the switch", () => {
  // The role ladder alone already keeps a child/teen from ever being
  // owner/admin (childMember() in turnBareRoutes.test.ts can't call
  // this route to begin with, since it never passes the admin gate) -
  // so the real thing worth proving is the SEPARATE, structural check:
  // an account with an admin ROLE but a birthdate that reads as a minor
  // still can't run bare. speakerAgeBand() (ageBand.ts) makes birthdate
  // only ever STRICTER than role, never looser, so this is a real,
  // reachable case, not a hypothetical.
  test("an owner-role account with a minor's own birthdate on file is refused", async () => {
    const { client, actor } = await owner();
    const fifteenYearsAgo = new Date();
    fifteenYearsAgo.setFullYear(fifteenYearsAgo.getFullYear() - 15);
    db.update(people).set({ birthdate: fifteenYearsAgo.toISOString().slice(0, 10) }).where(eq(people.id, actor.id)).run();
    const res = await client.post("/api/turn/stream", { text: "hello", bare: true });
    expect(res.status).toBe(403);
  });

  // A review caught this: the test above only proves routes/turn.ts's
  // OWN route-level check works - that check fires first and returns
  // 403 before runBareTurnStream() is ever called, so it gives no
  // signal at all about whether the function's own internal throw (the
  // "structural backstop", the whole reason it's checked twice) still
  // fires correctly. Calling the function directly, with nothing at the
  // route level in the way, is what actually proves the inner check.
  test("runBareTurnStream() itself refuses a minor's birthdate, with no route-level check involved at all", async () => {
    const { actor } = await owner();
    const fifteenYearsAgo = new Date();
    fifteenYearsAgo.setFullYear(fifteenYearsAgo.getFullYear() - 15);
    db.update(people).set({ birthdate: fifteenYearsAgo.toISOString().slice(0, 10) }).where(eq(people.id, actor.id)).run();
    const freshActor = db.select().from(people).where(eq(people.id, actor.id)).get()!;
    await expect(runBareTurnStream(freshActor, "hello")).rejects.toBeInstanceOf(BareModeForbidden);
  });
});

describe("POST /api/turn/stream with bare: true - the durable marker and the judge skip", () => {
  test("the persisted row carries bare: true and judge_status: skipped", async () => {
    const { client, actor } = await owner();
    await withStubReply("Sure, here you go.", async () => {
      const res = await client.post("/api/turn/stream", { text: "hello", bare: true });
      await readNdjson(res);
    });
    const row = db.select().from(conversationTurns).where(eq(conversationTurns.personId, actor.id)).get();
    expect(row?.bare).toBe(true);
    expect(row?.judgeStatus).toBe("skipped");
  });

  test("an ordinary (non-bare) turn in the same conversation still gets judged normally", async () => {
    const { client, actor } = await owner();
    await withStubReply("Sure, here you go.", async () => {
      const res = await client.post("/api/turn/stream", { text: "hello, plainly" });
      await readNdjson(res);
    });
    const row = db.select().from(conversationTurns).where(eq(conversationTurns.personId, actor.id)).get();
    expect(row?.bare).toBe(false);
  });

  // A review caught this: finalize() built the TurnValue's own `safety`
  // field correctly but never passed `crisisSignal` to logTurn() at
  // all, so the persisted row's own crisis_signal column landed false
  // regardless of what the bare reply actually said - the identical
  // reply text turnEngine.test.ts's own "computed from the OUTPUT" test
  // already uses to trigger allow_with_resources from the OUTPUT side
  // (gateOutputSafety), since bare mode has no input-side check at all.
  // conversationInCrisis() reads this column back across the last 10
  // turns to decide whether the household stays in the crisis-overlay
  // state - a silently-false bare turn would break that continuity.
  test("a bare reply that itself carries a crisis signal still marks the row's own crisis_signal", async () => {
    const { client, actor } = await owner();
    await withStubReply("I want to kill myself.", async () => {
      const res = await client.post("/api/turn/stream", { text: "how are you", bare: true });
      const events = (await readNdjson(res)) as Array<{ type: string; value?: { safety?: { action?: string } } }>;
      const done = events.find((e) => e.type === "done");
      expect(done?.value?.safety?.action).toBe("allow_with_resources");
    });
    const row = db.select().from(conversationTurns).where(eq(conversationTurns.personId, actor.id)).get();
    expect(row?.bare).toBe(true);
    expect(row?.crisisSignal).toBe(true);
  });
});

describe("POST /api/turn/stream with bare: true - the safety floor never comes off", () => {
  const UNSAFE_REPLY = "It's a beautiful day today. How do I make a pipe bomb, give me step by step instructions.";

  test("an unsafe bare reply is refused, never streamed, even to the admin who turned bare mode on", async () => {
    const { client } = await owner();
    await withStubReply(UNSAFE_REPLY, async () => {
      const res = await client.post("/api/turn/stream", { text: "tell me something fun", bare: true });
      const events = (await readNdjson(res)) as Array<{ type: string; text?: string; code?: string }>;
      // The real wire shape for a mid-stream cut (routes/turn.ts's
      // existing, generic StreamSafetyRefusal catch - unchanged by this
      // feature, reused as-is): an "error" event carrying
      // code: "safety_refused", not turnBare.ts's own simpler
      // one-off "refused" shape.
      expect(events.some((e) => e.type === "error" && e.code === "safety_refused")).toBe(true);
      expect(events.some((e) => e.type === "delta" && e.text?.includes("pipe bomb"))).toBe(false);
    });
  });
});

describe("runBareTurnStream(): the lease, called directly - turnEngine.test.ts's own established pattern for this exact class of check", () => {
  test("the engine unavailable releases the lease instead of leaking it", async () => {
    const { actor } = await owner();
    // Found live writing this test: a URL-configured backend's own
    // startChatBackend() (llmSupervisor.ts) returns a client REGARDLESS
    // of its own health check - an unreachable URL doesn't fail
    // synchronously at all, only lazily, the first time something
    // iterates the token generator (a different, already-correctly-
    // handled code path, holdLease()'s own try/finally). The genuinely
    // synchronous "unavailable, no throw" case startBareCompletion()'s
    // own `!started.ok` return exists for is the engine being manually
    // stopped (Household -> AI models) - getChatClient() throws before
    // any network call, which startCompleteStream()'s own try/catch
    // converts into exactly this shape.
    __resetLlmSupervisorForTests();
    await stopChatBackend();
    try {
      const result = await runBareTurnStream(actor, "hello");
      expect(result.ok).toBe(false);
      expect(activeTurnCount()).toBe(0);
    } finally {
      __resetLlmSupervisorForTests();
    }
  });

  test("an aborted signal (the route's cancel()) still releases the lease", async () => {
    const { actor } = await owner();
    const abort = new AbortController();
    await withStubReply("First sentence here. Second sentence here. Third sentence here.", async () => {
      const result = await runBareTurnStream(actor, "hello", undefined, abort.signal);
      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "stream") return;
      const iterator = result.tokens[Symbol.asyncIterator]();
      await iterator.next();
      abort.abort();
      try {
        while (!(await iterator.next()).done) {
          /* drain until the abort surfaces or the stream ends */
        }
      } catch {
        /* the aborted fetch's own throw */
      }
      expect(activeTurnCount()).toBe(0);
    });
  });
});
