import { api } from "@/lib/api";

/** The one rule for a companion's picture: its retained portrait when it has one, else its idle still, else nothing (the kit then draws the seeded illustrated face, never a letter). */
export function companionImageUrl(portrait: string | null | undefined, still: string | undefined): string | undefined {
  if (portrait) {
    // A malformed key from an old row must never crash a screen: fall through to the still.
    try { return api.companionPortrait(portrait); } catch { /* use the still */ }
  }
  return still;
}
