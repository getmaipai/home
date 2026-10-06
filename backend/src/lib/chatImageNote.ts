// UPLOAD-IMG-02: what the chat model is told about pictures a person sent
// when it cannot see them (a text-only chat model, or a turn whose
// pictures do not go to the model). It gets the plain fact as context:
// how many, their file names, that it cannot see them, and that it never
// says who a person in a photo is. It answers in its own words (rule 6's
// spirit: no stored reply wording). VISION-02c: when the chat model reads
// pictures, they go to it as picture parts instead (chatPictures.ts), and
// these notes cover only a picture that could not be sent or read.
import type { ChatImagePart } from "@/wire";
import { redactCredentials } from "@/lib/memoryContentPolicy";
import { sanitizeForPrompt } from "@/lib/promptSanitize";

/** A picture's file name, made safe for a prompt. */
export function cleanPictureName(name: string): string {
  return redactCredentials(sanitizeForPrompt(name.replace(/[\r\n\0]/g, " "))).trim() || "picture";
}

function names(images: readonly ChatImagePart[]): string {
  return images.map((image) => cleanPictureName(image.name)).join(", ");
}

/** The context line for the turn that carries the pictures. */
export function picturesAttachedNote(images: readonly ChatImagePart[]): string {
  const count = images.length === 1 ? "1 picture" : `${images.length} pictures`;
  return `The person attached ${count} to this message: ${names(images)}. You cannot see pictures yet, so you do not know what they show; never describe or guess their contents. You cannot tell who a person in a photo is.`;
}

/** VISION-02c (rule 6): pictures the model reads but that could not be
 * sent or read this turn. Only the kind of failure is named; the model
 * says so in its own words. */
export function picturesNotReadNote(images: readonly ChatImagePart[], kind: string): string {
  const count = images.length === 1 ? "1 picture" : `${images.length} pictures`;
  return `The person attached ${count} to this message: ${names(images)}. ${images.length === 1 ? "It" : "They"} could not be read this time (${kind}), so you do not know what ${images.length === 1 ? "it shows" : "they show"}; never describe or guess the contents. You cannot tell who a person in a photo is.`;
}

/** The short tail an earlier turn's own message carries in the window.
 * VISION-02c: a picture the model was shown on its turn is not sent
 * again; the note says it was shown then (the model's own reply on that
 * turn holds what it saw). Any other picture stays "not seen". */
export function picturesWindowNote(images: readonly ChatImagePart[]): string {
  const shown = images.filter((image) => image.shown_to_model === true);
  const unseen = images.filter((image) => image.shown_to_model !== true);
  const parts = [shown.length > 0 ? `[pictures shown to you with this message, not shown again: ${names(shown)}]` : null, unseen.length > 0 ? `[pictures attached, not seen: ${names(unseen)}]` : null].filter((part): part is string => part !== null);
  return parts.join(" ");
}

/** VISION-02c: the plain words for why a picture could not be read. */
export function pictureFailureWords(kind: string): string {
  if (kind === "context_too_large") return "it did not fit in the conversation";
  if (kind === "slow") return "it took too long to read";
  return "the picture reader could not take it";
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
