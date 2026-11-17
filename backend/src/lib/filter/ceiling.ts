import type { PersonRow } from "@/types";
import type { AgeBand } from "@/lib/audience";
import { passForSurface, type ContentKind } from "./pass";

export type Ceiling = 0 | 1 | 2 | 3 | 4;
/** The role's default ceiling: child G, teen PG-13, adult X. */
export function ceilingFor(band: AgeBand): Ceiling {
  return band === "child" ? 0 : band === "teen" ? 2 : 4;
}

export type Audience = { actor: PersonRow; band: AgeBand; surface?: string };

/** The door's surfaces, grouped into the five kinds of content an override can name (RULES.md C3). */
export function kindOf(surface: string | undefined): ContentKind {
  switch (surface) {
    case "search": return "web";
    case "news": return "news";
    case "library": return "library";
    case "picture": case "clip": case "song": return "made";
    default: return "chat"; // reply, coding, and a caller that names no surface
  }
}

/** OVERRIDES-01: the ceiling for this audience on this surface, read from the pass (no database read on this path). */
export function ceilingOf(audience: Audience, surface: string | undefined = audience.surface): Ceiling {
  return passForSurface(audience).ceiling[kindOf(surface)];
}
