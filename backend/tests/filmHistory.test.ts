import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { filmRuns, people } from "@/db/schema";
import { createConversation, listConversationTurns, logTurn } from "@/lib/conversationHistory";
import { resetDb } from "./reset-db";
import type { PersonRow } from "@/types";
import type { TurnValue } from "@/wire";
import { TestClient } from "./client";

const SAFE: TurnValue["safety"] = { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() };
function person(id: string): PersonRow {
  const now = new Date().toISOString();
  db.insert(people).values({ id, displayName: id, role: "owner", avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  return db.select().from(people).where(eq(people.id, id)).get() as PersonRow;
}
async function owner(): Promise<PersonRow> {
  await new TestClient().post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return db.select().from(people).where(eq(people.displayName, "Sage")).get() as PersonRow;
}
function run(owner: PersonRow, id: string) {
  const now = new Date().toISOString();
  db.insert(filmRuns).values({ id, personId: owner.id, idea: "A film", state: "done", stage: "Assemble", doneSteps: 6, totalSteps: 6, goAhead: true, createdAt: now, updatedAt: now }).run();
}
beforeEach(resetDb);

describe("film history", () => {
  test("returns a succeeded make_film run only to its owner and omits missing runs", async () => {
    const actor = await owner();
    const other = person("person-other123");
    run(actor, "film-owned");
    const conversation = createConversation(actor, { surface: "chat" });
    if (!conversation.ok) throw new Error(conversation.error);
    const outcome = (id: string, status = "succeeded") => ({ callId: `call-${id}`, packageId: "make_film", status, via: "tool_call", result: { data: { filmRunId: id } } }) as never;
    logTurn(actor, "chat", "make a film", { reply: { text: "Started." }, source: "plugin", safety: SAFE, conversation_id: conversation.value.id, turn_id: "film-turn-owner" }, { outcomes: [outcome("film-owned")] });
    logTurn(actor, "chat", "make missing film", { reply: { text: "Started." }, source: "plugin", safety: SAFE, conversation_id: conversation.value.id, turn_id: "film-turn-missing" }, { outcomes: [outcome("film-missing")] });
    logTurn(actor, "chat", "failed outcome", { reply: { text: "No." }, source: "plugin", safety: SAFE, conversation_id: conversation.value.id, turn_id: "film-turn-failed" }, { outcomes: [outcome("film-owned", "failed")] });
    const ownedRows = listConversationTurns(actor, conversation.value.id);
    expect(ownedRows.ok && ownedRows.value.find((row) => row.id === "film-turn-owner")?.film).toEqual({ id: "film-owned" });
    expect(ownedRows.ok && ownedRows.value.find((row) => row.id === "film-turn-missing")?.film).toBeUndefined();
    expect(ownedRows.ok && ownedRows.value.find((row) => row.id === "film-turn-failed")?.film).toBeUndefined();
    const otherRead = listConversationTurns(other, conversation.value.id);
    expect(otherRead.ok).toBe(false);
  });
});
