// CREATOR-02: the best-effort back-fill. An item made before this store existed has no record; when its maker opens it, the record is rebuilt from the job row
// that made it (the same builders the writers use, so the shape is the same). Only the maker's own, finished, stored items; anything else changes nothing.
// It writes nothing for an item whose job row is gone (a temporary chat keeps none, a deleted conversation drops its rows): the answer is then "no record".
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { libraryProvenance } from "@/lib/libraryProvenance";
import { getPictureJob } from "@/lib/pictures/jobStore";
import { getVideoJobFor } from "@/lib/videos/jobs";
import type { PersonRow } from "@/types";
import { recordClipCreation, recordPictureCreation } from "./writers";

/** Rebuild the record of one file from its job row. Returns whether a record was written. */
export function backfillCreationForFile(actor: PersonRow, fileId: string): boolean {
  try {
    const file = db.select({ provenance: attachments.provenance }).from(attachments).where(and(eq(attachments.id, fileId), eq(attachments.ownerPersonId, actor.id))).get();
    if (!file) return false;
    const note = libraryProvenance(file.provenance);
    const jobId = typeof note.job === "string" ? note.job : null;
    // The pointer already in the note is the record's id: reuse it, so the note and the record agree.
    const creationId = typeof note.creation === "string" && /^crt-[a-z0-9]{6,}$/.test(note.creation) ? note.creation : undefined;
    if (!jobId) return false;
    if (note.writer === "picture-gen") {
      const job = getPictureJob(actor, jobId);
      const made = job?.state === "done" ? job.files.find((f) => f.id === fileId) : undefined;
      return Boolean(job && made && !job.request.edit && recordPictureCreation(actor, job, made, creationId));
    }
    if (note.writer === "video-gen" || note.writer === "video-edit" || note.writer === "video-poster") {
      const job = getVideoJobFor(actor, jobId);
      if (!job || job.state !== "done" || !job.files.some((f) => f.id === fileId || f.poster_id === fileId)) return false;
      return Boolean(recordClipCreation(actor, job, job.files, job.kind === "edit" || job.request.edit ? "video-edit" : "video-gen", creationId));
    }
    return false;
  } catch { return false; }
}
