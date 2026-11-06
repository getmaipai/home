import { and, eq, isNull } from "drizzle-orm";
import sharp from "sharp";
import { db } from "@/db";
import { attachments, mediaSubjects } from "@/db/schema";
import { storeFile } from "@/lib/attachments";
import { nextHlc } from "@/lib/hlc";
import { getGenerationJob, submitGeneration, fetchPicture, cancelOrDelete } from "@/lib/pictures/stack";
import { checkImages } from "@/lib/pictures/ageCheck";
import { gateFinished } from "@/lib/pictures/laneGate";
import type { PersonRow } from "@/types";
import { isSheetReference } from "@/lib/mediaSubjects";

export function sheetPromptFor(subject: { kind: string; look: string }): string {
  const views = subject.kind === "character"
    ? "Drawn four times in a row from four angles: front view, three-quarter view, side profile, back view, identical outfit and colours in every view. Clean outlines, consistent design, no background scenery."
    : subject.kind === "place"
      ? "Show four views of the place: wide, from the left, from the right, and a detail, with identical colours and materials. No other scenery."
      : "Show the prop from the front, side, back, and a detail, with identical colours. No background scenery.";
  return `Model sheet on a plain white background. ${subject.look}. ${views}`;
}

export async function makeSubjectSheet(actor: PersonRow, subjectId: string): Promise<{ id: string; bytes: Uint8Array; mediaType: string; audience: string }> {
  const subject = db.select().from(mediaSubjects).where(eq(mediaSubjects.id, subjectId)).get();
  if (!subject || subject.ownerPersonId !== actor.id || actor.role === "guest") throw new Error("Subject unavailable");
  if (subject.real && (actor.role === "child" || actor.role === "teen")) throw new Error("Real-person subjects are not available for this profile yet.");
  const ids = JSON.parse(subject.referenceIds) as string[];
  const rows = ids.map((id) => db.select().from(attachments).where(and(eq(attachments.id, id), eq(attachments.ownerPersonId, subject.ownerPersonId), isNull(attachments.deletedAt))).get()).filter((row) => row && !isSheetReference(row.provenance));
  const audience = rows.some((row) => row!.provenance.includes('"audience":"adult-only"')) ? "adult-only" : "all-ages";
  const submitted = await submitGeneration({ prompt: sheetPromptFor(subject), size: "1024x576", n: 1, audience: audience === "adult-only" ? "adult" : "all-ages", timeout_ms: 1 });
  const deadline = Date.now() + 8 * 60_000;
  try {
    let data = submitted.done;
    while (!data?.length && Date.now() < deadline) {
      const job = await getGenerationJob(submitted.job);
      if (job.state === "failed" || job.state === "cancelled") throw new Error(job.error ?? "The model sheet could not be made.");
      if (job.state === "done") { data = job.data; break; }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!data?.length) throw new Error("The model sheet took too long. Try again.");
    const bytes = await fetchPicture(submitted.job, 0);
    const meta = await sharp(bytes, { failOn: "error" }).metadata();
    if (meta.format !== "png" || !meta.width || !meta.height) throw new Error("The model sheet could not be checked.");
    const checks = await checkImages([bytes], "picture");
    const decision = await gateFinished({ actor, kind: "picture", jobId: `subject-sheet:${subjectId}`, adultOnly: audience === "adult-only", checks, images: [bytes], prompt: sheetPromptFor(subject) });
    if (decision.action === "withhold") throw new Error(decision.line);
    const stored = storeFile(actor, { conversationId: null, turnId: null, mediaType: "image/png", bytes, provenance: `media-subject-reference:${JSON.stringify({ role: "sheet", audience })}`, retention: "kept", name: `${subject.name} model sheet` });
    if (!stored.ok) throw new Error(stored.error);
    const nextIds = [...ids.filter((id) => !rows.some((row) => row!.id === id && isSheetReference(row!.provenance))), stored.value.id];
    db.update(mediaSubjects).set({ referenceIds: JSON.stringify(nextIds), updatedAt: new Date().toISOString(), hlc: nextHlc() }).where(eq(mediaSubjects.id, subjectId)).run();
    // A replaced kept sheet is left unreferenced in the Library so no destructive file deletion occurs here.
    const file = db.select().from(attachments).where(eq(attachments.id, stored.value.id)).get()!;
    return { id: file.id, bytes, mediaType: file.mediaType, audience };
  } catch (error) { void cancelOrDelete(submitted.job); throw error; }
}
