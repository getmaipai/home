import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter, type ThreadMessageLike } from "@assistant-ui/react";
import { ChatThread } from "@/apps/chat/ChatThread";
import { consumeContinuation, setPendingContinuation } from "@/apps/chat/chatContinue";
import { ChatAgeBandContext } from "@/apps/chat/chatThreadContexts";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { FakeAudioContext } from "../../../tests/fakeAudioContext";

const PARTIAL = "The answer so far";
const NOOP: ChatModelAdapter = { run: async function* () { /* seeded message */ } };

function messages(reason: "cancelled" | "length" | "error"): ThreadMessageLike[] {
  return [
    { role: "user", content: [{ type: "text", text: "Tell me about bicycles" }] },
    {
      role: "assistant",
      content: [{ type: "text", text: PARTIAL }],
      status: { type: "incomplete", reason },
      metadata: { custom: { turnId: "turn-stopped01" } },
    },
  ];
}

function Harness({ band, reason = "cancelled", adapter = NOOP }: {
  band: "child" | "teen" | "adult";
  reason?: "cancelled" | "length" | "error";
  adapter?: ChatModelAdapter;
}) {
  const runtime = useLocalRuntime(adapter, { initialMessages: messages(reason) });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatAgeBandContext.Provider value={band}><ChatThread /></ChatAgeBandContext.Provider>
    </AssistantRuntimeProvider>
  );
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  globalThis.fetch = mock(() => Promise.resolve(Response.json([]))) as unknown as typeof fetch;
  setPendingContinuation(null);
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  setPendingContinuation(null);
});

describe("stopped reply Element", () => {
  test.each([
    ["child", "You stopped it"],
    ["teen", "You stopped this reply"],
    ["adult", "You stopped this reply"],
  ] as const)("%s: shows the Home reason copy after a cancelled reply", async (band, reason) => {
    const view = renderWithQueryClient(<MemoryRouter><Harness band={band} /></MemoryRouter>);
    const stopped = await waitFor(() => {
      const element = view.container.querySelector('[data-slot="stopped-run"]');
      expect(element).not.toBeNull();
      return element!;
    });

    expect(stopped.textContent).toContain(PARTIAL);
    expect(stopped.textContent).toContain(reason);
    expect(view.queryByRole("button", { name: "Discard" })).toBeNull();
  });

  test.each([
    ["length cap", "length"],
    ["output gate", "error"],
  ] as const)("does not render for an incomplete %s stop", async (_stopKind, reason) => {
    const view = renderWithQueryClient(<MemoryRouter><Harness band="adult" reason={reason} /></MemoryRouter>);
    await waitFor(() => expect(view.getByText(PARTIAL)).toBeTruthy());
    expect(view.container.querySelector('[data-slot="stopped-run"]')).toBeNull();
  });

  test("Continue stores the partial answer and turn id before reloading", async () => {
    const continuations: (ReturnType<typeof consumeContinuation> | null)[] = [];
    const adapter: ChatModelAdapter = {
      run: async function* () {
        continuations.push(consumeContinuation() ?? null);
        yield { content: [{ type: "text", text: "continued" }] };
      },
    };
    const view = renderWithQueryClient(<MemoryRouter><Harness band="adult" adapter={adapter} /></MemoryRouter>);

    fireEvent.click(await view.findByRole("button", { name: "Continue" }));
    await waitFor(() => expect(continuations).toHaveLength(1));
    expect(continuations[0]).toEqual({ assistantText: PARTIAL, fromTurnId: "turn-stopped01" });
  });
});
