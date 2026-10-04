import { useEffect, useState } from "react";
import { api } from "@/lib/api";

/** Chats whose title or message text match `search`, by the hub's own index (conversation_turns_fts),
 * which the kit's title-only filter cannot see. Waits for typing to settle; `null` means no search
 * running or the lookup failed, and the list falls back to matching titles alone. */
export function useChatContentMatches(search: string, settleMs = 250): ReadonlySet<string> | null {
  const [matches, setMatches] = useState<ReadonlySet<string> | null>(null);
  const query = search.trim();
  useEffect(() => {
    if (!query) {
      setMatches(null);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      api.conversationList(undefined, query, "include").then(
        (rows) => { if (current) setMatches(new Set(rows.map((row) => row.id))); },
        () => { if (current) setMatches(null); },
      );
    }, settleMs);
    return () => { current = false; clearTimeout(timer); };
  }, [query, settleMs]);
  return matches;
}
