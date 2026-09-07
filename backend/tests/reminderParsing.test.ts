// Direct unit tests for lib/reminderParsing.ts (session-d-packages-and-
// store.md step 8). Real chrono-node parsing for remind, no network, no
// model - deterministic and offline by the org's own testing standard.
import { describe, expect, test } from "bun:test";
import { parseReminder, parseTimerDuration } from "@/lib/reminderParsing";
import { HostError } from "@maipai/spec/emulators/ts/host-emulator.js";

const REF = new Date("2026-09-06T12:00:00");

describe("parseReminder", () => {
  test("extracts the task from a leading time phrase", () => {
    const result = parseReminder("at 6 to call Nadia", REF);
    expect(result.task).toBe("call Nadia");
  });

  test("extracts the task from a trailing time phrase", () => {
    const result = parseReminder("call Nadia at 6pm", REF);
    expect(result.task).toBe("call Nadia");
  });

  // A real bug found by stress-testing beyond the cases above: chrono
  // sometimes matches only the bare time word ("noon"), not the whole
  // prepositional phrase ("at noon") - leaving "at" dangling in front of
  // a SECOND connector ("and"), which a single non-looped strip missed
  // entirely ("at and don't forget the cake").
  test("strips a dangling leading preposition left in front of a second connector", () => {
    const result = parseReminder("at noon and don't forget the cake", REF);
    expect(result.task).toBe("don't forget the cake");
  });

  // Another real gap stress-testing found: chrono's own matched span
  // can cut a word in half ("tomorrow's" -> matches only "tomorrow"),
  // leaving a stray "'s" glued to the front of whatever follows.
  test("strips a stray possessive fragment left when chrono's match cuts a word in half", () => {
    const result = parseReminder("to buy tickets for tomorrow's show", REF);
    expect(result.task).not.toMatch(/^'s/);
    expect(result.task).not.toContain("'s show");
  });

  // chrono has no concept of recurrence - "every morning at 8" resolves
  // to one specific next occurrence, silently dropping what the
  // household member actually meant. Reject rather than confirm a
  // one-shot reminder nobody asked for.
  test("rejects a recurring reminder request rather than silently dropping the recurrence", () => {
    try {
      parseReminder("to water the plants every morning at 8", REF);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as HostError).code).toBe("invalid_input");
      expect((err as HostError).message).toContain("Recurring reminders aren't supported");
    }
  });

  test("doesn't false-positive on 'every' used as an ordinary word in the task", () => {
    const result = parseReminder("at 6 to check every window is locked", REF);
    expect(result.task).toBe("check every window is locked");
  });

  test("resolves a relative time to a real future ISO datetime", () => {
    const result = parseReminder("tomorrow at noon to walk the dog", REF);
    expect(result.task).toBe("walk the dog");
    expect(new Date(result.when).getTime()).toBeGreaterThan(REF.getTime());
  });

  test("throws invalid_input when no time phrase is found", () => {
    expect(() => parseReminder("call Nadia", REF)).toThrow(HostError);
    try {
      parseReminder("call Nadia", REF);
    } catch (err) {
      expect((err as HostError).code).toBe("invalid_input");
    }
  });

  test("throws invalid_input when nothing is left to remind about", () => {
    expect(() => parseReminder("at 6", REF)).toThrow(HostError);
  });
});

describe("parseTimerDuration", () => {
  // The regression test this step's own design flagged: a timer's whole
  // point is exact minute-level accuracy, not "close enough" - assert
  // the exact millisecond offset, not a fuzzy "within a few seconds of."
  test("ten minutes resolves to exactly now + 600000ms, not an approximation", () => {
    const result = parseTimerDuration("ten minutes", REF);
    expect(new Date(result.when).getTime()).toBe(REF.getTime() + 600_000);
  });

  test("a digit amount works the same as a word amount", () => {
    const result = parseTimerDuration("10 minutes", REF);
    expect(new Date(result.when).getTime()).toBe(REF.getTime() + 600_000);
  });

  test("seconds and hours both resolve exactly", () => {
    expect(new Date(parseTimerDuration("30 seconds", REF).when).getTime()).toBe(REF.getTime() + 30_000);
    expect(new Date(parseTimerDuration("2 hours", REF).when).getTime()).toBe(REF.getTime() + 7_200_000);
  });

  test("a singular unit and 'an hour' both work", () => {
    expect(new Date(parseTimerDuration("1 minute", REF).when).getTime()).toBe(REF.getTime() + 60_000);
    expect(new Date(parseTimerDuration("an hour", REF).when).getTime()).toBe(REF.getTime() + 3_600_000);
  });

  test("throws invalid_input for text this narrow grammar doesn't cover", () => {
    expect(() => parseTimerDuration("a while", REF)).toThrow(HostError);
    try {
      parseTimerDuration("a while", REF);
    } catch (err) {
      expect((err as HostError).code).toBe("invalid_input");
    }
  });

  test("throws invalid_input for zero or negative durations", () => {
    expect(() => parseTimerDuration("0 minutes", REF)).toThrow(HostError);
  });
});
