// CODE-POLISH: how full a session's context is, for the ring in the composer's status bar. Used tokens are the engine's own numbers from the latest turn
// (its prompt plus its reply is the whole context the next turn starts from); with no engine numbers yet it is the transcript's text size divided by four.
// The window is the Stack's record of the running coding role; null when the Stack does not report one (the ring then shows the count and no fill).
import { codingSessionRefusal, CodingSessionError, getSessionRow } from "@/lib/codingSessions";
import { listCodingMessages } from "@/lib/codingTranscript";
import { getStackClient } from "@/lib/stackEngine";
import type { PersonRow } from "@/types";

export interface SessionContext { used_tokens: number; window_tokens: number | null; source: "engine" | "estimate" }

let windowCache: { at: number; value: number | null } | null = null;
export function __resetCodingWindowCacheForTests(): void { windowCache = null; }
async function codingWindow(): Promise<number | null> {
  if (windowCache && Date.now() - windowCache.at < 60_000) return windowCache.value;
  let value: number | null = null;
  try {
    const roles = await getStackClient().roles();
    const row = roles.roles.find((r) => r.id === "coding") as { context_per_slot?: number | null; context_length?: number | null } | undefined;
    const figure = row?.context_per_slot ?? row?.context_length ?? null;
    value = typeof figure === "number" && figure > 0 ? figure : null;
  } catch { value = null; }
  windowCache = { at: Date.now(), value };
  return value;
}

export async function sessionContext(person: PersonRow, sessionId: string): Promise<SessionContext> {
  const refusal = codingSessionRefusal(person);
  if (refusal) throw new CodingSessionError("not_allowed", refusal);
  if (!getSessionRow(person.id, sessionId)) throw new CodingSessionError("not_found", "That session was not found. It may have been deleted.");
  const messages = listCodingMessages(person.id, sessionId);
  let used: SessionContext | null = null; let bytes = 0;
  for (const m of messages) for (const part of m.parts) {
    if (part.type === "usage") used = { used_tokens: part.input + part.output, window_tokens: null, source: "engine" };
    else if (part.type === "text") bytes += Buffer.byteLength(part.text);
    else if (part.type === "tool") bytes += Buffer.byteLength(part.summary) + Buffer.byteLength(part.output ?? "");
  }
  const window = await codingWindow();
  return { ...(used ?? { used_tokens: Math.ceil(bytes / 4), source: "estimate" as const }), window_tokens: window };
}
