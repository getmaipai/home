import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { speakerAgeBand } from "@/lib/ageBand";
import type { PersonRow } from "@/types";

export type SubjectWhy = "unknown" | "gone" | "guest" | "memorial";

/** A subject must be a living, enabled household member. Adult-content checks apply a separate adult-only floor. */
export function subjectEligibility(personId: string | null | undefined): { ok: true; person: PersonRow } | { ok: false; why: SubjectWhy } {
  if (!personId) return { ok: false, why: "unknown" };
  const person = db.select().from(people).where(eq(people.id, personId)).get();
  if (!person) return { ok: false, why: "unknown" };
  if (person.deletedAt || person.enabled === false) return { ok: false, why: "gone" };
  if (person.memorializedAt) return { ok: false, why: "memorial" };
  if (person.role === "guest") return { ok: false, why: "guest" };
  if (!["owner", "admin", "adult", "teen", "child"].includes(person.role)) return { ok: false, why: "unknown" };
  return { ok: true, person: person as PersonRow };
}

export function isAdultSubject(person: PersonRow): boolean { return speakerAgeBand(person, new Date()) === "adult"; }

/** Eligible household members available to the adult family subject picker. */
export function householdSubjects(): Array<{ id: string; name: string }> {
  return db.select().from(people).all()
    .filter((person) => subjectEligibility(person.id).ok)
    .map((person) => ({ id: person.id, name: person.displayName }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
