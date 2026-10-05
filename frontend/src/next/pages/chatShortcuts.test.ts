import { afterEach, expect, mock, test } from "bun:test";
import type { AssistantClient } from "@assistant-ui/react";
import { CHAT_SHORTCUTS, registerChatShortcuts } from "@/next/pages/chatShortcuts";

afterEach(() => {
  document.querySelector('[aria-label="Message input"]')?.remove();
});

function key(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(event);
  return event;
}

test("Cmd+Shift+O switches the real thread runtime to a new thread", () => {
  const switchToNewThread = mock(() => Promise.resolve());
  const stopRun = mock(() => {});
  const setReferenceOpen = mock(() => {});
  const cleanup = registerChatShortcuts({
    aui: { threads: { switchToNewThread }, thread: { cancelRun: stopRun } } as unknown as AssistantClient,
    isRunning: false,
    unavailable: false,
    setReferenceOpen,
  });
  const event = key("o", { metaKey: true, shiftKey: true });
  cleanup();
  expect(event.defaultPrevented).toBe(true);
  expect(switchToNewThread).toHaveBeenCalledTimes(1);
});

test("Cmd+Shift+O does not switch threads while chat is unavailable", () => {
  const switchToNewThread = mock(() => Promise.resolve());
  const cleanup = registerChatShortcuts({
    aui: { threads: { switchToNewThread } } as unknown as AssistantClient,
    isRunning: false,
    unavailable: true,
    setReferenceOpen: () => {},
  });
  const event = key("o", { metaKey: true, shiftKey: true });
  cleanup();
  expect(event.defaultPrevented).toBe(true);
  expect(switchToNewThread).not.toHaveBeenCalled();
});

test("Shift+Esc focuses the real composer input", () => {
  const input = document.createElement("textarea");
  input.setAttribute("aria-label", "Message input");
  document.body.append(input);
  const cleanup = registerChatShortcuts({
    aui: {} as AssistantClient,
    isRunning: false,
    unavailable: false,
    setReferenceOpen: () => {},
  });
  key("Escape", { shiftKey: true });
  cleanup();
  expect(document.activeElement).toBe(input);
});

test("Esc cancels the active reply", () => {
  const cancelRun = mock(() => {});
  const cleanup = registerChatShortcuts({
    aui: { thread: { cancelRun } } as unknown as AssistantClient,
    isRunning: true,
    unavailable: false,
    setReferenceOpen: () => {},
  });
  const event = key("Escape");
  cleanup();
  expect(event.defaultPrevented).toBe(true);
  expect(cancelRun).toHaveBeenCalledTimes(1);
});

test("Cmd+/ opens the shortcut reference with all five entries", () => {
  const setReferenceOpen = mock(() => {});
  const cleanup = registerChatShortcuts({
    aui: {} as AssistantClient,
    isRunning: false,
    unavailable: false,
    setReferenceOpen,
  });
  const event = key("/", { metaKey: true });
  cleanup();
  expect(event.defaultPrevented).toBe(true);
  expect(setReferenceOpen).toHaveBeenCalledWith(true);
  expect(CHAT_SHORTCUTS).toEqual([
    ["New chat", "⌘/Ctrl+⇧O"],
    ["Focus composer", "⇧Esc"],
    ["Stop reply", "Esc"],
    ["Command palette", "⌘/Ctrl+K"],
    ["Toggle sidebar", "⌘/Ctrl+B"],
  ]);
});
