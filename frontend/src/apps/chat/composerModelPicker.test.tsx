import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup } from "@testing-library/react";
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter } from "@assistant-ui/react";
import { ComposerTrailingWithThinkingMode } from "@/apps/chat/chatThreadSlots";
import { ChatAgeBandContext, ThinkingModeCapabilityContext, ThinkingModeContext } from "@/apps/chat/chatThreadContexts";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";

const NOOP: ChatModelAdapter = { async *run() { yield { content: [] }; } };
const realFetch = globalThis.fetch;

function Harness({ band }: { band: "child" | "teen" | "adult" }) {
  const runtime = useLocalRuntime(NOOP, { initialMessages: [] });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatAgeBandContext.Provider value={band}>
        <ThinkingModeContext.Provider value={{ mode: "instant", setMode: () => {} }}>
          <ThinkingModeCapabilityContext.Provider value="switchable">
            <ComposerTrailingWithThinkingMode />
          </ThinkingModeCapabilityContext.Provider>
        </ThinkingModeContext.Provider>
      </ChatAgeBandContext.Provider>
    </AssistantRuntimeProvider>
  );
}

beforeEach(() => {
  globalThis.fetch = mock(() => Promise.resolve(Response.json({}))) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

describe("composer mode control", () => {
  test("keeps the shipped Instant/Thinking mode control without model options", () => {
    const view = renderWithQueryClient(<Harness band="adult" />);
    expect(view.getByRole("combobox", { name: "Thinking mode" })).toBeTruthy();
    expect(view.queryByText("Private model alpha")).toBeNull();
    expect(view.queryByText("Private model beta")).toBeNull();
  });
});
