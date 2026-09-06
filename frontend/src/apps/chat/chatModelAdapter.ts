import type { ChatModelAdapter, ChatModelRunOptions, ChatModelRunResult } from "@assistant-ui/react";
import { api, readTurnStream, ApiError } from "@/lib/api";
import { SentenceSpeechScheduler } from "@/lib/sentenceSpeechScheduler";
import { splitReadyChunks } from "@/lib/sentenceChunker";
import { normalizeForSpeech } from "@maipai/spec/voice/ts/normalizeForSpeech.js";
import { messageText } from "@/apps/chat/chatMessageText";

// Qwen3's hybrid thinking mode wraps its reasoning in a `<think>...</think>`
// block ahead of the real answer when enabled (llm.ts's `thinking` option);
// stripped here rather than shown inline so turning it on for one hard
// question doesn't dump a paragraph of raw reasoning into the thread - a
// household member who wants to see it can still ask.
export function stripThinking(text: string): string {
  const stripped = text.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
  // A code review (2026-09-04) found the earlier `|| text` fallback here
  // defeated the whole point when a reply was reasoning-only (no final
  // answer after the </think> tag): stripped becomes "", which is
  // falsy, so `|| text` re-surfaced the raw, un-stripped block it exists
  // to hide. Never fall back to the unstripped text.
  return stripped || "MaiPai thought about it but didn't give a final answer. Try asking again.";
}

function lastUserText(messages: ChatModelRunOptions["messages"]): string | undefined {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") return undefined;
  return messageText(last);
}

export interface ChatModelAdapterDeps {
  // Reads AND resets the composer's "Think longer" toggle in one call
  // (ChatPage.tsx): a per-message opt-in, not a mode a household member
  // could forget is still on and pay the latency for every later reply -
  // the same "back to off after every send" the pre-assistant-ui version
  // did in handleSend's own `finally` block, just consumed here since the
  // adapter (created once via useMemo) has no per-run finally of its own
  // to hang that reset off.
  consumeThinking(): boolean;
  // 4.3: "offer, never block" - a crisis-resources banner rides alongside
  // the reply, not as part of the message content assistant-ui renders.
  onCrisisResources(resources: string): void;
  // The live reply's own sentence-by-sentence speech (2026-09-04): a
  // separate player from the per-message "Listen" replay (chatListen.ts),
  // since a fresh reply speaks as it arrives while an earlier message's
  // "Listen" button still replays the old, single-utterance way. Owned by
  // ChatPage.tsx so a manual "Listen" click can stop it too - never let
  // two voices overlap.
  turnSchedulerRef: { current: SentenceSpeechScheduler | null };
}

// The real end-to-end streaming adapter (docs/plans/session-b-ui.md step
// 4): reads POST /api/turn/stream and yields the CUMULATIVE visible text
// on every delta (assistant-ui's LocalRuntimeCore replaces a running
// message's content with each yield's content, not merge-appends it - see
// @assistant-ui/core's local-thread-runtime-core.ts), while the same
// think-tag resolution and sentence-chunked TTS scheduling that the old
// hand-rolled ChatPage.tsx used keep running as side effects hung off the
// same deltas. Ported, not rewritten from scratch: every quirk below has
// a code-review paper trail (2026-09-04/05) from when it was first found
// live, and the fix stays exactly as narrow as the bug that prompted it.
export function createChatModelAdapter(deps: ChatModelAdapterDeps): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }: ChatModelRunOptions): AsyncGenerator<ChatModelRunResult, void> {
      const text = lastUserText(messages);
      if (!text) return;

      // Stop whatever an earlier live reply was still speaking - never two
      // voices at once. A manual "Listen" replay (chatListen.ts) stops
      // itself independently when a new send starts (ChatPage.tsx).
      deps.turnSchedulerRef.current?.stop();
      const scheduler = new SentenceSpeechScheduler();
      deps.turnSchedulerRef.current = scheduler;

      // `raw` is every byte received so far, unstripped. `visible` is the
      // real, displayable/speakable answer built up incrementally with
      // every <think>...</think> block (llm.ts's `thinking` option)
      // resolved out of it as soon as each one closes - nothing inside an
      // open block is ever shown or spoken, streaming raw reasoning into
      // the thread word by word being exactly the dump stripThinking()
      // (above) was built to prevent, just done incrementally instead of
      // after the fact. `scanPos` is how far into `raw` has been fully
      // resolved into `visible` or discarded as think-block content, so a
      // later delta only re-scans genuinely new bytes. `insideThink` toggles
      // on/off around each block rather than latching permanently once one
      // resolves (a code review, 2026-09-04, found the original one-shot
      // flag couldn't handle a second block appearing later in the same
      // stream - unusual for this hub's own model, but nothing here should
      // assume it can't happen). `spokenLength` is how much of `visible`
      // has already been handed to the scheduler.
      let raw = "";
      let scanPos = 0;
      let visible = "";
      let insideThink = false;
      // How far into `raw` a search for the relevant tag has already come
      // up empty, so the next delta's search resumes from there instead of
      // re-scanning already-confirmed-clean text from `scanPos` every time
      // (a code review, 2026-09-04, found the original version re-scanned
      // the whole accumulated reasoning block from scratch on every single
      // delta - real, avoidable quadratic cost on a long think block).
      let searchFrom = 0;
      let spokenLength = 0;
      let sawTerminalEvent = false;

      // Resolves as much of `raw.slice(scanPos)` as currently possible into
      // `visible`, holding back only a still-ambiguous suffix that might
      // yet become "<think>" (real token-level streaming can split the tag
      // itself across several deltas - a tokenizer's own boundaries rarely
      // align with a tag's characters). A code review (2026-09-04) found
      // the original version only ever recognized the tag when it sat at
      // the very START of the unresolved remainder - real text arriving
      // ahead of a tag within the same delta (a network chunk batching a
      // lead-in phrase with a reasoning block, or a second block's tag not
      // landing exactly on a delta boundary) got the tag and everything
      // after it dumped into `visible` unresolved. This searches the whole
      // remainder for the tag, not just its start.
      function resolveRaw(): void {
        const OPEN_TAG = "<think>";
        const CLOSE_TAG = "</think>";
        for (;;) {
          if (insideThink) {
            const closeIdx = raw.indexOf(CLOSE_TAG, Math.max(scanPos, searchFrom));
            if (closeIdx === -1) {
              // Hold back only the last CLOSE_TAG.length - 1 characters,
              // which could still become the start of "</think>" once more
              // arrives; everything before that has been confirmed clean.
              searchFrom = Math.max(scanPos, raw.length - (CLOSE_TAG.length - 1));
              return;
            }
            scanPos = closeIdx + CLOSE_TAG.length;
            // stripThinking()'s own regex (`<\/think>\s*`) consumes
            // whitespace right after the closing tag too. A code review
            // (2026-09-04) found this didn't, so `visible` kept whitespace
            // stripThinking() drops - `visible`'s coordinate space silently
            // drifted out of sync with `finalText` (below), and
            // `spokenLength` (tracked against `visible`) then sliced
            // `finalText` at the wrong offset once "done" recomputed the
            // authoritative text, corrupting the trailing spoken fragment.
            while (scanPos < raw.length && /\s/.test(raw[scanPos]!)) scanPos++;
            searchFrom = scanPos;
            insideThink = false;
            continue;
          }
          const remainder = raw.slice(scanPos);
          const openIdx = remainder.indexOf(OPEN_TAG);
          if (openIdx === -1) {
            // No complete opening tag yet - hold back only a trailing
            // suffix that's still a genuine prefix of "<think>" (it could
            // complete the tag once more text arrives); everything before
            // that is definitely real, visible text.
            let holdBack = 0;
            for (let i = 1; i < OPEN_TAG.length && i <= remainder.length; i++) {
              if (OPEN_TAG.startsWith(remainder.slice(remainder.length - i))) holdBack = i;
            }
            const safeLength = remainder.length - holdBack;
            visible += remainder.slice(0, safeLength);
            scanPos += safeLength;
            return;
          }
          visible += remainder.slice(0, openIdx); // everything before the tag is real text
          scanPos += openIdx + OPEN_TAG.length;
          searchFrom = scanPos;
          insideThink = true;
          continue;
        }
      }

      try {
        const response = await api.streamTurn(text, deps.consumeThinking(), abortSignal);
        for await (const event of readTurnStream(response)) {
          if (event.type === "turn_meta") {
            // The contract's first line on every turn (routes/turn.ts).
            // Not consumed yet (chatActionBar.tsx's "Remember this" still
            // waits on a real turnId in message metadata for a live
            // reply, a documented gap for a later step); still a normal,
            // non-terminal event, so it must not fall into the generic
            // "else = error" branch below, which every turn would hit
            // otherwise.
            continue;
          }
          if (event.type === "delta") {
            raw += event.text;
            resolveRaw();
            // Only yield once there's something to show. A delta that lands
            // entirely inside an open <think> block leaves `visible` "" -
            // yielding that anyway would hand assistant-ui a real (if empty)
            // "text" part, which is enough to satisfy MessagePrimitive.
            // GroupedParts's "no-text" check (thread.aui.tsx's built-in
            // pulsing "Assistant is working" indicator) and hide it, well
            // before there's any visible reply to replace it with - and, if
            // a spoken_cue (below) is still audibly playing, exactly the
            // moment someone without audio needs that indicator most.
            if (visible) yield { content: [{ type: "text", text: visible }] };
            const pending = visible.slice(spokenLength);
            const { chunks, consumed } = splitReadyChunks(pending, spokenLength === 0);
            // Each chunk speaks its normalized form, never the displayed
            // one: `visible` (yielded just above) keeps the model's own
            // written text - the chat bubble - completely untouched.
            for (const chunk of chunks) scheduler.enqueueSentence(normalizeForSpeech(chunk));
            spokenLength += consumed;
          } else if (event.type === "spoken_cue") {
            // Spoken only, never displayed and never counted against
            // `spokenLength`: `visible`/the chat bubble and conversation
            // history are untouched (backend/src/wire.ts's own comment on
            // why - a small model that saw its own cue in its history
            // would start opening every reply with it). Enqueuing it here,
            // ahead of any real content, is the whole mechanism: the
            // scheduler is a plain FIFO queue, so it plays first and the
            // real reply's sentences (enqueued above as they arrive)
            // follow right after.
            scheduler.enqueueSentence(event.text);
          } else if (event.type === "done") {
            sawTerminalEvent = true;
            // Authoritative, not just the incrementally-built preview: a
            // reasoning-only reply (never saw a real </think>), a stream
            // that ended mid-block, or any other edge case all resolve
            // correctly here, the same stripThinking() fallback the old
            // non-streaming path already relied on.
            const finalText = stripThinking(event.value.reply.text);
            const trailing = finalText.slice(spokenLength).trim();
            if (trailing) {
              // Nothing was spoken incrementally yet (an immediate plugin/
              // safety reply, which never emits a "delta" at all, or a
              // short model reply that streamed as a single final flush):
              // the backend's own reply.speech is authoritative here,
              // including any package-authored override turnEngine.ts's
              // finalizeReply() respects - using it instead of recomputing
              // generically keeps that override intact (a code review,
              // 2026-09-05, found the original version always recomputed
              // via normalizeForSpeech() here, silently discarding any
              // override). Once anything has already been spoken
              // incrementally (spokenLength > 0), only the tail remains,
              // and reply.speech - computed over the WHOLE final text - has
              // no matching coordinate to slice a tail out of, so the
              // per-chunk normalizer above is the only correct option left.
              scheduler.enqueueSentence(
                spokenLength === 0 ? (event.value.reply.speech ?? normalizeForSpeech(trailing)) : normalizeForSpeech(trailing),
              );
            }
            scheduler.finish();
            // 4.3: "offer, never block" - shown alongside the reply, never
            // in place of it, and never suppressing anything else in the
            // thread.
            if (event.value.crisis_resources) deps.onCrisisResources(event.value.crisis_resources);
            yield { content: [{ type: "text", text: finalText }] };
          } else {
            sawTerminalEvent = true;
            // A code review (2026-09-04) found this thrown as a plain
            // Error, which the catch block below's `e instanceof ApiError
            // && e.code === "unavailable"` check can never match - a
            // mid-stream engine crash always fell through to the generic
            // "Could not reach the hub" message instead of the intended,
            // more actionable one.
            throw new ApiError(event.error, 503, "unavailable");
          }
        }
        if (!sawTerminalEvent && !abortSignal.aborted) {
          // A code review (2026-09-04) found that a connection dropped
          // abnormally (a proxy cutoff, a crash) between deltas and a real
          // "done"/"error" event left this loop ending silently: no
          // exception, so the catch below never ran, and the reply bubble
          // just stopped growing with no banner and no way to tell it
          // failed rather than finished.
          throw new ApiError("The connection ended before MaiPai finished replying.", 0, "unavailable");
        }
      } catch (e) {
        if (abortSignal.aborted) {
          // The runtime's own stop button (ComposerPrimitive.Cancel):
          // rawStreamPost merges this same abortSignal into the fetch's
          // own via AbortSignal.any, so the abort surfaces here as
          // whatever isAbortError()'s rewrap produced (an ApiError, not a
          // DOMException named "AbortError") - re-thrown here in the shape
          // @assistant-ui/core's local-thread-runtime-core.ts specifically
          // checks for (`e.name === "AbortError"`), so a user-initiated
          // stop reads as cancelled, not as a failed reply.
          //
          // A user-initiated stop is barge-in, not "let the reply wind
          // down": every other voice/chat app cuts audio the instant Stop
          // is pressed (Jesse, 2026-09-06, asked for exactly that
          // behavior) - scheduler.stop() (SentenceSpeechScheduler's own
          // "the real mechanism a future barge-in feature needs" method)
          // closes the AudioContext immediately, unlike finish() below,
          // which lets whatever's already scheduled keep playing out.
          scheduler.stop();
          throw new DOMException("The run was stopped.", "AbortError");
        }
        scheduler.finish(); // a genuine failure, not a user stop - let whatever already started speaking finish naturally, enqueue nothing more
        // turnEngine.ts's "unavailable" code covers every real down-state
        // (still downloading, crashed, never selected): one friendly,
        // actionable message rather than the developer-facing reason string
        // (e.g. "llama-server did not become healthy within 60000ms")
        // leaking straight into the household's chat thread.
        throw new Error(
          e instanceof ApiError && e.code === "unavailable"
            ? "MaiPai's AI isn't answering right now. If you just picked a new AI model it may still be getting ready - check Household → AI models, then try again."
            : e instanceof ApiError
              ? e.message
              : "Could not reach the hub. Try again.",
        );
      }
    },
  };
}
