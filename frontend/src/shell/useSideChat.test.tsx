import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, type Roster } from "@/lib/api";
import { useSideChat } from "@/shell/useSideChat";
import { INCOGNITO_DISCARDED_EVENT } from "@/shell/incognitoContext";

const person = { id: "person-1", display_name: "Sage", role: "adult", age_band: "adult" } as Roster;
const turn = {
  id: "turn-1", createdAt: "2026-10-27T12:00:00.000Z", hlc: null, parentTurnId: null,
  supersedes: null, branchChosen: true, userText: "Remembered question", replyText: "Remembered answer", memory_ids: [],
} as never;
let currentSide!: ReturnType<typeof useSideChat>;

function ThreadBinder({ side }: { side: ReturnType<typeof useSideChat> }) {
  const { runtime, registerThreadActions } = side;
  useEffect(() => {
    registerThreadActions({ reset: () => runtime.thread.reset(), import: (repository) => runtime.thread.import(repository) });
    return () => registerThreadActions(null);
  }, [registerThreadActions, runtime]);
  return null;
}
function SideHarness({ companion, temporary }: { companion: string; temporary: boolean }) {
  const side = useSideChat(person, companion, temporary);
  currentSide = side;
  return <AssistantRuntimeProvider runtime={side.runtime}><ThreadBinder side={side} /></AssistantRuntimeProvider>;
}
function mount(companion = "companion-1", temporary = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><SideHarness companion={companion} temporary={temporary} /></QueryClientProvider>);
  return { view, client };
}
function rerender(client: QueryClient, companion: string, temporary: boolean) {
  act(() => currentView!.rerender(<QueryClientProvider client={client}><SideHarness companion={companion} temporary={temporary} /></QueryClientProvider>));
}
let currentView: ReturnType<typeof render> | undefined;
function restoreApi() {
  spyOn(api, "sttStatus").mockResolvedValue({ installed: true } as never);
}
function stubTurns(rows: unknown[] = [turn]) {
  spyOn(api, "conversationTurns").mockResolvedValue(rows as never);
  spyOn(api, "conversationFeedback").mockResolvedValue(null as never);
}

afterEach(() => { cleanup(); currentView = undefined; mock.restore(); localStorage.clear(); });

describe("useSideChat lifecycle", () => {
  test("read aloud defaults off and is remembered for the current person", async () => {
    restoreApi();
    const { view } = mount(); currentView = view;
    expect(currentSide.readAloud).toBe(false);
    act(() => currentSide.setReadAloud(true));
    await waitFor(() => expect(localStorage.getItem("maipai.ambient.readaloud.person-1")).toBe("true"));
    expect(currentSide.readAloud).toBe(true);
  });

  test("restores the remembered conversation and imports its messages", async () => {
    localStorage.setItem("maipai.ambient.side.person-1.companion-1", "remembered-1");
    restoreApi(); stubTurns();
    const { view } = mount(); currentView = view;
    await waitFor(() => expect(currentSide.conversationId).toBe("remembered-1"));
    const messages = currentSide.runtime.thread.export().messages.map((entry) => entry.message);
    expect(JSON.stringify(messages.map((message) => message.content))).toContain("Remembered question");
    expect(JSON.stringify(messages.map((message) => message.content))).toContain("Remembered answer");
  });

  test("a first send waits for remembered history to load before resolving its conversation", async () => {
    localStorage.setItem("maipai.ambient.side.person-1.companion-1", "remembered-1");
    restoreApi();
    let finishTurns!: (rows: never[]) => void;
    spyOn(api, "conversationTurns").mockImplementation(() => new Promise((resolve) => { finishTurns = resolve as (rows: never[]) => void; }) as never);
    spyOn(api, "conversationFeedback").mockResolvedValue(null as never);
    const create = spyOn(api, "createConversation");
    const { view } = mount(); currentView = view;
    let firstSend!: Promise<string>;
    act(() => { firstSend = currentSide.ensureConversationId(); });
    expect(create).not.toHaveBeenCalled();
    await act(async () => { finishTurns([turn]); });
    await waitFor(() => expect(currentSide.conversationId).toBe("remembered-1"));
    await expect(firstSend).resolves.toBe("remembered-1");
    expect(create).not.toHaveBeenCalled();
  });

  test("companion key change resets the thread and restores the new key", async () => {
    localStorage.setItem("maipai.ambient.side.person-1.companion-1", "remembered-1");
    localStorage.setItem("maipai.ambient.side.person-1.companion-2", "remembered-2");
    restoreApi(); stubTurns();
    const { view, client } = mount(); currentView = view;
    await waitFor(() => expect(currentSide.conversationId).toBe("remembered-1"));
    rerender(client, "companion-2", false);
    await waitFor(() => expect(currentSide.conversationId).toBe("remembered-2"));
    expect(api.conversationTurns).toHaveBeenLastCalledWith("remembered-2");
  });

  test("Incognito flip clears the visible transcript and conversation id", async () => {
    localStorage.setItem("maipai.ambient.side.person-1.companion-1", "remembered-1");
    restoreApi(); stubTurns();
    const { view, client } = mount(); currentView = view;
    await waitFor(() => expect(currentSide.conversationId).toBe("remembered-1"));
    rerender(client, "companion-1", true);
    await waitFor(() => expect(currentSide.conversationId).toBeUndefined());
    expect(currentSide.runtime.thread.export().messages).toHaveLength(0);
    expect(localStorage.getItem("maipai.ambient.side.person-1.companion-1")).toBe("remembered-1");
  });

  test("temporary side chats never persist an id and discard clears the thread", async () => {
    restoreApi(); stubTurns([]);
    const create = spyOn(api, "createConversation").mockResolvedValue({ id: "temporary-1" } as never);
    const { view } = mount("companion-1", true); currentView = view;
    let id: string | undefined;
    await act(async () => { id = await currentSide.ensureConversationId(); });
    expect(create).toHaveBeenCalledWith("temporary", undefined, undefined, "companion-1", "side");
    expect(id).toBe("temporary-1");
    expect(localStorage.getItem("maipai.ambient.side.person-1.companion-1")).toBeNull();
    act(() => window.dispatchEvent(new Event(INCOGNITO_DISCARDED_EVENT)));
    await waitFor(() => expect(currentSide.conversationId).toBeUndefined());
    expect(currentSide.runtime.thread.export().messages).toHaveLength(0);
  });

  test("rapid sends share the one conversation create request", async () => {
    restoreApi();
    let finishCreate!: (value: { id: string }) => void;
    const create = spyOn(api, "createConversation").mockImplementation(() => new Promise((resolve) => { finishCreate = resolve as (value: { id: string }) => void; }) as never);
    const { view } = mount(); currentView = view;
    let first!: Promise<string>;
    let second!: Promise<string>;
    act(() => { first = currentSide.ensureConversationId(); second = currentSide.ensureConversationId(); });
    expect(create).toHaveBeenCalledTimes(1);
    await act(async () => { finishCreate({ id: "created-1" }); await Promise.all([first, second]); });
    expect(currentSide.conversationId).toBe("created-1");
  });

  test("a create completing after New side chat cannot restore its id or storage", async () => {
    restoreApi();
    let finishCreate!: (value: { id: string }) => void;
    spyOn(api, "createConversation").mockImplementation(() => new Promise((resolve) => { finishCreate = resolve as (value: { id: string }) => void; }) as never);
    const { view } = mount(); currentView = view;
    let pending!: Promise<string>;
    act(() => { pending = currentSide.ensureConversationId(); });
    expect(api.createConversation).toHaveBeenCalledTimes(1);
    act(() => currentSide.newSideChat());
    await act(async () => { finishCreate({ id: "stale-created" }); expect(await pending).toBe("stale-created"); });
    expect(currentSide.conversationId).toBeUndefined();
    expect(localStorage.getItem("maipai.ambient.side.person-1.companion-1")).toBeNull();
  });

  test("a create completing after a companion switch cannot restore its id or storage", async () => {
    restoreApi();
    let finishCreate!: (value: { id: string }) => void;
    spyOn(api, "createConversation").mockImplementation(() => new Promise((resolve) => { finishCreate = resolve as (value: { id: string }) => void; }) as never);
    const { view, client } = mount(); currentView = view;
    let pending!: Promise<string>;
    act(() => { pending = currentSide.ensureConversationId(); });
    rerender(client, "companion-2", false);
    await act(async () => { finishCreate({ id: "stale-companion-create" }); expect(await pending).toBe("stale-companion-create"); });
    expect(currentSide.conversationId).toBeUndefined();
    expect(localStorage.getItem("maipai.ambient.side.person-1.companion-1")).toBeNull();
  });

  test("handoff changes placement, then resets the side transcript and id", async () => {
    localStorage.setItem("maipai.ambient.side.person-1.companion-1", "remembered-1");
    restoreApi(); stubTurns();
    const placement = spyOn(api, "setConversationPlacement").mockResolvedValue(undefined as never);
    const { view } = mount(); currentView = view;
    await waitFor(() => expect(currentSide.conversationId).toBe("remembered-1"));
    let handedOff: string | undefined;
    await act(async () => { handedOff = await currentSide.handOff(); });
    expect(placement).toHaveBeenCalledWith("remembered-1", "chat");
    expect(handedOff).toBe("remembered-1");
    expect(currentSide.conversationId).toBeUndefined();
    expect(localStorage.getItem("maipai.ambient.side.person-1.companion-1")).toBeNull();
    expect(currentSide.runtime.thread.export().messages).toHaveLength(0);
  });

  test("a call after 30 idle minutes starts with a fresh side conversation", async () => {
    const oldId = "remembered-1";
    localStorage.setItem("maipai.ambient.side.person-1.companion-1", oldId);
    restoreApi(); stubTurns();
    spyOn(api, "conversationList").mockResolvedValue([{ id: oldId, last_turn_at: new Date(Date.now() - 45 * 60_000).toISOString(), created_at: new Date(Date.now() - 60 * 60_000).toISOString() }] as never);
    const create = spyOn(api, "createConversation").mockResolvedValue({ id: "fresh-1" } as never);
    const { view } = mount(); currentView = view;
    await waitFor(() => expect(currentSide.conversationId).toBe(oldId));
    await act(async () => { await currentSide.prepareCall(); });
    expect(currentSide.conversationId).toBeUndefined();
    await act(async () => { expect(await currentSide.ensureConversationId()).toBe("fresh-1"); });
    expect(create).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("maipai.ambient.side.person-1.companion-1")).toBe("fresh-1");
  });

  test("a call within 30 idle minutes keeps its side conversation", async () => {
    const oldId = "remembered-1";
    localStorage.setItem("maipai.ambient.side.person-1.companion-1", oldId);
    restoreApi(); stubTurns();
    spyOn(api, "conversationList").mockResolvedValue([{ id: oldId, last_turn_at: new Date(Date.now() - 10 * 60_000).toISOString(), created_at: new Date(Date.now() - 60 * 60_000).toISOString() }] as never);
    const create = spyOn(api, "createConversation");
    const { view } = mount(); currentView = view;
    await waitFor(() => expect(currentSide.conversationId).toBe(oldId));
    await act(async () => { await currentSide.prepareCall(); });
    expect(currentSide.conversationId).toBe(oldId);
    expect(create).not.toHaveBeenCalled();
  });
});
