// CODE-UI-03: the small pieces Code takes from Chat instead of drawing its own: the draft offer (Chat's draft store and hook), the connection banner (Chat's, with
// its own state), the server-error line and the poll delay. Nothing here restyles a kit part.
import { i18n } from "@lingui/core";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { ApiError } from "@/lib/api";
import { errorLine } from "@/lib/hubReachability";
import { ChatConnectionBanner } from "@/apps/chat/chatConnectionBanner";
import { ConnectionStateContext, DraftConversationContext, type ConnectionState } from "@/apps/chat/chatThreadContexts";

/** The line for a failed Code request: the hub's own words, except a refusal (403), which names what to do. */
export function codeErrorLine(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.status === 403) return i18n._({ id: "Coding is not turned on for you. Ask a household admin to turn Coding on for you in Settings, then open Code again.", message: "Coding is not turned on for you. Ask a household admin to turn Coding on for you in Settings, then open Code again." });
  return errorLine(error, fallback);
}

/** How long to wait before asking for a list again: 5 s while the tab is in view, a minute when it is hidden, and doubling (up to a minute) after each failure. */
export function pollDelay({ hidden, failures }: { hidden: boolean; failures: number }, base = 5000): number {
  if (hidden) return 60_000;
  return Math.min(60_000, base * 2 ** Math.max(0, failures));
}

/** Gives the subtree Chat's draft key and Chat's connection state, and draws Chat's connection banner above it. */
export function CodeComposerContexts({ draftId, onRetry, children }: { draftId: string; onRetry?: () => void; children: ReactNode }) {
  const [state, setState] = useState<ConnectionState>({ phase: "online" });
  const setConnection = useCallback((next: ConnectionState) => setState((current) => (current.phase === next.phase && current.attempt === next.attempt ? current : next)), []);
  const value = useMemo(() => ({ ...state, setConnection }), [state, setConnection]);
  return <DraftConversationContext.Provider value={draftId}>
    <ConnectionStateContext.Provider value={value}>
      <div className="flex justify-center"><ChatConnectionBanner {...(onRetry ? { onRetry } : {})} /></div>
      {children}
    </ConnectionStateContext.Provider>
  </DraftConversationContext.Provider>;
}
