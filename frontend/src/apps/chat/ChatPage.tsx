import { useCallback, useEffect, useRef, useState } from "react";
import { Page } from "@/kit/primitives/Page";
import { MessageThread, type ThreadMessage } from "@/kit/primitives/MessageThread";
import { Form } from "@/kit/primitives/Form";
import { Progress } from "@/kit/primitives/Progress";
import { Button } from "@/kit/components/Button";
import { api, readTurnStream, ApiError, type Roster } from "@/lib/api";
import { rowsToMessages } from "@/apps/chat/mapRows";
import { StreamingWavPlayer } from "@/lib/streamingWavPlayer";
import { SentenceSpeechScheduler } from "@/lib/sentenceSpeechScheduler";
import { splitReadyChunks } from "@/lib/sentenceChunker";
import { WakeWordToggle } from "@/apps/chat/WakeWordToggle";
import { normalizeForSpeech } from "@maipai/spec/voice/ts/normalizeForSpeech.js";

interface ChatPageProps {
  person: Roster;
}

// The real Chat page (spec/ui/pages/chat.json), hand-built against the
// kit primitives rather than executed by a generic UiNode interpreter
// (none exists yet, home/docs/dev.md documents that as a deferred slice).
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

export function ChatPage({ person }: ChatPageProps) {
  const [messages, setMessages] = useState<ThreadMessage[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  // Stays true for the ENTIRE turn (send through its final done/error
  // event), gating the Send button - a code review (2026-09-04) found an
  // earlier version cleared this as soon as the first token arrived
  // (often a fraction of a second in), which re-enabled Send while the
  // first reply was still streaming and speaking. A second handleSend
  // call starting mid-stream shares component state with the first
  // (setBanner, setThinking) with no way to tell whose update is whose -
  // one call's error banner could be silently wiped by the other's
  // `setBanner(null)`. `awaitingFirstToken` is the separate, narrower
  // flag for "hide the thinking spinner once real content starts
  // arriving" - it never gates whether another send can start.
  const [sending, setSending] = useState(false);
  const [awaitingFirstToken, setAwaitingFirstToken] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  // Off by default (Jesse, 2026-09-04: "thinking mode off by default with
  // the ability to enable in chats when needed"): a per-message opt-in,
  // not a standing setting, since most turns don't need the extra latency.
  const [thinking, setThinking] = useState(false);
  // The tts role (spec/voice/, 2026-09-04): "I don't think chat works
  // with voice on the web for me to test" - a manual "Listen" button per
  // reply, not autoplay (Jesse, same session, after trying an
  // auto-playing version: "again, I dont want auto play").
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  const playerRef = useRef<StreamingWavPlayer | null>(null);
  // Guards every state update below against a superseded call: a second
  // "Listen" click before the first finishes calls playerRef.current's
  // stop() immediately (cutting the old chunks off in real time, the
  // point of per-chunk scheduling - streamingWavPlayer.ts), but that
  // stop() doesn't synchronously unwind the first call's own async
  // fetch/read loop, which could otherwise still land a stale state
  // update after the second click has already taken over. The same class
  // of live-verified bug (2026-09-04) an earlier <audio>-element version
  // of this feature hit from a different angle (a stale rejected
  // audio.play() promise), now guarded against directly rather than
  // relying on stop() alone.
  const playRequestIdRef = useRef(0);
  // The live, currently-streaming reply's own speech (below): a separate
  // player from playerRef's single-shot "Listen" replay, since a fresh
  // reply speaks sentence by sentence as it arrives while any earlier
  // message's "Listen" button still replays the old, single-utterance
  // way. Never let two overlap: starting either one stops the other.
  const turnSchedulerRef = useRef<SentenceSpeechScheduler | null>(null);

  useEffect(() => {
    return () => {
      playerRef.current?.stop();
      turnSchedulerRef.current?.stop();
    };
  }, []);

  async function handlePlay(message: ThreadMessage) {
    const requestId = ++playRequestIdRef.current;
    playerRef.current?.stop();
    turnSchedulerRef.current?.stop();
    setPlayError(null);
    setLoadingId(message.id);
    // Unconditionally, not left for the new player's own onFirstAudio/
    // onEnded to overwrite: a code review (2026-09-04) found that if the
    // PREVIOUS message's onEnded never got a chance to fire before being
    // superseded (e.g. this new reply's audio has zero playable frames,
    // so its own onFirstAudio never runs and its onEnded fires without
    // matching `current === message.id`), the old message stayed stuck
    // showing "Playing…", disabled, for the rest of the session. Only
    // one thing can ever be loading or playing at a time (one shared
    // playerRef), so resetting here is always correct, not just a
    // narrow patch for this one edge case.
    setPlayingId(null);

    // Created synchronously, before the network fetch below: an
    // AudioContext only counts as unlocked by this click's real user
    // gesture if it exists before the call stack returns, not after an
    // awaited fetch (streamingWavPlayer.ts's own constructor comment;
    // flagged by a code review, 2026-09-04, against the previous
    // <audio>-element version, which created its element only after the
    // fetch resolved).
    const player = new StreamingWavPlayer();
    playerRef.current = player;
    player.onFirstAudio = () => {
      if (requestId !== playRequestIdRef.current) return;
      setLoadingId(null);
      setPlayingId(message.id);
    };
    player.onEnded = () => {
      if (requestId !== playRequestIdRef.current) return;
      // Also loadingId, not just playingId: a code review (2026-09-04)
      // found that a reply whose synthesized audio has zero playable
      // frames never calls onFirstAudio at all (StreamingWavPlayer.
      // finish() fires onEnded directly in that case), so loadingId was
      // left set to this message forever - the button stuck on
      // "Loading…", disabled, with no way to retry short of a reload.
      setLoadingId((current) => (current === message.id ? null : current));
      setPlayingId((current) => (current === message.id ? null : current));
    };

    try {
      // The message's own DISPLAYED text stays exactly as shown - only
      // what's sent to TTS is normalized (numbers, times, dates read the
      // way a person says them; Jesse, 2026-09-04: "if you have the voice
      // say ten O four, you still display 10:04"). Backend replies
      // already carry a normalized `reply.speech` (turnEngine.ts's
      // finalizeReply()), but a past message loaded from history
      // (mapRows.ts) only ever has `.text` - `conversation_turns` never
      // persisted a `replySpeech` column, so there is nothing stored to
      // read back here. A known, accepted gap this recomputation doesn't
      // close: a package's genuine speech OVERRIDE (never touched by
      // normalizeForSpeech at all, per finalizeReply()) is lost on replay
      // of a past message, recomputed generically instead - currently
      // latent, since no shipped package (`recall`/`remember`) writes a
      // real override yet. Adding a `replySpeech` column to persist it
      // exactly is the real fix if that ever changes; not worth the
      // schema migration for a case nothing produces today.
      const response = await api.streamSpeech(normalizeForSpeech(message.text));
      if (requestId !== playRequestIdRef.current) {
        player.stop();
        return;
      }
      const reader = response.body!.getReader();
      // Streams chunks straight into the player as they arrive, rather
      // than waiting for the whole reply - the entire point (2026-09-04,
      // Jesse: "make sure you are streaming responses as you get [them]
      // instead of generating the entire wav and then just playing
      // that").
      while (true) {
        const { done, value } = await reader.read();
        if (requestId !== playRequestIdRef.current) {
          player.stop();
          return;
        }
        if (done) break;
        if (value) player.addChunk(value);
      }
      player.finish();
    } catch {
      if (requestId !== playRequestIdRef.current) return;
      setPlayError(message.id);
      setLoadingId(null);
      setPlayingId(null);
      player.stop();
    }
  }

  const loadHistory = useCallback(() => {
    setLoadError(false);
    api
      .conversations()
      .then((rows) => setMessages(rowsToMessages(rows, person.display_name)))
      .catch(() => {
        // A code review (2026-09-04) found this used to render the same
        // "Nothing here yet" empty state on a real load failure as on a
        // genuinely new household, with no way to tell the two apart or
        // retry. Keep `messages` as whatever it was (null on first load,
        // the last good list on a background refresh) and show a real
        // error state instead of pretending the history is empty.
        setLoadError(true);
      });
  }, [person.display_name]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Real end-to-end streaming (2026-09-04): the reply's TEXT arrives
  // token by token from POST /api/turn/stream, and each completed
  // sentence is spoken (SentenceSpeechScheduler) the moment it's ready,
  // not after the whole reply finishes generating - the actual thing
  // Jesse asked for ("check our old project - we didnt do autoplay - we
  // streamed"), ported in spirit from home-legacy.git's
  // useCompanionVoice.ts. No manual "Listen" click needed for a fresh
  // reply; that button (handlePlay, above) still exists for replaying an
  // earlier one.
  async function handleSend(values: Record<string, string>) {
    const text = values.message;
    if (!text) return;
    setBanner(null);
    const pendingId = `pending-${crypto.randomUUID()}`;
    const replyId = `${pendingId}-reply`;
    setMessages((prev) => [
      ...(prev ?? []),
      { id: pendingId, sender: person.display_name, text, isSelf: true },
      { id: replyId, sender: "MaiPai", text: "", isSelf: false },
    ]);
    setSending(true);
    setAwaitingFirstToken(true);

    // Stop whatever the manual "Listen" button or an earlier live reply
    // was still speaking - never two voices at once. Created
    // synchronously, before any await: an AudioContext only counts as
    // unlocked by THIS click's real user gesture if it exists before the
    // call stack returns (streamingWavPlayer.ts's own constructor
    // comment; the exact risk a code review flagged in an earlier,
    // <audio>-element version of this feature).
    playerRef.current?.stop();
    turnSchedulerRef.current?.stop();
    const scheduler = new SentenceSpeechScheduler();
    turnSchedulerRef.current = scheduler;

    // `raw` is every byte received so far, unstripped. `visible` is the
    // real, displayable/speakable answer built up incrementally with
    // every <think>...</think> block (llm.ts's `thinking` option)
    // resolved out of it as soon as each one closes - nothing inside an
    // open block is ever shown or spoken, streaming raw reasoning into
    // the thread word by word being exactly the dump stripThinking()
    // (below) was built to prevent, just done incrementally instead of
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
    let gotAnyEvent = false;
    let sawTerminalEvent = false;

    function setVisibleText(text: string) {
      setMessages((prev) => (prev ?? []).map((m) => (m.id === replyId ? { ...m, text } : m)));
      return text;
    }

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
      const response = await api.streamTurn(text, thinking);
      for await (const event of readTurnStream(response)) {
        // Not on a "spoken_cue": a code review (2026-09-05) found this
        // used to clear the spinner on ANY first event, so exactly in
        // the slow-first-token case the cue exists for, the spinner
        // disappeared while the bubble was still empty (spoken_cue never
        // touches `visible`) - dead air on screen while the cue plays out
        // loud. The growing bubble is the real "something is happening"
        // signal; only a "delta" (or "done", for an immediate reply with
        // no deltas at all) counts as that.
        if (!gotAnyEvent && event.type !== "spoken_cue") {
          gotAnyEvent = true;
          setAwaitingFirstToken(false);
        }
        if (event.type === "delta") {
          raw += event.text;
          resolveRaw();
          setVisibleText(visible);
          const pending = visible.slice(spokenLength);
          const { chunks, consumed } = splitReadyChunks(pending, spokenLength === 0);
          // Each chunk speaks its normalized form, never the displayed
          // one: `visible` (set just above) keeps the model's own written
          // text - the chat bubble - completely untouched.
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
          const finalText = setVisibleText(stripThinking(event.value.reply.text));
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
            scheduler.enqueueSentence(spokenLength === 0 ? (event.value.reply.speech ?? normalizeForSpeech(trailing)) : normalizeForSpeech(trailing));
          }
          scheduler.finish();
          // 4.3: "offer, never block" - shown alongside the reply, never
          // in place of it, and never suppressing anything else in the
          // thread.
          if (event.value.crisis_resources) setBanner(event.value.crisis_resources);
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
      if (!sawTerminalEvent) {
        // A code review (2026-09-04) found that a connection dropped
        // abnormally (a proxy cutoff, a crash) between deltas and a real
        // "done"/"error" event left this loop ending silently: no
        // exception, so the catch below never ran, and the reply bubble
        // just stopped growing with no banner and no way to tell it
        // failed rather than finished.
        throw new ApiError("The connection ended before MaiPai finished replying.", 0, "unavailable");
      }
    } catch (e) {
      // A code review (2026-09-04) found an earlier version of this
      // catch left the optimistic user bubble looking sent even when it
      // never reached the backend, so a reload silently dropped it with
      // no explanation. Mark that exact message failed instead of only
      // banner-ing below.
      setMessages((prev) =>
        (prev ?? [])
          .map((m) => (m.id === pendingId ? { ...m, failed: true } : m))
          // An empty reply bubble (the error landed before any delta
          // ever arrived) would otherwise sit in the thread forever
          // looking broken; a partial reply that DID get some real text
          // stays, same as any other real (if short) answer.
          .filter((m) => !(m.id === replyId && m.text.length === 0)),
      );
      scheduler.finish(); // let whatever already started speaking finish naturally, enqueue nothing more
      // turnEngine.ts's "unavailable" code covers every real down-state
      // (still downloading, crashed, never selected): one friendly,
      // actionable message rather than the developer-facing reason string
      // (e.g. "llama-server did not become healthy within 60000ms")
      // leaking straight into the household's chat thread.
      setBanner(
        e instanceof ApiError && e.code === "unavailable"
          ? "MaiPai's AI isn't answering right now. If you just picked a new AI model it may still be getting ready - check Household → AI models, then try again."
          : e instanceof ApiError
            ? e.message
            : "Could not reach the hub. Try again.",
      );
    } finally {
      setSending(false);
      // A code review (2026-09-04) found this never reset
      // `awaitingFirstToken`: it's only ever cleared once a stream event
      // arrives (above), so a failure before any event - the fetch itself
      // rejecting, e.g. a network error - left the "MaiPai is thinking..."
      // spinner showing forever even though the error banner correctly
      // appeared right next to it.
      setAwaitingFirstToken(false);
      // Back to off after every send: a per-message opt-in, not a mode a
      // household member could forget is still on and pay the latency for
      // every later reply.
      setThinking(false);
    }
  }

  return (
    <Page title="Chat">
      {messages === null && loadError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-base text-[hsl(var(--destructive))]">
            Could not load your conversation. The hub might be unreachable.
          </p>
          <Button variant="secondary" size="sm" onClick={loadHistory}>
            Try again
          </Button>
        </div>
      ) : messages === null ? (
        <div className="flex flex-1 items-center justify-center">
          <Progress mode="spinner" label="Loading conversation" />
        </div>
      ) : (
        <MessageThread
          messages={messages}
          emptyState={{ icon: "message-circle", text: "Nothing here yet. Say hello." }}
          onPlay={handlePlay}
          loadingId={loadingId}
          playingId={playingId}
          errorId={playError}
        />
      )}
      {awaitingFirstToken ? (
        <div className="px-4 pb-1">
          <Progress mode="spinner" label="MaiPai is thinking…" />
        </div>
      ) : null}
      {banner ? (
        <div className="mx-4 mb-2 rounded-[var(--radius)] bg-[hsl(var(--muted))] px-3 py-2 text-sm">{banner}</div>
      ) : null}
      <div className="flex items-center justify-end gap-2 px-4 pb-1">
        {/* Phase 1 of the wake-word plan (docs/dev.md, 2026-09-04):
            "infrastructure proof, no custom model yet" - fires on
            openWakeWord's stock "hey jarvis" phrase, not a MaiPai-trained
            one. No auto-send/auto-listen wiring yet: STT doesn't exist
            anywhere in this codebase, so a real detection only shows a
            banner proving the mechanism, the same honest "real, narrow
            slice, not the full feature" posture the tts role's own first
            pass took. */}
        <WakeWordToggle
          onWakeDetected={(event) =>
            setBanner(`Wake word heard: "${event.modelId}" (demo only - MaiPai isn't listening for real commands yet)`)
          }
        />
        <button
          type="button"
          onClick={() => setThinking((v) => !v)}
          aria-pressed={thinking}
          className={`rounded-full px-3 py-1 text-sm transition-colors ${
            thinking
              ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
              : "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"
          }`}
        >
          {thinking ? "Thinking on for next message" : "Think longer"}
        </button>
      </div>
      <Form
        fields={[{ name: "message", selector: "text", placeholder: "Message" }]}
        submitIcon="send"
        submitLabel="Send"
        disabled={sending}
        onSubmit={handleSend}
      />
    </Page>
  );
}
