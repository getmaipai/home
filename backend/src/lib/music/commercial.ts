import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { generationOf, type GenerationProvenance } from "./types";
import { pruneMusicJobs, temporarySongs } from "./store";
export const COMMERCIAL_REFUSAL_LINE = "This song was made with a model that does not allow commercial use, so it can't be exported for money. You can still download it for yourself.";
export function provenanceFor(fileId: string): GenerationProvenance | null {
  pruneMusicJobs();
  return temporarySongs.get(fileId)?.provenance ?? generationOf(db.select({ provenance: attachments.provenance }).from(attachments).where(eq(attachments.id, fileId)).get()?.provenance ?? null);
}
/** Every link counts. Missing records, cycles, uploads and unrecognised values fail closed. */
export function commercialUseOf(fileId: string): GenerationProvenance["commercial_use"] {
  const seen = new Set<string>();
  let id: string | null = fileId;
  let result: GenerationProvenance["commercial_use"] = "cleared";
  while (id) {
    if (seen.has(id)) return "unknown";
    seen.add(id);
    const record = provenanceFor(id);
    if (!record || (record.source_kind !== "none" && record.source_kind !== "made_here")) return "unknown";
    if (record.commercial_use === "personal_only") result = "personal_only";
    else if (record.commercial_use !== "cleared") return "unknown";
    if (record.source_kind === "made_here" && !record.parent_file_id) return "unknown";
    id = record.parent_file_id ?? null;
  }
  return result;
}
