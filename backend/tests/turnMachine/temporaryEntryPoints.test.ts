// THIN-INC row 6: every entry to the turn engine that is not the chat screen
// leaves nothing durable behind for a temporary (Incognito) request, and the
// same entry still stores its rows for an ordinary one. One whole-database
// diff per entry, same shape as temporaryTurn.test.ts (THIN-INC row 1), but the
// snapshot here is the CONTENT of every row, not just the counts, so an
// existing row that a temporary request edits (a conversation closed, a mode
// flipped) shows up as a change too.
//
// Inventory (backend/src/routes plus lib/wyomingServer.ts; the grep is
// `temporary|incognito` over routes/, and `runTurnNext|runTurnNextStream|
// createConversation|resolveOrCreateConversation` over src/):
//   1. POST /api/turn                       routes/turn.ts, body.temporary
//   2. POST /api/turn/stream                routes/turn.ts, body.temporary
//   3. POST /v1/chat/completions, blocking  routes/openai.ts, body.temporary or X-MaiPai-Temporary
//   4. POST /v1/chat/completions, stream    routes/openai.ts, same
//   5. Wyoming "transcript" (handle)        lib/wyomingServer.ts, data.temporary
//   6. POST /api/conversations              routes/conversations.ts, body.mode "temporary"
// Read-only or not a turn entry, so not in the table: GET /api/conversations/incognito,
// POST /api/conversations/incognito/discard (deletes only), routes/devUi.ts (refuses temporary
// with a 403 and has its own test), routes/turnBare.ts (reads one stored turn).
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { eq } from "drizzle-orm";
import { TestClient } from "../client";
import { resetDb } from "../reset-db";
import { db, sqlite } from "@/db";
import { people } from "@/db/schema";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetPortOwnershipForTests } from "@/lib/sidecars";
import { setHouseholdSettingValue } from "@/lib/settings";
import { issueApiToken } from "@/lib/apiToken";
import { startWyomingServer, type WyomingServerHandle } from "@/lib/wyomingServer";
import { WyomingFramer, encodeWyomingMessage, type WyomingMessage } from "@/lib/wyoming";
import { useDefaultScriptedStack } from "../stackFixture";
import { withEngine } from "./modeHarness";
import type { PersonRow } from "@/types";

let client: TestClient;
let actor: PersonRow;
let token: string;
let wyoming: WyomingServerHandle | undefined;

beforeEach(async () => {
  resetDb();
  useDefaultScriptedStack();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  __resetRateLimiterForTests();
  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
  client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  token = issueApiToken(actor.id);
});

afterEach(() => {
  wyoming?.stop();
  wyoming = undefined;
  __resetLlmSupervisorForTests();
  __resetPortOwnershipForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

/** Every table's rows, serialized, by table name (FTS shadow tables left out). */
function snapshot(): Record<string, string> {
  const names = (sqlite.query("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '%\\_fts%' escape '\\'").all() as { name: string }[]).map((r) => r.name);
  const out: Record<string, string> = {};
  for (const name of names) out[name] = JSON.stringify(sqlite.query(`select * from "${name}" order by rowid`).all());
  return out;
}

/** The tables whose content differs between two snapshots. */
function changed(before: Record<string, string>, after: Record<string, string>): string[] {
  // auth bookkeeping: the token is stamped on use, it is not conversation data
  return Object.keys(after).filter((name) => name === "person_api_tokens" ? JSON.stringify((JSON.parse(after[name]!) as Record<string, unknown>[]).map(({ last_used_at: _lastUsedAt, ...row }) => row)) !== JSON.stringify((JSON.parse(before[name]!) as Record<string, unknown>[]).map(({ last_used_at: _lastUsedAt, ...row }) => row)) : after[name] !== before[name]).sort();
}

/** Row count of one table (an ordinary request's footprint). */
function rowCount(table: string): number {
  return (sqlite.query(`select count(*) as n from "${table}"`).get() as { n: number }).n;
}

const bearer = () => ({ authorization: `Bearer ${token}` });
const completion = (extra: Record<string, unknown> = {}) => ({ model: "maipai", messages: [{ role: "user", content: "what should we cook on Friday" }], ...extra });

async function drain(res: Response): Promise<string> {
  return await res.text();
}

class WyomingClient {
  private framer = new WyomingFramer();
  readonly received: WyomingMessage[] = [];
  private socket!: Bun.Socket;
  async connect(port: number): Promise<void> {
    this.socket = await Bun.connect({
      hostname: "127.0.0.1",
      port,
      socket: {
        data: (_s, chunk) => {
          this.framer.push(chunk);
          for (let m = this.framer.next(); m; m = this.framer.next()) this.received.push(m);
        },
        close: () => {},
        error: () => {},
      },
    });
  }
  send(msg: WyomingMessage): void { this.socket.write(encodeWyomingMessage(msg)); }
  async waitFor(count: number, ms = 3000): Promise<WyomingMessage[]> {
    const deadline = Date.now() + ms;
    while (this.received.length < count && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    return this.received;
  }
  end(): void { this.socket.end(); }
}

/** One authenticated Wyoming handle request; resolves with the satellite's reply. */
async function wyomingHandle(data: Record<string, unknown>): Promise<WyomingMessage> {
  wyoming = startWyomingServer(0);
  const satellite = new WyomingClient();
  await satellite.connect(wyoming.port);
  satellite.send({ type: "authenticate", data: { token } });
  satellite.send({ type: "transcript", data });
  const messages = await satellite.waitFor(1);
  satellite.end();
  expect(messages.length).toBeGreaterThan(0);
  return messages[0]!;
}

describe("THIN-INC row 6: POST /api/turn", () => {
  test("a temporary blocking turn leaves every table's content as it found it", async () => {
    const before = snapshot();
    await withEngine(() => "Sure, here is a short answer.", async () => {
      const res = await client.post("/api/turn", { surface: "chat", text: "what should we cook on Friday", temporary: true });
      expect(res.status).toBe(200);
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(changed(before, snapshot())).toEqual([]);
  });

  test("an ordinary blocking turn still stores its conversation and turn", async () => {
    await withEngine(() => "Sure, here is a short answer.", async () => {
      expect((await client.post("/api/turn", { surface: "chat", text: "what should we cook on Friday" })).status).toBe(200);
    });
    expect(rowCount("conversations")).toBe(1);
    expect(rowCount("conversation_turns")).toBe(1);
  });
});

describe("THIN-INC row 6: POST /api/turn/stream", () => {
  test("a temporary streamed turn leaves every table's content as it found it", async () => {
    const before = snapshot();
    await withEngine(() => "Sure, here is a short answer.", async () => {
      const res = await client.post("/api/turn/stream", { surface: "chat", text: "what should we cook on Friday", temporary: true });
      expect(res.status).toBe(200);
      expect(await drain(res)).toContain("short answer");
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(changed(before, snapshot())).toEqual([]);
  });

  test("an ordinary streamed turn still stores its conversation and turn", async () => {
    await withEngine(() => "Sure, here is a short answer.", async () => {
      await drain(await client.post("/api/turn/stream", { surface: "chat", text: "what should we cook on Friday" }));
    });
    expect(rowCount("conversations")).toBe(1);
    expect(rowCount("conversation_turns")).toBe(1);
  });
});

describe("THIN-INC row 6: POST /v1/chat/completions", () => {
  test("a temporary blocking request (body flag) leaves every table's content as it found it", async () => {
    const before = snapshot();
    await withEngine(() => "Sure, here is a short answer.", async () => {
      const res = await client.request("/v1/chat/completions", { method: "POST", body: completion({ temporary: true }), headers: bearer() });
      expect(res.status).toBe(200);
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(changed(before, snapshot())).toEqual([]);
  });

  test("a temporary blocking request (header) leaves every table's content as it found it", async () => {
    const before = snapshot();
    await withEngine(() => "Sure, here is a short answer.", async () => {
      const res = await client.request("/v1/chat/completions", { method: "POST", body: completion(), headers: { ...bearer(), "x-maipai-temporary": "true" } });
      expect(res.status).toBe(200);
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(changed(before, snapshot())).toEqual([]);
  });

  test("an ordinary blocking request still stores its conversation and turn", async () => {
    await withEngine(() => "Sure, here is a short answer.", async () => {
      expect((await client.request("/v1/chat/completions", { method: "POST", body: completion(), headers: bearer() })).status).toBe(200);
    });
    expect(rowCount("conversations")).toBe(1);
    expect(rowCount("conversation_turns")).toBe(1);
  });

  test("a temporary streaming request leaves every table's content as it found it", async () => {
    const before = snapshot();
    await withEngine(() => "Sure, here is a short answer.", async () => {
      const res = await client.request("/v1/chat/completions", { method: "POST", body: completion({ temporary: true, stream: true }), headers: bearer() });
      expect(res.status).toBe(200);
      expect(await drain(res)).toContain("[DONE]");
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(changed(before, snapshot())).toEqual([]);
  });

  test("an ordinary streaming request still stores its conversation and turn", async () => {
    await withEngine(() => "Sure, here is a short answer.", async () => {
      await drain(await client.request("/v1/chat/completions", { method: "POST", body: completion({ stream: true }), headers: bearer() }));
    });
    expect(rowCount("conversations")).toBe(1);
    expect(rowCount("conversation_turns")).toBe(1);
  });

  test("a temporary request from a child is refused, not downgraded to a stored turn", async () => {
    const childId = "child-test";
    const now = new Date().toISOString();
    sqlite.query("INSERT INTO people (id, display_name, role, avatar_seed, source, local_only, created_at, updated_at, hlc) VALUES (?, 'Clover', 'child', 'seed', 'test', 0, ?, ?, 'hlc')").run(childId, now, now);
    const childToken = issueApiToken(childId);
    const before = snapshot();
    await withEngine(() => "Hello.", async () => {
      const res = await client.request("/v1/chat/completions", { method: "POST", body: completion({ temporary: true }), headers: { authorization: `Bearer ${childToken}` } });
      expect(res.status).toBe(403);
    });
    expect(changed(before, snapshot())).toEqual([]);
  });
});

describe("THIN-INC row 6: the Wyoming transcript (handle) message", () => {
  test("a temporary handle request leaves every table's content as it found it", async () => {
    const before = snapshot();
    await withEngine(() => "Sure, here is a short answer.", async () => {
      const reply = await wyomingHandle({ text: "what should we cook on Friday", temporary: true });
      expect(reply.type).toBe("handled");
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(changed(before, snapshot())).toEqual([]);
  });

  test("an ordinary handle request still stores its conversation and turn", async () => {
    await withEngine(() => "Sure, here is a short answer.", async () => {
      const reply = await wyomingHandle({ text: "what should we cook on Friday" });
      expect(reply.type).toBe("handled");
    });
    expect(rowCount("conversations")).toBe(1);
    expect(rowCount("conversation_turns")).toBe(1);
  });
});

describe("THIN-INC row 6: POST /api/conversations", () => {
  test("creating a temporary conversation, then a turn in it, leaves every table's content as it found it, even with a saved chat already open", async () => {
    await withEngine(() => "Sure, here is a short answer.", async () => {
      await client.post("/api/turn", { surface: "chat", text: "a saved chat comes first" });
      const before = snapshot();
      const created = await client.post("/api/conversations", { surface: "chat", mode: "temporary" });
      expect(created.status).toBe(201);
      const conversation = (await created.json()) as { id: string };
      const turn = await client.post("/api/turn", { surface: "chat", conversation_id: conversation.id, text: "what should we cook on Friday" });
      expect(turn.status).toBe(200);
      await new Promise((r) => setTimeout(r, 200));
      expect(changed(before, snapshot())).toEqual([]);
    });
  });

  test("creating an ordinary conversation still stores a row", async () => {
    const created = await client.post("/api/conversations", { surface: "chat" });
    expect(created.status).toBe(201);
    expect(rowCount("conversations")).toBe(1);
  });
});
