import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { addBenchTeen, createBenchPeople } from "../scripts/bench/conversationRunner";
import { owner, teen } from "./support/testAuth";
import { recordUndo, runUndo, undoBlockFor } from "@/lib/toolUndo";
import { db } from "@/db";
import { lists, scheduledJobs, toolUndo, toolAudit, people as peopleTable } from "@/db/schema";
import { createList, addItem, deleteList } from "@/lib/lists";
import { scheduleCoreJob } from "@/lib/scheduler";
import { blocksForRecipeRun } from "@/lib/packageBlocks";
import { runPlugin } from "@/lib/plugins";

let people: ReturnType<typeof createBenchPeople>;
beforeEach(() => {
  resetDb();
  people = createBenchPeople();
  addBenchTeen(people);
});

describe("tool undo", () => {
  test("stores an id-only inverse, removes a restored item and audits undo", () => {
    const list = createList(people.owner, { kind: "custom", title: "Groceries" });
    if (!list.ok) throw new Error("list create failed");
    const item = addItem(people.owner, list.value.id, { text: "oat milk" });
    if (!item.ok) throw new Error("item add failed");
    const itemId = item.value.items[0]!.id;
    const receipt = recordUndo({
      personId: people.owner.id,
      turnId: "turn-test01",
      tool: "remind",
      action: "remove_item",
      inverse: { kind: "remove_item", listId: list.value.id, itemId },
    });
    expect(db.select().from(toolUndo).get()?.inverseJson).not.toContain("oat milk");
    expect(runUndo(people.owner, receipt.id)).toMatchObject({ ok: true });
    expect(db.select().from(toolAudit).all().some((row) => row.decision === "undo")).toBe(true);
  });

  test("restores a deleted list", () => {
    const list = createList(people.owner, { kind: "custom", title: "Errands" });
    if (!list.ok) throw new Error("list create failed");
    expect(deleteList(people.owner, list.value.id).ok).toBe(true);
    const receipt = recordUndo({
      personId: people.owner.id,
      tool: "lists",
      action: "delete",
      inverse: { kind: "restore_list", listId: list.value.id },
    });

    expect(runUndo(people.owner, receipt.id)).toMatchObject({ ok: true });
    expect(db.select().from(lists).where(eq(lists.id, list.value.id)).get()?.deletedAt).toBeNull();
  });

  test("cancels a reminder created by remind", () => {
    const scheduled = scheduleCoreJob(
      people.owner,
      "reminders.fire",
      new Date(Date.now() + 60_000).toISOString(),
      { task: "call the dentist" },
    );
    if (!scheduled.ok) throw new Error("reminder schedule failed");
    const receipt = recordUndo({
      personId: people.owner.id,
      tool: "remind",
      action: "remind",
      inverse: { kind: "cancel_reminder", id: scheduled.value.id },
    });

    expect(runUndo(people.owner, receipt.id)).toMatchObject({ ok: true });
    expect(
      db.select().from(scheduledJobs).where(eq(scheduledJobs.id, scheduled.value.id)).get()?.status,
    ).toBe("cancelled");
  });

  test("rejects a foreign owner with 404 and used undo with 409", () => {
    const job = scheduleCoreJob(
      people.owner,
      "timers.fire",
      new Date(Date.now() + 60_000).toISOString(),
      { label: "timer" },
    );
    if (!job.ok) throw new Error("job schedule failed");
    const row = recordUndo({
      personId: people.owner.id,
      tool: "timer",
      action: "timer",
      inverse: { kind: "cancel_reminder", id: job.value.id },
    });
    expect(runUndo(people.teen!, row.id)).toMatchObject({ ok: false, status: 404 });
    expect(runUndo(people.owner, row.id)).toMatchObject({ ok: true });
    expect(runUndo(people.owner, row.id)).toMatchObject({ ok: false, status: 409 });
  });

  test("expires after ten minutes and hides the Undo action once used", () => {
    const now = new Date("2026-10-30T12:00:00.000Z");
    const row = recordUndo({
      personId: people.owner.id,
      tool: "remind",
      action: "remind",
      inverse: { kind: "cancel_reminder", id: "missing-job" },
    }, now);
    const stored = db.select().from(toolUndo).where(eq(toolUndo.id, row.id)).get()!;
    expect(undoBlockFor(stored, now)).toEqual({ label: "Undo", action: "undo" });
    expect(runUndo(people.owner, row.id, new Date(now.getTime() + 10 * 60_000)))
      .toMatchObject({ ok: false, status: 409 });

    const job = scheduleCoreJob(
      people.owner,
      "reminders.fire",
      new Date(Date.now() + 60_000).toISOString(),
      { task: "a real reminder" },
    );
    if (!job.ok) throw new Error("reminder schedule failed");
    const live = recordUndo({
      personId: people.owner.id,
      tool: "remind",
      action: "remind",
      inverse: { kind: "cancel_reminder", id: job.value.id },
    });
    expect(runUndo(people.owner, live.id)).toMatchObject({ ok: true });
    const usedRow = db.select().from(toolUndo).where(eq(toolUndo.id, live.id)).get()!;
    expect(undoBlockFor(usedRow)).toBeUndefined();
  });

  test("remind result returns a schedule card and an Undo confirmation with the receipt id", () => {
    const receipt = recordUndo({
      personId: people.owner.id,
      tool: "remind",
      action: "remind",
      inverse: { kind: "cancel_reminder", id: "job-id" },
    });
    const blocks = blocksForRecipeRun(
      {
        id: "remind",
        returns_blocks: ["schedule_card", "confirmation"],
      },
      { data: { task: "call dentist", when_text: "tomorrow at noon", undo_id: receipt.id } },
      {},
    );
    expect(blocks.map((block) => block.kind)).toEqual(["schedule_card", "confirmation"]);
    const confirmation = blocks[1]!;
    expect(confirmation.id).toBe(receipt.id);
    expect((confirmation.props as { undo: unknown }).undo).toEqual({ label: "Undo", action: "undo" });
    // This is the id passed by the kit to onAction(block.id, "undo").
    expect(confirmation.id).toBe(receipt.id);
  });

  test("POST /api/tool-undo/:id returns 200, hides foreign rows and rejects reuse", async () => {
    resetDb();
    const { client, row } = await owner();
    const foreignClient = await teen(client);
    const list = createList(row, { kind: "custom", title: "Route list" });
    if (!list.ok) throw new Error("list create failed");
    expect(deleteList(row, list.value.id).ok).toBe(true);
    const receipt = recordUndo({
      personId: row.id,
      tool: "lists",
      action: "delete",
      inverse: { kind: "restore_list", listId: list.value.id },
    });

    expect((await foreignClient.post(`/api/tool-undo/${receipt.id}`)).status).toBe(404);
    expect((await client.post(`/api/tool-undo/${receipt.id}`)).status).toBe(200);
    expect((await client.post(`/api/tool-undo/${receipt.id}`)).status).toBe(409);
  });

  test("remind and timer run through their recipe return a confirmation block whose id is the undo row", async () => {
    const actor = db.select().from(peopleTable).where(eq(peopleTable.id, people.owner.id)).get()!;
    for (const [pkg, expression] of [["remind", "in 20 minutes to water the plants"], ["timer", "20 minutes"]] as const) {
      const result = await runPlugin(pkg, actor, { expression });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const blocks = (result.value as unknown as { blocks?: Array<{ kind: string; id: string; props: { undo?: unknown } }> }).blocks ?? [];
      const confirmation = blocks.find((block) => block.kind === "confirmation");
      expect(confirmation?.props.undo).toBeDefined();
      expect(db.select().from(toolUndo).where(eq(toolUndo.id, confirmation!.id)).get()?.personId).toBe(actor.id);
    }
  });
  // ASSIST-WIRE-01: the list inverse kinds.
  test("a batch undo runs every inverse, and a nested batch is refused", () => {
    const list = createList(people.owner, { kind: "custom", title: "Batch" });
    if (!list.ok) throw new Error("list create failed");
    const first = addItem(people.owner, list.value.id, { text: "one" });
    if (!first.ok) throw new Error("item add failed");
    const second = addItem(people.owner, list.value.id, { text: "two" });
    if (!second.ok) throw new Error("item add failed");
    const inverses = second.value.items.map((item) => ({ kind: "remove_item" as const, listId: list.value.id, itemId: item.id }));
    const receipt = recordUndo({ personId: people.owner.id, tool: "remind", action: "add_items", inverse: { kind: "batch", inverses } });
    expect(runUndo(people.owner, receipt.id)).toMatchObject({ ok: true });
    expect(JSON.parse(db.select().from(lists).where(eq(lists.id, list.value.id)).get()!.items)).toEqual([]);
    const nested = recordUndo({
      personId: people.owner.id,
      tool: "remind",
      action: "add_items",
      inverse: { kind: "batch", inverses: [{ kind: "batch", inverses: [] }] },
    });
    expect(runUndo(people.owner, nested.id)).toMatchObject({ ok: false, status: 409 });
  });

  test("remove_list only removes a person list the person made, never a household list or another person's", () => {
    const household = db.insert(lists).values({
      id: "list-household1",
      scope: "household",
      person: null,
      kind: "shopping",
      title: "Shared",
      icon: null,
      items: "[]",
      source: "hub",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
      hlc: "0",
    }).returning().get();
    const receipt = recordUndo({ personId: people.owner.id, tool: "remind", action: "create_list", inverse: { kind: "remove_list", listId: household.id } });
    expect(runUndo(people.owner, receipt.id)).toMatchObject({ ok: false, status: 409 });
    const teenList = createList(people.teen!, { kind: "custom", title: "Teen only" });
    if (!teenList.ok) throw new Error("list create failed");
    const foreign = recordUndo({ personId: people.owner.id, tool: "remind", action: "create_list", inverse: { kind: "remove_list", listId: teenList.value.id } });
    expect(runUndo(people.owner, foreign.id)).toMatchObject({ ok: false, status: 409 });
    expect(db.select().from(lists).where(eq(lists.id, teenList.value.id)).get()?.deletedAt).toBeNull();
  });
});
