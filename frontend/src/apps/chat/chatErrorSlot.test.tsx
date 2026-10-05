import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter } from "@assistant-ui/react";
import { ChatThread } from "@/apps/chat/ChatThread";
import { AdminContext } from "@/apps/chat/chatThreadContexts";
import { ChatTurnError } from "@/apps/chat/chatTurnError";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { FakeAudioContext } from "../../../tests/fakeAudioContext";

const originalAudioContext = globalThis.AudioContext;

beforeEach(() => {
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
});

afterEach(() => {
  cleanup();
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = originalAudioContext;
});

function Harness({ adapter, admin = false }: { adapter: ChatModelAdapter; admin?: boolean }) {
  const runtime = useLocalRuntime(adapter);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AdminContext.Provider value={admin}>
        <ChatThread />
      </AdminContext.Provider>
    </AssistantRuntimeProvider>
  );
}

function failingAdapter(error: Error, onRun = () => {}): ChatModelAdapter {
  return {
    async *run() {
      onRun();
      throw error;
    },
  };
}

async function sendFailingMessage(view: ReturnType<typeof renderWithQueryClient>) {
  fireEvent.change(view.getByRole("textbox", { name: "Message input" }), { target: { value: "hi" } });
  fireEvent.click(view.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(view.getByRole("alert")).toBeTruthy());
}

describe("ChatMessageError", () => {
  test("a failed reply renders the plain line in the kit error panel", async () => {
    const message = "The AI is busy starting up. Try again in a moment.";
    const view = renderWithQueryClient(<Harness adapter={failingAdapter(new ChatTurnError(message, "unavailable"))} />);
    await sendFailingMessage(view);

    expect(view.getByRole("alert").textContent).toContain("Couldn't finish that reply");
    expect(view.getByRole("alert").textContent).toContain(message);
    expect(view.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  test("Retry reruns the failed reply", async () => {
    const run = mock(() => {});
    let attempts = 0;
    const adapter: ChatModelAdapter = {
      async *run() {
        run();
        attempts++;
        if (attempts === 1) throw new ChatTurnError("Try again.", "unavailable");
        yield { content: [{ type: "text", text: "Recovered." }] };
      },
    };
    const view = renderWithQueryClient(<Harness adapter={adapter} />);
    await sendFailingMessage(view);
    expect(run).toHaveBeenCalledTimes(1);

    fireEvent.click(view.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(view.container.textContent).toContain("Recovered."));
  });

  test("an admin sees the error-details control and a non-admin does not", async () => {
    const error = new ChatTurnError("The reply failed.", "engine_unavailable", "turn-test123");
    const adminView = renderWithQueryClient(<Harness adapter={failingAdapter(error)} admin />);
    await sendFailingMessage(adminView);
    expect(adminView.getByRole("button", { name: "Error details" })).toBeTruthy();
    adminView.unmount();

    const memberView = renderWithQueryClient(<Harness adapter={failingAdapter(error)} />);
    await sendFailingMessage(memberView);
    expect(memberView.queryByRole("button", { name: "Error details" })).toBeNull();
  });

  test("the error panel never shows the code or the engine's raw text", async () => {
    const view = renderWithQueryClient(<Harness adapter={failingAdapter(new ChatTurnError("The chat engine is unavailable. Try again soon.", "engine_unavailable"))} />);
    await sendFailingMessage(view);

    expect(view.getByRole("alert").textContent).toContain("The chat engine is unavailable.");
    expect(view.container.textContent).not.toContain("engine_unavailable");
    expect(view.container.textContent).not.toContain("llama-server");
  });

  test("a generic Error renders its message without an admin detail control", async () => {
    const view = renderWithQueryClient(<Harness adapter={failingAdapter(new Error("Could not reach the hub. Try again."))} admin />);
    await sendFailingMessage(view);

    expect(view.getByRole("alert").textContent).toContain("Could not reach the hub. Try again.");
    expect(view.queryByRole("button", { name: "Error details" })).toBeNull();
  });
});
