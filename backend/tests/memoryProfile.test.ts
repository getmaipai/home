// MEM-AUDIT-01 (docs/design/memory-audit-and-redesign-2026-10-31.md,
// decision 1): the profile card. The jacket regression's other half
// (decision 9): a store holding an identity fact, a relationship fact
// naming the child and a "this week" state renders a card with the
// identity fact alone.
import { describe, expect, test, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { memoryRecords, people } from "@/db/schema";
import { newMemoryRecordId } from "@/lib/memoryId";
import { nextHlc } from "@/lib/hlc";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { TestClient } from "./client";
import { remember, PROFILE_SOURCE } from "@/lib/memory";
import { buildProfileCard, renderProfileCard, profileCardRuleLine, isProfileCardCategory, PROFILE_CARD_MAX_LINES, PROFILE_CARD_MAX_CHARS } from "@/lib/memoryProfile";
import type { PersonRow } from "@/types";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
});

async function ownerRow(): Promise<PersonRow> {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
}

function fact(actor: PersonRow, text: string, category: string, extra: { importance?: number; pinned?: boolean; tier?: "durable" | "episodic"; scope?: "person" | "household"; source?: string; sensitive?: boolean; valid_to?: string } = {}): { id: string; created_at: string } {
  if (category === "instruction") {
    // Decision 2's new category reaches the pinned spec enum with
    // MEM-AUDIT-02 (commons first); the column is free text, so the card
    // reads it today. Written straight into the store, as the judge will.
    const id = newMemoryRecordId("memory");
    const now = new Date().toISOString();
    sqlite
      .query("INSERT INTO memory_records (id, record_kind, text, category, tier, status, scope, person, source, importance, pinned, sensitive, uses, created_at, last_used_at, hlc) VALUES (?, 'memory', ?, 'instruction', 'durable', 'active', 'person', ?, 'test', ?, ?, 0, 0, ?, ?, ?)")
      .run(id, text, actor.id, extra.importance ?? 0.8, extra.pinned ? 1 : 0, now, now, nextHlc());
    return { id, created_at: now };
  }
  const made = remember(actor, { text, category: category as never, tier: extra.tier ?? "durable", scope: extra.scope ?? "person", person: extra.scope === "household" ? null : actor.id, source: extra.source ?? "test", importance: extra.importance ?? 0.7, pinned: extra.pinned ?? false, sensitive: extra.sensitive ?? false, valid_to: extra.valid_to ?? null });
  if (!made.ok) throw new Error(`setup failed: ${made.error}`);
  return made.value;
}

describe("buildProfileCard: the jacket case", () => {
  test("a store with an identity fact, a child relationship fact and a this-week state renders the identity fact alone", async () => {
    const actor = await ownerRow();
    const identity = fact(actor, "Sage is a software engineer who works from home", "identity", { importance: 0.9 });
    fact(actor, "Sage's daughter Nova is seven and loves the playground", "relationship", { importance: 0.8 });
    fact(actor, "this week Sage is stressed about a product launch", "state", { importance: 0.6, tier: "episodic" });

    const card = buildProfileCard(actor, new Date());
    expect(card.lines.map((line) => line.id)).toEqual([identity.id]);
    const rendered = renderProfileCard(card);
    expect(rendered).toBe(`Background about Sage. Use it only when it changes your answer; never mention or allude to it otherwise.\n(${identity.created_at.slice(0, 10)}) Sage is a software engineer who works from home`);
    expect(rendered).not.toMatch(/nova|daughter|this week/i);
  });

  test("the rule line names the person and tells the model it is background only", () => {
    expect(profileCardRuleLine("Sage")).toBe("Background about Sage. Use it only when it changes your answer; never mention or allude to it otherwise.");
  });
});

describe("buildProfileCard: membership", () => {
  test("identity and instruction always; a preference only when pinned; nothing else", () => {
    expect(isProfileCardCategory("identity", false)).toBe(true);
    expect(isProfileCardCategory("instruction", false)).toBe(true);
    expect(isProfileCardCategory("preference", true)).toBe(true);
    expect(isProfileCardCategory("preference", false)).toBe(false);
    for (const category of ["relationship", "state", "event", "project", "goal", "person", "place", "thing", "fact"]) {
      expect([category, isProfileCardCategory(category, true)]).toEqual([category, false]);
    }
  });

  test("a pinned relationship, event, project or goal never enters; a pinned preference and an instruction do", async () => {
    const actor = await ownerRow();
    const instruction = fact(actor, "Sage wants short answers with no bullet lists", "instruction", { importance: 0.8 });
    const pinnedPreference = fact(actor, "Sage takes coffee black", "preference", { importance: 0.5, pinned: true });
    fact(actor, "Sage prefers the window seat", "preference", { importance: 0.9 });
    fact(actor, "Sage's brother Vincent lives in Lisbon", "relationship", { importance: 0.95, pinned: true });
    fact(actor, "Sage is building a garden robot", "project", { importance: 0.95, pinned: true });
    fact(actor, "Sage wants to run a marathon next spring", "goal", { importance: 0.95, pinned: true });
    fact(actor, "Sage's dentist appointment is on Friday", "event", { importance: 0.95, pinned: true });

    const ids = buildProfileCard(actor).lines.map((line) => line.id);
    expect(ids).toEqual([instruction.id, pinnedPreference.id]);
  });

  test("a legacy profile paragraph (PROFILE_SOURCE) is never a card member, pinned identity or not", async () => {
    const actor = await ownerRow();
    fact(actor, "Sage is a night owl; this week she is tired and her daughter Nova has a cold", "identity", { importance: 0.9, pinned: true, source: PROFILE_SOURCE });
    const own = fact(actor, "Sage is a night owl", "identity", { importance: 0.9 });
    expect(buildProfileCard(actor).lines.map((line) => line.id)).toEqual([own.id]);
  });

  test("only the person's own, active, durable, person-scope, in-date rows; sensitive rows withheld on request", async () => {
    const actor = await ownerRow();
    const other = new TestClient();
    await other.post("/api/people", { displayName: "Marlow", role: "adult" });
    const keep = fact(actor, "Sage is left-handed", "identity");
    fact(actor, "the household is vegetarian", "identity", { scope: "household" });
    fact(actor, "Sage used to be a nurse", "identity", { tier: "episodic" });
    const archived = fact(actor, "Sage is an early riser", "identity");
    db.update(memoryRecords).set({ status: "archived" }).where(eq(memoryRecords.id, archived.id)).run();
    fact(actor, "Sage is on a temporary contract", "identity", { valid_to: "2020-01-01T00:00:00.000Z" });
    const sensitive = fact(actor, "Sage is in recovery", "identity", { sensitive: true });

    expect(buildProfileCard(actor).lines.map((line) => line.id).sort()).toEqual([keep.id, sensitive.id].sort());
    expect(buildProfileCard(actor, new Date(), { withholdSensitive: true }).lines.map((line) => line.id)).toEqual([keep.id]);
  });
});

describe("buildProfileCard: order and budget", () => {
  test("most important first, then newest; at most PROFILE_CARD_MAX_LINES (8)", async () => {
    const actor = await ownerRow();
    expect(PROFILE_CARD_MAX_LINES).toBe(8);
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push(fact(actor, `Sage fact number ${i}`, "identity", { importance: 0.5 }).id);
    // Ten rows at equal importance; give them distinct created_at values, oldest first.
    ids.forEach((id, i) => db.update(memoryRecords).set({ createdAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString() }).where(eq(memoryRecords.id, id)).run());
    const top = fact(actor, "Sage is the household owner", "identity", { importance: 0.95 });
    db.update(memoryRecords).set({ createdAt: new Date(Date.UTC(2025, 0, 1)).toISOString() }).where(eq(memoryRecords.id, top.id)).run();

    const card = buildProfileCard(actor);
    expect(card.lines.length).toBe(8);
    // The most important first even though it is the oldest, then the newest seven of the rest.
    expect(card.lines.map((line) => line.id)).toEqual([top.id, ...ids.slice(3).reverse()]);
    // Deterministic: the same store gives the same card.
    expect(buildProfileCard(actor).lines.map((line) => line.id)).toEqual(card.lines.map((line) => line.id));
  });

  test("the fact lines together never pass PROFILE_CARD_MAX_CHARS (400); the least important are dropped to fit", async () => {
    const actor = await ownerRow();
    expect(PROFILE_CARD_MAX_CHARS).toBe(400);
    const long = (n: number) => `Sage ${"really ".repeat(20)}likes thing number ${n}`; // about 160 characters each
    const a = fact(actor, long(1), "identity", { importance: 0.9 });
    const b = fact(actor, long(2), "identity", { importance: 0.8 });
    fact(actor, long(3), "identity", { importance: 0.7 });
    fact(actor, long(4), "identity", { importance: 0.6 });

    const card = buildProfileCard(actor);
    expect(card.lines.map((line) => line.id)).toEqual([a.id, b.id]);
    expect(card.lines.map((line) => `(${line.at.slice(0, 10)}) ${line.text}`).join("\n").length).toBeLessThanOrEqual(400);
  });

  test("a person with no standing fact gets an empty card", async () => {
    const actor = await ownerRow();
    fact(actor, "Sage's daughter Nova is seven", "relationship");
    expect(buildProfileCard(actor).lines).toEqual([]);
  });
});
