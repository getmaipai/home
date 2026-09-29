import type { AssistantClient } from "@assistant-ui/react";

export const CHAT_SHORTCUTS = [
  ["New chat", "⌘/Ctrl+⇧O"],
  ["Focus composer", "⇧Esc"],
  ["Stop reply", "Esc"],
  ["Search", "⌘/Ctrl+K"],
  ["Toggle sidebar", "⌘/Ctrl+B"],
] as const;

export function registerChatShortcuts({
  aui,
  isRunning,
  setReferenceOpen,
}: {
  aui: AssistantClient;
  isRunning: boolean;
  setReferenceOpen: (open: boolean) => void;
}): () => void {
  function onKeyDown(event: KeyboardEvent) {
    const key = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && key === "/") {
      event.preventDefault();
      setReferenceOpen(true);
    } else if ((event.metaKey || event.ctrlKey) && event.shiftKey && key === "o") {
      event.preventDefault();
      void aui.threads.switchToNewThread();
    } else if (!event.metaKey && !event.ctrlKey && event.shiftKey && key === "escape") {
      event.preventDefault();
      document.querySelector<HTMLElement>('[aria-label="Message input"]')?.focus();
    } else if (!event.metaKey && !event.ctrlKey && !event.shiftKey && key === "escape" && isRunning) {
      event.preventDefault();
      aui.thread.cancelRun();
    }
  }
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}
