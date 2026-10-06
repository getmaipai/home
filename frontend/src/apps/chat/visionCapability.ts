// VISION-02c: whether this person's pictures go to the chat model, read
// from the one backend source (GET /api/host/chat-capabilities, decided
// in backend/src/lib/chatPictures.ts from the Stack's chat row and the
// person's settings). The frontend never decides it from a model id or
// from chat health alone (rule 8): a running text engine is not evidence
// that it reads pictures. When it is off, a picture is kept and the model
// is told it cannot see it, exactly as before.
import type { ChatCapabilities } from "@/lib/api";

export const NO_CHAT_PICTURES: ChatCapabilities = { image_parts: false };

/** The query key the chat page and composer share. */
export const CHAT_CAPABILITIES_QUERY_KEY = ["chatCapabilities"] as const;

/** A response the frontend does not understand reads as "no pictures". */
export function chatCapabilitiesFrom(value: unknown): ChatCapabilities {
  const imageParts = (value as { image_parts?: unknown } | null | undefined)?.image_parts;
  return { image_parts: imageParts === true };
}
