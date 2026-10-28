// Chat models an admin added from a Hugging Face link (MODEL-ADD-01 S3): one
// table row per model holding the same ModelCapabilities record a shipped
// model has. Importing this module hands the rows to the catalog reader.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { addedModels } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { setAddedModelSource } from "@/lib/modelCatalog";
import { ModelCapabilities } from "@maipai/spec/gen/ts/model-capabilities.js";

let cache: ModelCapabilities[] | null = null;

/** Every stored record that still parses as a ModelCapabilities. A row that
 * does not (an older shape) is skipped, never repaired by guessing. */
export function listAddedModels(): ModelCapabilities[] {
  if (cache) return cache;
  const records: ModelCapabilities[] = [];
  for (const row of db.select().from(addedModels).all()) {
    try {
      const parsed = ModelCapabilities.safeParse(JSON.parse(row.record));
      if (parsed.success && parsed.data.origin === "added") records.push(parsed.data);
    } catch { /* an unreadable row is skipped */ }
  }
  cache = records;
  return records;
}

/** Stores an added record, replacing one with the same id. */
export function saveAddedModel(record: ModelCapabilities, provenance: string): void {
  const parsed = ModelCapabilities.parse(record);
  if (parsed.origin !== "added") throw new Error("Only a record with origin \"added\" is stored here.");
  const now = new Date().toISOString();
  const values = { record: JSON.stringify(parsed), hlc: nextHlc(), provenance };
  db.insert(addedModels).values({ id: parsed.id, createdAt: now, ...values }).onConflictDoUpdate({ target: addedModels.id, set: values }).run();
  cache = null;
}

export function removeAddedModel(id: string): boolean {
  const removed = db.delete(addedModels).where(eq(addedModels.id, id)).returning({ id: addedModels.id }).all().length > 0;
  cache = null;
  return removed;
}

setAddedModelSource(listAddedModels);
