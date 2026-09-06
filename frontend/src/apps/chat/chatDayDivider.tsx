import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useAuiState, type ThreadMessage } from "@assistant-ui/react";

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dayLabel(date: Date): string {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, now)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

// Nothing in the generated thread.aui.tsx has day dividers or per-message
// timestamps (docs/plans/session-b-ui.md step 4), since assistant-ui's own
// ThreadMessage callback receives just the one message (no index, no
// neighbor) - "is this the first message of a new day" needs the previous
// message, which only a thread-level scan of `s.thread.messages` has.
//
// Computed ONCE per messages-array change (DayBoundaryProvider, mounted
// once in thread.aui.tsx's ThreadRoot) rather than per message component:
// a code review (2026-09-05) found the original version ran its own
// `messages.findIndex()` scan inside EVERY message's own component
// instance - O(n) work times N mounted messages, so O(n^2) per render
// pass, and thread.aui.tsx has no virtualization to bound N (only a CSS
// content-visibility hint, which skips paint, not this JS). A context
// lookup is O(1) per message instead.
const DayBoundaryContext = createContext<ReadonlySet<string> | null>(null);

function firstOfDayIds(messages: readonly ThreadMessage[]): ReadonlySet<string> {
  const ids = new Set<string>();
  let previous: ThreadMessage | undefined;
  for (const message of messages) {
    if (!previous || !sameDay(previous.createdAt, message.createdAt)) ids.add(message.id);
    previous = message;
  }
  return ids;
}

export function DayBoundaryProvider({ children }: { children: ReactNode }) {
  const messages = useAuiState((s) => s.thread.messages);
  const ids = useMemo(() => firstOfDayIds(messages), [messages]);
  return <DayBoundaryContext.Provider value={ids}>{children}</DayBoundaryContext.Provider>;
}

function useIsFirstOfDay(): boolean {
  const id = useAuiState((s) => s.message.id);
  const ids = useContext(DayBoundaryContext);
  // No provider mounted (e.g. a test rendering DayDivider/MessageTimestamp
  // in isolation): fail open rather than throw, since a divider that
  // shows once too often is harmless.
  return ids ? ids.has(id) : true;
}

export function DayDivider() {
  const createdAt = useAuiState((s) => s.message.createdAt);
  const isFirstOfDay = useIsFirstOfDay();

  if (!isFirstOfDay) return null;

  return (
    <div role="separator" className="my-2 flex items-center gap-2 px-2 text-base text-muted-foreground select-none">
      <div className="h-px flex-1 bg-border" />
      {dayLabel(createdAt)}
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

export function MessageTimestamp() {
  const createdAt = useAuiState((s) => s.message.createdAt);
  return (
    <time dateTime={createdAt.toISOString()} className="text-base text-muted-foreground">
      {createdAt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
    </time>
  );
}
