import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup } from "@testing-library/react";
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter } from "@assistant-ui/react";
import { ComposerTrailingWithThinkingMode } from "@/apps/chat/chatThreadSlots";
import { ChatAgeBandContext, ThinkingModeCapabilityContext, ThinkingModeContext } from "@/apps/chat/chatThreadContexts";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";

const NOOP: ChatModelAdapter = { async *run() { yield { content: [] }; } };
const realFetch = globalThis.fetch;

function Harness({ band, capability = "switchable" }: { band: "child" | "teen" | "adult"; capability?: "switchable" | "none" | "always" }) {
  const runtime = useLocalRuntime(NOOP, { initialMessages: [] });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatAgeBandContext.Provider value={band}>
        <ThinkingModeContext.Provider value={{ mode: "instant", setMode: () => {} }}>
          <ThinkingModeCapabilityContext.Provider value={capability}>
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

  test("a model that always thinks shows one plain line and no choice (INSTANT-01)", () => {
    const view = renderWithQueryClient(<Harness band="adult" capability="always" />);
    expect(view.getByText("Thinks before every reply")).toBeTruthy();
    expect(view.queryByRole("combobox", { name: "Thinking mode" })).toBeNull();
    expect(view.queryByText("Instant")).toBeNull();
  });

  test("a model that never thinks shows no mode text at all (INSTANT-01)", () => {
    const view = renderWithQueryClient(<Harness band="adult" capability="none" />);
    expect(view.queryByRole("combobox", { name: "Thinking mode" })).toBeNull();
    expect(view.queryByText("Instant")).toBeNull();
    expect(view.queryByText("Thinking")).toBeNull();
    expect(view.queryByText("Thinks before every reply")).toBeNull();
  });
});
