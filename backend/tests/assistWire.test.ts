// ASSIST-WIRE-01: every action the widened `remind` and `timer` schemas name runs through the host path, with the setting on.
// Model-style calls go through runPlugin exactly as the turn engine makes them; the rows are real people and real lists.
import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { alarms, lists, scheduledJobs, toolAudit, toolUndo } from "@/db/schema";
import { alarmFoldFor, isAlarmActionCall, isListAction, listCallText, parseAlarmCall, parseListCall } from "@/lib/alarmCalls";
import { LIST_ACTIONS } from "@/lib/listActions";
import { createAlarm } from "@/lib/alarms";
import { runPlugin } from "@/lib/plugins";
import { setHouseholdSettingValue } from "@/lib/settings";
import { runUndo } from "@/lib/toolUndo";
import { policyNode } from "@/lib/turnMachine/nodes/policy";
import type { TurnState } from "@/lib/turnMachine/contract";
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

async function remind(actor: PersonRow, args: Record<string, unknown>) {
  const result = await runPlugin("remind", actor, args);
  if (!result.ok) throw new Error(`remind failed: ${result.error}`);
  return { text: result.value.reply?.text ?? "", data: (result.value.data ?? {}) as Record<string, unknown> };
}

async function timer(actor: PersonRow, args: Record<string, unknown>) {
  const result = await runPlugin("timer", actor, args);
  if (!result.ok) throw new Error(`timer failed: ${result.error}`);
  return { text: result.value.reply?.text ?? "", data: (result.value.data ?? {}) as Record<string, unknown> };
}

function listNamed(title: string) {
  const row = db.select().from(lists).where(and(eq(lists.title, title), isNull(lists.deletedAt))).get();
  return row ? { ...row, parsed: JSON.parse(row.items) as Items } : undefined;
}

const itemTexts = (title: string): string[] => (listNamed(title)?.parsed ?? []).map((item) => item.text);

describe("every list action through remind, setting on", () => {
  test("create, add, check, rename, move, copy with exclude, reorder, clear done, delete and undo", async () => {
    const owner = people.owner;
    expect((await remind(owner, { action: "create_list", name: "Camping" })).text).toBe("I created the list.");
    expect(listNamed("Camping")).toMatchObject({ scope: "person", person: owner.id });

    await remind(owner, { action: "add_items", list: "Camping", items: ["tent", "stove", "lantern", "mugs"] });
    expect(itemTexts("Camping")).toEqual(["tent", "stove", "lantern", "mugs"]);

    await remind(owner, { action: "check_items", list: "Camping", items: ["tent"] });
    expect(listNamed("Camping")!.parsed.find((item) => item.text === "tent")?.done).toBe(true);

    await remind(owner, { action: "rename_list", list: "Camping", name: "Trip" });
    expect(listNamed("Camping")).toBeUndefined();
    expect(listNamed("Trip")).toBeDefined();

    await remind(owner, { action: "create_list", name: "Gear" });
    expect((await remind(owner, { action: "move_items", list: "Trip", to_list: "Gear", items: ["stove", "lantern"] })).text).toBe("I moved the items.");
    expect(itemTexts("Gear")).toEqual(["stove", "lantern"]);
    expect(itemTexts("Trip")).toEqual(["tent", "mugs"]);

    await remind(owner, { action: "copy_list", list: "Gear", name: "Gear two", exclude: ["lantern"] });
    expect(itemTexts("Gear two")).toEqual(["stove"]);
    expect(itemTexts("Gear")).toEqual(["stove", "lantern"]);

    await remind(owner, { action: "reorder", list: "Gear", order: ["lantern", "stove"] });
    expect(itemTexts("Gear")).toEqual(["lantern", "stove"]);

    expect((await remind(owner, { action: "clear_done", list: "Trip" })).text).toBe("I cleared the completed items.");
    expect(itemTexts("Trip")).toEqual(["mugs"]);

    await remind(owner, { action: "edit_item", list: "Trip", items: ["mugs"], name: "tin mugs" });
    expect(itemTexts("Trip")).toEqual(["tin mugs"]);
    await remind(owner, { action: "uncheck_items", list: "Gear", items: ["stove"] });
    await remind(owner, { action: "remove_items", list: "Gear", items: ["stove"] });
    expect(itemTexts("Gear")).toEqual(["lantern"]);

    const found = await remind(owner, { action: "find_list", list: "Trip" });
    expect(found.text).toBe("I found the list: Trip.");
    const shown = await remind(owner, { action: "show_list", list: "Trip" });
    expect(shown.text).toBe("Trip: tin mugs");

    const removed = await remind(owner, { action: "delete_list", list: "Gear" });
    expect(listNamed("Gear")).toBeUndefined();
    const undoId = String(removed.data.undo_id);
    expect(runUndo(owner, undoId)).toMatchObject({ ok: true });
    expect(listNamed("Gear")?.parsed.map((item) => item.text)).toEqual(["lantern"]);
  });

  test("the expression stands in for the one field an action needs", async () => {
    const owner = people.owner;
    await remind(owner, { action: "create_list", expression: "Errands" });
    await remind(owner, { action: "add_items", list: "Errands", expression: "stamps" });
    expect(itemTexts("Errands")).toEqual(["stamps"]);
    expect((await remind(owner, { action: "show_list", expression: "Errands" })).text).toBe("Errands: stamps");
  });

  test("that list and those items mean what the last change touched, and the changes can be undone", async () => {
    const owner = people.owner;
    await remind(owner, { action: "create_list", name: "Picnic" });
    const added = await remind(owner, { action: "add_items", list: "Picnic", items: ["bread", "cheese"] });
    await remind(owner, { action: "check_items", list: "that", items: ["those"] });
    expect(listNamed("Picnic")!.parsed.every((item) => item.done)).toBe(true);
    // The check is the newest change: undoing it unticks both items.
    const newest = db.select().from(toolUndo).all().filter((row) => row.action === "check_items");
    expect(newest).toHaveLength(1);
    expect(runUndo(owner, newest[0]!.id)).toMatchObject({ ok: true });
    expect(listNamed("Picnic")!.parsed.some((item) => item.done)).toBe(false);
    // Undoing the add removes both items in one step.
    expect(runUndo(owner, String(added.data.undo_id))).toMatchObject({ ok: true });
    expect(itemTexts("Picnic")).toEqual([]);
  });

  test("rename, move, create and copy each leave a receipt that reverses them", async () => {
    const owner = people.owner;
    const made = await remind(owner, { action: "create_list", name: "Old name" });
    await remind(owner, { action: "add_items", list: "Old name", items: ["one"] });
    const renamed = await remind(owner, { action: "rename_list", list: "Old name", name: "New name" });
    expect(runUndo(owner, String(renamed.data.undo_id))).toMatchObject({ ok: true });
    expect(listNamed("Old name")).toBeDefined();
    await remind(owner, { action: "create_list", name: "Other" });
    const moved = await remind(owner, { action: "move_items", list: "Old name", to_list: "Other", items: ["one"] });
    expect(runUndo(owner, String(moved.data.undo_id))).toMatchObject({ ok: true });
    expect(itemTexts("Old name")).toEqual(["one"]);
    const copied = await remind(owner, { action: "copy_list", list: "Old name", name: "Copy" });
    expect(runUndo(owner, String(copied.data.undo_id))).toMatchObject({ ok: true });
    expect(listNamed("Copy")).toBeUndefined();
    expect(runUndo(owner, String(made.data.undo_id))).toMatchObject({ ok: true });
    expect(listNamed("Old name")).toBeUndefined();
  });

  test("each action writes one audit row of the lists tool with a count and no list or item words", async () => {
    const owner = people.owner;
    await remind(owner, { action: "create_list", name: "Private words" });
    await remind(owner, { action: "add_items", list: "Private words", items: ["secret one", "secret two"] });
    const rows = db.select().from(toolAudit).all().filter((row) => row.tool === "lists");
    expect(rows.map((row) => `${row.action}:${row.decision}:${row.count}`)).toEqual(["create_list:do:1", "add_items:do:2"]);
    expect(JSON.stringify(rows)).not.toContain("secret");
  });

  test("the shopping-list patterns keep their closed form and reply", async () => {
    const owner = people.owner;
    const added = await remind(owner, { action: "add_items", list: "shopping", items: ["milk"], expression: "milk" });
    expect(added.text).toBe("Added milk to your shopping list.");
    const shown = await remind(owner, { action: "show_list", list: "shopping", expression: "shopping list" });
    expect(shown.text).toBe("milk");
  });

  test("a model add to the shopping list by name finds or makes the household list", async () => {
    const owner = people.owner;
    expect((await remind(owner, { action: "add_items", list: "my shopping list", items: ["eggs"] })).text).toBe("I added the items.");
    expect(itemTexts("Shopping List")).toEqual(["eggs"]);
  });
});

describe("a person only ever reaches their own lists and the household's", () => {
  test("an owner never touches a teen's private list through any action", async () => {
    const mine = await remind(teen, { action: "create_list", name: "Diary" });
    expect(mine.text).toBe("I created the list.");
    await remind(teen, { action: "add_items", list: "Diary", items: ["private thought"] });
    const before = JSON.stringify(db.select().from(lists).where(eq(lists.title, "Diary")).all());
    const owner = people.owner;
    const attempts: Array<Record<string, unknown>> = [
      { action: "show_list", list: "Diary" },
      { action: "find_list", list: "Diary" },
      { action: "add_items", list: "Diary", items: ["owner was here"] },
      { action: "remove_items", list: "Diary", items: ["private thought"] },
      { action: "check_items", list: "Diary", items: ["private thought"] },
      { action: "uncheck_items", list: "Diary", items: ["private thought"] },
      { action: "edit_item", list: "Diary", items: ["private thought"], name: "changed" },
      { action: "rename_list", list: "Diary", name: "Taken" },
      { action: "delete_list", list: "Diary" },
      { action: "clear_done", list: "Diary" },
      { action: "reorder", list: "Diary", order: ["private thought"] },
      { action: "copy_list", list: "Diary", name: "Stolen" },
      { action: "move_items", list: "Diary", to_list: "Diary", items: ["private thought"] },
      { action: "delete_list", expression: "Diary" },
    ];
    for (const args of attempts) {
      const out = await remind(owner, args);
      expect(out.text).toBe("I couldn't find that list.");
    }
    // Moving an owner's item into the teen's list, and "that list" after the teen's last change, reach nothing either.
    await remind(owner, { action: "create_list", name: "Mine" });
    await remind(owner, { action: "add_items", list: "Mine", items: ["x"] });
    expect((await remind(owner, { action: "move_items", list: "Mine", to_list: "Diary", items: ["x"] })).text).toBe("I couldn't find that list.");
    expect(JSON.stringify(db.select().from(lists).where(eq(lists.title, "Diary")).all())).toBe(before);
    expect(db.select().from(lists).where(eq(lists.title, "Stolen")).all()).toHaveLength(0);
    expect(itemTexts("Mine")).toEqual(["x"]);
  });

  test("a teen's undo row cannot reach the owner's list and the owner's cannot reach the teen's", async () => {
    await remind(teen, { action: "create_list", name: "Diary" });
    const diary = listNamed("Diary")!;
    const row = db.insert(toolUndo).values({
      id: "undo-foreign01",
      personId: people.owner.id,
      turnId: null,
      tool: "remind",
      action: "rename_list",
      inverseJson: JSON.stringify({ kind: "rename_list", listId: diary.id, title: "Owned" }),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      usedAt: null,
    }).returning().get();
    expect(runUndo(people.owner, row.id)).toMatchObject({ ok: false, status: 409 });
    expect(listNamed("Diary")).toBeDefined();
  });

  test("a teen adds to the household shopping list but cannot delete it or rename it", async () => {
    expect((await remind(teen, { action: "add_items", list: "shopping", items: ["bread"] })).text).toBe("I added the items.");
    expect((await remind(teen, { action: "delete_list", list: "shopping" })).text).toBe("A parent can do that.");
    expect((await remind(teen, { action: "rename_list", list: "shopping", name: "Mine" })).text).toBe("A parent can do that.");
    await remind(teen, { action: "create_list", name: "Own" });
    await remind(teen, { action: "add_items", list: "Own", items: ["apple"] });
    expect((await remind(teen, { action: "move_items", list: "Own", to_list: "shopping", items: ["apple"] })).text).toBe("A parent can do that.");
    expect(itemTexts("Shopping List")).toEqual(["bread"]);
    const never = db.select().from(toolAudit).all().filter((row) => row.decision === "never");
    expect(never.map((row) => row.action)).toEqual(["delete_list", "rename_list", "move_items"]);
  });
});

describe("the private prefixes cannot be smuggled", () => {
  test("text that starts with a reserved prefix never reaches an engine", async () => {
    const owner = people.owner;
    await remind(owner, { action: "create_list", name: "Keep" });
    const payload = JSON.stringify({ list: "Keep" });
    const before = db.select().from(toolAudit).all().length;
    for (const expression of [`lists:delete_list:${payload}`, `  Lists:delete_list:${payload}`, `list:add_items:${payload}`]) {
      await runPlugin("remind", owner, { expression });
      await runPlugin("remind", owner, { action: "create_reminder", expression });
    }
    expect(listNamed("Keep")).toBeDefined();
    expect(db.select().from(toolAudit).all()).toHaveLength(before);
    expect(db.select().from(lists).where(isNull(lists.deletedAt)).all().filter((row) => row.title === "Keep")).toHaveLength(1);
  });

  test("a closed-pattern add whose words look like a payload is one plain item", async () => {
    await remind(teen, { action: "create_list", name: "Diary" });
    const words = JSON.stringify({ list: "Diary", items: ["owner was here"] });
    await remind(people.owner, { action: "add_items", list: "shopping", items: [words], expression: words });
    expect(itemTexts("Diary")).toEqual([]);
    expect(itemTexts("Shopping List")).toEqual([words]);
  });

  test("an alarm action prefix in a plain timer expression changes no alarm", async () => {
    const owner = people.owner;
    createAlarm(owner, { time: "06:30", days: [1, 2, 3, 4, 5], label: "gym" });
    await runPlugin("timer", owner, { expression: "alarm:delete:gym" });
    await runPlugin("timer", owner, { expression: "  Alarm:disable:gym" });
    expect(db.select().from(alarms).all().filter((row) => row.deletedAt === null && row.enabled)).toHaveLength(1);
  });

  test("the payload is closed: unknown fields, long words and too many items are refused", () => {
    expect(parseListCall('lists:add_items:{"items":["a"],"extra":1}')).toMatchObject({ ok: false });
    expect(parseListCall('lists:add_items:{"items":[""]}')).toMatchObject({ ok: false });
    expect(parseListCall(`lists:add_items:{"list":"${"x".repeat(201)}"}`)).toMatchObject({ ok: false });
    expect(parseListCall("lists:add_items:not json")).toMatchObject({ ok: false });
    expect(parseListCall("lists:unknown_action:{}")).toBeNull();
    expect(parseListCall("milk")).toBeNull();
    const fifty = parseListCall(`lists:add_items:${JSON.stringify({ items: Array.from({ length: 50 }, (_, i) => `item ${i}`) })}`);
    expect(fifty).toMatchObject({ ok: true });
    const fiftyOne = parseListCall(`lists:add_items:${JSON.stringify({ items: Array.from({ length: 51 }, (_, i) => `item ${i}`) })}`);
    expect(fiftyOne).toMatchObject({ ok: false });
  });

  test("fifty-one items in one call add nothing and say why", async () => {
    const owner = people.owner;
    await remind(owner, { action: "create_list", name: "Big" });
    const items = Array.from({ length: 51 }, (_, i) => `item ${i}`);
    const out = await remind(owner, { action: "add_items", list: "Big", items });
    expect(out.text).toBe("That is too many at once. Please give me 50 items or fewer.");
    expect(itemTexts("Big")).toEqual([]);
  });

  test("the fold is built from fields only", () => {
    expect(listCallText("add_items", { items: ["a", " b "], list: " Big " })).toBe('lists:add_items:{"list":"Big","items":["a","b"]}');
    expect(listCallText("create_list", { expression: "Trip" })).toBe('lists:create_list:{"name":"Trip"}');
  });
});

describe("alarm actions through timer", () => {
  const hubAlarm = (label: string, time: string, extra: Record<string, unknown> = {}) => {
    const made = createAlarm(people.owner, { time, days: [1, 2, 3, 4, 5], label, ...extra });
    if (!made.ok) throw new Error("alarm create failed");
    return made.value;
  };
  const row = (id: string) => db.select().from(alarms).where(eq(alarms.id, id)).get()!;
  const pendingJobs = () => db.select().from(scheduledJobs).all().filter((job) => job.job === "alarms.fire" && job.status === "pending");

  test("edit, disable, enable, skip and delete act on the named alarm only", async () => {
    const owner = people.owner;
    const gym = hubAlarm("gym", "06:30");
    const school = hubAlarm("school", "07:45");
    expect(pendingJobs()).toHaveLength(2);

    const edited = await timer(owner, { action: "edit_alarm", expression: "gym alarm to 7:15 am" });
    expect(edited.text).toContain("changed your alarm: gym");
    expect(row(gym.id).time).toBe("07:15");
    expect(row(school.id).time).toBe("07:45");

    await timer(owner, { action: "disable_alarm", expression: "gym" });
    expect(row(gym.id).enabled).toBe(false);
    expect(pendingJobs()).toHaveLength(1);
    await timer(owner, { action: "enable_alarm", expression: "gym" });
    expect(row(gym.id).enabled).toBe(true);
    expect(pendingJobs()).toHaveLength(2);

    await timer(owner, { action: "skip_next_alarm", expression: "the school alarm" });
    expect(row(school.id).skipUntil).not.toBeNull();
    expect(row(gym.id).skipUntil).toBeNull();

    const gone = await timer(owner, { action: "delete_alarm", expression: "gym" });
    expect(gone.text).toBe("Alarm deleted: gym.");
    expect(row(gym.id).deletedAt).not.toBeNull();
    expect(row(school.id).deletedAt).toBeNull();
    const audit = db.select().from(toolAudit).all().filter((entry) => entry.tool === "timer").map((entry) => entry.action);
    expect(audit).toEqual(["edit_alarm", "disable_alarm", "enable_alarm", "skip_next_alarm", "delete_alarm"]);
  });

  test("an alarm is found by its time, and a rename needs no time", async () => {
    const owner = people.owner;
    const gym = hubAlarm("gym", "06:30");
    await timer(owner, { action: "edit_alarm", expression: "the 6:30 alarm to workout" });
    expect(row(gym.id).label).toBe("workout");
    expect(row(gym.id).time).toBe("06:30");
    await timer(owner, { action: "disable_alarm", expression: "6:30 am" });
    expect(row(gym.id).enabled).toBe(false);
  });

  test("two matching alarms or none give one plain question and change nothing", async () => {
    const owner = people.owner;
    const morning = hubAlarm("gym morning", "06:30");
    hubAlarm("gym evening", "18:00");
    const ask = await timer(owner, { action: "delete_alarm", expression: "gym" });
    expect(ask.text).toContain("I found more than one alarm like that. Which one should I delete?");
    expect(row(morning.id).deletedAt).toBeNull();
    const none = await timer(owner, { action: "disable_alarm", expression: "yoga" });
    expect(none.text).toBe("I couldn't find an alarm matching that to turn off.");
    expect(db.select().from(toolAudit).all()).toHaveLength(0);
  });

  test("an owner never reaches a teen's alarm", async () => {
    const secret = createAlarm(teen, { time: "05:00", days: [1], label: "secret" });
    if (!secret.ok) throw new Error("alarm create failed");
    for (const action of ["edit_alarm", "enable_alarm", "disable_alarm", "skip_next_alarm", "delete_alarm"]) {
      const out = await timer(people.owner, { action, expression: "secret alarm to 6 am" });
      expect(out.text).toContain("I couldn't find an alarm matching that");
    }
    expect(row(secret.value.id)).toMatchObject({ time: "05:00", enabled: true, deletedAt: null, skipUntil: null });
  });
});

describe("an unidentified speaker is refused every action", () => {
  const abort = new AbortController().signal;
  const robot = (speakerEvidence: unknown, surface = "robot") =>
    ({ actor: { id: people.owner.id, role: "owner" }, surface, speakerEvidence, context: [], crisis: false, temporary: false, utterance: "set a timer for 10 minutes" }) as unknown as TurnState;
  const decide = async (state: TurnState, tool: string, args: Record<string, unknown>) =>
    (await policyNode(state, { calls: [{ id: "call-1", tool, args }] }, abort)).output.entries[0]?.decision;

  test("every list, reminder and alarm action is refused by the policy; a plain reminder and timer are not", async () => {
    const widened = (id: string) => JSON.parse(readFileSync(join(import.meta.dir, "..", "packages", id, "args.widened.json"), "utf-8")) as { args: { properties: { action: { enum: string[] } } } };
    for (const [tool, id] of [["remind", "remind"], ["timer", "timer"]] as const) {
      for (const action of widened(id).args.properties.action.enum) {
        if (action === "create_reminder") continue;
        expect(isAlarmActionCall(tool, { action })).toBe(true);
        expect(await decide(robot(null), tool, { action, expression: "x" })).toEqual({ allow: false, reason: "anonymous_speaker" });
      }
    }
    expect(await decide(robot(null), "timer", { expression: "10 minutes" })).toEqual({ allow: true });
    expect(isAlarmActionCall("remind", { action: "create_reminder" })).toBe(false);
  });
});

describe("the widened schemas promise only what the backend runs", () => {
  const widened = (id: string) => JSON.parse(readFileSync(join(import.meta.dir, "..", "packages", id, "args.widened.json"), "utf-8")) as {
    args: { properties: { action: { enum: string[] } } };
  };

  test("every timer action is a fold the host parses back to the same action", () => {
    for (const action of widened("timer").args.properties.action.enum) {
      const prefix = alarmFoldFor("timer", action);
      expect(prefix).not.toBeNull();
      expect(parseAlarmCall("timer", `${prefix}words`)).toMatchObject({ action, rest: "words" });
    }
  });

  test("every remind action is a list action, a reminder fold, or the plain reminder, and runs without an error", async () => {
    const owner = people.owner;
    await remind(owner, { action: "create_list", name: "Probe" });
    await remind(owner, { action: "add_items", list: "Probe", items: ["alpha", "beta"] });
    const calls: Record<string, Record<string, unknown>> = {
      create_reminder: { expression: "call Nadia tomorrow at noon" },
      edit_reminder: { expression: "call Nadia", reminder: "call Nadia", task: "call Nadia back" },
      snooze_reminder: { expression: "call Nadia back", minutes: 5 },
      complete_reminder: { expression: "call Nadia back" },
      cancel_reminder: { expression: "call Nadia back" },
      list_reminders: { expression: "reminders" },
    };
    for (const action of widened("remind").args.properties.action.enum) {
      if (isListAction(action)) {
        const fields = { name: "Probe two", list: "Probe", to_list: "Probe", items: ["alpha"], order: ["beta"], exclude: ["beta"] };
        const parsed = parseListCall(listCallText(action, { ...fields, expression: "Probe" }));
        expect(parsed).toMatchObject({ ok: true, action });
        const ran = await runPlugin("remind", owner, { action, ...fields, expression: "Probe" });
        expect(ran.ok).toBe(true);
        continue;
      }
      if (action === "create_reminder") {
        expect(alarmFoldFor("remind", action)).toBeNull();
      } else {
        const prefix = alarmFoldFor("remind", action);
        expect(prefix).not.toBeNull();
        expect(parseAlarmCall("remind", `${prefix}words`)).toMatchObject({ action });
      }
      const ran = await runPlugin("remind", owner, { action, ...calls[action]! });
      expect(ran.ok).toBe(true);
    }
    for (const action of LIST_ACTIONS) expect(widened("remind").args.properties.action.enum).toContain(action);
  });
});
