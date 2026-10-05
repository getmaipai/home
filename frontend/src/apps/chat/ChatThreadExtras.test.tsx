import { afterEach, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter, type ThreadMessageLike } from "@assistant-ui/react";
import { MemoryRouter } from "react-router-dom";
import { ChatThread } from "@/apps/chat/ChatThread";
import { CHAT_COMMAND_SHORTCUTS, buildChatCommands, type ChatCommandAction } from "@/apps/chat/chatCommands";
import { CHAT_SHORTCUTS } from "@/next/pages/chatShortcuts";
import { canHaveTemporaryChatRole, type Roster } from "@/lib/api";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";

const NOOP: ChatModelAdapter = { run: async function* () {} };

function messages(count: number, content = "ordinary message"): ThreadMessageLike[] {
  return Array.from({ length: count }, (_, index) => ({
    role: "user" as const,
    content: [{ type: "text" as const, text: `${content} ${index + 1}` }],
  }));
}

function Harness({ count, content, role = "adult", canUseIncognito }: { count: number; content?: string; role?: Roster["role"]; canUseIncognito?: boolean }) {
  const runtime = useLocalRuntime(NOOP, { initialMessages: messages(count, content) });
  return <AssistantRuntimeProvider runtime={runtime}><ChatThread canUseIncognito={canUseIncognito ?? canHaveTemporaryChatRole(role)} /></AssistantRuntimeProvider>;
}

function renderChat(props: React.ComponentProps<typeof Harness>) {
  return renderWithQueryClient(<MemoryRouter><Harness {...props} /></MemoryRouter>);
}

afterEach(() => cleanup());

test("the map shows only for a thread of eight or more messages", async () => {
  const short = renderChat({ count: 7 });
  await waitFor(() => expect(short.container.querySelector('[data-slot="aui_thread-viewport"]')).not.toBeNull());
  expect(short.container.querySelector('[data-slot="conversation-map"]')).toBeNull();
  short.unmount();
  const long = renderChat({ count: 8 });
  expect(await long.findByRole("navigation", { name: "Conversation map" })).not.toBeNull();
});

test("clicking a map item scrolls that message into view", async () => {
  const oldScrollIntoView = HTMLElement.prototype.scrollIntoView;
  const scrolled: Element[] = [];
  HTMLElement.prototype.scrollIntoView = function () { scrolled.push(this); };
  try {
    const view = renderChat({ count: 8, content: "map target" });
    const item = await view.findByRole("button", { name: "You: map target 1" });
    fireEvent.click(item);
    await waitFor(() => expect(scrolled.length).toBeGreaterThan(0));
    expect(scrolled.at(-1)?.getAttribute("data-message-id")).toBeTruthy();
  } finally {
    HTMLElement.prototype.scrollIntoView = oldScrollIntoView;
  }
});

test("the visible message is highlighted in the map", async () => {
  const original = globalThis.IntersectionObserver;
  class VisibleMessageObserver {
    constructor(private readonly callback: IntersectionObserverCallback) {}
    observe(target: Element) {
      this.callback([{ target, isIntersecting: target.textContent?.includes("visible target 4") === true } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    disconnect() {}
    unobserve() {}
    takeRecords() { return []; }
    root = null;
    rootMargin = "0px";
    thresholds = [0];
  }
  globalThis.IntersectionObserver = VisibleMessageObserver as unknown as typeof IntersectionObserver;
  try {
    const view = renderChat({ count: 8, content: "visible target" });
    await waitFor(() => expect(view.container.querySelector('[data-slot="conversation-map-tick"][data-in-view]')).not.toBeNull());
    const target = view.getByRole("button", { name: "You: visible target 4" });
    expect(target.hasAttribute("data-in-view")).toBe(true);
  } finally {
    globalThis.IntersectionObserver = original;
  }
});

test("Cmd+F opens in-chat search on a non-empty thread and not on an empty one", async () => {
  const populated = renderChat({ count: 1 });
  const populatedRoot = populated.container.querySelector('[data-slot="aui_thread-viewport"]')!;
  const opens = new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true });
  act(() => populatedRoot.dispatchEvent(opens));
  expect(opens.defaultPrevented).toBe(true);
  expect(await populated.findByRole("textbox", { name: "Find in conversation" })).not.toBeNull();
  populated.unmount();

  const empty = renderChat({ count: 0 });
  const emptyRoot = empty.container.querySelector('[data-slot="aui_thread-viewport"]')!;
  const leavesFind = new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true });
  act(() => emptyRoot.dispatchEvent(leavesFind));
  expect(leavesFind.defaultPrevented).toBe(false);
  expect(empty.queryByRole("textbox", { name: "Find in conversation" })).toBeNull();
});

test("the open search card ends above the first visible message", async () => {
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.matches('[data-slot="aui_thread-viewport"]')) {
      return { x: 0, y: 0, top: 0, right: 390, bottom: 844, left: 0, width: 390, height: 844, toJSON: () => ({}) } as DOMRect;
    }
    if (this.matches('[data-slot="conversation-search"]')) {
      return { x: 16, y: 80, top: 80, right: 374, bottom: 120, left: 16, width: 358, height: 40, toJSON: () => ({}) } as DOMRect;
    }
    if (this.matches("[data-message-id]") && this.textContent?.includes("geometry target")) {
      const viewport = document.querySelector<HTMLElement>('[data-slot="aui_thread-viewport"]');
      const content = viewport?.firstElementChild as HTMLElement | null;
      const top = Number.parseFloat(content?.style.paddingTop ?? "") || 16;
      return { x: 16, y: top, top, right: 374, bottom: top + 40, left: 16, width: 358, height: 40, toJSON: () => ({}) } as DOMRect;
    }
    return original.call(this);
  };
  try {
    const view = renderChat({ count: 1, content: "geometry target" });
    const root = view.container.querySelector('[data-slot="aui_thread-viewport"]')!;
    act(() => root.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true })));
    await view.findByRole("textbox", { name: "Find in conversation" });
    const search = view.container.querySelector<HTMLElement>('[data-slot="conversation-search"]')!;
    const message = [...view.container.querySelectorAll<HTMLElement>("[data-message-id]")]
      .find((element) => element.textContent?.includes("geometry target"))!;
    expect(search.getBoundingClientRect().bottom).toBeLessThanOrEqual(message.getBoundingClientRect().top);
  } finally {
    HTMLElement.prototype.getBoundingClientRect = original;
  }
});

test("search steps through matches with Enter and closes on Escape", async () => {
  const oldScrollIntoView = HTMLElement.prototype.scrollIntoView;
  const scrolled: Element[] = [];
  HTMLElement.prototype.scrollIntoView = function () { scrolled.push(this); };
  try {
    const view = renderChat({ count: 3, content: "needle result" });
    const root = view.container.querySelector('[data-slot="aui_thread-viewport"]')!;
    act(() => root.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true })));
    const input = await view.findByRole("textbox", { name: "Find in conversation" });
    fireEvent.change(input, { target: { value: "needle" } });
    await waitFor(() => expect(view.container.textContent).toContain("1/3"));
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(scrolled.length).toBeGreaterThan(1));
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(view.queryByRole("textbox", { name: "Find in conversation" })).toBeNull());
  } finally {
    HTMLElement.prototype.scrollIntoView = oldScrollIntoView;
  }
});

test("Cmd+K opens the palette and running a command closes it", async () => {
  const view = renderChat({ count: 1 });
  const root = view.container.querySelector('[data-slot="aui_thread-viewport"]')!;
  act(() => root.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true })));
  const paletteInput = await view.findByRole("combobox", { name: "Type a command" });
  expect(paletteInput).not.toBeNull();
  fireEvent.click(view.getByRole("option", { name: /Scroll to latest/ }));
  await waitFor(() => expect(view.queryByRole("combobox", { name: "Type a command" })).toBeNull());
});

test("the palette hides Incognito for a child", async () => {
  const view = renderChat({ count: 1, role: "child" });
  const root = view.container.querySelector('[data-slot="aui_thread-viewport"]')!;
  act(() => root.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true })));
  await view.findByRole("combobox", { name: "Type a command" });
  expect(view.queryByRole("option", { name: /Toggle Incognito/ })).toBeNull();
});

test("the shortcut reference and the palette read the same catalog", () => {
  const actions: ChatCommandAction = {
    newChat: mock(() => {}), focusComposer: mock(() => {}), stopReply: mock(() => {}),
    openPalette: mock(() => {}), toggleSidebar: mock(() => {}), focusChatSearch: mock(() => {}),
    toggleIncognito: mock(() => {}), openSettings: mock(() => {}), scrollToLatest: mock(() => {}),
  };
  const palette = buildChatCommands(actions, { isRunning: true, canUseIncognito: true, canSearchChats: true, canToggleSidebar: true, available: true, canOpenSettings: true });
  const expected = CHAT_COMMAND_SHORTCUTS.map(({ name, shortcut }) => [name, shortcut] as const);
  expect(CHAT_SHORTCUTS).toEqual(expected);
  expect(palette.filter((command) => command.shortcut).map(({ name, shortcut }) => [name, shortcut] as const)).toEqual(expected);
});
