import { useCallback, useEffect, useRef, useState } from "react";
import { Page } from "@/kit/primitives/Page";
import { MessageThread, type ThreadMessage } from "@/kit/primitives/MessageThread";
import { Form } from "@/kit/primitives/Form";
import { Progress } from "@/kit/primitives/Progress";
import { Button } from "@/kit/components/Button";
import { api, ApiError, type Roster } from "@/lib/api";
import { rowsToMessages } from "@/apps/chat/mapRows";
import { StreamingWavPlayer } from "@/lib/streamingWavPlayer";

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
  const [sending, setSending] = useState(false);
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

  useEffect(() => {
    return () => {
      playerRef.current?.stop();
    };
  }, []);

  async function handlePlay(message: ThreadMessage) {
    const requestId = ++playRequestIdRef.current;
    playerRef.current?.stop();
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
      const response = await api.streamSpeech(message.text);
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

  async function handleSend(values: Record<string, string>) {
    const text = values.message;
    if (!text) return;
    setBanner(null);
    const pendingId = `pending-${crypto.randomUUID()}`;
    setMessages((prev) => [
      ...(prev ?? []),
      { id: pendingId, sender: person.display_name, text, isSelf: true },
    ]);
    setSending(true);
    try {
      const value = await api.sendTurn(text, thinking);
      setMessages((prev) => [
        ...(prev ?? []),
        { id: `${pendingId}-reply`, sender: "MaiPai", text: stripThinking(value.reply.text), isSelf: false },
      ]);
      // 4.3: "offer, never block" - shown alongside the reply, never in
      // place of it, and never suppressing anything else in the thread.
      if (value.crisis_resources) setBanner(value.crisis_resources);
    } catch (e) {
      // A code review (2026-09-04) found the earlier version left the
      // optimistic bubble above looking sent even when it never reached
      // the backend, so a reload silently dropped it with no explanation.
      // Mark that exact message failed instead of only banner-ing below.
      setMessages((prev) => (prev ?? []).map((m) => (m.id === pendingId ? { ...m, failed: true } : m)));
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
      {sending ? (
        <div className="px-4 pb-1">
          <Progress mode="spinner" label="MaiPai is thinking…" />
        </div>
      ) : null}
      {banner ? (
        <div className="mx-4 mb-2 rounded-[var(--radius)] bg-[hsl(var(--muted))] px-3 py-2 text-sm">{banner}</div>
      ) : null}
      <div className="flex items-center justify-end px-4 pb-1">
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
