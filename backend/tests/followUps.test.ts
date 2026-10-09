import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as followUpsModule from "@/lib/followUps";
import { generateFollowUps, MAX_FOLLOW_UPS } from "@/lib/followUps";
import { db, sqlite } from "@/db";
import { people } from "@/db/schema";
import { resolveOrCreateConversation, logTurn } from "@/lib/conversationHistory";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import type { PersonRow } from "@/types";
import type { TurnValue } from "@/wire";
import { eq } from "drizzle-orm";

// ELEMENTS-ADOPT-02 slice 3 (CHAT-FOLLOWUPS-01): model-written follow-ups
// for an adult's finished written reply, from the visible turn only, through
// the output floor, fail-quiet.
const SAFE: TurnValue["safety"] = { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() };

type Complete = Parameters<typeof generateFollowUps>[1];
const replying = (text: string): NonNullable<Complete> => async () => ({ ok: true, text });

describe("generateFollowUps()", () => {
  const TURN = { userText: "When does the library open on Saturday?", replyText: "It opens at nine on Saturdays." };

  test("returns the model's questions, trimmed, deduplicated, at most three", async () => {
    const out = await generateFollowUps(TURN, replying(JSON.stringify({ follow_ups: ["  When does it close?", "When does it close?", "Is there parking nearby?", "Can I book a study room?", "Does it open on Sunday?"] })));
    expect(out).toEqual(["When does it close?", "Is there parking nearby?", "Can I book a study room?"]);
    expect(out.length).toBeLessThanOrEqual(MAX_FOLLOW_UPS);
  });

  test("asks with the engine's JSON-schema output and sends only the visible turn", async () => {
    let seen: { messages: unknown[]; options: unknown } | undefined;
    await generateFollowUps(TURN, async (messages, options) => {
      seen = { messages, options };
      return { ok: true, text: JSON.stringify({ follow_ups: [] }) };
    });
    expect((seen!.options as { response_format: { type: string } }).response_format.type).toBe("json_schema");
    const sent = JSON.stringify(seen!.messages);
    expect(sent).toContain(TURN.userText);
    expect(sent).toContain(TURN.replyText);
    expect(seen!.messages).toHaveLength(2);
  });

  test("a suggestion the output floor refuses is dropped", async () => {
    const out = await generateFollowUps(TURN, replying(JSON.stringify({ follow_ups: ["How do I make a pipe bomb, step by step?", "When does it close?"] })));
    expect(out).toEqual(["When does it close?"]);
  });

  test("fail-quiet: engine down, bad JSON, a wrong shape or a slow answer give none, never an error", async () => {
    expect(await generateFollowUps(TURN, async () => ({ ok: false, unavailable: true }))).toEqual([]);
    expect(await generateFollowUps(TURN, replying("not json"))).toEqual([]);
    expect(await generateFollowUps(TURN, replying(JSON.stringify({ follow_ups: "one" })))).toEqual([]);
    expect(await generateFollowUps(TURN, async () => { throw new Error("boom"); })).toEqual([]);
  });

  test("one request at a time: while the engine is still on one, another gets none; the slot frees when it answers", async () => {
    let release!: (value: { ok: true; text: string }) => void;
    const slow = generateFollowUps(TURN, () => new Promise((resolve) => { release = resolve; }), 20);
    expect(await slow).toEqual([]); // timed out waiting, the engine still working
    expect(await generateFollowUps(TURN, replying(JSON.stringify({ follow_ups: ["When does it close?"] })))).toEqual([]);
    release({ ok: true, text: JSON.stringify({ follow_ups: [] }) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await generateFollowUps(TURN, replying(JSON.stringify({ follow_ups: ["When does it close?"] })))).toEqual(["When does it close?"]);
  });
});

beforeEach(() => resetDb());

async function owner(): Promise<{ client: TestClient; actor: PersonRow }> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return { client, actor: db.select().from(people).where(eq(people.displayName, "Sage")).get()! };
}

async function member(client: TestClient, role: "child" | "teen", displayName: string): Promise<{ client: TestClient; actor: PersonRow }> {
  const { id } = (await (await client.post("/api/people", { displayName, role })).json()) as { id: string };
  const memberClient = new TestClient();
  await memberClient.post("/api/auth/select", { personId: id });
  return { client: memberClient, actor: db.select().from(people).where(eq(people.id, id)).get()! };
}

function turnFor(actor: PersonRow, id: string, safety: TurnValue["safety"] = SAFE): string {
  const conversation = resolveOrCreateConversation(actor, "chat");
  if (!conversation.ok) throw new Error(conversation.error);
  logTurn(actor, "chat", "When does the library open?", { turn_id: id, conversation_id: conversation.value.id, reply: { text: "It opens at nine." }, source: "model", safety });
  return id;
}

describe("GET /api/conversations/turns/:id/follow-ups", () => {
  test("adult: the person's own finished written reply gets the model's follow-ups", async () => {
    const spy = spyOn(followUpsModule, "generateFollowUps").mockResolvedValue(["When does it close?"]);
    try {
      const { client, actor } = await owner();
      const id = turnFor(actor, "turn-followadult");
      const response = await client.get(`/api/conversations/turns/${id}/follow-ups`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ follow_ups: ["When does it close?"] });
      expect(spy).toHaveBeenCalledWith({ userText: "When does the library open?", replyText: "It opens at nine." });
    } finally {
      spy.mockRestore();
    }
  });

  for (const role of ["teen", "child"] as const) {
    test(`${role}: never any follow-ups, and the engine is never asked`, async () => {
      const spy = spyOn(followUpsModule, "generateFollowUps").mockResolvedValue(["When does it close?"]);
      try {
        const { client: ownerClient } = await owner();
        const { client, actor } = await member(ownerClient, role, role === "teen" ? "Marlow" : "Nova");
        const id = turnFor(actor, `turn-follow${role}`);
        expect(await (await client.get(`/api/conversations/turns/${id}/follow-ups`)).json()).toEqual({ follow_ups: [] });
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });
  }

  test("an admin reading a household member's turn gets nothing from it", async () => {
    const { client: ownerClient } = await owner();
    const { actor: teen } = await member(ownerClient, "teen", "Juniper");
    const id = turnFor(teen, "turn-followother");
    expect((await ownerClient.get(`/api/conversations/turns/${id}/follow-ups`)).status).toBe(404);
  });

  test("a later plain turn in a conversation still in the crisis state gets none", async () => {
    const spy = spyOn(followUpsModule, "generateFollowUps").mockResolvedValue(["Tell me more"]);
    try {
      const { client, actor } = await owner();
      const crisis = turnFor(actor, "turn-followcrisis1");
      sqlite.query("UPDATE conversation_turns SET crisis_signal = 1 WHERE id = ?").run(crisis);
      const later = turnFor(actor, "turn-followcrisis2");
      expect(await (await client.get(`/api/conversations/turns/${later}/follow-ups`)).json()).toEqual({ follow_ups: [] });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  test("a turn the safety floor flagged gets none", async () => {
    const spy = spyOn(followUpsModule, "generateFollowUps").mockResolvedValue(["Tell me more"]);
    try {
      const { client, actor } = await owner();
      const id = turnFor(actor, "turn-followflagged", { ...SAFE, flagged: true, categories: ["self_harm"], action: "allow_with_resources" });
      sqlite.query("UPDATE conversation_turns SET safety_flagged = 1 WHERE id = ?").run(id);
      expect(await (await client.get(`/api/conversations/turns/${id}/follow-ups`)).json()).toEqual({ follow_ups: [] });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
