// LIKENESS-01: a request that makes something look like a person is checked when it is made and again while it waits
// for the engine. The Stack checks its signed proof again when the job really starts.
import { isAdultSubject, subjectEligibility } from "./eligibility";
import { LIKENESS_LINES } from "./decide";
import { getHouseholdSettingValue } from "@/lib/settings";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";
import { pictureDenial } from "@/lib/pictures/policy";
import { laneOf } from "@/lib/pictures/lane";
import { speakerAgeBand } from "@/lib/ageBand";
import { styleIsUnavailable } from "./adapters";
import type { LikenessWay } from "./decide";

export interface JobLikeness {
  subject: string;
  requester: string;
  way: LikenessWay;
  adultContent?: boolean;
  adult_content?: boolean;
  styleId?: string;
  styleIds?: string[];
  medium?: "picture" | "video";
}

export function normalizeJobLikeness(value: JobLikeness | null | undefined): JobLikeness | null {
  if (!value) return null;
  const raw = value as JobLikeness;
  return { ...raw, adultContent: raw.adultContent ?? raw.adult_content ?? true };
}

/** What a stopped job tells the person who asked. */
export function stoppedLine(name: string): string {
  return `Stopped. ${name} is no longer an eligible household subject, or the household option or requester policy changed, so this was not finished.`;
}

export type StillAllowed = { ok: true } | { ok: false; line: string };

/** Rechecks the option, subject and requester policy while a job waits. */
export function likenessStillAllowed(likeness: JobLikeness): StillAllowed {
  likeness = normalizeJobLikeness(likeness)!;
  if (likeness.medium && [likeness.styleId, ...(likeness.styleIds ?? [])].some((id) => id && styleIsUnavailable(likeness.medium!, id))) return { ok: false, line: stoppedLine("That saved style") };
  const eligible = subjectEligibility(likeness.subject);
  if (!eligible.ok) return { ok: false, line: stoppedLine("That person") };
  if (likeness.adultContent && !isAdultSubject(eligible.person)) return { ok: false, line: LIKENESS_LINES.adult_content_minor };
  const requester = db.select().from(people).where(eq(people.id, likeness.requester)).get();
  if (!requester) return { ok: false, line: LIKENESS_LINES.requester };
  const band = speakerAgeBand(requester, new Date());
  const audience = { actor: requester, band, surface: "chat" as const, surfaceClass: "written" as const, spoken: false };
  if (pictureDenial(audience) !== null || laneOf(audience) !== "adult") return { ok: false, line: LIKENESS_LINES.requester };
  if (likeness.adultContent && likeness.subject !== likeness.requester) return { ok: false, line: LIKENESS_LINES.adult_content_other };
  try { if (getHouseholdSettingValue("generation.household_likeness") !== true) return { ok: false, line: LIKENESS_LINES.household_off }; }
  catch { return { ok: false, line: LIKENESS_LINES.household_off }; }
  return { ok: true };
}
