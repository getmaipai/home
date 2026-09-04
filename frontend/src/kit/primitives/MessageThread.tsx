import { useEffect, useRef, useState } from "react";
import { EmptyState } from "@/kit/primitives/EmptyState";
import { Avatar } from "@/kit/components/Avatar";
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
}

const SCROLL_FOLLOW_THRESHOLD_PX = 48;

// spec/ui/pages/chat.json's message_thread: "a scrolling list of turns,
// newest last." The one real hard-won technique carried over from the
// legacy hub's frontend (home/docs/dev.md, principle 8: MessageList.tsx)
// rather than reused code: follow new messages to the bottom only while
// the person hasn't scrolled up to read something earlier, so a reply
// arriving mid-scrollback doesn't yank them back down.
export function MessageThread({ messages, emptyState }: MessageThreadProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);

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
          </div>
        </div>
      ))}
    </div>
  );
}
