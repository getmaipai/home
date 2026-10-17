// LIKENESS-01: who may be the subject of a picture, a video or a saved style, and whether they agreed. Owner's ruling,
// 2026-10-17: an adult may make a picture, a video or a style that looks like a household adult who consented, and
// nothing else. Two switches on the person's own page (person scope, off by default, changed only by that person, an
// adult): `likeness.adults` (other adults may) and `likeness.adult_content` (including adult content; counts only
// while the first is on). Everything here is deterministic and runs before the Stack is asked; a minor is never a
// subject, whatever any switch says.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { speakerAgeBand } from "@/lib/ageBand";
import { getSettingValueForPerson } from "@/lib/settings";
import { LIKENESS_ADULT_CONTENT_KEY, LIKENESS_ADULTS_KEY } from "@/settings/likenessKeys";
import type { PersonRow } from "@/types";

export { LIKENESS_ADULT_CONTENT_KEY, LIKENESS_ADULTS_KEY };
export { consentHistory, lastRecordedState, recordConsentChange, type ConsentEvent, type LikenessOption } from "./history";

export type SubjectWhy = "unknown" | "gone" | "guest" | "minor" | "memorial";

/** The person as a possible subject: a living, enabled household adult. A child, a teen, a guest, a deleted or memorialised profile, or an id that is no one, is never a subject. Role is a floor and a birthdate can only make the band stricter (speakerAgeBand), so a person who is under 18 by either is refused. */
export function subjectEligibility(personId: string | null | undefined): { ok: true; person: PersonRow } | { ok: false; why: SubjectWhy } {
  if (!personId) return { ok: false, why: "unknown" };
  const person = db.select().from(people).where(eq(people.id, personId)).get();
  if (!person) return { ok: false, why: "unknown" };
  if (person.deletedAt) return { ok: false, why: "gone" };
  if (person.memorializedAt) return { ok: false, why: "memorial" };
  if (person.role === "guest") return { ok: false, why: "guest" };
  if (person.enabled === false) return { ok: false, why: "gone" };
  if (person.role !== "owner" && person.role !== "admin" && person.role !== "adult") return { ok: false, why: "minor" };
  if (speakerAgeBand(person as PersonRow, new Date()) !== "adult") return { ok: false, why: "minor" };
  return { ok: true, person: person as PersonRow };
}

/** Every household adult who could be a subject, for the pickers (name and id; nothing else). */
export function householdAdults(): Array<{ id: string; name: string }> {
  return db.select().from(people).all()
    .filter((person) => subjectEligibility(person.id).ok)
    .map((person) => ({ id: person.id, name: person.displayName }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface ConsentState { adults: boolean; adultContent: boolean }

/** What this person has agreed to right now. Read from their own settings at the moment of the request (never cached), and false for anyone who cannot be a subject. The second switch counts only while the first is on. */
export function consentState(personId: string): ConsentState {
  if (!subjectEligibility(personId).ok) return { adults: false, adultContent: false };
  const adults = getSettingValueForPerson(personId, LIKENESS_ADULTS_KEY) === true;
  const adultContent = adults && getSettingValueForPerson(personId, LIKENESS_ADULT_CONTENT_KEY) === true;
  return { adults, adultContent };
}

