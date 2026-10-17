// LIKENESS-01: a request that makes something look like a person is checked once when it is made and again while it
// waits for the engine (a clip can wait minutes behind another). `JobLikeness` rides on the job's own request record; the
// watchers in lib/pictures/jobs.ts and lib/videos/jobs.ts ask `likenessStillAllowed` on every poll and stop the job the
// moment the person takes their agreement back. The Stack checks its signed proof again when the job really starts.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { consentState, subjectEligibility } from "./consent";
import { LIKENESS_LINES, subjectName } from "./decide";
import type { LikenessWay } from "./decide";

export interface JobLikeness {
  subject: string;
  requester: string;
  way: LikenessWay;
  /** The request fell under the second switch (adult content). */
  adult_content: boolean;
}

/** What a stopped job tells the person who asked. */
export function stoppedLine(name: string): string {
  return `Stopped. ${name} took back their agreement to pictures and videos that look like them, so this was not finished.`;
}

export type StillAllowed = { ok: true } | { ok: false; line: string };

/** Whether the person is still willing, read from their own settings right now. A person who made it of themselves is always willing. */
export function likenessStillAllowed(likeness: JobLikeness): StillAllowed {
  if (likeness.subject === likeness.requester) return { ok: true };
  const eligible = subjectEligibility(likeness.subject);
  const person = eligible.ok ? eligible.person : db.select().from(people).where(eq(people.id, likeness.subject)).get();
  const name = person ? subjectName(person) : "That person";
  if (!eligible.ok) return { ok: false, line: stoppedLine(name) };
  const consent = consentState(likeness.subject);
  if (!consent.adults) return { ok: false, line: stoppedLine(name) };
  if (likeness.adult_content && !consent.adultContent) return { ok: false, line: LIKENESS_LINES.adult_content_off(name) };
  return { ok: true };
}
