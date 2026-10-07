import { afterEach, describe, expect, jest, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { AssistantRuntimeProvider, ComposerPrimitive, useLocalRuntime, type ChatModelAdapter, type DictationAdapter } from "@assistant-ui/react";
import type { LevelMeter } from "@/lib/voice/audioLevelMeter";
import { ComposerDictationWaveform, DictationLevelMeterProvider } from "@/apps/chat/composerDictationWaveform";
import { ChatAvailabilityContext } from "@/apps/chat/useChatAvailability";

let runs = 0;
const chatAdapter: ChatModelAdapter = {
  async *run() {
    runs += 1;
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
        <ComposerPrimitive.Root>
        <ComposerPrimitive.Dictate>Start dictation</ComposerPrimitive.Dictate>
        <ComposerDictationWaveform />
        </ComposerPrimitive.Root>
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

  // CHAT-CALM-ERRORS-01d (design section 7): while chat is paused or
  // starting the field stays usable so a thought is not lost; the composer
  // line says why (ChatPage.calmErrors.test.tsx), and Enter sends nothing.
  test.each(["unavailable", "starting"] as const)("%s keeps the input usable with the plain placeholder, and Enter sends nothing", async (availability) => {
    runs = 0;
    const { getByLabelText } = render(<Harness meter={null} availability={availability} />);
    const input = getByLabelText("Message input") as HTMLTextAreaElement;
    expect(input.disabled).toBe(false);
    expect(input.placeholder).toBe("Send a message...");
    fireEvent.change(input, { target: { value: "hold this" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(runs).toBe(0);
    expect(input.value).toBe("hold this");
  });

  test("becoming ready lets Enter send again", async () => {
    runs = 0;
    const view = render(<Harness meter={null} availability="unavailable" />);
    view.rerender(<Harness meter={null} availability="ready" />);
    const input = view.getByLabelText("Message input") as HTMLTextAreaElement;
    expect(input.disabled).toBe(false);
    fireEvent.change(input, { target: { value: "go" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(runs).toBe(1));
  });

  test("dictating: uses the shipped voice-level Element and the real input is gone", async () => {
    const { getByText, container, queryByLabelText } = render(<Harness meter={null} />);
    fireEvent.click(getByText("Start dictation"));
    await waitFor(() => expect(container.querySelector('[data-slot="composer-voice-levels"]')).not.toBeNull());
    expect(container.querySelectorAll('[data-slot="composer-voice-levels"] [data-bar]')).toHaveLength(14);
    expect(container.querySelector('[data-slot="composer-voice-levels"]')?.getAttribute("data-recording")).toBe("true");
    expect(queryByLabelText("Message input")).toBeNull();
  });

  test("the accessible text is present once dictating, even before the bars have anything to show", async () => {
    const { getByText, getByRole } = render(<Harness meter={null} />);
    fireEvent.click(getByText("Start dictation"));
    await waitFor(() => expect(getByRole("status", { name: "Listening" })).toBeDefined());
  });

  test("voice levels use the live meter's own read()", async () => {
    const meter = fakeLevelMeter(() => 0.5);
    const { getByText, container } = render(<Harness meter={meter} />);
    fireEvent.click(getByText("Start dictation"));
    // The poll interval is 60ms - wait past a few ticks so the rolling
    // window has shifted the fake meter's own 0.5 reading all the way in.
    await waitFor(() => expect(Array.from(container.querySelectorAll('[data-slot="composer-voice-levels"] [data-bar]')).some((bar) => (bar as HTMLElement).style.height === "13.5px")).toBe(true), { timeout: 1000 });
  });

  test("the kit voice-level timer advances once a second", async () => {
    jest.useFakeTimers();
    try {
      const { getByText, getByRole } = render(<Harness meter={null} />);
      fireEvent.click(getByText("Start dictation"));
      await waitFor(() => expect(getByRole("status", { name: "Listening" }).textContent).toContain("0:00"));
      act(() => jest.advanceTimersByTime(3_000));
      expect(getByRole("status", { name: "Listening" }).textContent).toContain("0:03");
    } finally {
      jest.useRealTimers();
    }
  });
});
