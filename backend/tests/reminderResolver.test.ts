import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { createBenchPeople, addBenchTeen } from "../scripts/bench/conversationRunner";
import { scheduleCoreJob } from "@/lib/scheduler";
import { resolveReminder } from "@/lib/reminderActions";
import type { PersonRow } from "@/types";

let people: ReturnType<typeof createBenchPeople>;
beforeEach(() => {
  resetDb();
  people = createBenchPeople();
});

function remind(actor: PersonRow, task: string, hours = 3): string {
  const made = scheduleCoreJob(actor, "reminders.fire", new Date(Date.now() + hours * 3_600_000).toISOString(), { task });
  if (!made.ok) throw new Error("schedule failed");
  return made.value.id;
}

describe("resolveReminder", () => {
  test("exact task text, case-insensitive", () => {
    const id = remind(people.owner, "Call Nadia");
    remind(people.owner, "Take out the trash");
    expect(resolveReminder(people.owner, "call nadia")).toMatchObject({ ok: true, job: { id } });
  });

  test("a unique fuzzy match", () => {
    const id = remind(people.owner, "Call Nadia about the party");
    remind(people.owner, "Take out the trash");
    expect(resolveReminder(people.owner, "the reminder to call nadia")).toMatchObject({ ok: true, job: { id } });
  });

  test("that, it and the last one use lastReminderId", () => {
    remind(people.owner, "Call Nadia");
    const last = remind(people.owner, "Walk the dog");
    for (const words of ["that", "it", "the last one", "that reminder"]) {
      expect(resolveReminder(people.owner, words, { lastReminderId: last })).toMatchObject({ ok: true, job: { id: last } });
    }
  });

  test("a bare 'my reminder' with several pending asks which, with one pending it is that one", () => {
    const only = remind(people.owner, "Call Nadia");
    expect(resolveReminder(people.owner, "my reminder")).toMatchObject({ ok: true, job: { id: only } });
    remind(people.owner, "Walk the dog");
    const result = resolveReminder(people.owner, "my reminder");
    expect(result).toMatchObject({ ok: false, reason: "ambiguous" });
    expect(result.ok ? 0 : result.candidates).toHaveLength(2);
  });

  test("two equally good matches are ambiguous and nothing matching is none", () => {
    remind(people.owner, "Call the dentist");
    remind(people.owner, "Call the dentist");
    expect(resolveReminder(people.owner, "dentist")).toMatchObject({ ok: false, reason: "ambiguous" });
    expect(resolveReminder(people.owner, "submarine")).toMatchObject({ ok: false, reason: "none", candidates: [] });
  });

  test("an owner speaker never resolves a teen's reminder", () => {
    const teen = addBenchTeen(people);
    remind(teen, "Private plans with friends");
    expect(resolveReminder(people.owner, "private plans with friends")).toMatchObject({ ok: false, reason: "none" });
    expect(resolveReminder(people.owner, "my reminder")).toMatchObject({ ok: false, reason: "none" });
    expect(resolveReminder(teen, "private plans")).toMatchObject({ ok: true });
  });

  test("only pending reminders resolve, not alarms or closed ones", () => {
    const made = scheduleCoreJob(people.owner, "alarms.fire", new Date(Date.now() + 3_600_000).toISOString(), { task: "Gym" });
    expect(made.ok).toBe(true);
    expect(resolveReminder(people.owner, "gym")).toMatchObject({ ok: false, reason: "none" });
  });
});
