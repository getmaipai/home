// VIDEO-LORA-03 (docs/design/video-loras-2026-11-02.md 4.1, docs/dev/loras.md): the ONE store of the household's LoRA library. One row per spec `Lora`
// record; every write goes through `saveLora`, which validates the record (zod shape plus the spec's `validateLora`), refuses a minor in
// `availability.people`, refuses a second live record for one file, and advances `updated_at` and `hlc`. Nothing else writes the `loras` table, and nothing
// outside lib/loras reads a row's JSON: reads of a record for a person go through lib/loras/access.ts.
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { loras, people } from "@/db/schema";
import { speakerAgeBand } from "@/lib/ageBand";
import { nextHlc } from "@/lib/hlc";
import { Lora } from "@maipai/spec/gen/ts/lora.js";
import { validateLora } from "@maipai/spec/records/ts/validate.js";
import type { PersonRow } from "@/types";

export type { Lora };

/** A refusal with a plain sentence (what is wrong, what to do) the routes show as is. */
export class LoraWriteError extends Error {
  constructor(readonly code: "invalid" | "minor_in_people" | "duplicate_file" | "unknown_person", message: string) {
    super(message);
    this.name = "LoraWriteError";
  }
}

export const MINOR_IN_PEOPLE_LINE = "Only adults can be chosen. Pick adults, or choose all adults.";
export const DUPLICATE_FILE_LINE = "That style file is already in the library.";

/** The record of a stored row, or null when the JSON no longer parses as a `Lora` (a row of an older shape is skipped, never repaired by guessing). */
function parseRow(json: string): Lora | null {
  try {
    const parsed = Lora.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Every stored record (removed ones included). */
export function listLoraRecords(): Lora[] {
  return db.select({ record: loras.record }).from(loras).all().flatMap((row) => { const lora = parseRow(row.record); return lora ? [lora] : []; });
}

export function getLoraRecord(id: string): Lora | null {
  const row = db.select({ record: loras.record }).from(loras).where(eq(loras.id, id)).get();
  return row ? parseRow(row.record) : null;
}

/** The people ids that are not adults (a minor, or nobody by that id). The record holds no ages, so the writer is where "never a minor" is enforced. */
function notAdults(ids: readonly string[]): string[] {
  if (ids.length === 0) return [];
  const rows = db.select().from(people).where(inArray(people.id, [...ids])).all() as PersonRow[];
  const adults = new Set(rows.filter((p) => p.role !== "guest" && speakerAgeBand(p, new Date()) === "adult").map((p) => p.id));
  return ids.filter((id) => !adults.has(id));
}

/**
 * The only writer. `lora` is the record as the caller wants it; this stamps `updated_at` and `hlc`, validates, and stores. `by` is the person (or "migration")
 * the provenance column names. Throws `LoraWriteError`; a thrown write changes nothing.
 */
export function saveLora(lora: Lora, by: string): Lora {
  const now = new Date().toISOString();
  const next: Lora = { ...lora, updated_at: now, hlc: nextHlc() };
  const shape = Lora.safeParse(next);
  if (!shape.success) throw new LoraWriteError("invalid", `That style can't be saved: ${shape.error.issues[0]?.path.join(".") || "a value"} is not valid.`);
  const problems = validateLora(shape.data);
  if (problems.length > 0) throw new LoraWriteError("invalid", `That style can't be saved: ${problems[0]}.`);
  const bad = notAdults(shape.data.availability.people);
  if (bad.length > 0) throw new LoraWriteError("minor_in_people", MINOR_IN_PEOPLE_LINE);
  if (shape.data.removed_at === null) {
    const clash = db.select({ id: loras.id }).from(loras).where(eq(loras.sha256, shape.data.file.sha256)).all().find((row) => row.id !== shape.data.id && getLoraRecord(row.id)?.removed_at === null);
    if (clash) throw new LoraWriteError("duplicate_file", DUPLICATE_FILE_LINE);
  }
  const record = shape.data;
  const values = {
    record: JSON.stringify(record), media: record.media, kind: record.kind, baseModel: record.base_model, audience: record.audience, availabilityWho: record.availability.who,
    sha256: record.file.sha256, removedAt: record.removed_at, trashUntil: record.trash_until, addedAt: record.added_at, updatedAt: record.updated_at, hlc: record.hlc,
    provenance: by === "migration" ? "migration" : `person:${by}`,
  };
  db.insert(loras).values({ id: record.id, createdAt: record.created_at, ...values }).onConflictDoUpdate({ target: loras.id, set: values }).run();
  return record;
}

/** Drop a record for good (the 30-day trash purge). */
export function deleteLoraRecord(id: string): void {
  db.delete(loras).where(eq(loras.id, id)).run();
}
