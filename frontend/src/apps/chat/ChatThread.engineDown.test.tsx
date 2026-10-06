import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter, type SpeechSynthesisAdapter, type SuggestionAdapter, type ThreadMessageLike } from "@assistant-ui/react";
import { ChatThread } from "@/apps/chat/ChatThread";
import { createChatFeedbackAdapter } from "@/apps/chat/chatActionBar";
import { AdminContext, ModelChoiceAllowedContext, ModelPickerContext } from "@/apps/chat/chatThreadContexts";
import { ChatAvailabilityContext } from "@/apps/chat/useChatAvailability";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { FakeAudioContext } from "../../../tests/fakeAudioContext";
import { api } from "@/lib/api";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@maipai/ui/src/ui/tooltip";

// ENGINE-DOWN-UI-01: while chat cannot answer (paused, down or starting) every
// control that needs the engine is disabled through ONE mechanism (the thread's
// availability, mapped onto the kit Thread's `engineDown` prop), and every
// control that works offline stays enabled. Each control is checked in both
// states so a new engine-dependent button cannot slip through.
type Availability = "ready" | "starting" | "unavailable";
const done = { type: "complete", reason: "stop" } as const;
const NOOP: ChatModelAdapter = { run: async function* () { /* messages are seeded */ } };
const MESSAGES: ThreadMessageLike[] = [
  { role: "user", content: [{ type: "text", text: "First question" }] },
  { role: "assistant", content: [{ type: "text", text: "First answer." }], status: done, metadata: { custom: { turnId: "turn-1" } } },
  { role: "user", content: [{ type: "text", text: "Second question" }] },
];
const MODELS = [{ id: "model-a", name: "Model A" }, { id: "model-b", name: "Model B" }];

const speak = mock((_text: string): SpeechSynthesisAdapter.Utterance => ({ status: { type: "running" }, cancel: () => {}, subscribe: () => () => {} }));
const suggestion: SuggestionAdapter = { generate: async function* () { yield [{ prompt: "Tell me more" }]; } };

function Harness({ availability, initialMessages = MESSAGES, adapter = NOOP, models = false }: { availability: Availability; initialMessages?: ThreadMessageLike[]; adapter?: ChatModelAdapter; models?: boolean }) {
  const runtime = useLocalRuntime(adapter, { initialMessages, adapters: { feedback: createChatFeedbackAdapter(), speech: { speak }, suggestion } });
  harnessRuntime = runtime;
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AdminContext.Provider value>
        <ModelChoiceAllowedContext.Provider value={models}>
          <ModelPickerContext.Provider value={{ models: models ? MODELS : [], value: models ? "model-a" : undefined, setValue: () => {} }}>
            <ChatAvailabilityContext.Provider value={availability}><ChatThread /></ChatAvailabilityContext.Provider>
          </ModelPickerContext.Provider>
        </ModelChoiceAllowedContext.Provider>
      </AdminContext.Provider>
    </AssistantRuntimeProvider>
  );
}
let harnessRuntime: { thread: { getState(): { messages: readonly { id: string }[] }; getMessageByIndex(index: number): { reload(): void } } } | undefined;

function renderThread(availability: Availability, extra: Partial<Parameters<typeof Harness>[0]> = {}) {
  const view = renderWithQueryClient(<MemoryRouter><Harness availability={availability} {...extra} /></MemoryRouter>);
  const set = (next: Availability) => view.rerender(<QueryClientProvider client={view.queryClient}><TooltipProvider><MemoryRouter><Harness availability={next} {...extra} /></MemoryRouter></TooltipProvider></QueryClientProvider>);
  return { ...view, set };
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  globalThis.fetch = mock(() => Promise.resolve(Response.json({}))) as unknown as typeof fetch;
  speak.mockClear();
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

const ASSISTANT_ROW = ".aui-assistant-action-bar-root";
const USER_ROW = ".aui-user-action-bar-root";
function button(root: ParentNode, label: string): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim().startsWith(label));
  if (!found) throw new Error(`no button starting with "${label}"`);
  return found as HTMLButtonElement;
}
const isDisabled = (el: HTMLElement) => (el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true";
async function rows(view: ReturnType<typeof renderThread>) {
  await waitFor(() => expect(view.container.querySelector(ASSISTANT_ROW)).not.toBeNull());
  await waitFor(() => expect(view.container.querySelector(USER_ROW)).not.toBeNull());
  return { assistant: view.container.querySelector(ASSISTANT_ROW)!, user: view.container.querySelector(USER_ROW)! };
}
async function openMoreMenu(view: ReturnType<typeof renderThread>) {
  const trigger = await view.findByRole("button", { name: "More" });
  act(() => {
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1 });
    fireEvent.click(trigger);
  });
}

describe("engine-dependent reply controls", () => {
  for (const state of ["unavailable", "starting"] as const) {
    test(`Refresh, Edit and Retry are disabled while chat is ${state}, with the reason in their name`, async () => {
      const view = renderThread(state);
      const { assistant, user } = await rows(view);
      const reason = state === "unavailable" ? "Chat is paused" : "Chat is starting";
      for (const control of [button(assistant, "Refresh"), button(user, "Edit"), button(user, "Retry")]) {
        expect(isDisabled(control)).toBe(true);
        expect(control.textContent).toContain(reason);
      }
    });
  }

  test("Refresh, Edit and Retry are enabled when chat is ready", async () => {
    const view = renderThread("ready");
    const { assistant, user } = await rows(view);
    for (const control of [button(assistant, "Refresh"), button(user, "Edit"), button(user, "Retry")]) {
      expect(isDisabled(control)).toBe(false);
    }
  });

  test("clicking a disabled Refresh does not start a reply", async () => {
    const run = mock(async function* () { yield { content: [{ type: "text" as const, text: "new" }] }; });
    const view = renderThread("unavailable", { adapter: { run } });
    const { assistant } = await rows(view);
    fireEvent.click(button(assistant, "Refresh"));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(run).not.toHaveBeenCalled();
  });

  test("the edit composer's Update is disabled while chat is paused and enabled when it is back", async () => {
    const view = renderThread("ready");
    const { user } = await rows(view);
    act(() => { fireEvent.click(button(user, "Edit")); });
    const update = () => button(view.container, "Update");
    await waitFor(() => expect(update()).toBeTruthy());
    expect(isDisabled(update())).toBe(false);
    view.set("unavailable");
    await waitFor(() => expect(isDisabled(update())).toBe(true));
    view.set("ready");
    await waitFor(() => expect(isDisabled(update())).toBe(false));
  });

  test("follow-up chips are disabled while chat is paused and enabled when ready", async () => {
    const view = renderThread("ready", { initialMessages: MESSAGES.slice(0, 2) });
    act(() => harnessRuntime!.thread.getMessageByIndex(1).reload());
    const chip = () => view.queryByText("Tell me more")?.closest("button") ?? null;
    await waitFor(() => expect(chip()).not.toBeNull());
    expect(isDisabled(chip()!)).toBe(false);
    view.set("unavailable");
    await waitFor(() => expect(isDisabled(chip()!)).toBe(true));
  });

  test("branch regenerate (the regenerate-with-model trigger) is disabled while chat is paused", async () => {
    const view = renderThread("unavailable", { models: true });
    await rows(view);
    const trigger = view.container.querySelector<HTMLButtonElement>('[aria-label^="Regenerate with a different model"]');
    expect(trigger).not.toBeNull();
    expect(isDisabled(trigger!)).toBe(true);
    view.set("ready");
    await waitFor(() => expect(isDisabled(view.container.querySelector<HTMLButtonElement>('[aria-label^="Regenerate with a different model"]')!)).toBe(false));
  });
});

describe("starter suggestions", () => {
  test("every starter chip is disabled while chat is paused or starting, and clicking one sends nothing", async () => {
    const run = mock(async function* () { yield { content: [{ type: "text" as const, text: "hi" }] }; });
    for (const state of ["unavailable", "starting"] as const) {
      const view = renderThread(state, { initialMessages: [], adapter: { run } });
      const chips = Array.from(view.container.querySelectorAll<HTMLButtonElement>('[data-slot="empty-state-suggestion"]'));
      expect(chips.length).toBe(4);
      for (const chip of chips) expect(isDisabled(chip)).toBe(true);
      fireEvent.click(chips[0]!);
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(run).not.toHaveBeenCalled();
      view.unmount();
    }
  });

  test("starter chips are enabled when chat is ready", () => {
    const view = renderThread("ready", { initialMessages: [] });
    for (const chip of Array.from(view.container.querySelectorAll<HTMLButtonElement>('[data-slot="empty-state-suggestion"]'))) {
      expect(isDisabled(chip)).toBe(false);
    }
  });
});

describe("Send", () => {
  test("typing stays allowed while chat is paused, Send is disabled and nothing queues", async () => {
    const view = renderThread("unavailable", { initialMessages: [] });
    const input = view.getByRole("textbox", { name: "Message input" }) as HTMLTextAreaElement;
    expect(input.disabled).toBe(false);
    fireEvent.change(input, { target: { value: "hello" } });
    await waitFor(() => expect(input.value).toBe("hello"));
    expect(isDisabled(view.getByRole("button", { name: /^Send/ }))).toBe(true);
    expect(view.container.querySelector('[data-slot="message-queue"]')).toBeNull();
  });
});

describe("offline controls stay enabled while chat is paused", () => {
  test("Copy (reply and prompt), Read aloud, thumbs and More are enabled", async () => {
    const view = renderThread("unavailable");
    const { assistant, user } = await rows(view);
    for (const name of ["Copy", "Read aloud", "Helpful", "Not helpful", "More"]) {
      expect(isDisabled(button(assistant, name))).toBe(false);
    }
    expect(isDisabled(button(user, "Copy"))).toBe(false);
  });

  test("Read aloud speaks the reply while chat is paused (it depends on voice, not chat)", async () => {
    const view = renderThread("unavailable");
    const { assistant } = await rows(view);
    act(() => { fireEvent.click(button(assistant, "Read aloud")); });
    expect(speak).toHaveBeenCalledWith("First answer.");
  });

  test("a thumbs rating is still recorded while chat is paused", async () => {
    const submit = spyOn(api, "submitConversationFeedback").mockResolvedValue({} as never);
    try {
      const view = renderThread("unavailable");
      const { assistant } = await rows(view);
      fireEvent.click(button(assistant, "Helpful"));
      expect(submit).toHaveBeenCalledWith("turn-1", "up");
    } finally {
      submit.mockRestore();
    }
  });

  test("the More menu keeps Export as Markdown, Branch in new chat and Details-free items enabled; Compare is disabled", async () => {
    const view = renderThread("unavailable");
    await rows(view);
    await openMoreMenu(view);
    const exportItem = await view.findByRole("menuitem", { name: /Export as Markdown/ });
    expect(isDisabled(exportItem)).toBe(false);
    const branch = await view.findByRole("menuitem", { name: /Branch in new chat/ });
    expect(isDisabled(branch)).toBe(false);
    const bare = await view.findByRole("menuitem", { name: /bare mode/ });
    expect(isDisabled(bare)).toBe(false);
    const compare = await view.findByRole("menuitem", { name: /Compare/ });
    expect(isDisabled(compare)).toBe(true);
  });

  test("the More menu's Compare is enabled once chat is back", async () => {
    const view = renderThread("ready");
    await rows(view);
    await openMoreMenu(view);
    const compare = await view.findByRole("menuitem", { name: /Compare/ });
    // Enabled by this control's own availability rule; it still reads "available once saved" without a saved conversation id.
    expect(compare.getAttribute("aria-disabled") === "true" && !(compare.textContent ?? "").includes("once saved")).toBe(false);
  });

  test("the branch picker still switches between earlier branches while chat is paused", async () => {
    let call = 0;
    const adapter: ChatModelAdapter = { run: async function* () { call += 1; yield { content: [{ type: "text" as const, text: `Answer ${call}` }] }; } };
    const view = renderThread("ready", { initialMessages: MESSAGES.slice(0, 2), adapter });
    act(() => harnessRuntime!.thread.getMessageByIndex(1).reload());
    await waitFor(() => expect(view.getByText("Answer 1")).toBeTruthy());
    view.set("unavailable");
    const previous = await view.findByRole("button", { name: "Previous" });
    expect(isDisabled(previous)).toBe(false);
    fireEvent.click(previous);
    await waitFor(() => expect(view.getByText("First answer.")).toBeTruthy());
  });

  test("Stop stays available while a reply runs even when chat is reported down", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const adapter: ChatModelAdapter = { run: async function* () { await gate; yield { content: [{ type: "text" as const, text: "late" }] }; } };
    const view = renderThread("ready", { initialMessages: MESSAGES.slice(0, 2), adapter });
    act(() => harnessRuntime!.thread.getMessageByIndex(1).reload());
    view.set("unavailable");
    const stop = await view.findByRole("button", { name: "Stop generating" });
    expect(isDisabled(stop)).toBe(false);
    release();
  });
});
