import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { act, cleanup, fireEvent, render, renderHook, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, type Roster } from "@/lib/api";
import { MarkdownText } from "@maipai/ui/src/elements/markdown-text";
import { createAmbientAskQueue, isProtectedReply, useAmbientCompanionPane, type AmbientPaneState } from "@/shell/AmbientCompanionPane";
import type { useSideChat } from "@/shell/useSideChat";

const person = { id: "person-1", display_name: "Sage", role: "adult", age_band: "adult" } as Roster;
const noop = () => {};
function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}
function usePane(side: ReturnType<typeof useSideChat>, onContinue: (id: string) => void) {
  const [state, setState] = useState<AmbientPaneState>({ open: false, pinned: false });
  return useAmbientCompanionPane({ person, companionName: "Companion", companionId: "companion-1", avatar: null, incognito: false, state, onStateChange: setState, onContinue, onRing: noop, side });
}

afterEach(() => { cleanup(); mock.restore(); });

describe("ambient companion pane controls", () => {
  test("a preview ask queues until the runtime mounts, then sends exactly once", () => {
    const send = mock(() => {});
    const queue = createAmbientAskQueue();
    queue.ask("Question from preview");
    queue.register({ ask: send });
    queue.register(null);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("Question from preview");
  });

  test("a wake call waits for the companion stage to mount, then starts it once", () => {
    const start = mock(() => {});
    const queue = createAmbientAskQueue();
    queue.startCall();
    queue.registerCall(start);
    queue.registerCall(null);
    expect(start).toHaveBeenCalledTimes(1);
  });

  test("crisis, failed-tool and approval replies are marked to stay until dismissed", () => {
    expect(isProtectedReply({ metadata: { custom: { crisisSupport: { text: "Call or text 988." } } } })).toBe(true);
    expect(isProtectedReply({ metadata: { custom: { failedTool: true } } })).toBe(true);
    expect(isProtectedReply({ content: [{ type: "tool-call", toolName: "confirm" }] })).toBe(true);
    expect(isProtectedReply({ content: [{ type: "tool-call", toolName: "ask" }] })).toBe(true);
    expect(isProtectedReply({ content: [{ type: "text", text: "A normal reply." }] })).toBe(false);
  });

  test("long replies keep their complete text in a vertically scrollable bubble", () => {
    const longReply = Array.from({ length: 120 }, (_, index) => `Sentence ${index + 1} stays visible.`).join(" ");
    const view = render(<div className="max-h-48 overflow-y-auto overscroll-contain"><MarkdownText text={longReply} /></div>, { wrapper });
    expect(view.container.textContent).toBe(longReply);
    expect(view.container.firstElementChild?.className).toContain("overflow-y-auto");
    expect(view.container.firstElementChild?.className).toContain("max-h-48");
  });

  test("New from History opens the closed pane on the Companion tab and clears the thread", async () => {
    spyOn(api, "conversationList").mockResolvedValue([] as never);
    const newSideChat = mock(() => {});
    const side = { newSideChat, openConversation: mock(async () => true), handOff: mock(async () => "side-1") } as never;
    const { result } = renderHook(() => usePane(side, noop), { wrapper });
    act(() => result.current.onActiveTabChange("history"));
    act(() => result.current.control.newChat());
    await waitFor(() => expect(result.current.open).toBe(true));
    expect(result.current.activeTab).toBe("companion");
    expect(newSideChat).toHaveBeenCalledTimes(1);
  });

  test("Continue from a closed pane switches to Companion and completes the handoff", async () => {
    spyOn(api, "conversationList").mockResolvedValue([] as never);
    const onContinue = mock(() => {});
    const side = { newSideChat: noop, openConversation: mock(async () => true), handOff: mock(async () => "side-1") } as never;
    const { result } = renderHook(() => usePane(side, onContinue), { wrapper });
    await act(async () => { result.current.control.continueInChat(); await Promise.resolve(); });
    await waitFor(() => expect(result.current.open).toBe(true));
    expect(result.current.activeTab).toBe("companion");
    expect(onContinue).toHaveBeenCalledWith("side-1");
  });

  test("Settings links to companion voice, appearance and presence pages and saves the selected companion", async () => {
    const originals = { companions: api.companions, setSetting: api.setSetting };
    const save = mock(async () => ({} as never));
    api.companions = async () => ({ companions: [{ id: "companion-1", name: "Companion" }, { id: "companion-2", name: "Another companion" }] } as never);
    api.setSetting = save as never;
    try {
      const side = { newSideChat: noop, openConversation: mock(async () => true), handOff: mock(async () => undefined) } as never;
      const { result } = renderHook(() => usePane(side, noop), { wrapper });
      act(() => { result.current.onOpenChange(true); result.current.onActiveTabChange("settings"); });
      const settings = result.current.tabs.find((tab) => tab.id === "settings")!.content;
      const view = render(<>{settings}</>, { wrapper });
      expect((await view.findByRole("link", { name: "Voice" })).getAttribute("href")).toBe("/companions/companion-1");
      expect(view.getByRole("link", { name: "Appearance" }).getAttribute("href")).toBe("/companions/companion-1");
      expect(view.getByRole("link", { name: "Presence" }).getAttribute("href")).toBe("/settings/chat?tab=personalization");
      fireEvent.change(view.getByRole("combobox", { name: "Choose companion" }), { target: { value: "companion-2" } });
      await waitFor(() => expect(save).toHaveBeenCalledWith("person:person-1", "persona.active_id", "companion-2"));
    } finally {
      api.companions = originals.companions;
      api.setSetting = originals.setSetting;
    }
  });
});
