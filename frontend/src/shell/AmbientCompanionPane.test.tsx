import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, type Roster } from "@/lib/api";
import { createAmbientAskQueue, useAmbientCompanionPane, type AmbientPaneState } from "@/shell/AmbientCompanionPane";
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
});
