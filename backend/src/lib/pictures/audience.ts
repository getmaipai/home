import { speakerAgeBand } from "@/lib/ageBand";
import type { PersonRow } from "@/types";
import type { PictureAudience } from "./policy";

/** The audience of a route call: the signed-in person on the web chat screen. */
export function routeAudience(actor: PersonRow): PictureAudience {
  return { actor, band: speakerAgeBand(actor, new Date()), surface: "chat", surfaceClass: "written", spoken: false };
}

