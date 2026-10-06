// VISION-02c: whether this person's pictures go to the chat model, read
// from the one backend source (GET /api/host/chat-capabilities, decided
// in backend/src/lib/chatPictures.ts from the Stack's chat row and the
// person's settings). The frontend never decides it from a model id or
// from chat health alone (rule 8): a running text engine is not evidence
// that it reads pictures. When it is off, a picture is kept and the model
// is told it cannot see it, exactly as before.
import type { ChatCapabilities } from "@/lib/api";

type ThinkingMode = ChatCapabilities["thinking"];

/** What an older hub, a failed read or a missing route means: no picture
 * parts, and the thinking control exactly as it was before VISION-02d. */
export const NO_CHAT_PICTURES: ChatCapabilities = { image_parts: false, thinking: "switchable", thinking_modes: {} };

/** The query key the chat page and composer share. */
export const CHAT_CAPABILITIES_QUERY_KEY = ["chatCapabilities"] as const;

function mode(value: unknown): ThinkingMode | null {
  return value === "switchable" || value === "none" || value === "always" ? value : null;
}

/** A response the frontend does not understand reads as "no pictures"
 * and today's thinking control. */
export function chatCapabilitiesFrom(value: unknown): ChatCapabilities {
  const raw = (value ?? {}) as { image_parts?: unknown; thinking?: unknown; thinking_modes?: unknown };
  const modes: Record<string, ThinkingMode> = {};
  if (raw.thinking_modes && typeof raw.thinking_modes === "object") {
    for (const [id, entry] of Object.entries(raw.thinking_modes as Record<string, unknown>)) {
      const known = mode(entry);
      if (known) modes[id] = known;
    }
  }
  return { image_parts: raw.image_parts === true, thinking: mode(raw.thinking) ?? "switchable", thinking_modes: modes };
}

/** VISION-02d (rule 8): whether a model can be switched between Instant
 * and Thinking. The record decides through the backend; a model the
 * backend did not name keeps the current model's answer. */
export function modelThinks(capabilities: ChatCapabilities, modelId: string | undefined): boolean {
  const known = modelId ? capabilities.thinking_modes[modelId] : undefined;
  return (known ?? capabilities.thinking) === "switchable";
}
