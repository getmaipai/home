// UPLOAD-IMG-02: what the chat model is told about pictures a person sent,
// while no local vision engine exists (VISION-01 is not built). The model
// cannot see the pictures, so it gets the plain fact as context: how many,
// their file names, that it cannot see them, and that it never says who a
// person in a photo is. It answers in its own words (rule 6's spirit: no
// stored reply wording). VISION-01 replaces the "cannot see" half with each
// picture's description once the vision role is implemented and healthy.
import type { ChatImagePart } from "@/wire";
import { redactCredentials } from "@/lib/memoryContentPolicy";
import { sanitizeForPrompt } from "@/lib/promptSanitize";

function cleanName(name: string): string {
  return redactCredentials(sanitizeForPrompt(name.replace(/[\r\n\0]/g, " "))).trim() || "picture";
}

function names(images: readonly ChatImagePart[]): string {
  return images.map((image) => cleanName(image.name)).join(", ");
}

/** The context line for the turn that carries the pictures. */
export function picturesAttachedNote(images: readonly ChatImagePart[]): string {
  const count = images.length === 1 ? "1 picture" : `${images.length} pictures`;
  return `The person attached ${count} to this message: ${names(images)}. You cannot see pictures yet, so you do not know what they show; never describe or guess their contents. You cannot tell who a person in a photo is.`;
}

/** The short tail an earlier turn's own message carries in the window. */
export function picturesWindowNote(images: readonly ChatImagePart[]): string {
  return `[pictures attached, not seen: ${names(images)}]`;
}

/** Reads a stored turn row's `images` column (JSON or null). */
export function storedImages(raw: string | null | undefined): ChatImagePart[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is ChatImagePart => typeof (item as ChatImagePart | null)?.name === "string") : [];
  } catch {
    return [];
  }
}
