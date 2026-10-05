import type { AssistantClient } from "@assistant-ui/react";
import { CHAT_COMMAND_SHORTCUTS } from "@/apps/chat/chatCommands";

export const CHAT_SHORTCUTS = CHAT_COMMAND_SHORTCUTS.map(({ name, shortcut }) => [name, shortcut] as const);

export function registerChatShortcuts({
  aui,
  isRunning,
  unavailable,
  setReferenceOpen,
}: {
  aui: AssistantClient;
  isRunning: boolean;
  unavailable: boolean;
  setReferenceOpen: (open: boolean) => void;
}): () => void {
  function onKeyDown(event: KeyboardEvent) {
    const key = event.key.toLowerCase();
    const matches = (id: string) => {
      const shortcut = CHAT_COMMAND_SHORTCUTS.find((command) => command.id === id)?.shortcut;
      if (!shortcut) return false;
      const needsCommand = shortcut.includes("⌘/Ctrl+");
      const needsShift = shortcut.includes("⇧");
      const expectedKey = shortcut === "Esc" || shortcut.endsWith("Esc")
        ? "escape"
        : shortcut.slice(-1).toLowerCase();
      return (event.metaKey || event.ctrlKey) === needsCommand
        && event.shiftKey === needsShift
        && key === expectedKey;
    };
    if ((event.metaKey || event.ctrlKey) && key === "/") {
      event.preventDefault();
      setReferenceOpen(true);
    } else if (matches("new-chat")) {
      event.preventDefault();
      if (!unavailable) void aui.threads.switchToNewThread();
    } else if (matches("focus-composer")) {
      event.preventDefault();
      document.querySelector<HTMLElement>('[aria-label="Message input"]')?.focus();
    } else if (matches("stop-reply") && isRunning) {
      event.preventDefault();
      aui.thread.cancelRun();
    } else if (matches("toggle-sidebar")) {
      event.preventDefault();
      document.querySelector<HTMLButtonElement>('[aria-label="Show conversations"], [aria-label="Hide conversations"], [aria-label="Show threads"], [aria-label="Hide threads"]')?.click();
    }
  }
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}
