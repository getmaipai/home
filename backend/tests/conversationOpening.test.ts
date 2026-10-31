import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { memoryRecords, openQuestions, people } from "@/db/schema";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { archive, forget, forgetByIds, remember, runMaintenance } from "@/lib/memory";
import { contextToMessages } from "@/lib/turnMachine/messages";
import {
  conversationOpening,
  dayPartAt,
  readOpeningRecords,
  recordThreadOffer,
  renderConversationOpening,
  sinceLastAt,
  type OpeningPerson,
  type OpeningRecord,
  type OpeningTurns,
} from "@/lib/conversationOpening";
import { carriesNoTask } from "@/lib/turnSignal";
import type { PersonRow } from "@/types";

const NOW = new Date(2026, 9, 28, 9, 30, 0);
const DAY = 86_400_000;
const iso = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * DAY).toISOString();

const adult: OpeningPerson = { id: "p1", band: "adult", pickUpThreads: true };
const turns: OpeningTurns = { firstTurn: true, noTask: true, lastTurnAt: iso(3), sharedOrUnidentified: false, incognito: false };

function record(over: Partial<OpeningRecord> = {}): OpeningRecord {
  return {
    id: "m1", scope: "person", person: "p1", category: "event", text: "dentist appointment on Tuesday", status: "archived", archivedReason: "end_date",
    deletedAt: null, expiredAt: iso(2), createdAt: iso(6), validTo: iso(2).slice(0, 10), supersededBy: null, sensitive: false, offerWithheld: null,
    sourceReplaced: false, alreadyOffered: false, ...over,
  };
}

describe("conversationOpening gates", () => {
  test("buckets", () => {
    expect(dayPartAt(new Date(2026, 9, 28, 6))).toBe("morning");
    expect(dayPartAt(new Date(2026, 9, 28, 13))).toBe("afternoon");
    expect(dayPartAt(new Date(2026, 9, 28, 19))).toBe("evening");
    expect(dayPartAt(new Date(2026, 9, 28, 2))).toBe("night");
    expect(sinceLastAt(iso(0.1), NOW)).toBe("same_day");
    expect(sinceLastAt(iso(3), NOW)).toBe("few_days");
    expect(sinceLastAt(iso(20), NOW)).toBe("few_weeks");
    expect(sinceLastAt(iso(90), NOW)).toBe("months");
  });

  test("an event whose end date passed is offered", () => {
    const o = conversationOpening(adult, NOW, turns, [record()]);
    expect(o?.thread).toMatchObject({ record_id: "m1", kind: "event" });
    expect(o?.since_last).toBe("few_days");
  });

  test("a child gets the time facts only, a teen with the switch off the same", () => {
    expect(conversationOpening({ ...adult, band: "child" }, NOW, turns, [record()])?.thread).toBeUndefined();
    expect(conversationOpening({ ...adult, band: "teen", pickUpThreads: false }, NOW, turns, [record()])?.thread).toBeUndefined();
    expect(conversationOpening({ ...adult, band: "teen" }, NOW, turns, [record()])?.thread).toBeDefined();
  });

  test("nothing on a shared surface, an unidentified speaker, Incognito, a later turn or a turn with a task", () => {
    expect(conversationOpening(adult, NOW, { ...turns, sharedOrUnidentified: true }, [record()])).toBeNull();
    expect(conversationOpening(adult, NOW, { ...turns, incognito: true }, [record()])).toBeNull();
    expect(conversationOpening(adult, NOW, { ...turns, firstTurn: false }, [record()])).toBeNull();
    expect(conversationOpening(adult, NOW, { ...turns, noTask: false }, [record()])).toBeNull();
    expect(conversationOpening(adult, NOW, { ...turns, lastTurnAt: null }, [record()])).toBeNull();
  });

  test.each([
    ["forgotten", { archivedReason: "forgotten", deletedAt: iso(1) }],
    ["person-archived", { archivedReason: "person" }],
    ["decayed", { archivedReason: "decay" }],
    ["edit-retired", { archivedReason: "edit" }],
    ["unset reason", { archivedReason: null }],
    ["edit-superseded source", { sourceReplaced: true }],
    ["already offered", { alreadyOffered: true }],
    ["sensitive", { sensitive: true }],
    ["offer withheld", { offerWithheld: true }],
    ["another person's", { person: "p2" }],
  ] as const)("a %s event is never offered", (_name, over) => {
    expect(conversationOpening(adult, NOW, turns, [record(over)])?.thread).toBeUndefined();
  });

  test("a goal is offered only for 14 days", () => {
    const goal = (days: number) => record({ id: "g", category: "goal", status: "active", archivedReason: null, expiredAt: null, createdAt: iso(days), validTo: null, text: "run a 10k" });
    expect(conversationOpening(adult, NOW, turns, [goal(13)])?.thread?.kind).toBe("goal");
    expect(conversationOpening(adult, NOW, turns, [goal(15)])?.thread).toBeUndefined();
  });

  test("a mood is carried only while valid and rendered only when care is required", () => {
    const state = record({ id: "s", category: "state", status: "active", archivedReason: null, expiredAt: null, createdAt: iso(2), validTo: null, text: "stressed about a deadline" });
    const o = conversationOpening(adult, NOW, turns, [state])!;
    expect(o.mood?.record_id).toBe("s");
    expect(renderConversationOpening(o, { care: false })).not.toContain("stressed");
    expect(renderConversationOpening(o, { care: true })).toContain("stressed");
    expect(conversationOpening(adult, NOW, turns, [{ ...state, createdAt: iso(9) }])?.mood).toBeUndefined();
  });

  test("the render carries no record id (rule 6a is about logs, the prompt names the subject only)", () => {
    const text = renderConversationOpening(conversationOpening(adult, NOW, turns, [record()])!, { care: false });
    expect(text).not.toContain("m1");
    expect(text).toContain("dentist");
  });
});

describe("carriesNoTask", () => {
  test("a bare greeting or a greeting with an inform has no task; a question does", () => {
    expect(carriesNoTask("hi", [{ act: "greeting" }])).toBe(true);
    expect(carriesNoTask("hey, I'm back", [{ act: "greeting" }, { act: "inform" }])).toBe(true);
    expect(carriesNoTask("hi, what is the weather", [{ act: "greeting" }, { act: "question" }])).toBe(false);
  });
});

describe("rule 4: the stable prefix is identical with and without the opening", () => {
  test("only the final volatile message differs, on turn 1 and turn 2", () => {
    const plan = { moves: {}, playfulness: "allowed", max_sentences: 2, max_words: 30, age_band: "adult", vocabulary_level: "standard", explanation_style: "concrete", trusted_adult_move: "none", content_disclosure: "full", react_move: null } as never;
    const persona = { id: "t", name: "T" } as never;
    const profile = [{ id: "profile", text: "Sage likes tea.", source: "profile" as const, subjects: [], disclosure: "child_ok" as const }];
    const opening = [{ id: "opening", text: "It is morning. You last talked with this person a few days ago.", source: "opening" as const, subjects: [], disclosure: "child_ok" as const }];
    const run = (items: typeof profile) => contextToMessages(items as never, "hi", persona, plan, { clauses: [] } as never, "written");
    const without = run(profile);
    const withOpening = run([...profile, ...opening] as never);
    expect(withOpening[0]).toEqual(without[0]);
    expect(withOpening.length).toBe(without.length);
    expect(withOpening[withOpening.length - 1]!.content).toContain("Opening this conversation:");
    expect(without[without.length - 1]!.content).not.toContain("Opening this conversation:");
    // turn 2 has no opening item at all: its prefix is the same bytes again.
    expect(run(profile)[0]).toEqual(without[0]);
  });
});

describe("archive reasons, the reader and forget", () => {
  beforeEach(() => resetDb());

  async function sage(): Promise<PersonRow> {
    await new TestClient().post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    return db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  }
  const mk = (actor: PersonRow, over: Record<string, unknown> = {}) => {
    const r = remember(actor, { text: "dentist on Tuesday", category: "event", tier: "episodic", scope: "person", person: actor.id, source: "test", importance: 0.5, ...over } as never);
    if (!r.ok) throw new Error(String(r.error));
    return r.value.id as string;
  };
  const reasonOf = (id: string) => db.select().from(memoryRecords).where(eq(memoryRecords.id, id)).get()!.archivedReason;

  test("the person's archive, the end date, the state expiry and forget each write their reason", async () => {
    const actor = await sage();
    const byPerson = mk(actor);
    archive(actor, byPerson);
    expect(reasonOf(byPerson)).toBe("person");

    // MEM-AUDIT-04: a dated event ends as "event_passed" once its grace has run; any other record ends as "end_date".
    const ended = mk(actor, { text: "away on a trip", category: "state", valid_to: "2020-01-01T00:00:00.000Z" });
    const passed = mk(actor, { text: "trip", valid_to: "2020-01-01T00:00:00.000Z" });
    runMaintenance();
    expect(reasonOf(ended)).toBe("end_date");
    expect(reasonOf(passed)).toBe("event_passed");

    const forgotten = mk(actor, { text: "secret" });
    forgetByIds(actor, [forgotten]);
    expect(reasonOf(forgotten)).toBe("forgotten");

    const all = mk(actor, { text: "another" });
    forget(actor, actor.id);
    expect(reasonOf(all)).toBe("forgotten");
  });

  // MEM-AUDIT-04: an active event's own end date, not its creation date, puts
  // it in the window. Told about three weeks ahead and ended yesterday, it is
  // still inside the grace period, so the reader must find it by `valid_to`.
  test("an active event created 20 days ago whose end date was yesterday is read and offered", async () => {
    const actor = await sage();
    const now = new Date();
    const id = mk(actor, { text: "the recital", valid_to: new Date(now.getTime() - DAY).toISOString() });
    const { sqlite } = await import("@/db");
    sqlite.query("UPDATE memory_records SET created_at = ? WHERE id = ?").run(new Date(now.getTime() - 20 * DAY).toISOString(), id);
    const rows = readOpeningRecords(actor.id, now);
    expect(rows.map((r) => [r.id, r.status])).toEqual([[id, "active"]]);
    const opening = conversationOpening({ id: actor.id, band: "adult", pickUpThreads: true }, now, { ...turns, lastTurnAt: new Date(now.getTime() - 3 * DAY).toISOString() }, rows);
    expect(opening?.thread).toMatchObject({ record_id: id, kind: "event", subject: "the recital" });
    // A stale active event (ended three weeks ago, never archived) stays out of the read, as before.
    const old = mk(actor, { text: "an old picnic", valid_to: new Date(now.getTime() - 21 * DAY).toISOString() });
    sqlite.query("UPDATE memory_records SET created_at = ? WHERE id = ?").run(new Date(now.getTime() - 30 * DAY).toISOString(), old);
    expect(readOpeningRecords(actor.id, now).map((r) => r.id)).toEqual([id]);
  });

  test("the reader returns an ended event, marks an offered one, and forget removes the thread rows", async () => {
    const actor = await sage();
    const id = mk(actor, { text: "recital", valid_to: new Date(Date.now() - DAY).toISOString() });
    runMaintenance();
    const rows = readOpeningRecords(actor.id, new Date());
    expect(rows.map((r) => r.id)).toContain(id);
    expect(rows.find((r) => r.id === id)!.alreadyOffered).toBe(false);

    recordThreadOffer(actor.id, "c1", id, "turn-1");
    expect(readOpeningRecords(actor.id, new Date()).find((r) => r.id === id)!.alreadyOffered).toBe(true);
    const row = db.select().from(openQuestions).where(eq(openQuestions.subjectId, id)).get()!;
    expect(row.kind).toBe("thread");
    expect(row.status).toBe("asked");
    expect(row.text).not.toContain("recital");

    forgetByIds(actor, [id]);
    expect(db.select().from(openQuestions).where(eq(openQuestions.subjectId, id)).all()).toHaveLength(0);
  });
});
