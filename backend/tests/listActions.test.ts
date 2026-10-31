import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { addBenchTeen, createBenchPeople } from "../scripts/bench/conversationRunner";
import { addItem, createList, getList } from "@/lib/lists";
import { runListAction } from "@/lib/listActions";
import { recordUndo, runUndo } from "@/lib/toolUndo";

beforeEach(() => resetDb());

describe("list action engine", () => {
  test("supports create, rename, add, check, edit, show and find", () => {
    const owner = createBenchPeople().owner;
    const created = runListAction(owner, "adult", { action: "create_list", name: "Books" });
    expect(created.ok).toBe(true);
    if (!created.ok || !created.listId) return;
    expect(runListAction(owner, "adult", { action: "rename_list", list: "Books", name: "Reading" }).ok).toBe(true);
    const added = runListAction(owner, "adult", { action: "add_items", list: "Reading", items: ["Dune", "Solaris"] });
    expect(added.ok).toBe(true);
    expect(added.ok && added.undo?.inverse).toHaveLength(2);
    expect(runListAction(owner, "adult", { action: "check_items", list: "Reading", items: ["Dune"] }).ok).toBe(true);
    expect(runListAction(owner, "adult", { action: "edit_item", list: "Reading", items: ["Dune"], name: "Dune Messiah" }).ok).toBe(true);
    expect(runListAction(owner, "adult", { action: "show_list", list: "Reading" }).ok).toBe(true);
    expect(runListAction(owner, "adult", { action: "find_list", list: "Reading" }).ok).toBe(true);
  });

  test("moves preserving state, copies with exclusions, reorders, and clears done", () => {
    const owner = createBenchPeople().owner;
    const a = createList(owner, { kind: "custom", title: "A", scope: "person" });
    const b = createList(owner, { kind: "custom", title: "B", scope: "person" });
    if (!a.ok || !b.ok) return;
    addItem(owner, a.value.id, { text: "first" });
    const populated = addItem(owner, a.value.id, { text: "second" });
    if (!populated.ok) return;
    const ids = populated.value.items.map((item) => item.id);
    runListAction(owner, "adult", { action: "check_items", list: "A", items: ["second"] });
    expect(runListAction(owner, "adult", { action: "move_items", list: "A", to_list: "B", items: ["second"] }).ok).toBe(true);
    const moved = getList(owner, b.value.id);
    expect(moved.ok && moved.value.items.map((item) => [item.text, item.done])).toEqual([["second", true]]);
    expect(runListAction(owner, "adult", { action: "copy_list", list: "A", name: "A copy", exclude: ["first"] }).ok).toBe(true);
    expect(runListAction(owner, "adult", { action: "reorder", list: "A", order: ["second", "first"] }).ok).toBe(true);
    expect(runListAction(owner, "adult", { action: "clear_done", list: "B" }).ok).toBe(true);
    expect(ids).toHaveLength(2);
  });

  test("add and delete inverses restore state through runUndo", () => {
    const owner = createBenchPeople().owner;
    const made = runListAction(owner, "adult", { action: "create_list", name: "Undo List" });
    expect(made.ok).toBe(true);
    if (!made.ok || !made.listId) return;
    const added = runListAction(owner, "adult", { action: "add_items", list: "Undo List", items: ["pear"] });
    expect(added.ok && added.undo?.inverse).toHaveLength(1);
    if (!added.ok || !added.undo) return;
    const addUndo = recordUndo({ personId: owner.id, tool: "lists", action: "add_items", inverse: added.undo.inverse[0]! });
    expect(runUndo(owner, addUndo.id).ok).toBe(true);
    const afterAddUndo = getList(owner, made.listId); expect(afterAddUndo.ok && afterAddUndo.value.items).toHaveLength(0);
    const deleted = runListAction(owner, "adult", { action: "delete_list", list: "Undo List" });
    expect(deleted.ok && deleted.undo?.inverse[0]).toEqual({ kind: "restore_list", listId: made.listId });
    if (!deleted.ok || !deleted.undo) return;
    const delUndo = recordUndo({ personId: owner.id, tool: "lists", action: "delete_list", inverse: deleted.undo.inverse[0]! });
    expect(runUndo(owner, delUndo.id).ok).toBe(true);
    expect(getList(owner, made.listId).ok).toBe(true);
  });

  test("minor gates permit shopping add and ticks, their own records, and reject other household actions", () => {
    const people = createBenchPeople();
    const teen = addBenchTeen(people);
    const shop = createList(people.owner, { kind: "shopping", title: "Shopping List" });
    if (!shop.ok) return;
    expect(runListAction(people.child, "child", { action: "add_items", list: "shopping list", items: ["milk"] }).ok).toBe(true);
    expect(runListAction(teen, "teen", { action: "check_items", list: "shopping list", items: ["milk"] }).ok).toBe(true);
    expect(runListAction(people.child, "child", { action: "rename_list", list: "shopping list", name: "Food" })).toEqual({ ok: false, reply: "A parent can do that." });
    const own = createList(teen, { kind: "custom", title: "My stuff", scope: "person" });
    expect(own.ok).toBe(true);
    expect(runListAction(teen, "teen", { action: "delete_list", list: "My stuff" }).ok).toBe(true);
  });
});
