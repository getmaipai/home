import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter, type ThreadMessageLike } from "@assistant-ui/react";
import { ChatThread } from "@/apps/chat/ChatThread";
import { api, type Roster } from "@/lib/api";
import { WakeWordPersonContext } from "@/apps/chat/chatThreadContexts";
import { resetReasoningOpenForTests } from "@/apps/chat/useReasoningOpen";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { FakeAudioContext } from "../../../tests/fakeAudioContext";

const NOOP: ChatModelAdapter = { run: async function* () { /* seeded */ } };
const PERSON = { id: "p1", role: "owner", age_band: "adult" } as unknown as Roster;
const MESSAGES: ThreadMessageLike[] = [
  { role: "user", content: [{ type: "text", text: "Hi" }] },
  {
    role: "assistant",
    content: [{ type: "reasoning", text: "Weighing the options carefully." }, { type: "text", text: "Done." }],
    status: { type: "complete", reason: "stop" },
  },
];

function Harness({ adapter = NOOP, messages = MESSAGES, person = PERSON }: { adapter?: ChatModelAdapter; messages?: ThreadMessageLike[]; person?: Roster | null }) {
  const runtime = useLocalRuntime(adapter, { initialMessages: messages });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <WakeWordPersonContext.Provider value={person}><ChatThread /></WakeWordPersonContext.Provider>
    </AssistantRuntimeProvider>
  );
}

const trigger = (c: HTMLElement) => c.querySelector('[data-slot="reasoning-trigger"]') as HTMLElement;

beforeEach(() => {
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  resetReasoningOpenForTests();
});
afterEach(() => cleanup());

describe("reasoning group", () => {
  test("is collapsed by default", async () => {
    const values = spyOn(api, "settingsValues").mockResolvedValue([] as never);
    const view = renderWithQueryClient(<MemoryRouter><Harness /></MemoryRouter>);
    await waitFor(() => expect(trigger(view.container)).not.toBeNull());
    expect(trigger(view.container).getAttribute("aria-expanded")).toBe("false");
    values.mockRestore();
  });

  test("expands on click and saves the choice for the person", async () => {
    const values = spyOn(api, "settingsValues").mockResolvedValue([] as never);
    const set = spyOn(api, "setSetting").mockResolvedValue(undefined as never);
    const view = renderWithQueryClient(<MemoryRouter><Harness /></MemoryRouter>);
    await waitFor(() => expect(trigger(view.container)).not.toBeNull());
    fireEvent.click(trigger(view.container));
    await waitFor(() => expect(trigger(view.container).getAttribute("aria-expanded")).toBe("true"));
    expect(view.container.textContent).toContain("Weighing the options carefully.");
    expect(set).toHaveBeenCalledWith("person:p1", "ui.reasoning_open", true);
    values.mockRestore();
    set.mockRestore();
  });

  test("starts expanded when the person saved that choice", async () => {
    const values = spyOn(api, "settingsValues").mockResolvedValue([{ key: "ui.reasoning_open", value: true }] as never);
    const view = renderWithQueryClient(<MemoryRouter><Harness /></MemoryRouter>);
    await waitFor(() => expect(trigger(view.container).getAttribute("aria-expanded")).toBe("true"));
    values.mockRestore();
  });

  test("opens while running without changing the saved preference", async () => {
    const values = spyOn(api, "settingsValues").mockResolvedValue([] as never);
    const set = spyOn(api, "setSetting").mockResolvedValue(undefined as never);
    let release!: () => void;
    const adapter: ChatModelAdapter = { run: async function* () {
      yield { content: [{ type: "reasoning", text: "Still thinking." }] };
      await new Promise<void>((resolve) => { release = resolve; });
      yield { content: [{ type: "reasoning", text: "Still thinking." }, { type: "text", text: "Answer." }] };
    } };
    const view = renderWithQueryClient(<MemoryRouter><Harness adapter={adapter} messages={[]} /></MemoryRouter>);
    const input = await waitFor(() => {
      const el = view.container.querySelector("textarea");
      expect(el).not.toBeNull();
      return el as HTMLTextAreaElement;
    });
    fireEvent.change(input, { target: { value: "go" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(trigger(view.container).getAttribute("aria-expanded")).toBe("false"));
    fireEvent.click(trigger(view.container));
    await waitFor(() => expect(trigger(view.container).getAttribute("aria-expanded")).toBe("true"));
    expect(view.container.textContent).toContain("Still thinking.");
    expect(set).not.toHaveBeenCalled();
    release();
    await waitFor(() => expect(view.container.textContent).toContain("Answer."));
    expect(trigger(view.container).getAttribute("aria-expanded")).toBe("true");
    expect(set).not.toHaveBeenCalled();
    values.mockRestore();
    set.mockRestore();
  });

  test("shows 'Thought for Ns' after a live reasoning stream, collapsed", async () => {
    const values = spyOn(api, "settingsValues").mockResolvedValue([] as never);
    const adapter: ChatModelAdapter = { run: async function* () {
      yield { content: [{ type: "reasoning", text: "Thinking it through." }] };
      await new Promise((r) => setTimeout(r, 30));
      yield { content: [{ type: "reasoning", text: "Thinking it through." }, { type: "text", text: "Answer." }] };
    } };
    const view = renderWithQueryClient(<MemoryRouter><Harness adapter={adapter} messages={[]} /></MemoryRouter>);
    const input = await waitFor(() => {
      const el = view.container.querySelector("textarea");
      expect(el).not.toBeNull();
      return el as HTMLTextAreaElement;
    });
    fireEvent.change(input, { target: { value: "go" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(view.container.textContent).toContain("Answer."));
    await waitFor(() => expect(trigger(view.container).textContent).toContain("Thought for 1s"));
    expect(trigger(view.container).getAttribute("aria-expanded")).toBe("false");
    values.mockRestore();
  });
});
