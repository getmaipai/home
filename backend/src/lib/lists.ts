// Step 8: "lists, reminders and timers" (docs/plans/session-d-packages-
// and-store.md) - this is the List half (spec/schemas/list.schema.json).
// This is the hub's own boundary enforcement of spec/records/ts/
// validate.ts's validateList() - the schema alone cannot carry the
// scope/person and due_at-only-on-todo cross-field rules - the same
// shape lib/entities.ts already takes for validateEntity().
//
// `findOrCreateStandingList` backs the two chat-routable behaviors
// (`list-add`/`list-view`, via host.lists.add/view in packageHost.ts):
// a household's shopping list, and (once a package routes to it) its
// to-do list, are each a single standing record per household, never a
// second one - the REST surface below still lets a person create as
// many kind: custom lists as they like, since only shopping/todo have
// that "exactly one" rule.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { lists, people } from "@/db/schema";
import { newListId, newListItemId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { validateList } from "@maipai/spec/records/ts/validate.js";
import { List } from "@maipai/spec/gen/ts/list.js";
import type { List as ListT } from "@maipai/spec/gen/ts/list.js";
import type { PersonRow } from "@/types";

export type ListRow = typeof lists.$inferSelect;

// A real discriminated union, not the flat "ok: boolean, status: every
// code" shape lib/entities.ts's own OpResult<T> takes - that shape never
// narrows `status` down to just the failure codes on the `!ok` branch,
// which mapWriteFailure (packageHost.ts's own `lists.add`/`lists.view`)
// needs to accept a real `400 | 403 | 404`, not the full union.
export type OpResult<T> = { ok: true; status: 200 | 201; value: T } | { ok: false; status: 400 | 403 | 404; error: string };

function toList(row: ListRow): ListT {
  return List.parse({
    id: row.id,
    scope: row.scope,
    person: row.person,
    kind: row.kind,
    title: row.title,
    items: JSON.parse(row.items),
    source: row.source,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    deleted_at: row.deletedAt,
    hlc: row.hlc,
  });
}

function toRow(list: ListT) {
  return {
    id: list.id,
    scope: list.scope,
    person: list.person,
    kind: list.kind,
    title: list.title,
    items: JSON.stringify(list.items),
    source: list.source,
    createdAt: list.created_at,
    updatedAt: list.updated_at,
    deletedAt: list.deleted_at,
    hlc: list.hlc,
  };
}

const DEFAULT_TITLE: Record<"shopping" | "todo", string> = {
  shopping: "Shopping List",
  todo: "To-Do List",
};

/** A person-scoped list is visible only to the person it belongs to (and
 * owner/admin, the same reach they already have over everything else in
 * the household) - the same rule lib/entities.ts's listEntities() takes. */
export function listLists(actor: { id: string; role: string }): ListT[] {
  const canSeeAll = actor.role === "owner" || actor.role === "admin";
  const rows = db
    .select()
    .from(lists)
    .where(isNull(lists.deletedAt))
    .all()
    .filter((r) => r.scope === "household" || canSeeAll || r.person === actor.id);
  return rows.map(toList);
}

export function getList(actor: { id: string; role: string }, id: string): OpResult<ListT> {
  const row = db.select().from(lists).where(and(eq(lists.id, id), isNull(lists.deletedAt))).get();
  if (!row) return { ok: false, status: 404, error: "no such list" };
  const canSeeAll = actor.role === "owner" || actor.role === "admin";
  if (row.scope === "person" && row.person !== actor.id && !canSeeAll) {
    return { ok: false, status: 404, error: "no such list" };
  }
  return { ok: true, status: 200, value: toList(row) };
}

export interface ListCreate {
  kind: "shopping" | "todo" | "custom";
  title?: string;
  scope?: "household" | "person";
  person?: string | null;
}

export function createList(actor: { id: string }, input: ListCreate): OpResult<ListT> {
  const now = new Date().toISOString();
  const title = input.title ?? (input.kind === "custom" ? null : DEFAULT_TITLE[input.kind]);
  if (!title) return { ok: false, status: 400, error: "a custom list needs a title" };

  const candidate = List.safeParse({
    id: newListId(),
    scope: input.scope ?? "household",
    person: input.scope === "person" ? (input.person ?? actor.id) : null,
    kind: input.kind,
    title,
    items: [],
    source: "hub",
    created_at: now,
    updated_at: now,
    deleted_at: null,
    hlc: nextHlc(),
  });
  if (!candidate.success) return { ok: false, status: 400, error: candidate.error.issues.map((i) => i.message).join("; ") };

  const problems = validateList(candidate.data);
  if (problems.length > 0) return { ok: false, status: 400, error: problems.join("; ") };

  if (candidate.data.person) {
    const person = db.select({ id: people.id }).from(people).where(and(eq(people.id, candidate.data.person), isNull(people.deletedAt))).get();
    if (!person) return { ok: false, status: 400, error: "person does not name an existing person" };
  }

  db.insert(lists).values(toRow(candidate.data)).run();
  return { ok: true, status: 201, value: candidate.data };
}

/** The one household-wide standing list of `kind` (shopping or todo) -
 * created on first use, found thereafter. Not exposed as a REST verb of
 * its own: `host.lists.add`/`host.lists.view` (packageHost.ts) are the
 * only callers, since only a chat-routed package ever needs "the"
 * shopping list rather than a list it names by id. */
export function findOrCreateStandingList(kind: "shopping" | "todo"): ListRow {
  const existing = db
    .select()
    .from(lists)
    .where(and(eq(lists.kind, kind), eq(lists.scope, "household"), isNull(lists.deletedAt)))
    .get();
  if (existing) return existing;
  const now = new Date().toISOString();
  const row = toRow(
    List.parse({
      id: newListId(),
      scope: "household",
      person: null,
      kind,
      title: DEFAULT_TITLE[kind],
      items: [],
      source: "hub",
      created_at: now,
      updated_at: now,
      deleted_at: null,
      hlc: nextHlc(),
    }),
  );
  db.insert(lists).values(row).run();
  return row;
}

export interface ListEdit {
  title?: string;
}

/** Deliberately narrow, the same call lib/entities.ts's updateEntity()
 * makes: kind, scope and person are set once at creation and never move
 * afterward. */
export function updateList(actor: { id: string; role: string }, id: string, edit: ListEdit): OpResult<ListT> {
  const existing = getList(actor, id);
  if (!existing.ok || !existing.value) return existing;
  const target = existing.value;

  const candidate = List.safeParse({
    ...target,
    title: edit.title ?? target.title,
    updated_at: new Date().toISOString(),
    hlc: nextHlc(),
  });
  if (!candidate.success) return { ok: false, status: 400, error: candidate.error.issues.map((i) => i.message).join("; ") };

  const problems = validateList(candidate.data);
  if (problems.length > 0) return { ok: false, status: 400, error: problems.join("; ") };

  db.update(lists).set(toRow(candidate.data)).where(eq(lists.id, id)).run();
  return { ok: true, status: 200, value: candidate.data };
}

export function deleteList(actor: { id: string; role: string }, id: string): OpResult<{ id: string }> {
  const existing = getList(actor, id);
  if (!existing.ok) return { ok: false, status: existing.status, error: existing.error };
  const now = new Date().toISOString();
  db.update(lists).set({ deletedAt: now, updatedAt: now, hlc: nextHlc() }).where(eq(lists.id, id)).run();
  return { ok: true, status: 200, value: { id } };
}

export interface ItemCreate {
  text: string;
  due_at?: string | null;
}

export function addItem(actor: { id: string; role: string }, listId: string, input: ItemCreate): OpResult<ListT> {
  const existing = getList(actor, listId);
  if (!existing.ok || !existing.value) return existing;
  const target = existing.value;
  const now = new Date().toISOString();

  const candidate = List.safeParse({
    ...target,
    items: [...target.items, { id: newListItemId(), text: input.text, done: false, due_at: input.due_at ?? null, created_at: now }],
    updated_at: now,
    hlc: nextHlc(),
  });
  if (!candidate.success) return { ok: false, status: 400, error: candidate.error.issues.map((i) => i.message).join("; ") };

  const problems = validateList(candidate.data);
  if (problems.length > 0) return { ok: false, status: 400, error: problems.join("; ") };

  db.update(lists).set(toRow(candidate.data)).where(eq(lists.id, listId)).run();
  return { ok: true, status: 200, value: candidate.data };
}

export interface ItemEdit {
  text?: string;
  done?: boolean;
  due_at?: string | null;
}

export function editItem(actor: { id: string; role: string }, listId: string, itemId: string, edit: ItemEdit): OpResult<ListT> {
  const existing = getList(actor, listId);
  if (!existing.ok || !existing.value) return existing;
  const target = existing.value;
  const item = target.items.find((i) => i.id === itemId);
  if (!item) return { ok: false, status: 404, error: "no such item on this list" };

  const now = new Date().toISOString();
  const candidate = List.safeParse({
    ...target,
    items: target.items.map((i) =>
      i.id === itemId
        ? { ...i, text: edit.text ?? i.text, done: edit.done ?? i.done, due_at: edit.due_at !== undefined ? edit.due_at : i.due_at }
        : i,
    ),
    updated_at: now,
    hlc: nextHlc(),
  });
  if (!candidate.success) return { ok: false, status: 400, error: candidate.error.issues.map((i) => i.message).join("; ") };

  const problems = validateList(candidate.data);
  if (problems.length > 0) return { ok: false, status: 400, error: problems.join("; ") };

  db.update(lists).set(toRow(candidate.data)).where(eq(lists.id, listId)).run();
  return { ok: true, status: 200, value: candidate.data };
}

export function removeItem(actor: { id: string; role: string }, listId: string, itemId: string): OpResult<ListT> {
  const existing = getList(actor, listId);
  if (!existing.ok || !existing.value) return existing;
  const target = existing.value;
  if (!target.items.some((i) => i.id === itemId)) return { ok: false, status: 404, error: "no such item on this list" };

  const now = new Date().toISOString();
  const candidate = List.parse({
    ...target,
    items: target.items.filter((i) => i.id !== itemId),
    updated_at: now,
    hlc: nextHlc(),
  });
  db.update(lists).set(toRow(candidate)).where(eq(lists.id, listId)).run();
  return { ok: true, status: 200, value: candidate };
}

/** Removes every item, keeping the list itself - the standing "batch
 * clear-all" affordance (docs/BACKLOG.md's own note on this list schema:
 * "batch for clear-all", the same standing rule behind every other
 * clear-all this project has). */
export function clearList(actor: { id: string; role: string }, id: string): OpResult<ListT> {
  const existing = getList(actor, id);
  if (!existing.ok || !existing.value) return existing;
  const now = new Date().toISOString();
  const candidate = List.parse({ ...existing.value, items: [], updated_at: now, hlc: nextHlc() });
  db.update(lists).set(toRow(candidate)).where(eq(lists.id, id)).run();
  return { ok: true, status: 200, value: candidate };
}
