import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent } from "@testing-library/react";
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter } from "@assistant-ui/react";
import { ComposerTrailingWithThinkingMode } from "@/apps/chat/chatThreadSlots";
import { ChatAgeBandContext, ModelChoiceAllowedContext, ModelPickerContext, ThinkingModeCapabilityContext, ThinkingModeContext } from "@/apps/chat/chatThreadContexts";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";

const NOOP: ChatModelAdapter = { async *run() { yield { content: [] }; } };
const MODELS = [
  { id: "model-a", name: "Alpha", description: "Fast" },
  { id: "model-b", name: "Beta", description: "Detailed" },
];
const realFetch = globalThis.fetch;

function Harness({ band, setModel }: { band: "child" | "teen" | "adult"; setModel: (id: string) => void }) {
  const runtime = useLocalRuntime(NOOP, { initialMessages: [] });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatAgeBandContext.Provider value={band}>
        <ModelChoiceAllowedContext.Provider value>
          <ModelPickerContext.Provider value={{ models: MODELS, value: "model-a", setValue: setModel }}>
            <ThinkingModeContext.Provider value={{ mode: "instant", setMode: () => {} }}>
              <ThinkingModeCapabilityContext.Provider value="switchable">
                <ComposerTrailingWithThinkingMode />
              </ThinkingModeCapabilityContext.Provider>
            </ThinkingModeContext.Provider>
          </ModelPickerContext.Provider>
        </ModelChoiceAllowedContext.Provider>
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

describe("ComposerTrailingWithThinkingMode model choice", () => {
  test("an adult pick updates Home's selected model id and keeps the thinking-mode control", () => {
    const setModel = mock((_id: string) => {});
    const view = renderWithQueryClient(<Harness band="adult" setModel={setModel} />);
    fireEvent.click(view.container.querySelector('[data-slot="composer-model-trigger"]')!);
    const beta = Array.from(view.container.querySelectorAll('[data-slot="composer-menu-item"]')).find((item) => item.textContent?.includes("Beta"));
    expect(beta).toBeTruthy();
    fireEvent.click(beta!);
    expect(setModel).toHaveBeenCalledWith("model-b");
    expect(view.getByRole("combobox", { name: "Thinking mode" })).toBeTruthy();
  });

  test.each(["child", "teen"] as const)("a %s never gets the model picker", (band) => {
    const view = renderWithQueryClient(<Harness band={band} setModel={() => {}} />);
    expect(view.container.querySelector('[data-slot="composer-model-picker"]')).toBeNull();
  });
});
