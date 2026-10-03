// THIN-7C (rule 12): routes/turn.ts and routes/turnBare.ts call only the one
// path. Every case the route used to hand the old engine (bare, documents,
// temporary, supersedes, continuation, a Home card's ephemeral query) is run
// here through the HTTP route with the retired turn.pipeline.next setting OFF,
// and each still lands on the default path: the stored turn carries the
// machine's own node trace, which only that path writes.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __setTikaRunnerForTests } from "@/lib/documentExtraction";
import { db } from "@/db";
import { people, conversationTurns, attachments } from "@/db/schema";
import { useDefaultScriptedStack } from "./stackFixture";
import { withEngine } from "./turnMachine/modeHarness";
import { weatherCardQuestion } from "@/homeCardQuestions";
import type { PersonRow } from "@/types";

beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  setHouseholdSettingValue("turn.pipeline.next", false);
  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
});
afterEach(() => {
  __resetLlmSupervisorForTests();
  __setTikaRunnerForTests(null);
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

async function owner(): Promise<{ client: TestClient; actor: PersonRow }> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  return { client, actor };
}

type Event = { type: string; text?: string; code?: string; value?: { turn_id: string; conversation_id: string; bare?: boolean; continued_from_turn_id?: string | null; reply: { text: string } } };
async function ndjson(res: Response): Promise<Event[]> {
  return (await res.text()).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}
function done(events: Event[]): NonNullable<Event["value"]> {
  const value = events.find((e) => e.type === "done")?.value;
  if (!value) throw new Error(`no done event in ${JSON.stringify(events.map((e) => e.type))}`);
  return value;
}
function nodeNames(turnId: string): string[] | undefined {
  const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, turnId)).get();
  if (!row || row.stats === null) return undefined;
  return (JSON.parse(row.stats as unknown as string) as { nodes?: { node: string }[] }).nodes?.map((n) => n.node);
}

describe("the routes import only the one path", () => {
  const read = (file: string) => readFileSync(join(import.meta.dir, "../src/routes", file), "utf8");
  test("routes/turn.ts and routes/turnBare.ts name no old-engine module and no path-deciding setting", () => {
    for (const file of ["turn.ts", "turnBare.ts"]) {
      const source = read(file);
      expect(source).not.toMatch(/from "@\/lib\/turnEngine"|from "@\/lib\/turnBareStream"|from "@\/lib\/bareCompletion"/);
      expect(source).not.toContain("turn.pipeline.next");
      expect(source).not.toMatch(/\brunTurn\(|\brunTurnStream\(|\brunBareTurnStream\(/);
    }
  });
});

describe("POST /api/turn/stream with the retired setting off: each case runs the default path", () => {
  test("a plain turn", async () => {
    const { client } = await owner();
    await withEngine(() => "Hello!", async () => {
      const events = await ndjson(await client.post("/api/turn/stream", { surface: "chat", text: "hi" }));
      expect(nodeNames(done(events).turn_id)).toContain("output_gate");
    });
  });

  test("bare: the raw model through the default path, marked bare", async () => {
    const { client } = await owner();
    await withEngine(() => "Plain.", async (seen) => {
      const events = await ndjson(await client.post("/api/turn/stream", { surface: "chat", text: "hi", bare: true }));
      const value = done(events);
      expect(value.bare).toBe(true);
      expect(nodeNames(value.turn_id)).toContain("output_gate");
      expect(seen.at(-1)!.messages[0]).toMatchObject({ role: "system", content: "You are a helpful assistant." });
    });
  });

  test("bare is refused for a non-admin with a 403", async () => {
    const { client: ownerClient } = await owner();
    const res = await ownerClient.post("/api/people", { displayName: "Marlow", role: "adult", secret: "0000" });
    const { id } = (await res.json()) as { id: string };
    const adult = new TestClient();
    await adult.post("/api/auth/verify-secret", { personId: id, secret: "0000" });
    expect((await adult.post("/api/turn/stream", { text: "hi", bare: true })).status).toBe(403);
  });

  test("a document: extracted, stored against the turn, and the reply is given", async () => {
    const { client } = await owner();
    __setTikaRunnerForTests(() => "The boiler service is due in March.");
    await withEngine(() => "Due in March.", async (seen) => {
      const events = await ndjson(await client.post("/api/turn/stream", { surface: "chat", text: "Summarize this", document_attachments: [{ name: "notes.pdf", media_type: "application/pdf", data: "data:application/pdf;base64,eA==" }] }));
      const value = done(events);
      expect(String(seen.at(-1)!.messages.at(-1)!.content)).toContain("The boiler service is due in March.");
      expect(db.select().from(attachments).all().map((a) => a.turnId)).toEqual([value.turn_id]);
    });
  });

  test("a document with bare is still refused, with its own code", async () => {
    const { client } = await owner();
    const res = await client.post("/api/turn/stream", { surface: "chat", text: "Summarize this", bare: true, document_attachments: [{ name: "notes.pdf", media_type: "application/pdf", data: "data:application/pdf;base64,eA==" }] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Document attachments are not available in bare mode", code: "document_attachments_unavailable" });
  });

  test("a bad document is a 400 invalid_document", async () => {
    const { client } = await owner();
    __setTikaRunnerForTests(() => { throw new Error("parser internals"); });
    const res = await client.post("/api/turn/stream", { surface: "chat", text: "Summarize this", document_attachments: [{ name: "x.pdf", media_type: "application/pdf", data: "data:application/pdf;base64,eA==" }] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "document extraction failed", code: "invalid_document" });
  });

  test("temporary: nothing stored", async () => {
    const { client } = await owner();
    await withEngine(() => "Okay.", async () => {
      const events = await ndjson(await client.post("/api/turn/stream", { surface: "chat", text: "hi", temporary: true }));
      expect(done(events).reply.text).toBe("Okay.");
    });
    expect(db.select().from(conversationTurns).all()).toEqual([]);
  });

  test("supersedes: the edited turn leaves the window and the row records it", async () => {
    const { client } = await owner();
    await withEngine(() => "Noted.", async (seen) => {
      const first = done(await ndjson(await client.post("/api/turn/stream", { surface: "chat", text: "we are painting the fence on Saturday" })));
      const edited = done(await ndjson(await client.post("/api/turn/stream", { surface: "chat", conversation_id: first.conversation_id, supersedes: first.turn_id, text: "we are painting the fence on Sunday" })));
      expect(JSON.stringify(seen.at(-1)!.messages)).not.toContain("on Saturday");
      expect(db.select().from(conversationTurns).where(eq(conversationTurns.id, edited.turn_id)).get()?.supersedes).toBe(first.turn_id);
    });
  });

  test("continuation: the partial text is replayed and the turn records what it continued", async () => {
    const { client } = await owner();
    await withEngine(() => "tuck in fresh soil.", async (seen) => {
      const first = done(await ndjson(await client.post("/api/turn/stream", { surface: "chat", text: "how do I repot a fern" })));
      const next = done(await ndjson(await client.post("/api/turn/stream", { surface: "chat", conversation_id: first.conversation_id, text: "continue", continuation_of: first.turn_id, continuation_text: "First loosen the root ball, then" })));
      expect(next.continued_from_turn_id).toBe(first.turn_id);
      expect(seen.at(-1)!.messages.map((m) => ({ role: m.role, content: String(m.content ?? "") })).slice(-2)).toEqual([
        { role: "assistant", content: "First loosen the root ball, then" },
        { role: "user", content: "Continue the incomplete answer above. Do not repeat any text already given. Start at the first missing point and finish the answer clearly." },
      ]);
    });
  });

  test("an empty continuation_text is a 400", async () => {
    const { client } = await owner();
    const res = await client.post("/api/turn/stream", { surface: "chat", text: "continue", continuation_of: "turn-x", continuation_text: "  " });
    expect(res.status).toBe(400);
    expect((await res.json() as { code: string }).code).toBe("invalid_input");
  });

  test("ephemeral for the Home card's exact question: stored nothing; for any other text: ignored and stored", async () => {
    const { client } = await owner();
    await withEngine(() => "Sunny.", async () => {
      await ndjson(await client.post("/api/turn/stream", { surface: "chat", text: weatherCardQuestion(undefined), ephemeral: true }));
      expect(db.select().from(conversationTurns).all()).toEqual([]);
      await ndjson(await client.post("/api/turn/stream", { surface: "chat", text: "what is the weather", ephemeral: true }));
      expect(db.select().from(conversationTurns).all()).toHaveLength(1);
    });
  });
});

describe("POST /api/turn with the retired setting off", () => {
  test("a blocking turn runs the default path, honouring supersedes and temporary", async () => {
    const { client } = await owner();
    await withEngine(() => "Hello!", async () => {
      const first = (await (await client.post("/api/turn", { surface: "chat", text: "hi" })).json()) as { turn_id: string; conversation_id: string };
      expect(nodeNames(first.turn_id)).toContain("output_gate");
      const edited = (await (await client.post("/api/turn", { surface: "chat", conversation_id: first.conversation_id, supersedes: first.turn_id, text: "hello there" })).json()) as { turn_id: string };
      expect(db.select().from(conversationTurns).where(eq(conversationTurns.id, edited.turn_id)).get()?.supersedes).toBe(first.turn_id);
      const temp = (await (await client.post("/api/turn", { surface: "chat", text: "secret", temporary: true })).json()) as { turn_id: string };
      expect(db.select().from(conversationTurns).where(eq(conversationTurns.id, temp.turn_id)).get()).toBeUndefined();
    });
  });
});
