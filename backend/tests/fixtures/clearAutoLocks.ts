import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, pictureJobs } from "@/db/schema";
import { logAutoMark } from "@/lib/adultMarks";
import { withMark } from "@/lib/adultLock";
import { makePictureJob } from "./adultLockPicture";
import { secretLora } from "./lora";
import type { PersonRow } from "@/types";

let sequence = 0;

export async function autoLocked(actor: PersonRow, adultStyle = false): Promise<string> {
  const picture = await makePictureJob(actor, "adult", `landscape-${++sequence}`);
  const row = db.select().from(attachments).where(eq(attachments.id, picture.id)).get()!;
  const withJob = row.provenance.replace(/"job":"[^"]+"/, `"job":"${picture.jobId}"`);
  const marked = withMark(withJob, { lock: "on", raiseToAdult: true });
  if (!marked) throw new Error("No lock note");
  db.update(attachments).set({ provenance: marked }).where(eq(attachments.id, picture.id)).run();
  if (adultStyle) {
    const lora = secretLora(actor.id);
    db.update(pictureJobs).set({ request: JSON.stringify({ loras: [lora.id] }) }).where(eq(pictureJobs.id, picture.jobId)).run();
  }
  logAutoMark(picture.id, actor.id);
  return picture.id;
}

export async function lockedNote(actor: PersonRow, writer = "video-gen"): Promise<string> {
  const picture = await makePictureJob(actor, "adult", `other-kind-${++sequence}`);
  const row = db.select().from(attachments).where(eq(attachments.id, picture.id)).get()!;
  db.update(attachments).set({ provenance: `${writer}:${row.provenance.slice(row.provenance.indexOf(":") + 1)}` }).where(eq(attachments.id, picture.id)).run();
  return picture.id;
}
