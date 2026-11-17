export type AgeBand = "child" | "teen" | "adult";

export function bandOf(person: { age_band?: AgeBand; role: string } | null | undefined): AgeBand {
  if (!person) return "child";
  if (person.age_band) return person.age_band;
  if (person.role === "child") return "child";
  if (person.role === "teen") return "teen";
  if (person.role === "guest") return "child";
  return "adult";
}

export const isMinor = (person: { age_band?: AgeBand; role: string } | null | undefined): boolean => bandOf(person) !== "adult";

/** A guest has no age band of their own (their controls give one): the one role check callers make outside this module. */
export const isGuestRole = (role: string): boolean => role === "guest";
