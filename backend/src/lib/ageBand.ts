// Child and teen keep their role controls. A guest uses the controls the admin
// chose, and child controls when none were stored. Birthdate is not used.
// Owner ruling, 2026-10-18: stop using the birthdate for anything.
import type { PersonRow } from "@/types";

export type AgeBand = "child" | "teen" | "adult";

export function bandOfPerson(person: Pick<PersonRow, "role" | "controls">): AgeBand {
  if (person.role === "child") return "child";
  if (person.role === "teen") return "teen";
  if (person.role === "guest") return (person.controls ?? "child") as AgeBand;
  return "adult";
}

/** One role-only band for callers sharing the speaker's protections.
 * The time argument remains accepted for existing callers. */
export function speakerAgeBand(actor: PersonRow, _now: Date): AgeBand {
  return bandOfPerson(actor);
}
