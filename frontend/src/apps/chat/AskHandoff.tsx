import { useEffect, useState } from "react";
import { useAui } from "@assistant-ui/react";
import { useLocation } from "react-router-dom";

/** The longest line Home may hand to the composer through the address. */
export const ASK_HANDOFF_MAX = 2_000;

/** HOME-ALIVE-01h: the words Home's ask box (or a starter) sent in `?ask=`.
 * Null when there are none. */
export function askFromSearch(search: string): string | null {
  const raw = new URLSearchParams(search).get("ask");
  const text = raw?.trim().slice(0, ASK_HANDOFF_MAX);
  return text ? text : null;
}

/** Puts Home's words in the composer, unsent and editable. It reads the
 * address once, on the first render, before ChatPage rewrites the query to
 * the open conversation, and sends nothing. */
export function AskHandoff() {
  const aui = useAui();
  const location = useLocation();
  const [ask] = useState(() => askFromSearch(location.search));
  useEffect(() => {
    if (ask === null) return;
    aui.composer().setText(ask);
  }, [aui, ask]);
  return null;
}
