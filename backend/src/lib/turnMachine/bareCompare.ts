// THIN-7C (rule 12, ADMIN-COMPARE-01 a): the admin's "compare with the bare
// model" re-run of one past turn. Not a turn: nothing is stored. It sends one
// plain system prompt, the history as it stood at that turn and the turn's own
// message to the chat role, with thinking on, and streams the reply through
// the default path's own output gate (StreamGate), age-banded off the ORIGINAL
// turn's speaker, never the admin watching: a bare reply shown in a child's
// conversation still has to be safe for the child to read.
//
// There is no exported way to get this reply's text ungated: the only thing
// returned is the gate's own release, so "unskippable by construction, not by
// a caller remembering to gate it" (COORDINATOR, 2026-09-22) holds here as it
// does for a bare turn on the default path.
import { startCompleteStreamPieces, type LlmMessage, type LlmPiecesStartResult } from "@/lib/llm";
import { StatusChannel } from "@/lib/statusChannel";
import { feedThinkSplit, flushThinkSplit, newThinkSplitState } from "@/lib/wellFormed";
import { BARE_SYSTEM_PROMPT, StreamSafetyRefusal } from "@/lib/turnShared";
import type { PersonRow } from "@/types";
import { StreamGate, gateGrainFor } from "./nodes/outputGate";
import { turnAgeBand } from "./speaker";

export type BareCompareChunk = { type: "reasoning" | "delta"; text: string };

export type BareCompareStart =
  | { ok: true; chunks: AsyncGenerator<BareCompareChunk, void, void> }
  | Extract<LlmPiecesStartResult, { ok: false }>;

/** `speaker` is the original turn's own speaker. Reasoning is shown only to an adult
 * (a minor's request sets thinking off and any reasoning the engine returns is dropped
 * at the engine client); it travels under the same check-as-it-arrives gate as the
 * answer. A refused sentence ends the stream with StreamSafetyRefusal. */
export async function startBareCompare(historyMessages: LlmMessage[], userText: string, speaker: PersonRow, turnId: string, signal?: AbortSignal): Promise<BareCompareStart> {
  const band = turnAgeBand("chat", speaker, undefined, new Date());
  const showReasoning = band === "adult";
  const messages: LlmMessage[] = [{ role: "system", content: BARE_SYSTEM_PROMPT }, ...historyMessages, { role: "user", content: userText }];
  const started = await startCompleteStreamPieces("chat", messages, { thinking: true, dropReasoning: !showReasoning }, signal);
  if (!started.ok) return started;

  const channel = new StatusChannel<BareCompareChunk>();
  const gate = new StreamGate(
    band,
    speaker,
    turnId,
    (sentence) => channel.emit({ type: "delta", text: sentence }),
    () => channel.close(),
    () => channel.close(),
    { releaseReasoning: (text) => channel.emit({ type: "reasoning", text }), grain: gateGrainFor(band, "chat", false) },
  );
  let failure: Error | undefined;
  void (async () => {
    const split = newThinkSplitState();
    // A `<think>` block an engine leaks into content is reasoning, not text.
    const route = (span: { reasoning: boolean; text: string }) => {
      if (!span.reasoning) gate.push(span.text);
      else if (showReasoning) gate.pushReasoning(span.text);
    };
    try {
      for (;;) {
        const step = await started.pieces.next();
        if (step.done) break;
        if (step.value.channel === "reasoning") {
          if (showReasoning) gate.pushReasoning(step.value.text);
        } else {
          for (const span of feedThinkSplit(split, step.value.text)) route(span);
        }
      }
      for (const span of flushThinkSplit(split)) route(span);
    } catch (err) {
      failure = err instanceof Error ? err : new Error(String(err));
    } finally {
      gate.finish(); // closes the channel through onDone, refused or not
    }
  })();

  async function* chunks(): AsyncGenerator<BareCompareChunk, void, void> {
    for (;;) {
      const chunk = await channel.next();
      if (chunk === null) break;
      yield chunk;
    }
    const refused = gate.result().refused;
    if (refused) throw new StreamSafetyRefusal(refused);
    if (failure) throw failure;
  }
  return { ok: true, chunks: chunks() };
}
