// The shared age band is the person's role: child, teen, or adult for
// every other role. Birthdate is not used for tone or protection decisions.
// Owner ruling, 2026-10-18: stop using the birthdate for anything.
import type { PersonRow } from "@/types";

export type AgeBand = "child" | "teen" | "adult";

function ageBandFromRole(role: string): AgeBand {
  if (role === "child") return "child";
  if (role === "teen") return "teen";
  return "adult";
}

/** One role-only band for callers sharing the speaker's protections.
 * The time argument remains accepted for existing callers. */
export function speakerAgeBand(actor: PersonRow, _now: Date): AgeBand {
  return ageBandFromRole(actor.role);
}
