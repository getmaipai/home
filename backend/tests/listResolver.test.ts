import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { createBenchPeople, addBenchTeen } from "../scripts/bench/conversationRunner";
import { createList, addItem } from "@/lib/lists";
import { resolveList, resolveItems } from "@/lib/listResolver";

beforeEach(() => resetDb());

describe("list resolver visibility and matching", () => {
  test("resolves exact, fuzzy, and last-list references", () => {
    const people = createBenchPeople();
    const list = createList(people.owner, { kind: "custom", title: "Weekend Groceries", scope: "person" });
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(resolveList(people.owner, "weekend groceries")).toMatchObject({ ok: true, list: { id: list.value.id } });
    expect(resolveList(people.owner, "weekend grocery")).toMatchObject({ ok: true, list: { id: list.value.id } });
    expect(resolveList(people.owner, "that", { lastListId: list.value.id })).toMatchObject({ ok: true, list: { id: list.value.id } });
    expect(resolveList(people.owner, "nothing here").ok).toBe(false);
  });

  test("ambiguous names return a count without exposing list text", () => {
    const owner = createBenchPeople().owner;
    createList(owner, { kind: "custom", title: "Books" });
    createList(owner, { kind: "custom", title: "Books" });
    expect(resolveList(owner, "books")).toEqual({ ok: false, reason: "ambiguous", candidates: 2 });
  });

  test("an owner cannot resolve a teen's private list", () => {
    const people = createBenchPeople();
    const teen = addBenchTeen(people);
    createList(teen, { kind: "custom", title: "Private Plans", scope: "person" });
    expect(resolveList(people.owner, "private plans")).toEqual({ ok: false, reason: "none", candidates: 0 });
  });

  test("resolves exact then fuzzy items and recent pronouns", () => {
    const owner = createBenchPeople().owner;
    const made = createList(owner, { kind: "shopping", scope: "person" });
    if (!made.ok) return;
    const added = addItem(owner, made.value.id, { text: "Oat milk" });
    if (!added.ok) return;
    expect(resolveItems(made.value, "oat milk")).toMatchObject({ ok: true, items: [{ id: added.value.items[0]!.id }] });
    expect(resolveItems(made.value, "oat mil")).toMatchObject({ ok: true, items: [{ id: added.value.items[0]!.id }] });
    expect(resolveItems(made.value, "those", { lastItemIds: [added.value.items[0]!.id] })).toMatchObject({ ok: true, items: [{ id: added.value.items[0]!.id }] });
  });
});
