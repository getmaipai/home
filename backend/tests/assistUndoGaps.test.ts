// ASSIST-UNDO-02: the list and alarm actions that left no Undo now leave one, and a read leaves list context.
import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { alarms, lists, scheduledJobs, toolUndo } from "@/db/schema";
import { createAlarm } from "@/lib/alarms";
import { lastListContextFor } from "@/lib/listContext";
import { runPlugin } from "@/lib/plugins";
import { setHouseholdSettingValue } from "@/lib/settings";
import { purgeExpiredUndo, recordUndo, runUndo } from "@/lib/toolUndo";
import type { PersonRow } from "@/types";
import { addBenchTeen, createBenchPeople } from "../scripts/bench/conversationRunner";
import { resetDb } from "./reset-db";

let people: ReturnType<typeof createBenchPeople>;
let teen: PersonRow;
beforeEach(() => {
  resetDb();
  people = createBenchPeople();
  teen = addBenchTeen(people);
  expect(setHouseholdSettingValue("tools.assist.widened", true).ok).toBe(true);
});

type Items = Array<{ id: string; text: string; done: boolean }>;
type Block = { kind: string; id: string; props: { sentence?: string; undo?: unknown } };

async function call(pkg: "remind" | "timer", actor: PersonRow, args: Record<string, unknown>) {
  const result = await runPlugin(pkg, actor, args);
  if (!result.ok) throw new Error(`${pkg} failed: ${result.error}`);
  const value = result.value as unknown as { reply?: { text?: string }; data?: Record<string, unknown>; blocks?: Block[] };
  const confirmation = (value.blocks ?? []).find((block) => block.kind === "confirmation");
  return { text: value.reply?.text ?? "", undoId: String(value.data?.undo_id ?? ""), confirmation };
}

const remind = (actor: PersonRow, args: Record<string, unknown>) => call("remind", actor, args);
const timer = (actor: PersonRow, args: Record<string, unknown>) => call("timer", actor, args);

function listItems(title: string): Items {
  const row = db.select().from(lists).where(and(eq(lists.title, title), isNull(lists.deletedAt))).get();
  return row ? (JSON.parse(row.items) as Items) : [];
}
const texts = (title: string): string[] => listItems(title).map((item) => item.text);

async function seedList(actor: PersonRow, title: string, items: string[]) {
  await remind(actor, { action: "create_list", name: title });
  await remind(actor, { action: "add_items", list: title, items });
}

describe("list receipts", () => {
  test("remove_items leaves a receipt, and Undo restores the same items at the same places", async () => {
    await seedList(people.owner, "Camp", ["tent", "stove", "lantern", "mugs"]);
    const before = listItems("Camp");
    const out = await remind(people.owner, { action: "remove_items", list: "Camp", items: ["stove", "mugs"] });
    expect(out.text).toBe("Removed 2 items.");
    expect(out.confirmation?.props.sentence).toBe("Removed 2 items.");
    expect(out.confirmation?.props.undo).toEqual({ label: "Undo", action: "undo" });
    expect(out.confirmation?.id).toBe(out.undoId);
    expect(texts("Camp")).toEqual(["tent", "lantern"]);
    expect(runUndo(people.owner, out.undoId)).toMatchObject({ ok: true });
    expect(listItems("Camp")).toEqual(before);
    expect(runUndo(people.owner, out.undoId)).toMatchObject({ ok: false, status: 409 });
  });

  test("clear_done leaves a receipt that restores the done items", async () => {
    await seedList(people.owner, "Chores", ["dishes", "laundry", "trash"]);
    await remind(people.owner, { action: "check_items", list: "Chores", items: ["dishes"] });
    await remind(people.owner, { action: "check_items", list: "Chores", items: ["trash"] });
    const before = listItems("Chores");
    const out = await remind(people.owner, { action: "clear_done", list: "Chores" });
    expect(out.confirmation?.props.undo).toBeDefined();
    expect(texts("Chores")).toEqual(["laundry"]);
    expect(runUndo(people.owner, out.undoId)).toMatchObject({ ok: true });
    expect(listItems("Chores")).toEqual(before);
  });

  test("edit_item leaves a receipt that restores the old text", async () => {
    await seedList(people.owner, "Gear", ["mugs", "tent"]);
    const out = await remind(people.owner, { action: "edit_item", list: "Gear", items: ["mugs"], name: "tin mugs" });
    expect(texts("Gear")).toEqual(["tin mugs", "tent"]);
    expect(out.confirmation?.props.undo).toBeDefined();
    expect(runUndo(people.owner, out.undoId)).toMatchObject({ ok: true });
    expect(texts("Gear")).toEqual(["mugs", "tent"]);
  });

  test("reorder leaves a receipt that restores the old order", async () => {
    await seedList(people.owner, "Order", ["a1", "b2", "c3"]);
    const before = listItems("Order");
    const out = await remind(people.owner, { action: "reorder", list: "Order", order: ["c3", "b2", "a1"] });
    expect(texts("Order")).toEqual(["c3", "b2", "a1"]);
    expect(out.confirmation?.props.undo).toBeDefined();
    expect(runUndo(people.owner, out.undoId)).toMatchObject({ ok: true });
    expect(listItems("Order")).toEqual(before);
  });

  test("a reorder that changes nothing leaves no receipt", async () => {
    await seedList(people.owner, "Same", ["a1", "b2"]);
    const out = await remind(people.owner, { action: "reorder", list: "Same", order: ["a1", "b2"] });
    expect(out.undoId).toBe("");
  });

  test("an owner cannot undo into a teen's private list", async () => {
    await seedList(teen, "Diary", ["secret one", "secret two"]);
    const list = db.select().from(lists).where(eq(lists.title, "Diary")).get()!;
    const items = JSON.parse(list.items) as Items;
    const rows = [
      { kind: "restore_items", listId: list.id, removed: [{ index: 0, item: { ...items[0]!, id: "li-x", created_at: items[0]!.id } }] },
      { kind: "edit_item_back", listId: list.id, itemId: items[0]!.id, previousText: "owned" },
      { kind: "reorder_back", listId: list.id, order: [items[1]!.id, items[0]!.id] },
    ];
    for (const inverse of rows) {
      const receipt = recordUndo({ personId: people.owner.id, tool: "remind", action: "x", inverse: inverse as never });
      expect(runUndo(people.owner, receipt.id)).toMatchObject({ ok: false, status: 409 });
    }
    expect(texts("Diary")).toEqual(["secret one", "secret two"]);
  });

  test("a foreign person's undo id is a 404, and an expired one a 409", async () => {
    await seedList(people.owner, "Mine", ["x1", "y2"]);
    const out = await remind(people.owner, { action: "remove_items", list: "Mine", items: ["x1"] });
    expect(runUndo(teen, out.undoId)).toMatchObject({ ok: false, status: 404 });
    expect(runUndo(people.owner, out.undoId, new Date(Date.now() + 11 * 60_000))).toMatchObject({ ok: false, status: 409 });
    expect(texts("Mine")).toEqual(["y2"]);
  });
});

describe("alarm receipts", () => {
  const rowOf = (id: string) => db.select().from(alarms).where(eq(alarms.id, id)).get()!;
  const pendingJobs = (alarmId: string) => db.select().from(scheduledJobs).all()
    .filter((job) => job.job === "alarms.fire" && job.status === "pending" && JSON.parse(job.inputs).alarmId === alarmId);

  test("edit, disable, enable and skip each leave a receipt that restores the exact state", async () => {
    const made = createAlarm(people.owner, { time: "06:30", days: [1, 2, 3, 4, 5], label: "gym" });
    if (!made.ok) throw new Error("alarm create failed");
    const id = made.value.id;
    const original = rowOf(id);
    const steps: Array<[string, string]> = [
      ["edit_alarm", "gym to 7:15 am"],
      ["disable_alarm", "gym"],
      ["skip_next_alarm", "gym"],
    ];
    for (const [action, expression] of steps) {
      const before = rowOf(id);
      const out = await timer(people.owner, { action, expression });
      expect(out.confirmation?.props.undo).toBeDefined();
      expect(out.confirmation?.id).toBe(out.undoId);
      expect(rowOf(id)).not.toMatchObject({ time: before.time, enabled: before.enabled, skipUntil: before.skipUntil, label: before.label });
      expect(runUndo(people.owner, out.undoId)).toMatchObject({ ok: true });
      const after = rowOf(id);
      expect({ time: after.time, days: after.days, label: after.label, enabled: after.enabled, skipUntil: after.skipUntil })
        .toEqual({ time: before.time, days: before.days, label: before.label, enabled: before.enabled, skipUntil: before.skipUntil });
    }
    await timer(people.owner, { action: "disable_alarm", expression: "gym" });
    const enabled = await timer(people.owner, { action: "enable_alarm", expression: "gym" });
    expect(rowOf(id).enabled).toBe(true);
    expect(runUndo(people.owner, enabled.undoId)).toMatchObject({ ok: true });
    expect(rowOf(id).enabled).toBe(false);
    expect(pendingJobs(id)).toHaveLength(0);
    expect(original.time).toBe("06:30");
  });

  test("delete_alarm leaves a receipt, and Undo brings the alarm and its ring job back", async () => {
    const made = createAlarm(people.owner, { time: "06:30", days: [1, 2, 3, 4, 5], label: "gym" });
    if (!made.ok) throw new Error("alarm create failed");
    const out = await timer(people.owner, { action: "delete_alarm", expression: "gym" });
    expect(out.confirmation?.props.undo).toBeDefined();
    expect(rowOf(made.value.id).deletedAt).not.toBeNull();
    expect(runUndo(people.owner, out.undoId)).toMatchObject({ ok: true });
    expect(rowOf(made.value.id).deletedAt).toBeNull();
    expect(pendingJobs(made.value.id)).toHaveLength(1);
  });

  test("set_alarm for a repeating alarm record and cancel_alarm each leave a receipt", async () => {
    const set = await timer(people.owner, { action: "set_alarm", expression: "weekdays at 6:45 am called run" });
    expect(set.confirmation?.props.undo).toBeDefined();
    const live = () => db.select().from(alarms).where(isNull(alarms.deletedAt)).all();
    expect(live()).toHaveLength(1);
    const cancelled = await timer(people.owner, { action: "cancel_alarm", expression: "run" });
    expect(live()).toHaveLength(0);
    expect(runUndo(people.owner, cancelled.undoId)).toMatchObject({ ok: true });
    expect(live()).toHaveLength(1);
    expect(runUndo(people.owner, set.undoId)).toMatchObject({ ok: true });
    expect(live()).toHaveLength(0);
  });

  test("a one-time alarm job can be undone after set and after cancel", async () => {
    const set = await timer(people.owner, { action: "set_alarm", expression: "tomorrow at 7 called gym" });
    const jobs = () => db.select().from(scheduledJobs).all().filter((job) => job.job === "alarms.fire");
    expect(jobs()[0]!.status).toBe("pending");
    const cancelled = await timer(people.owner, { action: "cancel_alarm", expression: "gym" });
    expect(jobs()[0]!.status).toBe("cancelled");
    expect(runUndo(people.owner, cancelled.undoId)).toMatchObject({ ok: true });
    expect(jobs()[0]!.status).toBe("pending");
    expect(runUndo(people.owner, set.undoId)).toMatchObject({ ok: true });
    expect(jobs()[0]!.status).toBe("cancelled");
  });

  test("an owner cannot undo into a teen's alarm, and another person's undo id is a 404", async () => {
    const theirs = createAlarm(teen, { time: "07:00", days: [1], label: "school" });
    if (!theirs.ok) throw new Error("alarm create failed");
    const out = await timer(teen, { action: "disable_alarm", expression: "school" });
    expect(runUndo(people.owner, out.undoId)).toMatchObject({ ok: false, status: 404 });
    for (const inverse of [
      { kind: "alarm_state_back", alarmId: theirs.value.id, state: { enabled: true, skipUntil: null, time: "05:00", days: [1], label: "own" } },
      { kind: "restore_alarm", alarmId: theirs.value.id },
      { kind: "remove_alarm", alarmId: theirs.value.id },
    ]) {
      const receipt = recordUndo({ personId: people.owner.id, tool: "timer", action: "x", inverse: inverse as never });
      expect(runUndo(people.owner, receipt.id)).toMatchObject({ ok: false, status: 409 });
    }
    expect(rowOf(theirs.value.id)).toMatchObject({ enabled: false, time: "07:00", deletedAt: null });
  });

  test("a question or a refusal leaves no receipt", async () => {
    const out = await timer(people.owner, { action: "disable_alarm", expression: "yoga" });
    expect(out.undoId).toBe("");
    expect(out.confirmation).toBeUndefined();
  });
});

describe("list context after a read", () => {
  test("after show_list, 'those items' and 'that list' resolve, and no Undo is offered", async () => {
    await seedList(people.owner, "Picnic", ["bread", "cheese"]);
    const shown = await remind(people.owner, { action: "show_list", list: "Picnic" });
    expect(shown.confirmation).toBeUndefined();
    const context = lastListContextFor(people.owner.id);
    expect(context.lastItemIds).toHaveLength(2);
    // Newer than the add, so it wins; and the context row itself is spent: it cannot be undone.
    const rows = db.select().from(toolUndo).all().filter((row) => row.action === "show_list");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.usedAt).not.toBeNull();
    expect(runUndo(people.owner, rows[0]!.id)).toMatchObject({ ok: false, status: 409 });
    await remind(people.owner, { action: "check_items", list: "that", items: ["those"] });
    expect(listItems("Picnic").every((item) => item.done)).toBe(true);
  });

  test("after find_list, 'that list' resolves", async () => {
    await seedList(people.owner, "Errands", ["stamps"]);
    await remind(people.owner, { action: "create_list", name: "Other" });
    await remind(people.owner, { action: "find_list", list: "Errands" });
    await remind(people.owner, { action: "add_items", list: "that", items: ["milk"] });
    expect(texts("Errands")).toEqual(["stamps", "milk"]);
  });
});

describe("Undo rows hold nothing after use or expiry", () => {
  test("a used row drops its inverse, and rows expired for an hour are deleted", async () => {
    await seedList(people.owner, "Purge", ["alpha one", "beta two"]);
    const out = await remind(people.owner, { action: "remove_items", list: "Purge", items: ["alpha one"] });
    const stored = () => db.select().from(toolUndo).where(eq(toolUndo.id, out.undoId)).get();
    expect(stored()!.inverseJson).toContain("alpha one");
    expect(runUndo(people.owner, out.undoId)).toMatchObject({ ok: true });
    expect(stored()!.inverseJson).not.toContain("alpha one");
    const later = new Date(Date.now() + 2 * 60 * 60_000);
    expect(purgeExpiredUndo(later)).toBeGreaterThan(0);
    expect(stored()).toBeUndefined();
  });

  test("no list text or alarm label reaches the logger", async () => {
    const spies = (["log", "warn", "error", "info"] as const).map((name) => spyOn(console, name));
    try {
      await seedList(people.owner, "Quiet", ["zebra stripes"]);
      const removed = await remind(people.owner, { action: "remove_items", list: "Quiet", items: ["zebra stripes"] });
      runUndo(people.owner, removed.undoId);
      createAlarm(people.owner, { time: "06:30", days: [1], label: "tiger alarm" });
      const edited = await timer(people.owner, { action: "edit_alarm", expression: "tiger alarm to 7 am" });
      runUndo(people.owner, edited.undoId);
      const logged = spies.flatMap((spy) => spy.mock.calls).map((args) => args.join(" ")).join("\n");
      expect(logged).not.toContain("zebra");
      expect(logged).not.toContain("tiger");
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
