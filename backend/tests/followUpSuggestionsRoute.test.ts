import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { appendTemporaryTurn, discardTemporarySessions, resolveOrCreateConversation, logTurn } from "@/lib/conversationHistory";
import type { PersonRow } from "@/types";
import type { TurnValue } from "@/wire";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { child, owner, teen } from "./support/testAuth";

const SAFE: TurnValue["safety"] = {
  flagged: false,
  categories: [],
  action: "allow",
  notify_parent: false,
  matched_signals: [],
  checked_at: new Date().toISOString(),
};

beforeEach(() => resetDb());

function completedTurn(actor: PersonRow, id: string): void {
  const conversation = resolveOrCreateConversation(actor, "chat");
  if (!conversation.ok) throw new Error(conversation.error);
  logTurn(actor, "chat", "Why do leaves change color?", {
    turn_id: id,
    conversation_id: conversation.value.id,
    reply: { text: "Chlorophyll breaks down in autumn." },
    source: "model",
    safety: SAFE,
  });
}

describe("POST /api/conversations/turns/:id/follow-up-suggestions", () => {
  test("a child or teen can never request generated suggestions", async () => {
    const household = await owner();
    const childAccount = await child(household.client);
    const teenClient = await teen(household.client);
    const teenRow = db.select().from(people).where(eq(people.displayName, "Bramble")).get() as PersonRow | undefined;
    if (!teenRow) throw new Error("teen row not found");

    completedTurn(childAccount.row, "turn-child-followup");
    completedTurn(teenRow, "turn-teen-followup");
    const childResponse = await childAccount.client.post("/api/conversations/turns/turn-child-followup/follow-up-suggestions");
    const teenResponse = await teenClient.post("/api/conversations/turns/turn-teen-followup/follow-up-suggestions");
    expect(childResponse.status).toBe(200);
    expect(await childResponse.json()).toEqual({ suggestions: [] });
    expect(teenResponse.status).toBe(200);
    expect(await teenResponse.json()).toEqual({ suggestions: [] });
  });

  test("Incognito turns have no route-visible row, and an adult cannot request another person's turn", async () => {
    const household = await owner();
    const childAccount = await child(household.client);
    completedTurn(childAccount.row, "turn-other-person");
    const temporary = resolveOrCreateConversation(household.row, "chat", undefined, { temporary: true });
    if (!temporary.ok) throw new Error(temporary.error);
    appendTemporaryTurn(household.row, "chat", "Why do leaves change color?", {
      turn_id: "turn-incognito-only",
      conversation_id: temporary.value.id,
      reply: { text: "Chlorophyll breaks down in autumn." },
      source: "model",
      safety: SAFE,
    }, {});

    const incognito = await household.client.post("/api/conversations/turns/turn-incognito-only/follow-up-suggestions");
    const foreign = await household.client.post("/api/conversations/turns/turn-other-person/follow-up-suggestions");
    expect(incognito.status).toBe(404);
    expect(foreign.status).toBe(404);
    discardTemporarySessions(household.row.id);
  });

  test("requires authentication", async () => {
    const client = new TestClient();
    expect((await client.post("/api/conversations/turns/turn-unauth/follow-up-suggestions")).status).toBe(401);
  });
});
