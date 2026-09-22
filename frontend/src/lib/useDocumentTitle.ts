import { useEffect } from "react";

// c-99f5: the browser tab's title. Every page renders "<page> · MaiPai
// Home" (the chat page renders the open conversation's own title instead,
// so a tab opened on a past conversation names that conversation, not
// just "Chat"). Restores the previous title on unmount, so a navigation
// back to the prior page's tab title happens when the page leaves.
export function useDocumentTitle(title: string) {
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} · MaiPai Home`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
