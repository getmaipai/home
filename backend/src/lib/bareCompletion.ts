// ADMIN-COMPARE-01: the one implementation of the bare-mode bypass -
// what it removes, and what it never removes.
//
// Removes: persona (composePersonaPrompt), routing (route()), packages
// (no plugin/command ever runs), and the quality guards guardReply()
// adds on top of the model's own words (honesty fixes, repeat
// detection - MaiPai's own coat on the model, which comparing against
// the model's natural answer means taking off). One plain system
// prompt, the given history and user text, thinking on.
//
// Never removes: the safety floor - gateOutputSafety(), the minor
// safety pass, the content ceilings docs/SAFETY.md calls architecture,
// not settings. That call is not a parameter of this function; it is
// made unconditionally, inside, before any token this function returns
// ever reaches a caller. There is no exported way to obtain this
// function's raw, ungated tokens - "unskippable by construction, not by
// a caller remembering to gate it" (COORDINATOR, 2026-09-22).
//
// Both bare-mode callers use this the same way: routes/turnBare.ts
// (feature a, re-running one past turn, the admin only ever watching)
// and turnBareStream.ts's runBareTurnStream (feature b, a new real
// turn, the admin themselves speaking it).
import { startCompleteStream, type LlmMessage, type LlmStreamStartResult } from "@/lib/llm";
import { gateOutputSafety } from "@/lib/turnEngine";
import type { PersonRow } from "@/types";
import type { StreamOutcome } from "@/lib/turnEngine";

export const BARE_SYSTEM_PROMPT = "You are a helpful assistant.";

export type BareCompletionResult = { ok: true; tokens: AsyncGenerator<string, StreamOutcome, void> } | Extract<LlmStreamStartResult, { ok: false }>;

/**
 * `speaker` calibrates the safety pass's own age band - feature (a)
 * passes the ORIGINAL turn's own speaker (the admin is only watching);
 * feature (b) passes the admin themselves, since they are the one
 * actually speaking the new turn (guaranteed by the caller's own gate
 * not to be a minor).
 */
export async function startBareCompletion(historyMessages: LlmMessage[], userText: string, speaker: PersonRow, turnId?: string, signal?: AbortSignal): Promise<BareCompletionResult> {
  const messages: LlmMessage[] = [{ role: "system", content: BARE_SYSTEM_PROMPT }, ...historyMessages, { role: "user", content: userText }];
  const started = await startCompleteStream("chat", messages, { thinking: true }, signal);
  if (!started.ok) return started;
  return { ok: true, tokens: gateOutputSafety(started.tokens, speaker, turnId) };
}
