import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { createBenchPeople } from "../scripts/bench/conversationRunner";
import { commandsNode, type CommandsOutput } from "@/lib/turnMachine/nodes/commands";
import { classifyTurnSignal } from "@/lib/turnSignal";
import { commandOpeners, loadAllManifests } from "@/lib/turnShared";
import { lists, toolAudit, toolUndo } from "@/db/schema";
import { db } from "@/db";
import { loadManifestOnly, runPlugin } from "@/lib/plugins";
import { listWidgets, getWidgetData } from "@/lib/widgets";
import { guardReply } from "@/lib/guards";
import { ACTION_FAMILIES } from "@/lib/guards";
import type { PersonRow } from "@/types";

let people: ReturnType<typeof createBenchPeople>;
beforeEach(() => {
  resetDb();
  people = createBenchPeople();
});

type Matched = Extract<CommandsOutput, { matched: true }>;

function expectMatched(out: CommandsOutput): Matched {
  expect(out.matched).toBe(true);
  if (!out.matched) throw new Error("expected the command to match");
  return out;
}

async function command(utterance: string, actor: PersonRow = people.owner, anonymous = false) {
  const state = {
    actor,
    surface: anonymous ? "robot" : "chat",
    speakerEvidence: anonymous ? null : undefined,
    signal: classifyTurnSignal({
      text: utterance,
      ageBand: anonymous ? "child" : "adult",
      commandOpeners: commandOpeners(loadAllManifests()),
    }),
    temporary: false,
    turnId: `list-${Math.random()}`,
    conversationId: "list-test",
    outcomes: [],
    toolEvents: [],
  } as never;
  const { output } = await commandsNode(state, { utterance }, new AbortController().signal);
  return expectMatched(output);
}

function shoppingTexts(): string[] {
  return db.select().from(lists).all()
    .flatMap((row) => JSON.parse(row.items) as Array<{ text: string }>)
    .map((item) => item.text);
}

function blockKinds(out: Matched): string[] {
  return (out.blockEvents ?? []).flatMap((event) => (event.t === "block" ? [String(event.block?.kind)] : []));
}

describe("remind owns the shopping list closed patterns", () => {
  test.each(["add milk to the shopping list", "put milk on the shopping list"])("%s adds through remind with the old reply", async (utterance) => {
    const out = await command(utterance);
    expect(out.outcome.packageId).toBe("remind");
    expect(out.text).toBe("Added milk to your shopping list.");
    expect(shoppingTexts()).toContain("milk");
    expect(blockKinds(out)).toEqual([]);
  });

  test("an add writes one audit row and one undo row that removes the item", async () => {
    await command("add milk to the shopping list");
    const audit = db.select().from(toolAudit).all().filter((row) => row.tool === "lists");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ decision: "do", action: "add_items" });
    const undo = db.select().from(toolUndo).all();
    expect(undo).toHaveLength(1);
    expect(JSON.parse(undo[0]!.inverseJson)).toMatchObject({ kind: "remove_item" });
  });

  test.each(["what's on my shopping list", "what do I need to buy"])("%s answers with the list and a todo_list block", async (utterance) => {
    await command("add milk to the shopping list");
    await command("add salt to the shopping list");
    const out = await command(utterance);
    expect(out.outcome.packageId).toBe("remind");
    expect(out.text).toBe("milk, salt");
    expect(blockKinds(out)).toEqual(["todo_list"]);
    const audit = db.select().from(toolAudit).all().filter((row) => row.action === "show_list");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ decision: "do", tool: "lists" });
  });

  test("an empty list keeps the old wording", async () => {
    const out = await command("what's on my shopping list");
    expect(out.text).toBe("Your shopping list is empty.");
  });

  test("a plain reminder still sets a reminder with the Undo confirmation", async () => {
    const out = await command("remind me at 6 to call Nadia");
    expect(out.outcome.packageId).toBe("remind");
    expect(out.text).toMatch(/^Okay, I'll remind you: .*call Nadia/);
    expect(blockKinds(out)).toEqual(["schedule_card", "confirmation"]);
    expect(db.select().from(toolUndo).all()).toHaveLength(1);
    expect(db.select().from(toolAudit).all().filter((row) => row.tool === "lists")).toHaveLength(0);
  });

  test("an unidentified speaker can still add to the shopping list", async () => {
    const out = await command("add milk to the shopping list", people.owner, true);
    expect(out.text).toBe("Added milk to your shopping list.");
  });

  test("a child can add and view the shopping list", async () => {
    const added = await command("put eggs on the shopping list", people.child);
    expect(added.text).toBe("Added eggs to your shopping list.");
    const shown = await command("what's on my shopping list", people.child);
    expect(shown.text).toBe("eggs");
  });

  test("remind declares the permissions and block kinds the list phrases need", () => {
    const loaded = loadManifestOnly("remind");
    if (!loaded.ok) throw new Error("remind did not load");
    expect(loaded.value.permissions).toEqual(expect.arrayContaining(["reminders:write", "lists:write", "lists:read"]));
    expect(loaded.value.returns_blocks).toEqual(expect.arrayContaining(["schedule_card", "confirmation", "todo_list"]));
    expect(loaded.value.args).toEqual({
      type: "object",
      required: ["expression"],
      properties: { expression: { type: "string", minLength: 1 } },
    });
  });

  test("remind declares the shopping widget and it reads the shopping list", async () => {
    expect(listWidgets(people.owner)).toContainEqual(
      expect.objectContaining({ package: "remind", id: "shopping", title: "Shopping List", size: "card", refresh_s: 60 }),
    );
    const empty = await getWidgetData(people.owner, "remind", "shopping");
    expect(empty.ok && empty.value.items).toEqual([{ title: "Your shopping list is empty." }]);
    await command("add milk to the shopping list");
    const result = await getWidgetData(people.owner, "remind", "shopping");
    expect(result.ok && result.value.items).toEqual([{ title: "milk" }]);
  });

  test("the list false-claim guard covers remind", () => {
    const family = ACTION_FAMILIES.find((entry) => entry.packages.includes("remind"));
    expect(family?.packages).toContain("remind");
    const reply = "Added milk to your shopping list.";
    const guarded = guardReply(reply, {
      utterance: "add milk to the shopping list",
      outcomes: [{ packageId: "remind", status: "succeeded" }],
    } as never);
    expect(guarded.reply ?? reply).toBe(reply);
  });

  test("a reminder whose text starts with the private list prefix is never run as a list call", async () => {
    await runPlugin("remind", people.owner, { expression: "list:add_items:smuggled in an hour" });
    const shopping = db.select().from(lists).all().flatMap((row) => JSON.parse(row.items) as Array<{ text: string }>);
    expect(shopping.some((item) => item.text.includes("smuggled"))).toBe(false);
    expect(db.select().from(toolAudit).all().filter((row) => row.tool === "lists")).toHaveLength(0);
  });
});
