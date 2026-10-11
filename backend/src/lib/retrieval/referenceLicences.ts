// The one licence-enum-to-label map (KS-02F-BE): the article page footer, the
// model's source line and the chat's source card all read it. Its own file with
// no backend-only imports so the frontend (KS-02F) can import it without a
// second copy of the labels. referenceSources.ts re-exports both names.
import type { Source } from "@maipai/spec/gen/ts/source.js";

/** Keyed by the spec's whole enum, so a new value fails the type check here. */
export const LICENCE_LABELS: Record<NonNullable<Source["licence"]>, string> = {
  "cc-by-sa-4.0": "CC BY-SA 4.0",
  cc0: "CC0",
  "public-domain": "Public domain",
  publisher: "Publisher's licence",
};

export function licenceLabel(licence: NonNullable<Source["licence"]>): string {
  return LICENCE_LABELS[licence];
}
