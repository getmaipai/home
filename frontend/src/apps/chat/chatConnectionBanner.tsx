import { useCallback, useContext, useEffect } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import { ConnectionState } from "@maipai/ui/src/elements/connection-state";
import { ConnectionStateContext } from "@/apps/chat/chatThreadContexts";

/** `onRetry` is for a host with no assistant message to reload (Code, CODE-UI-03): its own retry replaces the reload. */
export function ChatConnectionBanner({ onRetry }: { onRetry?: () => void } = {}) {
  const connection = useContext(ConnectionStateContext);
  const aui = useAui();
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const lastAssistantIndex = useAuiState((state) => {
    for (let i = state.thread.messages.length - 1; i >= 0; i--) {
      if (state.thread.messages[i]?.role === "assistant") return i;
    }
    return -1;
  });
  const setConnection = connection.setConnection;
  const retry = useCallback(() => {
    if (lastAssistantIndex >= 0) void aui.thread.message({ index: lastAssistantIndex }).reload();
  }, [aui, lastAssistantIndex]);

  useEffect(() => {
    if (connection.phase !== "resumed") return;
    const timer = window.setTimeout(() => setConnection?.({ phase: "online" }), 4000);
    return () => window.clearTimeout(timer);
  }, [connection.phase, setConnection]);

  useEffect(() => {
    const update = () => {
      if (isRunning) return;
      setConnection?.({ phase: navigator.onLine ? "online" : "dropped" });
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, [isRunning, setConnection]);

  return <ConnectionState className="pointer-events-auto" phase={connection.phase} attempt={connection.attempt} resumedTokens={connection.resumedTokens} onRetry={onRetry ?? retry} />;
}
