import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { AssistantRuntimeProvider, ComposerPrimitive, useLocalRuntime, type ChatModelAdapter, type DictationAdapter } from "@assistant-ui/react";
import type { LevelMeter } from "@/lib/voice/audioLevelMeter";
import { ComposerDictationWaveform, DictationLevelMeterProvider } from "@/apps/chat/composerDictationWaveform";
import { ChatAvailabilityContext } from "@/apps/chat/useChatAvailability";

const chatAdapter: ChatModelAdapter = {
  async *run() {
    yield { content: [] };
  },
};

function fakeLevelMeter(read: () => number): LevelMeter {
  return { read, stop: () => {} };
}

// A minimal, always-"running" DictationAdapter - these tests only need
// `s.composer.dictation != null` to go true on click, never a real
// transcript.
function fakeDictationAdapter(): DictationAdapter {
  return {
    listen() {
      return {
        status: { type: "running" },
        stop: async () => {},
        cancel: () => {},
        onSpeechStart: () => () => {},
        onSpeechEnd: () => () => {},
        onSpeech: () => () => {},
      };
    },
  };
}

function Harness({ meter, availability = "ready" }: { meter: LevelMeter | null; availability?: "ready" | "starting" | "unavailable" }) {
  const runtime = useLocalRuntime(chatAdapter, { adapters: { dictation: fakeDictationAdapter() } });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <DictationLevelMeterProvider value={meter}>
        <ChatAvailabilityContext.Provider value={availability}>
        <ComposerPrimitive.Dictate>Start dictation</ComposerPrimitive.Dictate>
        <ComposerDictationWaveform />
        </ChatAvailabilityContext.Provider>
      </DictationLevelMeterProvider>
    </AssistantRuntimeProvider>
  );
}

describe("ComposerDictationWaveform", () => {
  afterEach(() => {
    cleanup();
    document.documentElement.style.removeProperty("--color-primary");
  });

  test("not dictating: renders the real composer input, never the bars - the regression VOICE-LIVE-04b found live", () => {
    const { getByLabelText, queryAllByTestId } = render(<Harness meter={null} />);
    expect(getByLabelText("Message input")).toBeTruthy();
    expect((getByLabelText("Message input") as HTMLTextAreaElement).placeholder).toBe("Send a message...");
    expect((getByLabelText("Message input") as HTMLTextAreaElement).disabled).toBe(false);
    expect(queryAllByTestId("dictation-bar")).toHaveLength(0);
  });

  test("unavailable disables the input and explains why", () => {
    const { getByLabelText } = render(<Harness meter={null} availability="unavailable" />);
    const input = getByLabelText("Message input") as HTMLTextAreaElement;
    expect(input.disabled).toBe(true);
    expect(input.placeholder).toBe("MaiPai's AI isn't running right now");
  });

  test("becoming ready re-enables the input", () => {
    const view = render(<Harness meter={null} availability="unavailable" />);
    expect((view.getByLabelText("Message input") as HTMLTextAreaElement).disabled).toBe(true);
    view.rerender(<Harness meter={null} availability="ready" />);
    const input = view.getByLabelText("Message input") as HTMLTextAreaElement;
    expect(input.disabled).toBe(false);
    expect(input.placeholder).toBe("Send a message...");
  });

  test("dictating: swaps to a fixed row of bars, at their resting height, and the real input is gone", async () => {
    const { getByText, getAllByTestId, queryByLabelText } = render(<Harness meter={null} />);
    fireEvent.click(getByText("Start dictation"));
    await waitFor(() => expect(getAllByTestId("dictation-bar")).toHaveLength(24));
    for (const bar of getAllByTestId("dictation-bar")) expect(bar.style.height).toBe("8%");
    expect(queryByLabelText("Message input")).toBeNull();
  });

  test("the accessible text is present once dictating, even before the bars have anything to show", async () => {
    const { getByText } = render(<Harness meter={null} />);
    fireEvent.click(getByText("Start dictation"));
    await waitFor(() => expect(getByText("Listening")).toBeDefined());
  });

  test("colors the bars from the design token", async () => {
    document.documentElement.style.setProperty("--color-primary", "rgb(1, 2, 3)");
    const { getByText, getAllByTestId } = render(<Harness meter={null} />);
    fireEvent.click(getByText("Start dictation"));
    await waitFor(() => expect(getAllByTestId("dictation-bar")).toHaveLength(24));
    for (const bar of getAllByTestId("dictation-bar")) expect(bar.style.backgroundColor).toBe("rgb(1, 2, 3)");
  });

  test("falls back to a real color when the token isn't resolvable (never an empty barColor)", async () => {
    const { getByText, getAllByTestId } = render(<Harness meter={null} />);
    fireEvent.click(getByText("Start dictation"));
    await waitFor(() => expect(getAllByTestId("dictation-bar")).toHaveLength(24));
    for (const bar of getAllByTestId("dictation-bar")) expect(bar.style.backgroundColor).toBeTruthy();
  });

  test("bars animate from the live meter's own read() once one is in context", async () => {
    const meter = fakeLevelMeter(() => 0.5);
    const { getByText, getAllByTestId } = render(<Harness meter={meter} />);
    fireEvent.click(getByText("Start dictation"));
    // The poll interval is 60ms - wait past a few ticks so the rolling
    // window has shifted the fake meter's own 0.5 reading all the way in.
    await waitFor(() => expect(getAllByTestId("dictation-bar").some((bar) => bar.style.height === "50%")).toBe(true), { timeout: 1000 });
  });
});
