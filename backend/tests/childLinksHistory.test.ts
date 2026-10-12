// MINOR-SEARCH-01o: a stored turn's blocks and spec-sheet part reach a child with no web address; an adult keeps them.
import { describe, expect, test, beforeEach } from "bun:test";
import { db } from "@/db";
import { people, conversationTurns } from "@/db/schema";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { newConversationTurnId } from "@/lib/id";
import { resolveOrCreateConversation, listConversationTurns } from "@/lib/conversationHistory";

beforeEach(() => resetDb());

const BLOCK = { id: "blk-abcdef", kind: "spec_sheet", schema_version: 1, producer: "sample-package", alt: "Facts", provenance: "x", created_at: "2026-10-08T12:00:00.000Z", hlc: "1791478099338:0:abcdef", props: { title: "Facts", rows: [{ label: "Site", value: "[Frogs](https://example.com/f)" }] } };
const PART = { kind: "spec_sheet", tool_id: "almanac-date", title: "Today", rows: [{ label: "More", value: "https://example.com/day" }] };

async function seeded(role: "owner" | "child") {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  let id = db.select().from(people).where(eq(people.displayName, "Sage")).get()!.id;
  if (role === "child") {
    const res = await owner.post("/api/people", { displayName: "Bramble", role: "child" });
    id = ((await res.json()) as { id: string }).id;
  }
  const actor = db.select().from(people).where(eq(people.id, id)).get()!;
  const conv = resolveOrCreateConversation(actor, "chat");
  if (!conv.ok) throw new Error(conv.error);
  db.insert(conversationTurns).values({ id: newConversationTurnId(), personId: actor.id, surface: "chat", conversationId: conv.value.id, userText: "hi", replyText: "ok", source: "model", safetyAction: "allow", createdAt: "2026-10-08T12:00:00.000Z", hlc: "1791478099338:0:abcdef", blocks: JSON.stringify([BLOCK]), structuredPart: JSON.stringify(PART) } as typeof conversationTurns.$inferInsert).run();
  const turns = listConversationTurns(actor, conv.value.id);
  if (!turns.ok) throw new Error(turns.error);
  return turns.value[0]!;
}

describe("stored structured parts by band", () => {
  test("a child's history read holds no web address in the block or the part", async () => {
    const turn = await seeded("child");
    expect(JSON.stringify(turn.blocks)).not.toContain("http");
    expect(JSON.stringify(turn.structured_part)).not.toContain("http");
    expect(JSON.stringify(turn.blocks)).toContain("Frogs");
  });
  test("an adult keeps both as stored", async () => {
    const turn = await seeded("owner");
    expect(JSON.stringify(turn.blocks)).toContain("https://example.com/f");
    expect(JSON.stringify(turn.structured_part)).toContain("https://example.com/day");
  });
});
