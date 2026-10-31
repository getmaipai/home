import { useCallback, useEffect, useRef, useState } from "react";

/** How long a conversation id the page wrote to the address is still expected to come back as a URL change. */
const ECHO_WINDOW_MS = 3000;

/**
 * Issue #165: the id handed to assistant-ui as its controlled `threadId`.
 *
 * It used to be read straight from the address bar. The page writes the address from `onThreadIdChange`, and the
 * router commits that write a moment later, so for a short window the prop still named the previous conversation.
 * A New thread click inside that window started `switchToNewThread()`, and then the late commit changed the prop
 * to the first conversation's id, which made the runtime switch back to it: the second message went into the
 * first conversation (one POST /api/conversations, and an Incognito chat folded into an earlier one).
 *
 * Here the runtime-driven id is applied at once (`adopt`), and the address changes that come back from our own
 * writes are recognised and ignored. Only an address change nobody here wrote (a link, the back button) is adopted.
 */
export function useControlledConversationId(urlValue: string | undefined): { threadId: string | undefined; adopt: (id: string | undefined) => void } {
  const [threadId, setThreadId] = useState<string | undefined>(urlValue);
  const echoes = useRef<Array<{ id: string | undefined; at: number }>>([]);
  const adopt = useCallback((id: string | undefined) => {
    echoes.current.push({ id, at: Date.now() });
    setThreadId(id);
  }, []);
  useEffect(() => {
    const now = Date.now();
    const live = echoes.current.filter((echo) => now - echo.at <= ECHO_WINDOW_MS);
    const at = live.findIndex((echo) => echo.id === urlValue);
    if (at >= 0) {
      echoes.current = live.slice(at + 1);
      return;
    }
    echoes.current = [];
    setThreadId(urlValue);
  }, [urlValue]);
  return { threadId, adopt };
}
