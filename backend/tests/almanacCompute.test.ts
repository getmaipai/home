// Direct unit tests for lib/almanacCompute.ts (ALM-01, chunk A).
// No database, no network, no model - deterministic and offline.
// Clock fixed to a Monday, 2026-09-14 22:43 local.
import { describe, expect, test } from "bun:test";
import {
  computeDateAnswer,
  dateRelation,
  parseDateQuestion,
} from "@/lib/almanacCompute";

const NOW = new Date(2026, 8, 14, 22, 43); // Monday 2026-09-14 22:43

describe("parseDateQuestion", () => {
  test("reads a next-clock question", () => {
    const q = parseDateQuestion("when's the next time it's 10:41");
    expect(q).not.toBeNull();
    expect(q?.kind).toBe("next_clock");
    if (q?.kind === "next_clock") {
      expect(q.hour).toBe(10);
      expect(q.minute).toBe(41);
    }
  });

  test("reads a date-of-next-clock from the carried clock", () => {
    const q = parseDateQuestion("which date is that", "10:41");
    expect(q).not.toBeNull();
    expect(q?.kind).toBe("date_of_next_clock");
    if (q?.kind === "date_of_next_clock") {
      expect(q.hour).toBe(10);
      expect(q.minute).toBe(41);
    }
  });

  test("reads a days-until question with a referent", () => {
    const q = parseDateQuestion("how many days until the 27th");
    expect(q).not.toBeNull();
    expect(q?.kind).toBe("days_until");
    if (q?.kind === "days_until") {
      expect(q.referent.day).toBe(27);
    }
  });

  test("reads an is-weekday question", () => {
    const q = parseDateQuestion("is the 27th a Friday");
    expect(q).not.toBeNull();
    expect(q?.kind).toBe("is_weekday");
    if (q?.kind === "is_weekday") {
      expect(q.referent.day).toBe(27);
      expect(q.weekday).toBe(5);
    }
  });

  test("reads a relative-weekday question", () => {
    const q = parseDateQuestion("what's the date next Friday");
    expect(q).not.toBeNull();
    expect(q?.kind).toBe("relative_weekday");
    if (q?.kind === "relative_weekday") {
      expect(q.which).toBe("next");
      expect(q.weekday).toBe(5);
    }
  });

  test("reads tomorrow", () => {
    const q = parseDateQuestion("tomorrow");
    expect(q).not.toBeNull();
    expect(q?.kind).toBe("relative_day");
    if (q?.kind === "relative_day") {
      expect(q.offset).toBe(1);
    }
  });

  test("returns null for a time question", () => {
    expect(parseDateQuestion("what time is it")).toBeNull();
  });
});

describe("computeDateAnswer", () => {
  test("next-clock answers with the morning half-day and the next day", () => {
    const q = parseDateQuestion("when's the next time it's 10:41");
    if (!q) throw new Error("expected a question");
    const a = computeDateAnswer(q, NOW, "when's the next time it's 10:41");
    expect(a.text).toMatch(/am|morning/);
    expect(a.text).toContain("September 15");
  });

  test("date-of-next-clock gives the next day, not today alone", () => {
    const q = parseDateQuestion("which date is that", "10:41");
    if (!q) throw new Error("expected a question");
    const a = computeDateAnswer(q, NOW, "which date is that");
    expect(a.text).toContain("September 15");
    expect(a.text).not.toContain("September 14");
  });

  test("days-until the 27th gives 13", () => {
    const q = parseDateQuestion("how many days until the 27th");
    if (!q) throw new Error("expected a question");
    const a = computeDateAnswer(q, NOW, "how many days until the 27th");
    expect(a.text).toContain("13");
  });

  test("is-weekday the 27th Friday gives No and Sunday", () => {
    const q = parseDateQuestion("is the 27th a Friday");
    if (!q) throw new Error("expected a question");
    const a = computeDateAnswer(q, NOW, "is the 27th a Friday");
    expect(a.text).toContain("No");
    expect(a.text).toContain("Sunday");
  });

  test("next-Friday on a Monday clock gives one reading", () => {
    const q = parseDateQuestion("what's the date next Friday");
    if (!q) throw new Error("expected a question");
    const a = computeDateAnswer(q, NOW, "what's the date next Friday");
    expect(a.text).toContain("September 18");
    expect(a.readings).toBeUndefined();
    expect(a.text).not.toContain("?");
  });

  test("next-Friday on a Wednesday clock gives both readings, no ?", () => {
    const wed = new Date(2026, 8, 16, 12, 0); // Wednesday
    const q = parseDateQuestion("what's the date next Friday");
    if (!q) throw new Error("expected a question");
    const a = computeDateAnswer(q, wed, "what's the date next Friday");
    expect(a.readings).toBeDefined();
    expect(a.text).toContain("18");
    expect(a.text).toContain("25");
    expect(a.text).not.toContain("?");
  });

  test("tomorrow gives Tuesday September 15", () => {
    const q = parseDateQuestion("tomorrow");
    if (!q) throw new Error("expected a question");
    const a = computeDateAnswer(q, NOW, "tomorrow");
    expect(a.text).toContain("Tuesday");
    expect(a.text).toContain("September 15");
  });

  test("records the clock and term in inputs", () => {
    const q = parseDateQuestion("tomorrow");
    if (!q) throw new Error("expected a question");
    const a = computeDateAnswer(q, NOW, "tomorrow");
    expect(a.inputs.clock).toBe(NOW.toISOString());
    expect(a.inputs.term).toBe("tomorrow");
  });
});

describe("dateRelation", () => {
  test("same day is today", () => {
    expect(dateRelation(new Date(2026, 8, 14, 9, 0), NOW)).toBe("today");
  });

  test("+1 is tomorrow", () => {
    expect(dateRelation(new Date(2026, 8, 15, 9, 0), NOW)).toBe("tomorrow");
  });

  test("+11 is in 11 days", () => {
    expect(dateRelation(new Date(2026, 8, 25, 9, 0), NOW)).toBe("in 11 days");
  });
});
