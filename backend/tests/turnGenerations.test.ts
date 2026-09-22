// LAT-00: every real model call a turn makes is recorded, not just the
// last one - the diagnosis (Fable, 2026-09-22) was that "hi" spends a
// hidden second generation (thinking eats the token cap, LAT-01) with
// nothing in the logs to show it. This proves the fix through the real
// streaming route: a scripted think-only first generation followed by a
// real second one records two `generations` entries, tagged
// "initial"/"think_exhausted", and the first entry's own timings survive
// once the second one has run (the bug this replaces: modelTurn's single
// streamStats field got overwritten, losing the first generation's numbers
// entirely).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { db } from "@/db";
import { people, conversationTurns } from "@/db/schema";
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

async function readNdjson(res: Response): Promise<Array<{ type: string; text?: string; value?: { stats?: { generations?: Array<{ reason: string; thinking: boolean; request_sent_ms: number; first_delta_ms: number | null }> } } }>> {
  const body = await res.text();
  return body
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

describe("LAT-00: a hidden second generation is recorded, not overwritten", () => {
  test("a think-only first generation followed by a real reply records both, and the first entry's timings survive", async () => {
    const { client } = await owner();
    __resetLlmSupervisorForTests();
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    // The stub calls scriptedChatReply() before scriptedReasoning() for
    // the same request (stubServer.ts's own order), so the index is
    // advanced in the first and read by the second - the first request
    // (index 0) gets reasoning only, no visible content (the exact
    // "truncated think block" shape the stub server's own header
    // describes), which holdOpening() reads as a malformed/empty reply
    // and regenerates from (RETRY_TOKEN_CAP, thinking off); the second
    // (the regeneration) gets a real reply.
    let requestIndex = -1;
    const stub = startStubLlmServer(0, {
      scriptedChatReply: () => {
        requestIndex++;
        return requestIndex === 0 ? undefined : "Hi there!";
      },
      scriptedReasoning: () => (requestIndex === 0 ? "thinking it over" : undefined),
    });
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    try {
      const res = await client.post("/api/turn/stream", { text: "hi", thinking: true });
      const events = await readNdjson(res);
      const done = events.find((e) => e.type === "done");
      const generations = done?.value?.stats?.generations;
      expect(generations).toBeDefined();
      expect(generations).toHaveLength(2);
      expect(generations![0]!.reason).toBe("initial");
      expect(generations![0]!.thinking).toBe(true);
      expect(generations![1]!.reason).toBe("think_exhausted");
      expect(generations![1]!.thinking).toBe(false);
      // The bug this replaces: a single streamStats field meant the
      // first generation's own numbers were gone by the time the turn
      // finished, overwritten by the second. Both entries' own
      // request_sent_ms survive independently, the second strictly
      // later than the first.
      expect(generations![0]!.request_sent_ms).toBeGreaterThanOrEqual(0);
      expect(generations![1]!.request_sent_ms).toBeGreaterThan(generations![0]!.request_sent_ms);
    } finally {
      stub.stop();
      __resetLlmSupervisorForTests();
    }
  });

  test("an ordinary reply with no retry records exactly one generation", async () => {
    const { client } = await owner();
    __resetLlmSupervisorForTests();
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const seen: ChatCompletionRequest[] = [];
    const stub = startStubLlmServer(0, {
      scriptedChatReply: (request) => {
        seen.push(request);
        return "It's a beautiful day today.";
      },
    });
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    try {
      const res = await client.post("/api/turn/stream", { text: "how are you" });
      const events = await readNdjson(res);
      const done = events.find((e) => e.type === "done");
      const generations = done?.value?.stats?.generations;
      expect(generations).toHaveLength(1);
      expect(generations![0]!.reason).toBe("initial");
      expect(generations![0]!.first_delta_ms).not.toBeNull();
    } finally {
      stub.stop();
      __resetLlmSupervisorForTests();
    }
  });

  test("the persisted row's own stats carry the same generations array", async () => {
    const { client, actor } = await owner();
    __resetLlmSupervisorForTests();
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer(0, { scriptedChatReply: () => "Sure, here you go." });
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    try {
      const res = await client.post("/api/turn/stream", { text: "hello" });
      await readNdjson(res);
      const row = db.select().from(conversationTurns).where(eq(conversationTurns.personId, actor.id)).get();
      const stats = row?.stats ? (JSON.parse(row.stats) as { generations?: unknown[] }) : null;
      expect(stats?.generations).toHaveLength(1);
    } finally {
      stub.stop();
      __resetLlmSupervisorForTests();
    }
  });
});
