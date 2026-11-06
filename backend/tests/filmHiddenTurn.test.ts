import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { conversationTurns, musicJobs, people } from "@/db/schema";
import { resolveOrCreateConversation, logTurn, listConversationTurns, buildConversationWindow, getConversation } from "@/lib/conversationHistory";
import { listLibrary } from "@/lib/library";
import { storeFile } from "@/lib/attachments";
import { musicJobIdsByTurn } from "@/lib/music/store";
import { resetDb } from "./reset-db";
import { testM4a } from "./musicFixture";
import type { PersonRow } from "@/types";
import type { TurnValue } from "@/wire";

const SAFE: TurnValue["safety"] = { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() };
function person(): PersonRow {
  const now = new Date().toISOString();
  db.insert(people).values({ id: "person-filmhidden", displayName: "Sage", role: "owner", avatarSeed: "sage", source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  return db.select().from(people).all()[0]!;
}
beforeEach(resetDb);

describe("film internal turn", () => {
  test("keeps the song in Library while hiding its runner turn and music card", async () => {
    const actor = person();
    const resolved = resolveOrCreateConversation(actor, "chat");
    if (!resolved.ok) throw new Error(resolved.error);
    const conversation = resolved.value;
    logTurn(actor, "chat", "Make a film", { reply: { text: "Making your film." }, source: "plugin", plugin_id: "film", safety: SAFE, conversation_id: conversation.id, turn_id: "turn-filmhidden" });
    const saved = storeFile(actor, { conversationId: conversation.id, turnId: "turn-filmhidden", mediaType: "audio/mp4", bytes: testM4a(), provenance: "music-gen:{\"kind\":\"music\",\"job_id\":\"film-song-job\"}", retention: "kept", name: "Film song", deduplicate: false });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const now = new Date().toISOString();
    db.insert(musicJobs).values({ id: "film-song-job", personId: actor.id, conversationId: conversation.id, turnId: "turn-filmhidden", task: "text2music", request: "{}", state: "done", stage: "ready", progress: 1, fileId: saved.value.id, createdAt: now, updatedAt: now, hlc: "2:0:test" }).run();
    const realTurn = logTurn(actor, "chat", "Could you make that a quiet film?", { reply: { text: "Yes, I can." }, source: "model", safety: SAFE, conversation_id: conversation.id, turn_id: "turn-realchat" }, { branchFrom: "turn-filmhidden" });
    const history = listConversationTurns(actor, conversation.id);
    expect(history.ok).toBe(true);
    if (!history.ok) return;
    expect(history.value).toHaveLength(1);
    expect(history.value[0]?.userText).toBe("Could you make that a quiet film?");
    expect(JSON.stringify(history.value)).not.toContain("Make a film");
    expect(history.value.every((row) => !("music" in row))).toBe(true);
    expect(musicJobIdsByTurn(actor, ["turn-filmhidden"]).has("turn-filmhidden")).toBe(true);
    const refreshed = getConversation(actor, conversation.id);
    if (!refreshed.ok) throw new Error(refreshed.error);
    const window = await buildConversationWindow(refreshed.value, { historyBudgetTokens: 4096 });
    expect(JSON.stringify(window.messages)).not.toContain("Make a film");
    expect(window.turnIds).toContain(realTurn.id);
    expect(window.messages.some((message) => message.role === "user" && message.content.includes("Could you make that a quiet film?"))).toBe(true);
    expect(realTurn.userText).toBe("Could you make that a quiet film?");
    expect(db.select().from(conversationTurns).where(eq(conversationTurns.pluginId, "film")).get()?.userText).toBe("Make a film");
    expect(listLibrary(actor, { type: "audio", limit: 60 }).items.some((item) => item.id === saved.value.id)).toBe(true);
  });
});
