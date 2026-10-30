import { and, eq, isNull } from "drizzle-orm";
import { QuickTimer } from "@maipai/spec/gen/ts/quick-timer.js";
import type { QuickTimer as QT } from "@maipai/spec/gen/ts/quick-timer.js";
import { db } from "@/db";
import { quickTimers } from "@/db/schema";
import { randomSuffix } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import type { PersonRow } from "@/types";

type R<T> = { ok: true; value: T } | { ok: false; status: 400 | 404; error: string };
type Row = typeof quickTimers.$inferSelect;

function shape(row: Row): QT {
  return QuickTimer.parse({
    id: row.id,
    person: row.person,
    name: row.name,
    minutes: row.minutes,
    position: row.position,
    source: row.source,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    deleted_at: row.deletedAt,
    hlc: row.hlc,
  });
}

function all(actor: PersonRow) {
  return db
    .select()
    .from(quickTimers)
    .where(and(eq(quickTimers.person, actor.id), isNull(quickTimers.deletedAt)))
    .all();
}

export function listQuickTimers(actor: PersonRow): QT[] {
  let rows = all(actor);
  const initialized = db
    .select()
    .from(quickTimers)
    .where(eq(quickTimers.person, actor.id))
    .all()
    .some((row) => row.defaultsInitialized);

  if (!initialized) {
    const now = new Date().toISOString();
    const defaults: [[string, number], [string, number], [string, number], [string, number]] = [
      ["Tea steep", 4],
      ["A little break", 10],
      ["Focus session", 25],
      ["Deep work", 45],
    ];

    for (let i = 0; i < 4; i++) {
      const [name, minutes] = defaults[i]!;
      db.insert(quickTimers)
        .values({
          id: `qtimer-${randomSuffix(10)}`,
          person: actor.id,
          name,
          minutes,
          position: i,
          source: "hub",
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          hlc: nextHlc(),
          defaultsInitialized: i === 0,
        })
        .run();
    }

    rows = all(actor);
  }

  return rows.map(shape).sort((a, b) => a.position - b.position);
}

function own(actor: PersonRow, id: string) {
  return db
    .select()
    .from(quickTimers)
    .where(and(eq(quickTimers.id, id), eq(quickTimers.person, actor.id), isNull(quickTimers.deletedAt)))
    .get();
}

export function createQuickTimer(
  actor: PersonRow,
  edit: { name?: string; minutes?: number; position?: number },
): R<QT> {
  const now = new Date().toISOString();
  const candidate = QuickTimer.safeParse({
    id: `qtimer-${randomSuffix(10)}`,
    person: actor.id,
    name: edit.name?.trim() ?? "",
    minutes: edit.minutes,
    position: edit.position ?? all(actor).length,
    source: "hub",
    created_at: now,
    updated_at: now,
    deleted_at: null,
    hlc: nextHlc(),
  });

  if (!candidate.success) return { ok: false, status: 400, error: "Invalid quick timer." };

  db.insert(quickTimers)
    .values({
      id: candidate.data.id,
      person: candidate.data.person,
      name: candidate.data.name,
      minutes: candidate.data.minutes,
      position: candidate.data.position,
      source: candidate.data.source,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      hlc: candidate.data.hlc,
    })
    .run();

  return { ok: true, value: candidate.data };
}

export function updateQuickTimer(
  actor: PersonRow,
  id: string,
  edit: Partial<Pick<QT, "name" | "minutes" | "position">>,
): R<QT> {
  const row = own(actor, id);
  if (!row) return { ok: false, status: 404, error: "No such quick timer." };

  const now = new Date().toISOString();
  const candidate = QuickTimer.safeParse({
    ...shape(row),
    ...edit,
    name: edit.name?.trim() ?? row.name,
    updated_at: now,
    hlc: nextHlc(),
  });

  if (!candidate.success) return { ok: false, status: 400, error: "Invalid quick timer." };

  db.update(quickTimers)
    .set({
      name: candidate.data.name,
      minutes: candidate.data.minutes,
      position: candidate.data.position,
      updatedAt: now,
      hlc: candidate.data.hlc,
    })
    .where(eq(quickTimers.id, id))
    .run();

  return { ok: true, value: candidate.data };
}

export function deleteQuickTimer(actor: PersonRow, id: string): R<{ id: string }> {
  if (!own(actor, id)) return { ok: false, status: 404, error: "No such quick timer." };

  const now = new Date().toISOString();
  db.update(quickTimers)
    .set({ deletedAt: now, updatedAt: now, hlc: nextHlc() })
    .where(eq(quickTimers.id, id))
    .run();

  return { ok: true, value: { id } };
}
