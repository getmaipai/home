import type { PersonRow } from "@/types";
import { audienceBand, stricterBand, type AgeBand } from "@/lib/audience";

export type Ceiling = 0 | 1 | 2 | 3 | 4;
export function ceilingFor(band: AgeBand): Ceiling {
  return band === "child" ? 0 : band === "teen" ? 2 : 4;
}

export type Audience = { actor: PersonRow; band: AgeBand; surface?: string };
export function ceilingOf(audience: Audience): Ceiling {
  return ceilingFor(stricterBand(audienceBand(audience.actor), audience.band));
}
