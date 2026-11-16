// Combine pictures: the base picture plus up to N reference pictures become one picture. N is the picture engine's own reference count
// (pictureReferenceLimit), so an engine that takes more pictures works without a code change. The instruction numbers the pictures so a
// model that takes numbered pictures can use that.
import { pictureReferenceLimit } from "./ready";
import type { StackImageStatus } from "./stack";

export const COMBINE_DEFAULT_WORDS = "Combine these pictures into one natural picture that keeps the people and the place recognisable.";
export const COMBINE_NEEDS_ONE_LINE = "Choose at least one more picture to combine with.";
export const COMBINE_EXTRAS_LINE = "Some extra reference pictures were not used.";

/** How many pictures one combine takes in all: the base picture plus the engine's reference count. */
export function combinePictureLimit(status: StackImageStatus | null | undefined): number {
  return pictureReferenceLimit(status) + 1;
}

/** The instruction sent to the engine: Picture 1 is the one being changed, Pictures 2 and up are added to it, then the person's words or the default. */
export function combineInstruction(pictureCount: number, words?: string | null): string {
  const extras = Math.max(1, pictureCount - 1);
  const numbered = Array.from({ length: extras }, (_, index) => index + 2);
  const names = numbered.length === 1 ? "Picture 2 is" : `Pictures ${numbered.slice(0, -1).join(", ")} and ${numbered[numbered.length - 1]} are`;
  const said = words?.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
  return `Picture 1 is the one being changed. ${names} added to it. ${said ? `${said}.` : COMBINE_DEFAULT_WORDS}`;
}
