// AUDIT-DUP-ROUTES-01: the create / update / soft-delete / own-row machinery that lib/quickTimers.ts and lib/worldPlaces.ts each wrote out
// by hand (same shape(), own(), nextHlc() stamps, soft delete, "invalid" and "no such" answers). A record here belongs to one person
// (`person` column), has id, name, position, source, created_at, updated_at, deleted_at and hlc (the shared spec shape), and
// carries its own extra value columns. The drizzle table is addressed by column name, so the table is typed loosely in this one file.
import { and, eq, isNull } from "drizzle-orm";
import type { z } from "zod";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { db } from "@/db";
import { randomSuffix } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import type { ApiErrorBodyCode } from "@/lib/apiErrorCopy";
import { refusal, type Result } from "@/lib/result";
import type { PersonRow } from "@/types";

export type CrudResult<T> = Result<T, 400 | 404>;

type Loose = Record<string, any>;

export type OwnedRecordSpec<S extends z.ZodTypeAny> = {
  table: SQLiteTable;
  /** The spec record (a zod schema from @maipai/spec). */
  spec: S;
  idPrefix: string;
  /** Value columns the person edits, beyond `position`; they carry the same name in the table and the spec. */
  fields: readonly string[];
  /** The fields trimmed on the way in; a trimmed field missing from a create is "". */
  trimmed: readonly string[];
  /** Fields that default to "" on create when missing and are not trimmed. */
  blankDefaults?: readonly string[];
  /** The table codes (lib/apiErrorCopy.ts) for a failed spec parse and for a missing row. */
  invalid: ApiErrorBodyCode;
  missing: ApiErrorBodyCode;
  /** At most this many live rows per person (create refuses beyond it with the table line `code`). */
  limit?: { max: number; code: ApiErrorBodyCode };
  /** A refusal code for the merged values of a create or update, or null. Runs before the spec parse. */
  validate?: (values: Loose) => ApiErrorBodyCode | null;
};

export function ownedRecordCrud<S extends z.ZodTypeAny>(config: OwnedRecordSpec<S>) {
  type T = z.infer<S>;
  const table = config.table as unknown as Record<string, any>;
  const columns = [...config.fields, "position"];

  function shape(row: Loose): T {
    return config.spec.parse({
      id: row.id, person: row.person, name: row.name, ...Object.fromEntries(columns.filter((key) => key !== "name").map((key) => [key, row[key]])),
      source: row.source, created_at: row.createdAt, updated_at: row.updatedAt, deleted_at: row.deletedAt, hlc: row.hlc,
    });
  }

  const rows = (actor: PersonRow): Loose[] => db.select().from(config.table).where(and(eq(table.person, actor.id), isNull(table.deletedAt))).all() as Loose[];

  /** One live row of this person's, or undefined. */
  function own(actor: PersonRow, id: string): Loose | undefined {
    return db.select().from(config.table).where(and(eq(table.id, id), eq(table.person, actor.id), isNull(table.deletedAt))).get() as Loose | undefined;
  }

  function list(actor: PersonRow): T[] {
    return rows(actor).map(shape).sort((a, b) => (a as Loose).position - (b as Loose).position);
  }

  function create(actor: PersonRow, input: Loose): CrudResult<T> {
    if (config.limit && rows(actor).length >= config.limit.max) return refusal(400, config.limit.code);
    const values: Loose = {};
    for (const key of config.fields) {
      const value = input[key];
      values[key] = config.trimmed.includes(key) ? (typeof value === "string" ? value.trim() : "") : value ?? (config.blankDefaults?.includes(key) ? "" : undefined);
    }
    const invalid = config.validate?.(values);
    if (invalid) return refusal(400, invalid);
    const now = new Date().toISOString();
    const candidate = config.spec.safeParse({
      id: `${config.idPrefix}-${randomSuffix(10)}`, person: actor.id, ...values, position: input.position ?? rows(actor).length,
      source: input.source ?? "hub", created_at: now, updated_at: now, deleted_at: null, hlc: nextHlc(),
    });
    if (!candidate.success) return refusal(400, config.invalid);
    const data = candidate.data as Loose;
    db.insert(config.table).values({
      id: data.id, person: data.person, ...Object.fromEntries(columns.map((key) => [key, data[key]])), source: data.source,
      createdAt: now, updatedAt: now, deletedAt: null, hlc: data.hlc,
    } as never).run();
    return { ok: true, value: candidate.data };
  }

  function update(actor: PersonRow, id: string, edit: Loose): CrudResult<T> {
    const row = own(actor, id);
    if (!row) return refusal(404, config.missing);
    const current = shape(row) as Loose;
    const merged: Loose = { ...current, ...edit };
    for (const key of config.trimmed) merged[key] = typeof edit[key] === "string" ? edit[key].trim() : current[key];
    const invalid = config.validate?.(merged);
    if (invalid) return refusal(400, invalid);
    const now = new Date().toISOString();
    const candidate = config.spec.safeParse({ ...merged, updated_at: now, hlc: nextHlc() });
    if (!candidate.success) return refusal(400, config.invalid);
    const data = candidate.data as Loose;
    db.update(config.table).set({ ...Object.fromEntries(columns.map((key) => [key, data[key]])), updatedAt: now, hlc: data.hlc } as never).where(eq(table.id, id)).run();
    return { ok: true, value: candidate.data };
  }

  function remove(actor: PersonRow, id: string): CrudResult<{ id: string }> {
    if (!own(actor, id)) return refusal(404, config.missing);
    const now = new Date().toISOString();
    db.update(config.table).set({ deletedAt: now, updatedAt: now, hlc: nextHlc() } as never).where(eq(table.id, id)).run();
    return { ok: true, value: { id } };
  }

  return { shape, rows, own, list, create, update, remove };
}
