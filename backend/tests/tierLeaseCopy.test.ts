// TIER-LEASE-04: the words of the shared tier-lease notice line. One short sentence, an adult and a child form, kinds and counts only (rule 6a).
import { describe, expect, test } from "bun:test";
import { holderNotice, pausedNotice, releasedNotice, waiterNotice, type TierLeaseNotice } from "@/lib/tierLeaseCopy";

const all = (n: TierLeaseNotice) => [n.adult, n.child, n.more].join(" ");

describe("holder lines", () => {
  test("nobody waits: Max switches off when you stop, with the time it takes to come back", () => {
    const n = holderNotice({ key: "chat", waiters: { count: 0, kinds: [] }, comeBackSeconds: 40 });
    expect(n.code).toBe("holder_idle");
    expect(n.adult).toBe("Max switches off when you stop. It comes back when you type, about 40 seconds.");
    expect(n.actions).toEqual([]);
  });
  test("one picture waits: the design's sentence, with Keep going, a lower tier and Pause on coding", () => {
    const n = holderNotice({ key: "coding", waiters: { count: 1, kinds: ["picture"] }, etaSeconds: 120 });
    expect(n.code).toBe("holder_waiting");
    expect(n.adult).toBe("1 picture is waiting. It runs after this step, about 2 min.");
    expect(n.actions).toEqual(["keep", "lower", "pause"]);
  });
  test("chat has no Pause; counts and plurals read right; mixed kinds say jobs; no estimate leaves the sentence short", () => {
    expect(holderNotice({ key: "chat", waiters: { count: 1, kinds: ["video"] } }).actions).toEqual(["keep", "lower"]);
    expect(holderNotice({ key: "coding", waiters: { count: 2, kinds: ["picture", "picture"] } }).adult).toBe("2 pictures are waiting. They run after this step.");
    expect(holderNotice({ key: "coding", waiters: { count: 3, kinds: ["picture", "song", "video"] } }).adult).toBe("3 jobs are waiting. They run after this step.");
  });
  test("the child form never names a tier or a kind", () => {
    const n = holderNotice({ key: "coding", waiters: { count: 1, kinds: ["coding"] } });
    expect(n.child).toBe("Someone is waiting for a turn.");
    expect(n.child).not.toMatch(/Max|coding|picture/);
  });
});

describe("paused, released and waiter lines", () => {
  test("paused offers Resume only", () => {
    const n = pausedNotice({ count: 1, kinds: ["picture"] });
    expect(n.adult).toBe("Paused so a picture can run.");
    expect(n.actions).toEqual(["resume"]);
  });
  test("released while idle says what it went to and that typing brings it back", () => {
    const n = releasedNotice({ count: 1, kinds: ["picture"] });
    expect(n.adult).toBe("Max was released for a picture. It switches back when you type.");
    expect(n.actions).toEqual([]);
  });
  test("a waiter reads the blocker and the wait; behind a pin for 10 minutes it offers Standard now", () => {
    expect(waiterNotice({ etaSeconds: 120 }).adult).toBe("Waiting for a coding job to finish, about 2 minutes.");
    expect(waiterNotice({}).adult).toBe("Waiting for a coding job to finish.");
    const pinned = waiterNotice({ etaSeconds: 600, pinnedWaitMinutes: 10 });
    expect(pinned.code).toBe("waiter_pinned");
    expect(pinned.actions).toEqual(["standard_now"]);
    expect(waiterNotice({ pinnedWaitMinutes: 9 }).actions).toEqual([]);
  });
  test("every child form is a plain sentence with no tier word", () => {
    for (const n of [pausedNotice({ count: 1, kinds: ["video"] }), releasedNotice({ count: 2, kinds: ["song"] }), waiterNotice({ etaSeconds: 90 })]) expect(n.child).not.toMatch(/Max|Boost|coding|tier/i);
  });
});

describe("rule 6a and length", () => {
  test("no line carries an id, a person word or a title, and each sentence stays short", () => {
    const lines = [
      holderNotice({ key: "chat", waiters: { count: 0, kinds: [] } }), holderNotice({ key: "coding", waiters: { count: 1, kinds: ["picture"] }, etaSeconds: 120 }),
      pausedNotice({ count: 1, kinds: ["picture"] }), releasedNotice({ count: 1, kinds: ["picture"] }), waiterNotice({ etaSeconds: 120 }),
    ];
    for (const n of lines) {
      expect(all(n)).not.toMatch(/[0-9a-f]{8}-|@|\bhe\b|\bshe\b|\bDad\b|\bMom\b/);
      expect(n.adult.length).toBeLessThanOrEqual(90);
      expect(all(n)).not.toContain("—");
    }
  });
});
