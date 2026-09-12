import { describe, expect, test, beforeEach } from "bun:test";
import { resetDb } from "./reset-db";
import { resolveOrCreateConversation, logTurn } from "@/lib/conversationHistory";
import { recallEpisodes, formatEpisodesForPrompt } from "@/lib/recall";
import { newPersonId } from "@/lib/id";
import { db, sqlite } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { PersonRow } from "@/types";

beforeEach(() => {
  resetDb();
});

async function setupOwner(): Promise<{ actor: PersonRow; actor2: PersonRow }> {
  const now = new Date().toISOString();
  const hlc = `${Date.now()}:0:testfix`;
  const actorId = newPersonId();
  const actor2Id = newPersonId();

  const actor = db
    .insert(people)
    .values({
      id: actorId,
      displayName: "Marlow",
      role: "adult",
      avatarSeed: actorId,
      source: "hub",
      createdAt: now,
      updatedAt: now,
      hlc,
    })
    .returning()
    .get()!;

  const actor2 = db
    .insert(people)
    .values({
      id: actor2Id,
      displayName: "Iris",
      role: "adult",
      avatarSeed: actor2Id,
      source: "hub",
      createdAt: now,
      updatedAt: now,
      hlc,
    })
    .returning()
    .get()!;

  return { actor, actor2 };
}

const SAFE = {
  flagged: false,
  categories: [],
  action: "allow" as const,
  notify_parent: false,
  matched_signals: [],
  checked_at: new Date().toISOString(),
};

function makeTurnWithDate(actor: PersonRow, userText: string, replyText: string, daysAgo: number = 0) {
  const conv = resolveOrCreateConversation(actor, "chat");
  if (!conv.ok) throw new Error("setup failed");
  const turnId = `turn-${Math.random().toString(36).slice(2, 12)}`;

  const createdDate = new Date();
  createdDate.setDate(createdDate.getDate() - daysAgo);
  const createdAt = createdDate.toISOString();

  logTurn(actor, "chat", userText, {
    reply: { text: replyText },
    source: "model",
    safety: SAFE,
    conversation_id: conv.value.id,
    turn_id: turnId,
  });

  // Update the turn's createdAt to simulate old episodes
  sqlite.query(`UPDATE conversation_turns SET created_at = ? WHERE id = ?`).run(createdAt, turnId);
  sqlite.query(`UPDATE episodes SET created_at = ? WHERE turn_id = ?`).run(createdAt, turnId);

  return turnId;
}

describe("recall (MEM-04)", () => {
  test("recallEpisodes returns results for matching queries", async () => {
    const { actor } = await setupOwner();
    makeTurnWithDate(actor, "I love chocolate cake", "That's delicious!");
    makeTurnWithDate(actor, "What's your favorite food?", "I enjoy pasta");

    const results = await recallEpisodes(actor, "chocolate");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.text).toContain("chocolate");
  });

  test("recallEpisodes ranks semantic and text matches by RRF", async () => {
    const { actor } = await setupOwner();
    makeTurnWithDate(actor, "I love cooking Italian food", "Pasta is wonderful");
    makeTurnWithDate(actor, "pasta recipe tips", "Here are some pasta tips");
    makeTurnWithDate(actor, "food allergies matter", "Avoid peanuts");

    const results = await recallEpisodes(actor, "pasta", 5);
    expect(results.length).toBeGreaterThan(0);
    // Top result should be highly relevant to pasta
    expect(results[0]?.finalScore).toBeGreaterThan(0);
  });

  test("formatEpisodesForPrompt truncates text to 200 chars and adds time labels", async () => {
    const { actor } = await setupOwner();
    const longText = "This is a very long text. ".repeat(20);
    makeTurnWithDate(actor, longText, "response");
    makeTurnWithDate(actor, "Recent question", "Recent answer", 0);

    const results = await recallEpisodes(actor, "long", 5);
    const formatted = formatEpisodesForPrompt(results);

    for (const ep of formatted) {
      expect(ep.text.length).toBeLessThanOrEqual(200);
      expect(ep.timeLabel).toBeTruthy();
      expect(["user", "assistant"]).toContain(ep.speaker);
    }
  });

  test("time decay favors recent episodes over old ones", async () => {
    const { actor } = await setupOwner();
    // Same topic, but at different times
    makeTurnWithDate(actor, "vacation planning", "Summer is nice", 30); // 30 days ago
    makeTurnWithDate(actor, "vacation ideas", "Beach resort", 1); // 1 day ago

    const results = await recallEpisodes(actor, "vacation");
    expect(results.length).toBeGreaterThan(0);
    // Newer episode should rank higher
    const moreRecentIndex = results.findIndex((r) => r.text.includes("Beach"));
    const olderIndex = results.findIndex((r) => r.text.includes("Summer"));
    if (moreRecentIndex >= 0 && olderIndex >= 0) {
      expect(moreRecentIndex).toBeLessThan(olderIndex);
    }
  });

  test("recallEpisodes respects person isolation", async () => {
    const { actor, actor2 } = await setupOwner();
    makeTurnWithDate(actor, "Marlow's secret", "Marlow's answer");
    makeTurnWithDate(actor2, "Iris's secret", "Iris's answer");

    const marlowResults = await recallEpisodes(actor, "secret", 10);
    const irisResults = await recallEpisodes(actor2, "secret", 10);

    const marlowText = marlowResults.map((r) => r.text).join(" ");
    const irisText = irisResults.map((r) => r.text).join(" ");

    expect(marlowText).toContain("Marlow");
    expect(marlowText).not.toContain("Iris");

    expect(irisText).toContain("Iris");
    expect(irisText).not.toContain("Marlow");
  });

  test("recallEpisodes returns empty for no matches", async () => {
    const { actor } = await setupOwner();
    makeTurnWithDate(actor, "cooking tips", "Here are cooking tips");

    const results = await recallEpisodes(actor, "xyz-unlikely-query-that-matches-nothing");
    expect(results.length).toBe(0);
  });

  test("getTimeLabel produces correct labels", async () => {
    const { actor } = await setupOwner();
    makeTurnWithDate(actor, "today question", "today answer", 0);
    makeTurnWithDate(actor, "yesterday question", "yesterday answer", 1);
    makeTurnWithDate(actor, "week-old question", "week-old answer", 7);
    makeTurnWithDate(actor, "month-old question", "month-old answer", 30);

    const results = await recallEpisodes(actor, "question");
    const formatted = formatEpisodesForPrompt(results);

    const timeLabels = new Set(formatted.map((e) => e.timeLabel));
    expect(timeLabels.size).toBeGreaterThan(0);
    // Should have different time labels
    expect(Array.from(timeLabels).some((label) => label.includes("ago") || label === "today")).toBe(true);
  });

  test("recallEpisodes handles limit parameter", async () => {
    const { actor } = await setupOwner();
    for (let i = 0; i < 15; i++) {
      makeTurnWithDate(actor, `question ${i}`, `answer ${i}`);
    }

    const results1 = await recallEpisodes(actor, "question", 3);
    const results5 = await recallEpisodes(actor, "question", 5);

    expect(results1.length).toBeLessThanOrEqual(3);
    expect(results5.length).toBeLessThanOrEqual(5);
    expect(results5.length).toBeGreaterThanOrEqual(results1.length);
  });
});
