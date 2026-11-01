// ASSIST-UNDO-03: the model's `undo` action on remind and timer undoes the speaker's own latest open Undo row.
import { beforeEach, describe, expect, test } from "bun:test";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { lists, toolAudit, toolUndo } from "@/db/schema";
import { alarmFoldFor, isAlarmActionCall, neutralizeReservedPrefix, parseAlarmCall } from "@/lib/alarmCalls";
import { runPlugin } from "@/lib/plugins";
import { setHouseholdSettingValue } from "@/lib/settings";
import { brakeFor } from "@/lib/toolBrake";
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

async function call(pkg: "remind" | "timer", actor: PersonRow, args: Record<string, unknown>) {
  const result = await runPlugin(pkg, actor, args);
  if (!result.ok) throw new Error(`${pkg} failed: ${result.error}`);
  const value = result.value as unknown as { reply?: { text?: string } };
  return value.reply?.text ?? "";
}
const remind = (actor: PersonRow, args: Record<string, unknown>) => call("remind", actor, args);

function texts(title: string): string[] {
  const row = db.select().from(lists).where(and(eq(lists.title, title), isNull(lists.deletedAt))).get();
  return row ? (JSON.parse(row.items) as Array<{ text: string }>).map((item) => item.text) : [];
}

describe("undo action", () => {
  test("the fold exists on both tools and parses back to the action", () => {
    expect(alarmFoldFor("remind", "undo")).toBe("undo:last:");
    expect(alarmFoldFor("timer", "undo")).toBe("undo:last:");
    expect(parseAlarmCall("remind", "undo:last:")).toMatchObject({ action: "undo" });
    expect(isAlarmActionCall("remind", { action: "undo" })).toBe(true);
    expect(isAlarmActionCall("timer", { action: "undo" })).toBe(true);
  });

  test("reverts the latest add and audits it without text", async () => {
    await remind(people.owner, { action: "create_list", name: "Camp" });
    await remind(people.owner, { action: "add_items", list: "Camp", items: ["tent"] });
    await remind(people.owner, { action: "add_items", list: "Camp", items: ["stove"] });
    expect(texts("Camp")).toEqual(["tent", "stove"]);
    expect(await remind(people.owner, { action: "undo" })).toBe("Undone.");
    expect(texts("Camp")).toEqual(["tent"]);
    const audit = db.select().from(toolAudit).all().filter((row) => row.decision === "undo");
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain("stove");
  });

  test("works from timer too, and a spent row is not used twice", async () => {
    await remind(people.owner, { action: "create_list", name: "Camp" });
    await remind(people.owner, { action: "add_items", list: "Camp", items: ["tent"] });
    expect(await call("timer", people.owner, { action: "undo" })).toBe("Undone.");
    expect(texts("Camp")).toEqual([]);
    // The next call takes the older create_list row, then nothing is left: a spent row is never reused.
    expect(await call("timer", people.owner, { action: "undo" })).toBe("Undone.");
    expect(await call("timer", people.owner, { action: "undo" })).toBe("There is nothing to undo.");
  });

  test("nothing to undo gives the plain sentence", async () => {
    expect(await remind(people.owner, { action: "undo" })).toBe("There is nothing to undo.");
  });

  test("an expired row is not used", async () => {
    await remind(people.owner, { action: "create_list", name: "Camp" });
    await remind(people.owner, { action: "add_items", list: "Camp", items: ["tent"] });
    db.update(toolUndo).set({ expiresAt: new Date(Date.now() - 60_000).toISOString() }).run();
    expect(await remind(people.owner, { action: "undo" })).toBe("There is nothing to undo.");
    expect(texts("Camp")).toEqual(["tent"]);
  });

  test("another person's row is never used", async () => {
    await remind(people.owner, { action: "create_list", name: "Camp" });
    await remind(people.owner, { action: "add_items", list: "Camp", items: ["tent"] });
    expect(await remind(teen, { action: "undo" })).toBe("There is nothing to undo.");
    expect(await remind(people.child, { action: "undo" })).toBe("There is nothing to undo.");
    expect(texts("Camp")).toEqual(["tent"]);
  });

  test("a minor undoes their own row", async () => {
    await remind(teen, { action: "create_list", name: "Mine" });
    await remind(teen, { action: "add_items", list: "Mine", items: ["book"] });
    expect(await remind(teen, { action: "undo" })).toBe("Undone.");
    expect(texts("Mine")).toEqual([]);
  });

  test("the brake always allows a known speaker, even for a minor or a taint, and refuses an unknown one", () => {
    const base = { tool: "remind" as const, action: "undo", args: {}, tainted: true, mode: "do" as const };
    expect(brakeFor({ ...base, actor: { id: "p1", role: "owner", band: "adult" } }).decision).toBe("do");
    expect(brakeFor({ ...base, actor: { id: "p2", role: "child", band: "child" } }).decision).toBe("do");
    expect(brakeFor({ ...base, mode: "ask", actor: { id: "p1", role: "owner", band: "adult" } }).decision).toBe("do");
    expect(brakeFor({ ...base, actor: { id: "", role: "guest", band: "adult" } })).toMatchObject({ decision: "never", reason: "unknown_speaker" });
  });
});

describe("reserved prefix", () => {
  test("model text that starts with undo: is neutralized and runs nothing", async () => {
    await remind(people.owner, { action: "create_list", name: "Camp" });
    await remind(people.owner, { action: "add_items", list: "Camp", items: ["tent"] });
    expect(neutralizeReservedPrefix("undo:last:")).toBe("undo last:");
    expect(neutralizeReservedPrefix("  Undo:last:")).toBe("  Undo last:");
    await runPlugin("remind", people.owner, { expression: "undo:last:" });
    await runPlugin("timer", people.owner, { expression: "undo:last:" });
    expect(texts("Camp")).toEqual(["tent"]);
    expect(db.select().from(toolAudit).all().filter((row) => row.decision === "undo")).toHaveLength(0);
  });
});
