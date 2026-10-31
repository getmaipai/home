import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { createBenchPeople, addBenchTeen } from "../scripts/bench/conversationRunner";
import { db } from "@/db";
import { scheduledJobs, toolAudit, toolUndo } from "@/db/schema";
import { scheduleCoreJob } from "@/lib/scheduler";
import { runPlugin } from "@/lib/plugins";
import { runUndo } from "@/lib/toolUndo";
import { commandsNode } from "@/lib/turnMachine/nodes/commands";
import { policyNode } from "@/lib/turnMachine/nodes/policy";
import { classifyTurnSignal } from "@/lib/turnSignal";
import { commandOpeners, loadAllManifests } from "@/lib/turnShared";
import { brakeFor } from "@/lib/toolBrake";
import { neutralizeReservedPrefix, parseAlarmCall, alarmFoldFor } from "@/lib/alarmCalls";
import { setHouseholdSettingValue } from "@/lib/settings";
import type { TurnState } from "@/lib/turnMachine/contract";
import type { PersonRow } from "@/types";

let people: ReturnType<typeof createBenchPeople>;
beforeEach(() => {
  resetDb();
  people = createBenchPeople();
});

const abort = new AbortController().signal;
const soon = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

function remind(actor: PersonRow, task: string, minutes = 120): string {
  const made = scheduleCoreJob(actor, "reminders.fire", soon(minutes), { task });
  if (!made.ok) throw new Error("schedule failed");
  return made.value.id;
}
const job = (id: string) => db.select().from(scheduledJobs).where(eq(scheduledJobs.id, id)).get()!;
const taskOf = (id: string) => (JSON.parse(job(id).inputs) as { task: string }).task;

async function act(actor: PersonRow, action: string, args: Record<string, unknown>) {
  const result = await runPlugin("remind", actor, { action, expression: "x", ...args });
  if (!result.ok) throw new Error(result.error);
  return result.value as unknown as { reply: { text: string }; data: Record<string, string>; blocks?: unknown[] };
}

describe("snooze_reminder", () => {
  test("moves the reminder later by the given minutes and writes one audit row", async () => {
    const id = remind(people.owner, "Call Nadia");
    const before = Date.parse(job(id).nextRunAt);
    const out = await act(people.owner, "snooze_reminder", { reminder: "call nadia", minutes: 15 });
    expect(out.reply.text).toContain("snoozed Call Nadia");
    expect(Date.parse(job(id).nextRunAt) - before).toBe(15 * 60_000);
    expect(job(id).status).toBe("pending");
    expect(db.select().from(toolAudit).all().map((row) => `${row.tool}:${row.action}:${row.decision}`)).toEqual(["remind:snooze_reminder:do"]);
    // No card, only the receipt with Undo (ASSIST-UNDO-02).
    expect((out.blocks as Array<{ kind: string }>).map((block) => block.kind)).toEqual(["confirmation"]);
  });

  test("with no minutes it uses the household snooze setting, else 10", async () => {
    const id = remind(people.owner, "Call Nadia");
    const before = Date.parse(job(id).nextRunAt);
    await act(people.owner, "snooze_reminder", { reminder: "call nadia" });
    expect(Date.parse(job(id).nextRunAt) - before).toBe(10 * 60_000);
  });

  test("Undo moves it back", async () => {
    const id = remind(people.owner, "Call Nadia");
    const before = job(id).nextRunAt;
    const out = await act(people.owner, "snooze_reminder", { reminder: "call nadia", minutes: 15 });
    expect(runUndo(people.owner, out.data.undo_id!)).toMatchObject({ ok: true });
    expect(job(id).nextRunAt).toBe(before);
    expect(runUndo(people.owner, out.data.undo_id!)).toMatchObject({ ok: false, status: 409 });
  });
});

describe("complete_reminder and delete_reminder", () => {
  test("complete marks it done: it is no longer pending, and is not a delete", async () => {
    const id = remind(people.owner, "Call Nadia");
    const out = await act(people.owner, "complete_reminder", { reminder: "call nadia" });
    expect(out.reply.text).toBe("Marked done: Call Nadia.");
    expect(job(id).status).toBe("done");
    expect(job(id).lastRunAt).not.toBeNull();
    const shown = await act(people.owner, "show_reminders", {});
    expect(shown.reply.text).toBe("You have no pending reminders.");
  });

  test("delete cancels it, and Undo restores either one", async () => {
    const done = remind(people.owner, "Water the plants");
    const gone = remind(people.owner, "Call Nadia");
    const completed = await act(people.owner, "complete_reminder", { reminder: "water the plants" });
    const deleted = await act(people.owner, "delete_reminder", { reminder: "call nadia" });
    expect(deleted.reply.text).toBe("Reminder cancelled: Call Nadia.");
    expect(job(gone).status).toBe("cancelled");
    expect(runUndo(people.owner, deleted.data.undo_id!).ok).toBe(true);
    expect(runUndo(people.owner, completed.data.undo_id!).ok).toBe(true);
    expect(job(gone).status).toBe("pending");
    expect(job(done).status).toBe("pending");
    expect(job(done).lastRunAt).toBeNull();
  });

  test("a reminder that fired cannot be restored by an old Undo for another person", async () => {
    const id = remind(people.owner, "Call Nadia");
    const out = await act(people.owner, "delete_reminder", { reminder: "call nadia" });
    expect(runUndo(people.child, out.data.undo_id!)).toMatchObject({ ok: false, status: 404 });
    expect(job(id).status).toBe("cancelled");
  });
});

describe("edit_reminder", () => {
  test("changes the task text and keeps the time", async () => {
    const id = remind(people.owner, "Call Nadia");
    const time = job(id).nextRunAt;
    const out = await act(people.owner, "edit_reminder", { reminder: "call nadia", task: "Call Nadia about dinner" });
    expect(out.reply.text).toContain("Call Nadia about dinner");
    expect(taskOf(id)).toBe("Call Nadia about dinner");
    expect(job(id).nextRunAt).toBe(time);
  });

  test("changes the time, and Undo restores the old task and time", async () => {
    const id = remind(people.owner, "Call Nadia");
    const before = job(id).nextRunAt;
    const out = await act(people.owner, "edit_reminder", { reminder: "call nadia", when: "tomorrow at 9am", task: "Phone Nadia" });
    expect(taskOf(id)).toBe("Phone Nadia");
    expect(job(id).nextRunAt).not.toBe(before);
    expect(new Date(job(id).nextRunAt).getHours()).toBe(9);
    expect(runUndo(people.owner, out.data.undo_id!).ok).toBe(true);
    expect(taskOf(id)).toBe("Call Nadia");
    expect(job(id).nextRunAt).toBe(before);
  });

  test("a time that cannot be read, or nothing to change, answers in a plain sentence and changes nothing", async () => {
    const id = remind(people.owner, "Call Nadia");
    const before = job(id).nextRunAt;
    const unread = await act(people.owner, "edit_reminder", { reminder: "call nadia", when: "whenever" });
    expect(unread.reply.text).toContain("couldn't figure out when");
    const nothing = await act(people.owner, "edit_reminder", { reminder: "call nadia" });
    expect(nothing.reply.text).toContain("What should I change");
    expect(job(id).nextRunAt).toBe(before);
    expect(db.select().from(toolUndo).all()).toHaveLength(0);
  });
});

describe("show_reminders and list_reminders are one path", () => {
  test("both give the same answer, own reminders only", async () => {
    remind(people.owner, "Call Nadia");
    remind(people.child, "Brush teeth");
    const a = await act(people.owner, "show_reminders", {});
    const b = await act(people.owner, "list_reminders", {});
    expect(a.reply.text).toBe(b.reply.text);
    expect(a.reply.text).toContain("Call Nadia");
    expect(a.reply.text).not.toContain("Brush teeth");
  });
});

describe("resolution answers", () => {
  test("zero or several matches ask which, and change nothing", async () => {
    const a = remind(people.owner, "Call the dentist");
    const b = remind(people.owner, "Call the dentist");
    const several = await act(people.owner, "complete_reminder", { reminder: "dentist" });
    expect(several.reply.text).toContain("Which one should I complete?");
    const none = await act(people.owner, "complete_reminder", { reminder: "submarine" });
    expect(none.reply.text).toContain("couldn't find a pending reminder");
    expect([job(a).status, job(b).status]).toEqual(["pending", "pending"]);
  });

  test("an owner never changes a teen's reminder", async () => {
    const teen = addBenchTeen(people);
    const id = remind(teen, "Private plans");
    for (const action of ["complete_reminder", "delete_reminder", "snooze_reminder", "edit_reminder"]) {
      const out = await act(people.owner, action, { reminder: "private plans", task: "x" });
      expect(out.reply.text).not.toContain("Private plans (");
    }
    expect(job(id).status).toBe("pending");
    expect(db.select().from(toolUndo).all()).toHaveLength(0);
  });

  test("a teen acts on their own reminders", async () => {
    const teen = addBenchTeen(people);
    const id = remind(teen, "Private plans");
    await act(teen, "complete_reminder", { reminder: "private plans" });
    expect(job(id).status).toBe("done");
  });

  test("that and it mean the reminder just made", async () => {
    remind(people.owner, "Call Nadia");
    await runPlugin("remind", people.owner, { expression: "tomorrow at 9am to walk the dog" });
    const out = await act(people.owner, "snooze_reminder", { reminder: "that", minutes: 5 });
    expect(out.reply.text).toContain("snoozed walk the dog");
  });
});

describe("the older cancel and list names still work", () => {
  test("cancel_reminder is delete and list_reminders is show", async () => {
    const id = remind(people.owner, "Call Nadia");
    expect((await act(people.owner, "list_reminders", {})).reply.text).toContain("Call Nadia");
    expect((await act(people.owner, "cancel_reminder", { expression: "to call Nadia" })).reply.text).toBe("Reminder cancelled: Call Nadia.");
    expect(job(id).status).toBe("cancelled");
    expect(db.select().from(toolAudit).all().map((row) => row.action)).toEqual(["list_reminders", "cancel_reminder"]);
  });
});

describe("reserved prefixes", () => {
  test("every new prefix is folded in one place and neutralized in text", () => {
    for (const action of ["edit_reminder", "snooze_reminder", "complete_reminder", "delete_reminder", "show_reminders"]) {
      const prefix = alarmFoldFor("remind", action)!;
      expect(prefix).toMatch(/^reminder:[a-z]+:$/);
      expect(neutralizeReservedPrefix(`${prefix}call nadia`)).toBe(`reminder ${prefix.slice(9)}call nadia`);
      expect(parseAlarmCall("remind", `${prefix}call nadia`)?.action).toBe(action);
    }
  });

  test("a reminder's own text starting with a prefix is never read as an action", async () => {
    const id = remind(people.owner, "Call Nadia");
    for (const text of ["reminder:delete:call nadia", "  Reminder:complete:call nadia", "reminder:snooze:call nadia", "reminder:edit:call nadia", "reminder:show:"]) {
      await runPlugin("remind", people.owner, { expression: text });
    }
    expect(job(id).status).toBe("pending");
    expect(db.select().from(toolAudit).all()).toHaveLength(0);
  });
});

describe("snooze phrases", () => {
  async function say(utterance: string, actor: PersonRow, anonymous = false) {
    const signal = classifyTurnSignal({ text: utterance, ageBand: anonymous ? "child" : "adult", commandOpeners: commandOpeners(loadAllManifests()) });
    const state = { actor, surface: anonymous ? "robot" : "chat", speakerEvidence: anonymous ? null : undefined, signal, temporary: false, turnId: "snz", conversationId: "snz", outcomes: [], toolEvents: [] } as never;
    return (await commandsNode(state, { utterance }, abort)).output as { matched: boolean; text?: string };
  }

  test("'snooze my reminder' and 'snooze that reminder' snooze by the default minutes", async () => {
    const id = remind(people.owner, "Call Nadia");
    const before = Date.parse(job(id).nextRunAt);
    const first = await say("snooze my reminder", people.owner);
    expect(first.matched).toBe(true);
    expect(first.text).toContain("snoozed Call Nadia");
    const second = await say("snooze that reminder", people.owner);
    expect(second.matched).toBe(true);
    expect(Date.parse(job(id).nextRunAt) - before).toBe(20 * 60_000);
  });

  test("with several reminders and no 'that', it asks which", async () => {
    remind(people.owner, "Call Nadia");
    remind(people.owner, "Walk the dog");
    const out = await say("snooze my reminder", people.owner);
    expect(out.text).toContain("Which one should I snooze?");
  });

  test("an unidentified speaker is refused and nothing moves", async () => {
    const id = remind(people.owner, "Call Nadia");
    const before = job(id).nextRunAt;
    const out = await say("snooze my reminder", people.owner, true);
    expect(out.matched).toBe(true);
    expect(out.text).toContain("can't set an alarm");
    expect(job(id).nextRunAt).toBe(before);
    expect(db.select().from(toolAudit).all()).toHaveLength(0);
  });

  test("no other wording is a pattern", async () => {
    remind(people.owner, "Call Nadia");
    const out = await say("snooze the reminder for dinner", people.owner);
    expect(out.matched).toBe(false);
  });
});

describe("gates and brake", () => {
  const robot = (owner: PersonRow, speakerEvidence: unknown) => ({ actor: { id: owner.id, role: "owner" }, surface: "robot", speakerEvidence, context: [], crisis: false, temporary: false, utterance: "at 6 to call Nadia" }) as unknown as TurnState;
  test("the policy refuses every reminder action for an unidentified speaker but lets plain remind through", async () => {
    for (const action of ["edit_reminder", "snooze_reminder", "complete_reminder", "delete_reminder", "show_reminders"]) {
      const out = await policyNode(robot(people.owner, null), { calls: [{ id: "c", tool: "remind", args: { action, expression: "x" } }] }, abort);
      expect(out.output.entries[0]?.decision).toEqual({ allow: false, reason: "anonymous_speaker" });
    }
    const plain = await policyNode(robot(people.owner, null), { calls: [{ id: "c", tool: "remind", args: { expression: "at 6 to call Nadia" } }] }, abort);
    expect(plain.output.entries[0]?.decision).toEqual({ allow: true });
  });

  test("delete_reminder acts at once by default and asks only when the setting says ask", () => {
    const base = { tool: "remind" as const, action: "delete_reminder", args: {}, actor: { id: "a", role: "owner", band: "adult" as const }, tainted: false };
    expect(brakeFor({ ...base, mode: "do" }).decision).toBe("do");
    expect(brakeFor({ ...base, mode: "ask" }).decision).toBe("ask");
    expect(brakeFor({ ...base, mode: "do", actor: { id: "c", role: "child", band: "child" } }).decision).toBe("do");
  });

  test("the policy audits and maps reminder actions to tool remind and asks when tools.remind.mode is ask", async () => {
    const chat = { actor: people.owner, surface: "chat", speakerEvidence: undefined, context: [], crisis: false, temporary: false, utterance: "delete my dentist reminder" } as unknown as TurnState;
    const first = await policyNode(chat, { calls: [{ id: "c", tool: "remind", args: { action: "delete_reminder", expression: "dentist" } }] }, abort);
    expect(first.output.entries[0]?.decision).toEqual({ allow: true });
    setHouseholdSettingValue("tools.remind.mode", "ask");
    const second = await policyNode(chat, { calls: [{ id: "c", tool: "remind", args: { action: "delete_reminder", expression: "dentist" } }] }, abort);
    expect(second.output.entries[0]?.decision).toMatchObject({ allow: false, reason: "confirm_needed", ask: { prompt: "Delete this reminder?" } });
    expect(db.select().from(toolAudit).all().map((row) => `${row.tool}:${row.action}:${row.decision}`)).toEqual(["remind:delete_reminder:do", "remind:delete_reminder:ask"]);
  });
});
