// PERUSE-2026-10-25: the per-use consent ask store and its route. Adult content of another household adult has exactly one way
// to a proof: an ask the pictured adult approved. These tests pin every other way shut.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { likenessAsks, people as peopleTable } from "@/db/schema";
import { setValue } from "@/lib/settings";
import { createBenchPeople, type BenchPeople } from "../scripts/bench/conversationRunner";
import { ASK_APPROVED_MS, ASK_HOURLY_CAP, ASK_WAIT_MS, askApproved, askFor, askStatus, asksFor, attachJob, cancelAsk, decideAsk, expireAsks, onAskChange, openAsk, promptHash, releaseAsk, type AskEvent, type OpenAskInput } from "@/lib/likeness/ask";
import { __setStackTrustForTests } from "@/lib/likeness/proof";
import { decideLikeness, ADULT_CONTENT_OTHER_SUBJECT_LINE } from "@/lib/likeness/decide";
import { likenessStillAllowed } from "@/lib/likeness/guard";
import type { PersonRow } from "@/types";

let bench: BenchPeople;
let sage: PersonRow;
let iris: PersonRow;
let events: AskEvent[];
let off: () => void;

function addPerson(name: string, role: string): PersonRow {
  const now = new Date().toISOString();
  db.insert(peopleTable).values({ id: `p-${name.toLowerCase()}`, displayName: name, role, avatarSeed: name, source: "test", createdAt: now, updatedAt: now, hlc: "1:0:test00" }).run();
  return db.select().from(peopleTable).where(eq(peopleTable.id, `p-${name.toLowerCase()}`)).get()! as PersonRow;
}
const perUse = (on: boolean) => expect(setValue(bench.owner, "household", "likeness.per_use", on).ok).toBe(true);
const input = (over: Partial<OpenAskInput> = {}): OpenAskInput => ({ subjectId: iris.id, requesterId: sage.id, medium: "picture", prompt: "Iris on a beach at sunset", count: 1, styleName: "Iris", styleIds: ["style-iris"], source: "chat", ...over });
function open(over: Partial<OpenAskInput> = {}): string {
  const result = openAsk(input(over));
  if (!result.ok) throw new Error(result.line);
  return result.id;
}
const row = (id: string) => db.select().from(likenessAsks).where(eq(likenessAsks.id, id)).get()!;
const release = (id: string, over: Record<string, unknown> = {}) => releaseAsk({ askId: id, jobId: "job-1", subjectId: iris.id, requesterId: sage.id, medium: "picture", prompt: "Iris on a beach at sunset", styleIds: ["style-iris"], ...over } as Parameters<typeof releaseAsk>[0]);

beforeEach(() => {
  resetDb();
  bench = createBenchPeople();
  sage = addPerson("Sage", "adult");
  iris = addPerson("Iris", "adult");
  perUse(true);
  __setStackTrustForTests({ ok: true });
  events = [];
  off = onAskChange((event) => events.push(event));
});
afterEach(() => { off(); __setStackTrustForTests(null); });

describe("opening an ask", () => {
  test("holds the exact prompt on the row, with a hash, a 10 minute clock and a notification for the pictured adult", () => {
    const id = open();
    const stored = row(id);
    expect(stored).toMatchObject({ state: "waiting", prompt: "Iris on a beach at sunset", promptSha256: promptHash("Iris on a beach at sunset"), way: "style", subjectPersonId: iris.id, requesterPersonId: sage.id });
    expect(Date.parse(stored.expiresAt!) - Date.parse(stored.createdAt)).toBeGreaterThan(ASK_WAIT_MS - 2000);
    expect(Date.parse(stored.expiresAt!) - Date.parse(stored.createdAt)).toBeLessThanOrEqual(ASK_WAIT_MS + 2000);
  });

  test("is refused while the switch is off, for yourself, for a child and for an unknown person", () => {
    perUse(false);
    expect(openAsk(input()).ok).toBe(false);
    perUse(true);
    expect(openAsk(input({ subjectId: sage.id })).ok).toBe(false);
    const child = addPerson("Nova", "child");
    expect(openAsk(input({ subjectId: child.id })).ok).toBe(false);
    expect(openAsk(input({ subjectId: "p-missing" })).ok).toBe(false);
    expect(openAsk(input({ styleIds: [] })).ok).toBe(false);
  });

  test("a declined prompt cannot be asked again for an hour, and three asks an hour is the cap", () => {
    const first = open();
    expect(decideAsk(first, iris, "decline")).toEqual({ ok: true, state: "declined" });
    const again = openAsk(input());
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.line).toContain("said no");
    // A different prompt is allowed until the cap.
    open({ prompt: "a second prompt" });
    open({ prompt: "a third prompt" });
    expect(ASK_HOURLY_CAP).toBe(3);
    const capped = openAsk(input({ prompt: "a fourth prompt" }));
    expect(capped.ok).toBe(false);
    if (!capped.ok) expect(capped.line).toContain("3 times");
  });
});

describe("deciding", () => {
  test("Consent approves, records which account clicked, gives the job 4 hours and tells the listeners", () => {
    const id = open();
    expect(askApproved(id)).toBe(false);
    expect(decideAsk(id, iris, "consent")).toEqual({ ok: true, state: "approved" });
    expect(row(id)).toMatchObject({ state: "approved", decidedBy: "subject", prompt: "Iris on a beach at sunset" });
    expect(Date.parse(row(id).expiresAt!) - Date.now()).toBeGreaterThan(ASK_APPROVED_MS - 5000);
    expect(askApproved(id)).toBe(true);
    expect(events.map((e) => e.state)).toEqual(["approved"]);
  });

  test("the requester on the same screen may click and is recorded as the requester; a third person may not", () => {
    const marlow = addPerson("Marlow", "adult");
    const id = open();
    expect(decideAsk(id, marlow, "consent")).toMatchObject({ ok: false, code: "not_found" });
    expect(askFor(id, marlow)).toBeNull();
    expect(asksFor(marlow)).toEqual([]);
    expect(decideAsk(id, sage, "consent")).toEqual({ ok: true, state: "approved" });
    expect(row(id).decidedBy).toBe("requester");
  });

  test("Decline ends it, clears the prompt text and keeps the hash", () => {
    const id = open();
    expect(decideAsk(id, iris, "decline")).toEqual({ ok: true, state: "declined" });
    expect(row(id)).toMatchObject({ state: "declined", prompt: null, promptSha256: promptHash("Iris on a beach at sunset") });
    expect(events.at(-1)).toMatchObject({ state: "declined", reason: "decline" });
    expect(decideAsk(id, iris, "consent")).toMatchObject({ ok: false, code: "closed" });
  });

  test("an ask is decided once: a second Consent or a late click after Decline does nothing", () => {
    const id = open();
    expect(decideAsk(id, iris, "consent").ok).toBe(true);
    expect(decideAsk(id, iris, "consent")).toMatchObject({ ok: false, code: "closed" });
    expect(decideAsk(id, iris, "decline")).toMatchObject({ ok: false, code: "closed" });
    expect(row(id).state).toBe("approved");
  });

  test("the requester can cancel a waiting ask; the pictured adult cannot cancel it for them", () => {
    const id = open();
    expect(cancelAsk(id, iris)).toMatchObject({ ok: false, code: "not_found" });
    expect(cancelAsk(id, sage)).toEqual({ ok: true, state: "cancelled" });
    expect(row(id)).toMatchObject({ state: "cancelled", prompt: null });
  });

  test("the card view shows the exact prompt while open and none after it ends", () => {
    const id = open();
    expect(askFor(id, iris)).toMatchObject({ prompt: "Iris on a beach at sunset", as: "subject", subject_name: "Iris", requester_name: "Sage", count: 1, state: "waiting" });
    expect(askFor(id, sage)).toMatchObject({ as: "requester" });
    decideAsk(id, iris, "decline");
    expect(askFor(id, iris)).toMatchObject({ prompt: null, state: "declined" });
  });
});

describe("ending without a click", () => {
  test("a waiting ask expires after 10 minutes and an approved one after 4 hours, clearing the prompt", () => {
    const waiting = open();
    const approved = open({ prompt: "second prompt" });
    decideAsk(approved, iris, "consent");
    expect(expireAsks(Date.now() + ASK_WAIT_MS + 1000)).toBe(1);
    expect(row(waiting)).toMatchObject({ state: "expired", prompt: null });
    expect(row(approved).state).toBe("approved");
    expect(expireAsks(Date.now() + ASK_APPROVED_MS + 1000)).toBe(1);
    expect(row(approved)).toMatchObject({ state: "expired", prompt: null });
    expect(events.filter((e) => e.state === "expired").every((e) => e.reason === "timeout")).toBe(true);
  });

  test("turning the switch or the household option off, or the pictured adult leaving, cancels open asks", () => {
    const one = open();
    const two = open({ prompt: "second prompt" });
    decideAsk(two, iris, "consent");
    perUse(false);
    expect(expireAsks()).toBe(2);
    expect(row(one).state).toBe("cancelled");
    expect(row(two)).toMatchObject({ state: "cancelled", prompt: null });
    perUse(true);
    const three = open({ prompt: "third prompt" });
    db.update(peopleTable).set({ deletedAt: new Date().toISOString() }).where(eq(peopleTable.id, iris.id)).run();
    expect(expireAsks()).toBe(1);
    expect(row(three).state).toBe("cancelled");
  });

  test("a click after the switch went off is refused and cancels the ask", () => {
    const id = open();
    perUse(false);
    expect(decideAsk(id, iris, "consent")).toMatchObject({ ok: false, code: "closed" });
    expect(row(id).state).toBe("cancelled");
  });
});

describe("the proof", () => {
  test("no proof before approval, none for a declined ask", async () => {
    const id = open();
    expect((await release(id)).ok).toBe(false);
    decideAsk(id, iris, "decline");
    expect((await release(id)).ok).toBe(false);
    expect(row(id).consumedAt).toBeNull();
  });

  test("an approved ask gives one proof per style, once, and clears the prompt", async () => {
    const id = open({ styleIds: ["style-a", "style-b"] });
    decideAsk(id, iris, "consent");
    const out = await release(id, { styleIds: ["style-a", "style-b"] });
    expect(out.ok).toBe(true);
    if (out.ok) { expect([...out.proofs.keys()].sort()).toEqual(["style-a", "style-b"]); expect([...out.proofs.values()].every((p) => p.split(".").length === 2)).toBe(true); }
    expect(row(id)).toMatchObject({ state: "consumed", prompt: null, jobId: "job-1" });
    // A second job cannot reuse it.
    expect((await release(id, { styleIds: ["style-a", "style-b"], jobId: "job-2" })).ok).toBe(false);
  });

  test("the same job may start again after a memory requeue, with a fresh proof", async () => {
    const id = open();
    decideAsk(id, iris, "consent");
    expect((await release(id)).ok).toBe(true);
    expect((await release(id)).ok).toBe(true);
    expect((await release(id, { jobId: "job-2" })).ok).toBe(false);
  });

  test("a prompt, person, medium or style that differs from what was shown cancels the approval and sends nothing", async () => {
    for (const change of [{ prompt: "something else entirely" }, { subjectId: sage.id }, { requesterId: iris.id }, { medium: "video" }, { styleIds: ["style-other"] }, { styleIds: [] }]) {
      const id = open({ prompt: `prompt for ${JSON.stringify(change)}` });
      decideAsk(id, iris, "consent");
      const out = await release(id, { prompt: `prompt for ${JSON.stringify(change)}`, ...change });
      expect(out.ok).toBe(false);
      expect(row(id).state).toBe("cancelled");
      // each cycle leaves the hourly cap room by ending its own ask
      db.delete(likenessAsks).where(eq(likenessAsks.id, id)).run();
    }
  });

  test("a job that is bound to another job id cannot take the proof", async () => {
    const id = open();
    attachJob(id, "job-real");
    decideAsk(id, iris, "consent");
    expect((await release(id, { jobId: "job-other" })).ok).toBe(false);
    expect(row(id).state).toBe("cancelled");
  });

  test("an engine that does not trust Home's key burns no consent", async () => {
    const id = open();
    decideAsk(id, iris, "consent");
    __setStackTrustForTests({ ok: false, code: "unreachable", line: "The engine isn't answering." });
    expect(await release(id)).toEqual({ ok: false, line: "The engine isn't answering." });
    expect(row(id).state).toBe("approved");
    __setStackTrustForTests({ ok: true });
    expect((await release(id)).ok).toBe(true);
  });

  test("an approval that went stale because the switch went off yields no proof", async () => {
    const id = open();
    decideAsk(id, iris, "consent");
    perUse(false);
    expect((await release(id)).ok).toBe(false);
    expect(row(id)).toMatchObject({ state: "cancelled", prompt: null });
  });
});

describe("the decision and the job guard", () => {
  const audience = () => ({ actor: sage, band: "adult" as const, surface: "chat" as const, surfaceClass: "written" as const, spoken: false });

  test("without the switch, or without a caller that can hold the job, adult content of another adult stays refused", () => {
    expect(decideLikeness({ requester: audience(), subjectPersonId: iris.id, adultContent: true })).toEqual({ ok: false, denial: "adult_content_other_subject", line: ADULT_CONTENT_OTHER_SUBJECT_LINE });
    perUse(false);
    expect(decideLikeness({ requester: audience(), subjectPersonId: iris.id, adultContent: true, allowAsk: true })).toMatchObject({ ok: false, denial: "adult_content_other_subject" });
    perUse(true);
    expect(decideLikeness({ requester: audience(), subjectPersonId: iris.id, adultContent: true, allowAsk: true })).toMatchObject({ ok: true, needsAsk: true });
    // Self and ordinary requests need no ask.
    expect(decideLikeness({ requester: audience(), subjectPersonId: sage.id, adultContent: true, allowAsk: true })).toMatchObject({ ok: true, needsAsk: false });
    expect(decideLikeness({ requester: audience(), subjectPersonId: iris.id, adultContent: false, allowAsk: true })).toMatchObject({ ok: true, needsAsk: false });
  });

  test("a job with adult content of another person runs only with an approved (or its own consumed) ask between the same two people", async () => {
    const likeness = (ask?: string) => ({ subject: iris.id, requester: sage.id, way: "style" as const, adult_content: true, ...(ask ? { ask } : {}) });
    expect(likenessStillAllowed(likeness()).ok).toBe(false);
    expect(likenessStillAllowed(likeness("ask-missing")).ok).toBe(false);
    const id = open();
    expect(likenessStillAllowed(likeness(id), "job-1").ok).toBe(false);
    decideAsk(id, iris, "consent");
    expect(likenessStillAllowed(likeness(id), "job-1").ok).toBe(true);
    // An ask between other people never opens the gate.
    const marlow = addPerson("Marlow", "adult");
    expect(likenessStillAllowed({ ...likeness(id), subject: marlow.id }, "job-1").ok).toBe(false);
    await release(id);
    expect(likenessStillAllowed(likeness(id), "job-1").ok).toBe(true);
    expect(likenessStillAllowed(likeness(id), "job-2").ok).toBe(false);
    expect(likenessStillAllowed(likeness(id)).ok).toBe(false);
    perUse(false);
    expect(likenessStillAllowed(likeness(id), "job-1").ok).toBe(false);
  });

  test("an ask that ended without a yes never opens the gate", () => {
    const likeness = (ask: string) => ({ subject: iris.id, requester: sage.id, way: "style" as const, adult_content: true, ask });
    const declined = open();
    decideAsk(declined, iris, "decline");
    expect(likenessStillAllowed(likeness(declined), "job-1")).toMatchObject({ ok: false });
    const cancelled = open({ prompt: "another" });
    cancelAsk(cancelled, sage);
    expect(likenessStillAllowed(likeness(cancelled), "job-1")).toMatchObject({ ok: false });
  });
});
