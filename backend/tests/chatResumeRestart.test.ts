import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { conversationTurns, conversations, people } from "@/db/schema";
import { failInterruptedTurns, insertProvisionalTurn } from "@/lib/conversationHistory";
import type { PersonRow } from "@/types";

// CHAT-RESUME-01, the finding (2026-11-27): a hub restart loses an in-flight turn. The resume buffer (`resumeSessions` in routes/turn.ts) and the
// model call live in the old process's memory, so after a restart a resume is refused with turn_resume_unavailable, and the provisional turn
// row stays "running" (every reader skips it) unless the boot sweep ends it. The client's half (the plain "cut off" line) is in
// frontend/src/apps/chat/chatModelAdapter.test.ts.

beforeEach(() => resetDb());

async function owner(): Promise<TestClient> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return client;
}

describe("CHAT-RESUME-01: after a restart", () => {
  test("a resume for a turn the new process never held is refused with turn_resume_unavailable", async () => {
    const client = await owner();
    // A fresh process has no resume sessions: any token a client holds from before the restart is unknown to it.
    const res = await client.post("/api/turn/stream", { conversation_id: "conv-before-restart", turn_id: "turn-before-restart", resume_token: "token-before-restart", resume_from: 3 });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "turn_resume_unavailable" });
  });

  test("a turn left running by the restart ends as failed, and a finished one is untouched", async () => {
    await owner();
    const person = db.select().from(people).where(eq(people.displayName, "Sage")).get() as unknown as PersonRow;
    const now = new Date().toISOString();
    db.insert(conversations).values({ id: "conv-restart", personId: person.id, surface: "chat", title: "t", createdAt: now, updatedAt: now, hlc: "0" } as never).run();
    insertProvisionalTurn(person, "chat", "conv-restart", "turn-cut", "hello");
    insertProvisionalTurn(person, "chat", "conv-restart", "turn-done", "hi");
    db.update(conversationTurns).set({ status: "done" }).where(eq(conversationTurns.id, "turn-done")).run();
    expect(failInterruptedTurns()).toBe(1);
    expect(db.select().from(conversationTurns).where(eq(conversationTurns.id, "turn-cut")).get()?.status).toBe("failed");
    expect(db.select().from(conversationTurns).where(eq(conversationTurns.id, "turn-done")).get()?.status).toBe("done");
    expect(failInterruptedTurns()).toBe(0);
  });
});
