// Recheck queued likeness jobs against current household membership and
// settings. Jobs created before the cleanup that requested adult content of
// someone else are withheld here as well.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { speakerAgeBand } from "@/lib/ageBand";
import { decideLikeness, ADULT_CONTENT_OTHER_SUBJECT_LINE, householdLikenessOn, perUseOn, subjectName } from "./decide";
import { ASK_WAITING_LINE, askOutcomeLine, askStatus } from "./ask";
import { subjectEligibility } from "./resolve";
import type { PictureAudience } from "@/lib/pictures/policy";

export type LikenessWay = "style" | "photo";
/** `ask` is the per-use consent ask (likeness_asks) that must be approved before adult content of another person may start. */
export interface JobLikeness { subject: string; requester: string; way: LikenessWay; adult_content: boolean; ask?: string }

export function stoppedLine(name: string): string {
  return `Stopped. ${name} can no longer be used as a subject, so this was not finished.`;
}

export type StillAllowed = { ok: true } | { ok: false; line: string };

/** `jobId` is the job asking: an ask that was already used counts only for the job that used it. */
export function likenessStillAllowed(likeness: JobLikeness, jobId?: string): StillAllowed {
  const requester = db.select().from(people).where(eq(people.id, likeness.requester)).get();
  if (!requester) return { ok: false, line: "Stopped. The requester is no longer available, so this was not finished." };
  const eligible = subjectEligibility(likeness.subject);
  if (!eligible.ok) {
    const person = db.select().from(people).where(eq(people.id, likeness.subject)).get();
    return { ok: false, line: stoppedLine(person ? subjectName(person as never) : "That person") };
  }
  if (likeness.subject === likeness.requester) return { ok: true };
  if (!householdLikenessOn()) return { ok: false, line: "Stopped. Pictures and videos of people in this household are switched off." };
  if (likeness.adult_content) {
    // Fail closed: adult content of another person runs only with the per-use switch on and an ask, between these same two people,
    // that the pictured adult approved (or that this job already used). Anything else is refused.
    if (!perUseOn() || !likeness.ask) return { ok: false, line: ADULT_CONTENT_OTHER_SUBJECT_LINE };
    const ask = askStatus(likeness.ask);
    if (!ask || ask.subjectId !== likeness.subject || ask.requesterId !== likeness.requester) return { ok: false, line: ADULT_CONTENT_OTHER_SUBJECT_LINE };
    if (ask.state === "consumed" && (jobId === undefined || ask.jobId !== jobId)) return { ok: false, line: ADULT_CONTENT_OTHER_SUBJECT_LINE };
    if (ask.state !== "approved" && ask.state !== "consumed") {
      if (ask.state === "waiting") return { ok: false, line: ASK_WAITING_LINE(subjectName(eligible.person)) };
      return { ok: false, line: askOutcomeLine(ask.state === "declined" ? "decline" : ask.state === "expired" ? "timeout" : "unavailable", subjectName(eligible.person)) };
    }
  }
  const audience = { actor: requester, band: speakerAgeBand(requester, new Date()), surface: "chat", surfaceClass: "written", spoken: false } as PictureAudience;
  const decision = decideLikeness({ requester: audience, subjectPersonId: likeness.subject, adultContent: false });
  return decision.ok ? { ok: true } : { ok: false, line: decision.line };
}
