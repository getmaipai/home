import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { AssistantRuntimeProvider, ComposerPrimitive, useLocalRuntime, type ChatModelAdapter } from "@assistant-ui/react";
import { ChatAvailabilityContext } from "@/apps/chat/useChatAvailability";
import { DraftConversationContext, TemporaryChatContext } from "@/apps/chat/chatThreadContexts";
import { ComposerDictationWaveform } from "@/apps/chat/composerDictationWaveform";
import { discardDraft, readDraft, saveDraft } from "@/apps/chat/draftStore";

const adapter: ChatModelAdapter = { async *run() { yield { content: [] }; } };
const id = "draft-test-chat";
const originalDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");

function Harness({ temporary = false }: { temporary?: boolean }) {
  const runtime = useLocalRuntime(adapter);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <DraftConversationContext.Provider value={id}>
        <TemporaryChatContext.Provider value={{ on: temporary }}>
          <ChatAvailabilityContext.Provider value="ready">
            <ComposerPrimitive.Root>
              <ComposerDictationWaveform />
              <ComposerPrimitive.Send>Send</ComposerPrimitive.Send>
            </ComposerPrimitive.Root>
          </ChatAvailabilityContext.Provider>
        </TemporaryChatContext.Provider>
      </DraftConversationContext.Provider>
    </AssistantRuntimeProvider>
  );
}

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "localStorage", originalDescriptor!);
  discardDraft(id);
});

describe("chat drafts", () => {
  test("typing saves a draft for that chat", async () => {
    const view = render(<Harness />);
    fireEvent.change(view.getByRole("textbox", { name: "Message input" }), { target: { value: "unsent note" } });
    await waitFor(() => expect(readDraft(id)?.text).toBe("unsent note"), { timeout: 1200 });
  });

  test("clearing the text removes the saved draft", async () => {
    const view = render(<Harness />);
    const input = view.getByRole("textbox", { name: "Message input" });
    fireEvent.change(input, { target: { value: "unsent note" } });
    await waitFor(() => expect(readDraft(id)?.text).toBe("unsent note"), { timeout: 1200 });
    fireEvent.change(input, { target: { value: "" } });
    await waitFor(() => expect(readDraft(id)).toBeNull());
  });

  test("sending clears the draft", async () => {
    saveDraft(id, "unsent note");
    const onSend = () => discardDraft(id);
    onSend();
    expect(readDraft(id)).toBeNull();
  });

  test("reopening a chat with a draft offers restore and discard", async () => {
    const view = render(<Harness />);
    fireEvent.change(view.getByRole("textbox", { name: "Message input" }), { target: { value: "pick up here" } });
    await waitFor(() => expect(readDraft(id)?.text).toBe("pick up here"), { timeout: 1200 });
    view.unmount();
    const reopened = render(<Harness />);
    await waitFor(() => expect(reopened.getByText("pick up here")).toBeTruthy());
    expect(reopened.getByRole("button", { name: "Restore" })).toBeTruthy();
    expect(reopened.getByRole("button", { name: "Discard the draft" })).toBeTruthy();
  });

  test("restore puts the text back in the composer", async () => {
    const view = render(<Harness />);
    fireEvent.change(view.getByRole("textbox", { name: "Message input" }), { target: { value: "restored text" } });
    await waitFor(() => expect(readDraft(id)?.text).toBe("restored text"), { timeout: 1200 });
    view.unmount();
    const reopened = render(<Harness />);
    await waitFor(() => expect(reopened.getByRole("button", { name: "Restore" })).toBeTruthy());
    fireEvent.click(reopened.getByRole("button", { name: "Restore" }));
    expect((reopened.getByRole("textbox", { name: "Message input" }) as HTMLTextAreaElement).value).toBe("restored text");
  });

  test("discard deletes the draft", async () => {
    const view = render(<Harness />);
    fireEvent.change(view.getByRole("textbox", { name: "Message input" }), { target: { value: "discard me" } });
    await waitFor(() => expect(readDraft(id)?.text).toBe("discard me"), { timeout: 1200 });
    view.unmount();
    const reopened = render(<Harness />);
    await waitFor(() => expect(reopened.getByRole("button", { name: "Discard the draft" })).toBeTruthy());
    fireEvent.click(reopened.getByRole("button", { name: "Discard the draft" }));
    expect(readDraft(id)).toBeNull();
  });

  test("a temporary chat never writes a draft", async () => {
    const view = render(<Harness temporary />);
    fireEvent.change(view.getByRole("textbox", { name: "Message input" }), { target: { value: "temporary text" } });
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(readDraft(id)).toBeNull();
  });

  test("blocked storage does not break typing", () => {
    Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
    const view = render(<Harness />);
    const input = view.getByRole("textbox", { name: "Message input" }) as HTMLTextAreaElement;
    expect(() => fireEvent.change(input, { target: { value: "still typeable" } })).not.toThrow();
    expect(input.value).toBe("still typeable");
  });
});
