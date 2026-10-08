import type { ChatModelAdapter, ChatModelRunOptions, ChatModelRunResult, ThreadAssistantMessagePart } from "@assistant-ui/react";
import { offerCarry, withdrawCarry } from "./chatCarry";
import { MAX_CHAT_IMAGES, CHAT_IMAGE_REFUSAL } from "@maipai/home-backend/src/wire";
import { api, ApiError } from "@/lib/api";
import { readAssistantTurnStream } from "@/lib/assistantTurnStream";
import { SentenceSpeechScheduler } from "@/lib/sentenceSpeechScheduler";
import { splitReadyChunks } from "@/lib/sentenceChunker";
import { normalizeForSpeech } from "@maipai/spec/voice/ts/normalizeForSpeech.js";
import { TurnStreamEvent as ToolTurnStreamEvent } from "@maipai/spec/stack/ts/turn-stream-event.js";
import { messageText } from "@/apps/chat/chatMessageText";
import { stagedDocumentPayload, clearStagedImageAttachment } from "@/apps/chat/localImageAttachmentAdapter";
import { toolCallPart } from "@/apps/chat/chatToolCallPart";
import { sourceMessageParts } from "@/apps/chat/chatSources";
import type { TurnWithMedia } from "@/apps/chat/chatCitations";
import { textWithAnswerImages } from "@/apps/chat/chatAnswerImages";
import type { AnswerImageSet, CrisisSupport } from "@maipai/home-backend/src/wire";
import type { PendingContinuation } from "@/apps/chat/chatContinue";
import { ChatTurnError } from "@/apps/chat/chatTurnError";
import { failureLine } from "@maipai/home-backend/src/lib/failureCopy";

// Qwen3's hybrid thinking mode wraps its reasoning in a `<think>...</think>`
// block ahead of the real answer when enabled (llm.ts's `thinking` option);
// stripped here rather than shown inline so turning it on for one hard
// question doesn't dump a paragraph of raw reasoning into the thread - a
// household member who wants to see it can still ask.
export function stripThinking(text: string): string {
  const closedStripped = text.replace(/<think>[\s\S]*?<\/think>\s*/g, "");
  // Issue #20: a reply can end (stream truncated, hit a token limit, a
  // backend crash) while still inside an UNCLOSED think block - the
  // regex above requires a matching `</think>` and finds none, so
  // closedStripped still has a bare `<think>` with raw reasoning after
  // it. Treat that the same as a closed block: drop everything from the
  // last `<think>` onward rather than showing it verbatim.
  const openIdx = closedStripped.lastIndexOf("<think>");
  const stripped = (openIdx === -1 ? closedStripped : closedStripped.slice(0, openIdx)).trim();
  // A code review (2026-09-04) found the earlier `|| text` fallback here
  // defeated the whole point when a reply was reasoning-only (no final
  // answer after the </think> tag): stripped becomes "", which is
  // falsy, so `|| text` re-surfaced the raw, un-stripped block it exists
  // to hide. Never fall back to the unstripped text.
  return stripped || "MaiPai thought about it but didn't give a final answer. Try asking again.";
}

// ATT-01, live finding 2026-09-22: a document attachment (SimpleTextAttachmentAdapter,
// composerAddMenu.tsx's own text/Markdown path) resolves its own
// `<attachment name="...">...</attachment>`-wrapped content onto
// `message.attachments[i].content`, a SEPARATE array from `message.content`
// (the typed text) - messageText() only ever read the latter, so an
// attached text file sent successfully (no adapter error, unlike the
// image case below) with its own content silently never reaching the
// model at all. Backend has no separate attachment channel
// (routes/turn.ts never mentions one) - folded into the one text field
// it does read, the same inline shape the adapter's own tag already
// gives it.
function userQuote(last: ChatModelRunOptions["messages"][number] | undefined): string | undefined {
  if (!last || last.role !== "user") return undefined;
  const quote = last.metadata.custom.quote;
  if (typeof quote !== "object" || quote === null || !("text" in quote)) return undefined;
  return typeof quote.text === "string" && quote.text.trim() ? quote.text : undefined;
}

function lastUserText(messages: ChatModelRunOptions["messages"], includeQuote = true): string | undefined {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") return undefined;
  const typed = messageText(last);
  const selectedQuote = includeQuote ? userQuote(last) : undefined;
  const quoteText = selectedQuote
    ? `> ${selectedQuote.replace(/\r\n?/g, "\n").split("\n").join("\n> ")}`
    : "";
  const attachmentText = last.attachments
    .flatMap((attachment) => attachment.content ?? [])
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n\n");
  return [quoteText, typed, attachmentText].filter(Boolean).join("\n\n") || undefined;
}

export interface ChatModelAdapterDeps {
  onDraftSent?(): void;
  onConnection?(state: { phase: "online" | "dropped" | "reconnecting" | "resumed"; attempt?: number; resumedTokens?: number }): void;
  onReplyState?(state: "waiting" | "responding" | "ready" | "error" | "idle"): void;
  onSpeechError?(): void;
  // NewChat reads the active conversation's selected mode. Undefined
  // for a minor (safety ruling, 2026-09-22): its request omits `thinking`.
  getThinking?(): boolean | undefined;
  // Retired ChatPage's one-message "Think longer" action.
  consumeThinking?(): boolean | undefined;
  /** Session-local model selected in /chat; read once so a reconnect
   * retries the same model even if the composer changes meanwhile. */
  getModel?(): string | undefined;
  /** Age band for the signed-in person; per-message model choice is adults-only. */
  getAgeBand?(): "adult" | "teen" | "child" | undefined;
  // ADMIN-COMPARE-01 (b): a plain read, never consumed/reset - unlike
  // `consumeThinking()`, bare mode is meant to stay on across every send
  // in the conversation until the admin turns it off themselves
  // (ChatPage.tsx's own ephemeral, session-local switch). Undefined
  // for any surface that never offers it.
  isBareMode?(): boolean;
  // getmaipai/home#60: reads AND resets the "which turn is this Update
  // replacing" ref that thread.aui.tsx's EditComposer sets right before
  // its own Send click reaches assistant-ui's real send callback
  // (chatEditSupersedes.ts) - undefined for an ordinary send, never
  // anything else's edit once this one's been read.
  consumeSupersedes(): string | undefined;
  consumeContinuation?(): PendingContinuation | undefined;
  // SHELL-02 slice 6: reads AND resets the composer's Apps-menu choice
  // (composerAddMenu.tsx's `PackageScopeContext`), the same single-shot
  // shape as `consumeSupersedes()` - a choice ridden on the next send,
  // then cleared, never a mode a later message inherits by accident.
  // Undefined for any surface with no Apps menu. Carried on the wire as
  // an additive field the old turn path doesn't read yet (see
  // `api.streamTurn`'s own comment) - present here so the choice's own
  // test can assert the outgoing payload without the flag it's gated
  // behind changing how a real send behaves today.
  consumePackageScope?(): string | undefined;
  // CHAT-HEADER-01: reads AND resets the "start temporary chat" choice
  // made from the header menu, the same single-shot shape as
  // `consumeSupersedes()`/`consumePackageScope()` - only meaningful on
  // the very next send (which starts the new conversation this was
  // chosen for), never a mode a later message inherits. Undefined for
  // any surface with no temporary-chat entry.
  consumeTemporary?(): boolean | undefined;
  // APPROVE-CARD-01: reads AND resets the confirm card's own tapped
  // approve/deny (ConfirmTool, ChatPage.tsx), the same single-shot
  // shape as `consumeSupersedes()`/`consumePackageScope()` - only
  // meaningful on the one send the card's own Yes/No click makes (which
  // also sets the composer text to that label before sending, so the
  // transcript reads naturally), never a mode a later typed message
  // inherits. Undefined for any surface with no confirm card (a plain
  // typed "yes" still resumes an ask too, through the backend's own
  // AFFIRMATIVE_RE text match - this field only carries a real button
  // tap's structured answer).
  consumeAskAnswer?(): { turnId: string; approved: boolean } | undefined;
  // VOICE-LIVE-02: reads AND resets the live voice session's own
  // "this send is spoken" choice, the same single-shot shape as
  // consumeTemporary()/consumePackageScope() - only meaningful on the
  // one send the live voice session itself makes (its own final
  // transcript, sent via aui.composer.send()), never a mode a later
  // typed message inherits after the call ends.
  consumeSpoken?(): boolean | undefined;
  getConversationId?(): Promise<string>;
  resumeConversationIfClosed?(conversationId: string): Promise<void>;
  // The live reply's own sentence-by-sentence speech (2026-09-04): a
  // separate player from the per-message "Listen" replay (chatListen.ts),
  // since a fresh reply speaks as it arrives while an earlier message's
  // "Listen" button still replays the old, single-utterance way. Owned by
  // ChatPage.tsx so a manual "Listen" click can stop it too - never let
  // two voices overlap.
  turnSchedulerRef: { current: SentenceSpeechScheduler | null };
  // Jesse, 2026-09-06: the composer's Send/Stop toggle tracks only
  // `thread.isRunning` (text generation) - text almost always finishes
  // streaming well before its speech has finished playing (inherent to
  // any pipeline that starts talking before the whole reply exists, not
  // a bug), so the button flips back to "Send" while audio for the reply
  // is still going, with nothing left on screen able to stop it. Wired to
  // the scheduler's own onFirstAudio/onEnded so ChatPage.tsx can show a
  // dedicated “stop speaking” control for exactly that window.
  onSpeakingChange?(speaking: boolean): void;
  onResearchDocument?(turnId: string): void;
  // Jesse, live-found 2026-09-27: "this should be the default when
  // generating an artifact that requires the canvas" - a synchronous
  // write_document reply used to leave its own artifact card sitting
  // there unopened until clicked. Fired exactly once, right where
  // `artifact` (below) is known non-null on the turn's own terminal
  // event - never on chatHistoryAdapter.ts's reload path, which has no
  // such callback at all, so reopening an old conversation never
  // re-triggers this for a document written minutes or days ago.
  onArtifactReady?(artifactId: string): void;
  // SHELL-02: the plan's own wiring table (docs/plans/shell-on-
  // shadcndashboard-2026-09-21.md) lists "Speaking a reply" (the
  // read-aloud Element) as its own row, separate from the reply text
  // and reasoning rows this adapter already renders - /chat's
  // first slice mounts the Elements composer with no "stop speaking"
  // control on screen yet, so false here skips every enqueueSentence()
  // call rather than have a turn autoplay audio nothing can cut off.
  // Defaults true: ChatPage.tsx's own established behavior, unchanged.
  // VOICE-LIVE-02: also accepts a getter, read fresh every send - the
  // live voice session flips this on only while it's open (ChatPage
  // passes `false` today; a live call needs the identical scheduler this
  // adapter already drives, on only for the turn it itself sent, off
  // again the moment the call ends, never a second speech pipeline).
  speakReplies?: boolean | (() => boolean);
  /** UI-SHOWCASE: opens the turn's stream somewhere other than
   * POST /api/turn/stream (the admin Chat showcase's canned fixtures). The
   * response is read by the same assistant-stream decoder. Unset on the
   * real chat. */
  openStream?(text: string, abortSignal: AbortSignal): Promise<Response>;
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
/** A sent picture rebuilt from the hub's store (no File, its image served
 * by GET /api/attachments/:id), as opposed to one picked in this session. */
function isStoredPicture(attachment: { file?: File; content?: readonly { type: string; image?: string }[] }): boolean {
  return !attachment.file && (attachment.content ?? []).some((part) => part.type === "image" && typeof part.image === "string" && part.image.startsWith("/api/attachments/"));
}

export function createChatModelAdapter(deps: ChatModelAdapterDeps): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal, runConfig }: ChatModelRunOptions): AsyncGenerator<ChatModelRunResult, void> {
      deps.onDraftSent?.();
      const lastMessage = messages[messages.length - 1];
      const quote = userQuote(lastMessage);
      const quoteSpoken = quote ? deps.consumeSpoken?.() : undefined;
      // UPLOAD-IMG-02: only a picture picked in this session (it still holds
      // its File) is uploaded with the turn. A picture rebuilt from the hub's
      // store on a reopened chat (chatHistoryAdapter.ts) is already saved
      // against its own turn, so "Try again" or an edit of that message
      // runs as text, never "attach it again".
      const newPictures = lastMessage?.role === "user" ? lastMessage.attachments.filter((attachment) => attachment.type === "image" && !isStoredPicture(attachment)) : [];
      const imageAttached = newPictures.length > 0;
      const documentPayloads = lastMessage?.role === "user" ? (await Promise.all(lastMessage.attachments.filter((attachment) => attachment.type === "file").map((attachment) => stagedDocumentPayload(attachment.id)))).filter((item): item is NonNullable<typeof item> => Boolean(item)) : [];
      const typedText = lastUserText(messages, !quoteSpoken);
      const text = typedText || (documentPayloads.length > 0 ? "Please read the attached document." : undefined);
      if (!text && !imageAttached && documentPayloads.length === 0) return;

      // Stop whatever an earlier live reply was still speaking - never two
      // voices at once. A manual "Listen" replay (chatListen.ts) stops
      // itself independently when a new send starts (ChatPage.tsx).
      deps.turnSchedulerRef.current?.stop();
      // The scheduler being stopped never fires its own onEnded (stop() is
      // an abrupt cutoff, not a natural finish) - without this, a "stop
      // speaking" control shown for the PREVIOUS reply would stay visible
      // into this new one until/unless the new reply happens to speak too.
      deps.onSpeakingChange?.(false);
      const speakReplies = typeof deps.speakReplies === "function" ? deps.speakReplies() : (deps.speakReplies ?? true);
      const scheduler = new SentenceSpeechScheduler();
      deps.turnSchedulerRef.current = scheduler;
      scheduler.onFirstAudio = () => deps.onSpeakingChange?.(true);
      scheduler.onError = () => deps.onSpeechError?.();
      scheduler.onEnded = () => deps.onSpeakingChange?.(false);

      // `visible` is the released answer text, exactly as the wire sent it:
      // the server splits <think> spans into reasoning parts before release
      // (routes/turn.ts), so a text part never carries the tags and nothing
      // here parses them. `spokenLength` is how much of `visible` has already
      // been handed to the scheduler.
      let visible = "";
      // SHELL-02: the reasoning Element's own part (thread.aui.tsx),
      // built from the `reasoning` wire event (REASONING-01, wire.ts) -
      // already tag-split server-side, so unlike `visible` above this
      // never needs any <think> scanning.
      let reasoningText = "";
      let spokenLength = 0;
      let sawTerminalEvent = false;
      let resumeToken: string | undefined;
      let resumeTurnId: string | undefined;
      let crisisSupport: CrisisSupport | undefined;
      let lastAcknowledgedSequence = 0;
      let reconnectAttempts = 0;
      const MAX_RECONNECT_ATTEMPTS = 3;
      let awaitingResume = false;
      let resumedDeltaCount = 0;
      deps.onConnection?.({ phase: "online" });
      // Lane 11 item 1: true from the moment a `status`/`spoken_cue`
      // event has set the transient activity line (chatTurnActivity.ts)
      // until the next delta clears it - tracked here, not derived from
      // `visible`, since the activity is about what's happening BEFORE
      // any real text exists, not about the text itself.
      let activityShown = false;
      // TOOL-EVENTS-01 (spec-v0.1.16, backend emission not landed yet -
      // getmaipai/home docs/dev.md's own handoff note): `tool_call`/
      // `tool_result`/`tool_error` are a SEPARATE event shape from the
      // rest of this stream, keyed by `t` (spec's own
      // `stack/ts/turn-stream-event.ts`), not `type` - backend/src/
      // wire.ts's own `TurnStreamEvent` union (what `readTurnStream`
      // actually returns today) has no such member yet, so these are
      // parsed with `safeParse` against the raw event rather than a
      // branch of the `event.type` chain below, the same
      // "cast/parse before the backend type has it" shape `status` used
      // above it (Lane 11 item 1) before it was real either. Consumer
      // before producer, same as slice 5(a)'s sources card and slice
      // 4's artifact card: this renders nothing in the app until the
      // backend half of TOOL-EVENTS-01 lands, proven only by
      // chatModelAdapter.test.ts's own scripted NDJSON until then.
      // Insertion order (Map's own iteration order) is step order -
      // there is no separate sequence field on these events.
      const toolCalls = new Map<string, { packageId: string; state: "running" | "ok" | "error"; failureKind?: string; sites?: { host: string; url: string }[] }>();
      let failedTool = false;
      // ANSWER-IMG-04: the hub's picture set, once its `images` event arrives;
      // the reply text is split at its paragraph boundary around it.
      let answerImages: AnswerImageSet | undefined;

      // One definition (a review caught this built twice, copy-pasted,
      // between buildContent() and the done handler below): `turnId`
      // undefined mid-stream (before turn_meta) or once finalized both
      // return undefined the same way, so a future shape change only
      // has one call site to make it in.
      function toolTimelinePart(turnId: string | undefined): ThreadAssistantMessagePart | undefined {
        if (toolCalls.size === 0 || !turnId) return undefined;
        return toolCallPart(
          `${turnId}-tools`,
          "tool_timeline",
          [...toolCalls].map(([callId, call]) => ({ callId, ...call })),
        );
      }

      // Every yield below replaces the whole message's content (this
      // file's own header comment), so the reasoning part has to ride
      // along on every yield once it exists, not just the ones a
      // `reasoning` event itself triggers.
      function buildContent(): ThreadAssistantMessagePart[] {
        const parts: ThreadAssistantMessagePart[] = [];
        if (reasoningText) parts.push({ type: "reasoning", text: reasoningText });
        // Before the text part, like the structured/artifact cards above
        // (slice 5(e)'s own rule) - a trace of what the model did while
        // producing this answer reads above its own sentence, the
        // opposite of sources' "compact card under the reply."
        const timeline = toolTimelinePart(resumeTurnId);
        if (timeline) parts.push(timeline);
        if (visible || answerImages) parts.push(...textWithAnswerImages(visible, answerImages, `${resumeTurnId ?? "live"}-images`).filter((part) => part.type !== "text" || part.text));
        return parts;
      }

      // Consumed here, synchronously, before anything that can throw or
      // abort below: consumeSupersedes() is a single-shot read-and-reset
      // (chatEditSupersedes.ts), so calling it any later - after an
      // `await` a Stop click can race - risks throwing past it and
      // leaving a stale edit's turn id sitting in the module-scope ref
      // for a later, unrelated send to inherit.
      const supersedes = deps.consumeSupersedes();
      const continuation = deps.consumeContinuation?.();
      deps.onReplyState?.("waiting");
      try {
        let conversationId = await deps.getConversationId?.();
        if (conversationId) await deps.resumeConversationIfClosed?.(conversationId);
        const temporary = deps.consumeTemporary?.();
        const imageParts: { id: string; name: string; width: number; height: number; media_type: string }[] = [];
        const photoTurnId = imageAttached ? `turn-${crypto.randomUUID().replaceAll("-", "").toLowerCase()}` : undefined;
        if (imageAttached && lastMessage?.role === "user") {
          const photos = newPictures;
          if (photos.length > MAX_CHAT_IMAGES) throw new Error(CHAT_IMAGE_REFUSAL);
          for (const attachment of photos) {
            if (!attachment.file) throw new Error("The selected picture is no longer available. Please attach it again.");
            const form = new FormData();
            form.append("file", attachment.file, attachment.name ?? "picture");
            form.append("turn_id", photoTurnId!);
            form.append("temporary", temporary ? "true" : "false");
            if (conversationId) form.append("conversation_id", conversationId);
            const response = await fetch("/api/attachments/upload", { method: "POST", credentials: "include", body: form, signal: abortSignal });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error ?? "Could not upload this picture.");
            conversationId = payload.conversation_id as string;
            imageParts.push(payload.image as (typeof imageParts)[number]);
            clearStagedImageAttachment(attachment.id);
          }
        }
        const selectedModel = deps.getModel?.();
        abortSignal.throwIfAborted();
        while (!sawTerminalEvent) {
          const bare = deps.isBareMode?.() ?? false;
          // Bare completion ignores `thinking` entirely
          // (bareCompletion.ts hardcodes it on), so don't add a thinking
          // field to that request. NewChat's getter reads the active
          // conversation setting; the old ChatPage fallback consumes its
          // one-message action.
          const thinking = deps.getThinking ? deps.getThinking() : deps.consumeThinking?.();
          const perRunModel = (runConfig as { custom?: { model?: unknown } } | undefined)?.custom?.model;
          const runModel = deps.getAgeBand?.() === "adult" && typeof perRunModel === "string" ? perRunModel : undefined;
          const response = await (deps.openStream?.(text ?? "", abortSignal) ?? api.streamTurn(text ?? (imageAttached ? "Please look at the attached picture." : "Please read the attached document."), abortSignal, {
            thinking: reconnectAttempts === 0 && !bare ? thinking : undefined,
            model: !bare ? (runModel ?? selectedModel) : undefined,
            // `undefined`, not `false`, when a surface has no bare-mode
            // concept at all (ChatPage.tsx's own adapter never sets
            // isBareMode) - `false` would still ride the request body
            // (JSON.stringify only drops `undefined`), a field on every
            // surface's request that only ChatPage's own admin
            // diagnostic ever means anything.
            bare: bare || undefined,
            assistantStream: true,
            conversationId,
            supersedes,
            continuation,
            resumeToken,
            turnId: resumeTurnId ?? photoTurnId,
            resumeFrom: resumeToken ? lastAcknowledgedSequence : undefined,
            packageScope: reconnectAttempts === 0 ? deps.consumePackageScope?.() : undefined,
            temporary: reconnectAttempts === 0 ? temporary : undefined,
            spoken: reconnectAttempts === 0 ? quote ? quoteSpoken : deps.consumeSpoken?.() : undefined,
            // APPROVE-CARD-01: the same reconnectAttempts===0 gate as
            // packageScope/temporary/spoken above - a single-shot field
            // only ever meaningful on the first attempt of this send,
            // never resent on a reconnect retry within the same send.
            askAnswer: reconnectAttempts === 0 ? deps.consumeAskAnswer?.() : undefined,
            documentAttachments: reconnectAttempts === 0 && documentPayloads.length > 0 ? documentPayloads : undefined,
            images: imageParts.length > 0 ? imageParts : undefined,
          }));
          for await (const event of readAssistantTurnStream(response)) {
          // A review caught this: `safeParse` ran on every event
          // unconditionally, including every `delta` - the hottest path
          // in this loop, once per streamed chunk. `t` is exclusive to
          // the three tool events (nothing else on the wire has it), so
          // this skips the Zod parse entirely for the overwhelming
          // majority of events that can't possibly match.
          const toolEvent = "t" in event ? ToolTurnStreamEvent.safeParse(event) : undefined;
          if (toolEvent?.success) {
            const e = toolEvent.data;
            if (e.t === "tool_call") {
              toolCalls.set(e.call_id, { packageId: e.package_id, state: "running" });
            } else if (e.t === "tool_result" || e.t === "tool_error") {
              // tool_result and tool_error both resolve an existing call;
              // an unrecognized call_id (a result for a call this stream
              // never saw start, a stream resumed mid-call) is ignored
              // rather than inventing a step with no start.
              const existing = toolCalls.get(e.call_id);
              if (existing) {
                // TOOL-EVENTS-02: `sites` only ever rides a `tool_result`
                // (spec's own schema has no such field on `tool_error`) -
                // one `e.t` check, not two, decides both `state` and
                // whether `sites` applies.
                toolCalls.set(e.call_id, e.t === "tool_result" ? { ...existing, state: e.outcome.error_code ? "error" : "ok", ...(e.outcome.sites ? { sites: e.outcome.sites } : {}) } : { ...existing, state: "error", failureKind: e.error });
                if (e.t === "tool_error" || Boolean(e.outcome.error_code)) failedTool = true;
              }
            }
            if (activityShown) {
              activityShown = false;
              yield { metadata: { custom: {} } };
            }
            yield { content: buildContent() };
            continue;
          }
          if (event.type === "turn_meta") {
            // The contract's first line on every turn (routes/turn.ts).
            // Not consumed yet (chatActionBar.tsx's "Remember this" still
            // waits on a real turnId in message metadata for a live
            // reply, a documented gap for a later step); still a normal,
            // non-terminal event, so it must not fall into the generic
            // "else = error" branch below, which every turn would hit
            // otherwise.
            conversationId = event.conversation_id;
            resumeToken = event.resume_token;
            resumeTurnId = event.turn_id;
            continue;
          }
          if (event.type === "signal") continue;
          if (event.type === "delta") {
            if (event.sequence !== undefined) {
              if (event.sequence <= lastAcknowledgedSequence) continue;
              lastAcknowledgedSequence = event.sequence;
            }
            if (awaitingResume) {
              resumedDeltaCount++;
              awaitingResume = false;
              deps.onConnection?.({ phase: "resumed", resumedTokens: resumedDeltaCount });
            }
            deps.onReplyState?.("responding");
            visible += event.text;
            if (activityShown) {
              // Lane 11 item 1's own acceptance: "the first delta removes
              // it" - a real content update can still be empty this same
              // delta (entirely inside an open <think> block, below), so
              // this clears on its own yield rather than piggybacking on
              // the conditional content one just below, which would miss
              // exactly that case.
              activityShown = false;
              yield { metadata: { custom: {} } };
            }
            // Only yield once there's something to show. An empty delta
            // yielding anyway would hand assistant-ui a real (if empty)
            // "text" part, which is enough to satisfy MessagePrimitive.
            // GroupedParts's "no-text" check (thread.aui.tsx's built-in
            // pulsing "Assistant is working" indicator) and hide it, well
            // before there's any visible reply to replace it with - and, if
            // a spoken_cue (below) is still audibly playing, exactly the
            // moment someone without audio needs that indicator most.
            if (visible || reasoningText) yield { content: buildContent() };
            if (speakReplies) {
              const pending = visible.slice(spokenLength);
              const { chunks, consumed } = splitReadyChunks(pending, spokenLength === 0);
              // Each chunk speaks its normalized form, never the displayed
              // one: `visible` (yielded just above) keeps the model's own
              // written text - the chat bubble - completely untouched.
              for (const chunk of chunks) scheduler.enqueueSentence(normalizeForSpeech(chunk));
              spokenLength += consumed;
            }
          } else if (event.type === "spoken_cue") {
            // Spoken only, never displayed as message content and never
            // counted against `spokenLength`: `visible`/the chat bubble and
            // conversation history are untouched (backend/src/wire.ts's own
            // comment on why - a small model that saw its own cue in its
            // history would start opening every reply with it). Enqueuing it
            // here, ahead of any real content, is the whole mechanism: the
            // scheduler is a plain FIFO queue, so it plays first and the
            // real reply's sentences (enqueued above as they arrive) follow
            // right after.
            if (speakReplies) scheduler.enqueueSentence(event.text);
            // Lane 11 item 1's own decision (chatTurnActivity.ts): a
            // spoken_cue also drives the same transient activity line a
            // `status` event does below - this file's own older comment on
            // "the moment someone without audio needs that indicator most"
            // was the gap (a cue playing has never had any VISIBLE trace).
            activityShown = true;
            yield { metadata: { custom: { activity: event.text } } };
          } else if (event.type === "status") {
            // CHAT-16 (Session A): a real TurnStreamEvent member
            // (backend/src/wire.ts, BACKLOG.md's "Engine emits `status`
            // events at lookup start," done 2026-09-15). `stage` isn't
            // read here, since the activity line shows the event's own
            // text verbatim, the same "no spinner icon invented"
            // instruction that also means no per-stage icon or color.
            activityShown = true;
            yield { metadata: { custom: { activity: event.text } } };
          } else if (event.type === "done") {
            sawTerminalEvent = true;
            deps.onConnection?.({ phase: "online" });
            // Authoritative, not just the incrementally-built preview: a
            // reasoning-only reply (never saw a real </think>), a stream
            // that ended mid-block, or any other edge case all resolve
            // correctly here, the same stripThinking() fallback the old
            // non-streaming path already relied on.
            deps.onReplyState?.("ready");
            const finalText = stripThinking(event.value.reply.text);
            const trailing = finalText.slice(spokenLength).trim();
            if (trailing && speakReplies) {
              // Nothing was spoken incrementally yet (an immediate plugin/
              // safety reply, which never emits a "delta" at all, or a
              // short model reply that streamed as a single final flush):
              // the backend's own reply.speech is authoritative here,
              // including any package-authored override the retired turn engine's
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
            if (event.value.document_available === true) deps.onResearchDocument?.(event.value.turn_id);
            // THIN-3G: the offer of a new chat that carries the summary.
            if (event.value.carry_offer === true) offerCarry(event.value.conversation_id);
            else withdrawCarry();
            // REASONING-02: a tool-calling reply never streams a live
            // `reasoning` event (its reasoning never rides a visible
            // span to split out of), so `reasoningText` is still "" here
            // for exactly that case - `event.value.reasoning` is the
            // buffered fallback wire.ts's own comment describes.
            const finalReasoning = reasoningText || event.value.reasoning;
            // SHELL-02 slice 3: the generative-UI contract's structured
            // part (weather, almanac-date) arrives as one field on the
            // done event, not as a real tool-call stream (Home resolves
            // packages server-side, before the visible reply ever
            // streams) - built into a real ToolCallMessagePart here,
            // `toolName` the producing package's own real id
            // (`structured_part.tool_id`, wire.ts), never a name this
            // file invents, so the Elements' registered spec-sheet
            // render (ChatPage.tsx) and the generic ToolFallback
            // (any other tool) both key on something honest. No
            // `args`/`argsText`: the wire never carries the tool's own
            // call arguments, only its result.
            const structuredPart = event.value.structured_part;
            // SHELL-02 slice 4: the artifact record's own writer
            // (ARTIFACT-02, composer.ts's `artifactForOutcomes()`)
            // names only which version a turn minted or updated
            // ({id, version}), never the body - a real
            // ToolCallMessagePart here, `toolName: "write_document"`
            // (the one bundled package that writes this record today),
            // so the Elements' registered artifact-card render
            // (ChatPage.tsx) can fetch the full version and open
            // it in canvas-split on click.
            const artifact = event.value.artifact;
            if (artifact) deps.onArtifactReady?.(artifact.id);
            // APPROVE-CARD-01: `TurnValue.confirm` (wire.ts) - set only
            // on the turn that just parked a confirm_needed/consent_needed
            // ask (turnNext.ts's finishTurn() "asked" branch). A real
            // ToolCallMessagePart here, `toolName: "confirm"`
            // (ConfirmTool's own registration, ChatPage.tsx), the
            // same "package result, not model text" composition as
            // structuredPart/artifact above. `turn_id` rides in the
            // result (not just the toolCallId) because the approve/deny
            // click handler needs it to build the outgoing `ask_answer`
            // - wire.ts's own doc comment on `confirm` has the full
            // read-time-derivation reasoning for `open`.
            const confirm = event.value.confirm;
            // PROJECT-PROGRESS-01: `start_project`'s own outcome names
            // only the id it just launched (wire.ts's own comment on
            // `TurnValue.project` - the same "name it, don't inline it"
            // shape `artifact` just above already is for a version) - a
            // real ToolCallMessagePart here, `toolName: "project"`,
            // registered in ChatPage.tsx to poll GET /api/projects/
            // :id and render the shipped JobProgress element while it's
            // live. A code review caught this never checking `artifact`
            // the way conversationHistory.ts's own reload-path gate
            // already does: `state.outcomes` is a plural array
            // (turnNext.ts), so a turn whose outcomes somehow included
            // both a succeeded `write_document` and a succeeded
            // `start_project` call would otherwise show both cards live
            // while a reload of that same turn shows only the artifact
            // one - the identical "no double card" rule, applied here
            // too, not just on reload.
            const project = artifact ? undefined : event.value.project;
            // TOOL-EVENTS-01: `toolTimelinePart` (above) is the one
            // definition, used here and by `buildContent()` mid-stream -
            // computed once so both the array-spread check and the part
            // itself read the identical value.
            const timelinePart = toolTimelinePart(event.value.turn_id);
            // TurnValue.sources (CHAT-16) becomes assistant-ui's native
            // source parts in source order below. The same parts are
            // rebuilt by chatHistoryAdapter.ts after a reload.
            const sources = event.value.sources;
            const sourceParts = sourceMessageParts(sources);
            // Fix B4 (docs/dev.md's "Chat reliability" B4): the same
            // metadata shape chatHistoryAdapter.ts attaches on reload, so
            // the retired caption rendered identically whether a message
            // just streamed in live or came back from GET /api/conversations/
            // :id/turns - camelCase keys to match that adapter's row fields,
            // even though TurnValue itself is snake_case on the wire.
            // getmaipai/home#60: `turnId` matches chatHistoryAdapter.ts's
            // own reload-path metadata shape exactly (camelCase, same
            // key) - a live reply carries its real turn id from the
            // moment it's created, not only once a reload rebuilds it
            // from the database, so editing a message sent THIS session
            // can find the turn its own reply belongs to (thread.aui.tsx's
            // EditComposer) without waiting for a reload.
            // CHAT-20: `conversationId` (already resolved above, before
            // the stream even opened) lets chatMemoryState.ts's poller
            // know which conversation this live turn belongs to the
            // moment it finishes - no `judgeStatus` field here on
            // purpose (the judge runs after the turn, never during it;
            // `deriveMemoryStatus` reads an absent/undefined field the
            // same as a freshly-created row's real `null`).
            yield {
              // slice 5(e): tool parts before the text part - the reference
              // bar's own ordering ("the structured card FIRST, the prose
              // after it") falls out of nothing but array order here, since
              // MessagePrimitive.GroupedParts just renders parts in the
              // order this content array gives it (thread.aui.tsx's own
              // switch on part.type, no forced ordering). A review, 2026-09-
              // 21, found this array put `text` before both tool-call parts,
              // the opposite of what every reply with a weather card or a
              // written document actually wants to show.
              content: [
                ...(finalReasoning ? [{ type: "reasoning" as const, text: finalReasoning }] : []),
                ...(structuredPart ? [toolCallPart(`${event.value.turn_id}-structured`, structuredPart.tool_id, structuredPart)] : []),
                ...(artifact ? [toolCallPart(`${event.value.turn_id}-artifact`, "write_document", artifact)] : []),
                // TOOL-EVENTS-01: same "before text" placement as the
                // structured/artifact cards above - a trace of what ran
                // while this reply was produced reads above its own
                // sentence, not under it like sources. Empty today (no
                // caller emits tool_call/tool_result/tool_error yet), so
                // this never adds a part in the running app until the
                // backend half lands.
                ...(timelinePart ? [timelinePart] : []),
                ...textWithAnswerImages(finalText, event.value.answer_images ?? answerImages, `${event.value.turn_id}-images`),
                // APPROVE-CALM-01 (owner's Row-Bot reference, 2026-10-06): the
                // approval card sits UNDER the reply that asks, the way the
                // reference reads ("...so it waits for your approval", then
                // the card), and the same place on reload (chatHistoryAdapter.ts).
                ...(confirm ? [toolCallPart(`${event.value.turn_id}-confirm`, "confirm", { package_id: confirm.package_id, open: confirm.open, turn_id: event.value.turn_id })] : []),
                // Native source parts stay after the reply text. The
                // footer's static Sources card and [n] citation mapper
                // both read them in this same order.
                //
                // `project` moved down here from the "before text" group
                // above, 2026-09-27 (Jesse found live): chatHistoryAdapter.ts's
                // own #182 reload-path rule already renders a project's
                // finished artifact AFTER its text (PROJECT_START_PLUGIN_ID),
                // matching sources' own "compact card under the reply"
                // reasoning, not the structured/artifact/confirm "reference
                // the reply is ABOUT" reasoning above. Leaving `project`
                // in the before-text group here, while it was live, meant
                // ProjectResultReload's own `reloadMainThread()` (up to
                // 15s later, once the project's done/failed notification
                // arrives) visibly relocated the exact same card from
                // above the reply to below it the moment the reload
                // landed - the live and reload paths now agree on the
                // one position from the start, so nothing has to jump.
                ...(project ? [toolCallPart(`${event.value.turn_id}-project`, "project", project)] : []),
                ...sourceParts,
              ],
              ...(event.value.stats?.stop_reason === "length" ? { status: { type: "incomplete", reason: "length" as const } } : {}),
              metadata: {
                custom: {
                  source: event.value.source,
                  // 4.3, "offer, never block" (SAFETY-NOTICE-01): the crisis
                  // resources ride on the reply's own metadata and are drawn
                  // beside it by the message footer, never in place of it.
                  ...(event.value.crisis_support ? { crisisSupport: event.value.crisis_support } : {}),
                  pluginId: event.value.plugin_id,
                  commandId: event.value.command_id,
                  turnId: event.value.turn_id,
                  failedGeneration: event.value.failed_generation === true,
                  failedTool,
                  conversationId,
                  documentAvailable: event.value.document_available === true,
                  media: event.value.media,
                  media_items: (event.value as TurnWithMedia).media_items,
                  stats: event.value.stats,
                  bare: event.value.bare === true,
                },
              },
            };
          } else if (event.type === "images") {
            // ANSWER-IMG-04: the hub's picture set (additive, rule 9), placed
            // at the end of the text received so far, so nothing above it
            // moves; resent on a resume, so it is idempotent.
            answerImages = { layout: event.layout, after_paragraph: event.after_paragraph, visible: event.visible, items: event.items };
            yield { content: buildContent() };
            continue;
          } else if (event.type === "reasoning") {
            // SHELL-02: rendered by the reasoning Element (thread.aui.tsx)
            // via buildContent() above - REASONING-01 left this discarded
            // client-side until a reasoning Element actually existed to
            // render it; it does now. stripThinking() below is unaffected
            // either way: it strips a `<think>` block from
            // `event.value.reply.text` itself (the stored row), not from
            // anything reconstructed out of these delta/reasoning events.
            if (event.sequence !== undefined) {
              if (event.sequence <= lastAcknowledgedSequence) continue;
              lastAcknowledgedSequence = event.sequence;
            }
            if (awaitingResume) {
              awaitingResume = false;
              deps.onConnection?.({ phase: "resumed", resumedTokens: resumedDeltaCount });
            }
            deps.onReplyState?.("responding");
            reasoningText += event.text;
            if (activityShown) {
              activityShown = false;
              yield { metadata: { custom: {} } };
            }
            yield { content: buildContent() };
            continue;
          } else {
            sawTerminalEvent = true;
            deps.onConnection?.({ phase: "online" });
            // SAFETY-01 (#85), SAFETY-NOTICE-01: a streamed refusal's crisis
            // resources ride on the error event and reach the reply's error
            // slot with it (chatErrorSlot.tsx draws one support notice).
            if (event.crisis_support) crisisSupport = event.crisis_support;
            // CHAT-CALM-ERRORS-01c: the admin-only detail the hub sent with
            // this error (it never reaches anyone else's stream) is kept in
            // the message metadata, so the details control reads it before a
            // reload and in a temporary chat, where nothing is stored.
            if (event.detail) yield { metadata: { custom: { turnId: resumeTurnId, failureDetail: event.detail } } };
            // Pass event.code through (e.g., "safety_refused" from backend)
            // so error handling can distinguish coded errors from generic ones.
            throw new ApiError(event.error, 503, event.code || "unavailable");
          }
          }
          if (sawTerminalEvent || abortSignal.aborted) break;
          if (!resumeToken || !resumeTurnId || reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            // A code review (2026-09-04) found that a connection dropped
            // abnormally (a proxy cutoff, a crash) between deltas and a real
            // "done"/"error" event left this loop ending silently. When the
            // server supplied a live resume token, retry the same turn; a
            // legacy or malformed response still gets the old clear error.
            deps.onConnection?.({ phase: "dropped" });
            throw new ApiError("The connection ended before MaiPai finished replying.", 0, "unavailable");
          }
          deps.onConnection?.({ phase: "reconnecting", attempt: reconnectAttempts + 1 });
          reconnectAttempts++;
          awaitingResume = true;
          resumedDeltaCount = 0;
        }
      } catch (e) {
        if (abortSignal.aborted) {
          deps.onReplyState?.("idle");
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
          deps.onSpeakingChange?.(false); // stop() never fires onEnded itself
          throw new DOMException("The run was stopped.", "AbortError");
        }
        deps.onReplyState?.("error");
        scheduler.finish(); // a genuine failure, not a user stop - let whatever already started speaking finish naturally, enqueue nothing more
        // Show the generic banner for generic "unavailable" code; pass backend's
        // message for specific codes (e.g., "safety_refused" from the safety layer).
        //
        // Issue #163's own new refusal: turning Incognito on mid-chat
        // (the header toggle, not New Thread) still sends the existing,
        // already-durable conversation id, which the backend now
        // refuses outright rather than silently ignoring the flag - a
        // real gap a code review found live, since nothing here forces
        // a fresh thread when the toggle flips. Until that's fixed
        // properly (filed as a follow-up), this at least tells the
        // person what to do instead of surfacing the backend's raw,
        // id-bearing error string.
        const message =
          e instanceof ApiError && e.code === "unavailable"
            ? failureLine("unreachable", false)
            : e instanceof ApiError && e.code === "temporary_mismatch"
              ? "Incognito can't turn on partway through a chat. Start a new chat to go incognito."
            : e instanceof ApiError
              ? e.message
              : "Could not reach the hub. Try again.";
        const code = e instanceof ApiError ? e.code ?? "unavailable" : "client_unreachable";
        throw new ChatTurnError(message, code, resumeTurnId, code === "safety_refused" ? crisisSupport : undefined);
      }
    },
  };
}
