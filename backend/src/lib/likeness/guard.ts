// Recheck queued likeness jobs against current household membership and
// settings. Jobs created before the cleanup that requested adult content of
// someone else are withheld here as well.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { speakerAgeBand } from "@/lib/ageBand";
import { decideLikeness, ADULT_CONTENT_OTHER_SUBJECT_LINE, householdLikenessOn, subjectName } from "./decide";
import { subjectEligibility } from "./resolve";
import type { PictureAudience } from "@/lib/pictures/policy";

export type LikenessWay = "style" | "photo";
export interface JobLikeness { subject: string; requester: string; way: LikenessWay; adult_content: boolean }

export function stoppedLine(name: string): string {
  return `Stopped. ${name} can no longer be used as a subject, so this was not finished.`;
}

export type StillAllowed = { ok: true } | { ok: false; line: string };

export function likenessStillAllowed(likeness: JobLikeness): StillAllowed {
  const requester = db.select().from(people).where(eq(people.id, likeness.requester)).get();
  if (!requester) return { ok: false, line: "Stopped. The requester is no longer available, so this was not finished." };
  const eligible = subjectEligibility(likeness.subject);
  if (!eligible.ok) {
    const person = db.select().from(people).where(eq(people.id, likeness.subject)).get();
    return { ok: false, line: stoppedLine(person ? subjectName(person as never) : "That person") };
  }
  if (likeness.subject === likeness.requester) return { ok: true };
  if (!householdLikenessOn()) return { ok: false, line: "Stopped. Pictures and videos of people in this household are switched off." };
  if (likeness.adult_content) return { ok: false, line: ADULT_CONTENT_OTHER_SUBJECT_LINE };
  const audience = { actor: requester, band: speakerAgeBand(requester, new Date()), surface: "chat", surfaceClass: "written", spoken: false } as PictureAudience;
  const decision = decideLikeness({ requester: audience, subjectPersonId: likeness.subject, adultContent: false });
  return decision.ok ? { ok: true } : { ok: false, line: decision.line };
}
