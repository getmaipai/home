import type { PersonRow } from "@/types";

/** The one answer to which protections a person gets. Other modules call this; the age-comparison build check guards new copies. */
export type AgeBand = "child" | "teen" | "adult";

export function audienceBand(person: Pick<PersonRow, "id" | "role" | "controls"> | null | undefined): AgeBand {
  if (!person?.id || !["owner", "admin", "adult", "teen", "child", "guest"].includes(person.role)) return "child";
  if (person.role === "child") return "child";
  if (person.role === "teen") return "teen";
  if (person.role === "guest") return (person.controls ?? "child") as AgeBand;
  return "adult";
}

const RANK: Record<AgeBand, number> = { child: 0, teen: 1, adult: 2 };

export function stricterBand(a: AgeBand, b: AgeBand): AgeBand {
  return RANK[a] <= RANK[b] ? a : b;
}

export function isMinorBand(band: AgeBand): boolean {
  return band !== "adult";
}

/** The controls a new person starts with: a guest made without a choice gets child controls, the strictest band; every other role has none. */
export function controlsForNewPerson(role: string, controls: "child" | "teen" | "adult" | null | undefined): "child" | "teen" | "adult" | null {
  return controls ?? (role === "guest" ? "child" : null);
}
