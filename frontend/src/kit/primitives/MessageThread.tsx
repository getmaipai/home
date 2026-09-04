import { useEffect, useRef, useState } from "react";
import { EmptyState } from "@/kit/primitives/EmptyState";
import { Avatar } from "@/kit/components/Avatar";
import { getIcon } from "@/kit/icons";
import { cn } from "@/kit/utils";

export interface ThreadMessage {
  id: string;
  sender: string;
  text: string;
  isSelf?: boolean;
  /** True when this was optimistically added and the send it represents
   * failed: a code review (2026-09-04) found the earlier version left a
   * failed send looking identical to a successful one, so a reload
   * silently dropped it with nothing telling the person it never sent. */
  failed?: boolean;
}

interface MessageThreadProps {
  messages: ThreadMessage[];
  emptyState?: { icon: string; text: string };
  /** Optional per-message "listen" action, Chat's real caller today
   * (ChatPage.tsx, the tts role - 2026-09-04). Undefined leaves every
   * other consumer of this shared primitive unchanged: no button renders
   * at all unless a caller opts in. `loadingId` is the message currently
   * fetching audio; `playingId` is the one actively playing - kept
   * separate from `loadingId` so the button doesn't keep showing
   * "Loading…" once audio is already sounding; `errorId` marks the one
   * whose most recent attempt failed. */
  onPlay?: (message: ThreadMessage) => void;
  loadingId?: string | null;
  playingId?: string | null;
  errorId?: string | null;
}

const SCROLL_FOLLOW_THRESHOLD_PX = 48;

// spec/ui/pages/chat.json's message_thread: "a scrolling list of turns,
// newest last." The one real hard-won technique carried over from the
// legacy hub's frontend (home/docs/dev.md, principle 8: MessageList.tsx)
// rather than reused code: follow new messages to the bottom only while
// the person hasn't scrolled up to read something earlier, so a reply
// arriving mid-scrollback doesn't yank them back down.
export function MessageThread({ messages, emptyState, onPlay, loadingId, playingId, errorId }: MessageThreadProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);
  const VolumeIcon = getIcon("volume-2");
  const LoaderIcon = getIcon("loader");

  useEffect(() => {
    const el = containerRef.current;
    if (el && stickToBottom) el.scrollTop = el.scrollHeight;
  }, [messages, stickToBottom]);

  function onScroll() {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setStickToBottom(distanceFromBottom < SCROLL_FOLLOW_THRESHOLD_PX);
  }

  if (messages.length === 0 && emptyState) {
    return <EmptyState icon={emptyState.icon} text={emptyState.text} />;
  }

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"
    >
      {messages.map((m) => (
        <div
          key={m.id}
          className={cn("flex items-end gap-2", m.isSelf ? "flex-row-reverse self-end" : "self-start")}
        >
          <Avatar name={m.sender} className="h-8 w-8 text-sm" />
          <div className={cn("flex flex-col gap-1", m.isSelf ? "items-end" : "items-start")}>
            <div
              className={cn(
                "max-w-[75%] whitespace-pre-wrap rounded-[var(--radius)] px-4 py-2 text-base",
                m.failed
                  ? "border border-[hsl(var(--destructive))] bg-[hsl(var(--muted))] text-[hsl(var(--foreground))] opacity-70"
                  : m.isSelf
                    ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                    : "bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]",
              )}
            >
              {m.text}
            </div>
            {m.failed ? (
              <span className="text-xs text-[hsl(var(--destructive))]">Not sent. Try again.</span>
            ) : null}
            {onPlay && !m.isSelf ? (
              <button
                type="button"
                onClick={() => onPlay(m)}
                disabled={loadingId === m.id || playingId === m.id}
                aria-label={loadingId === m.id ? "Loading" : playingId === m.id ? "Playing" : "Listen"}
                className="flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] disabled:opacity-60"
              >
                {loadingId === m.id ? (
                  <LoaderIcon className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <VolumeIcon className="h-3.5 w-3.5" aria-hidden />
                )}
                {errorId === m.id
                  ? "Couldn't play. Try again."
                  : loadingId === m.id
                    ? "Loading…"
                    : playingId === m.id
                      ? "Playing…"
                      : "Listen"}
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
