// VOICE-LIVE-02: the live session's own state machine, isolated from
// chatModelAdapter.ts's real streaming (its own tests already cover
// consumeSpoken/speakReplies) and from a real microphone/socket -
// createSocket/startCapture are both injectable (sttDictationAdapter.ts's
// own established shape), so this exercises the actual listen -> send ->
// speak -> listen-again loop with a scripted STT fixture and a trivial
// runtime adapter that just records what it received.
import { describe, expect, test, afterEach } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { Link, MemoryRouter } from "react-router-dom";
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter } from "@assistant-ui/react";
import { Dialog, DialogContent } from "@maipai/ui/src/ui/dialog";
import { VoiceConversation } from "@maipai/ui/src/elements/voice-conversation";
import { TooltipIconButton } from "@maipai/ui/src/elements/tooltip-icon-button";
import { getIcon } from "@maipai/ui/src/icons";
import { useLiveVoiceSession } from "@/apps/chat/liveVoiceSession";
import { createMockSttSocket, type SttFixtureStep } from "@/lib/voice/sttSocket";
import type { MicCaptureHandle, MicCaptureOptions } from "@/lib/voice/mic-capture";
import type { SentenceSpeechScheduler } from "@/lib/sentenceSpeechScheduler";

afterEach(cleanup);

let voiceRuntime: ReturnType<typeof useLocalRuntime> | undefined;

function fakeStartCapture(): (options: MicCaptureOptions) => Promise<MicCaptureHandle> {
  return async (options: MicCaptureOptions) => {
    const fakeAnalyser = { fftSize: 0, smoothingTimeConstant: 0, frequencyBinCount: 8, connect: () => {}, disconnect: () => {}, getByteTimeDomainData: (data: Uint8Array) => data.fill(128) };
    const fakeContext = { createAnalyser: () => fakeAnalyser } as unknown as AudioContext;
    const fakeSource = { connect: () => {} } as unknown as MediaStreamAudioSourceNode;
    options.onSource?.(fakeContext, fakeSource);
    return { stop: () => {}, sampleRate: 16_000 };
  };
}

const SettingsIcon = getIcon("settings");

function Harness({ open, onOpenChange, isSpeaking, speakingEndedAt, fixture, sentTexts }: { open: boolean; onOpenChange: (open: boolean) => void; isSpeaking: boolean; speakingEndedAt: number; fixture: readonly SttFixtureStep[]; sentTexts: string[] }) {
  const adapter: ChatModelAdapter = {
    async *run({ messages }) {
      const last = messages[messages.length - 1];
      const part = last?.content[0];
      sentTexts.push(part && part.type === "text" ? part.text : "");
      yield { content: [{ type: "text", text: "ok" }] };
    },
  };
  const runtime = useLocalRuntime(adapter, { unstable_enableMessageQueue: !open });
  voiceRuntime = runtime;
  const turnSchedulerRef = useRef<SentenceSpeechScheduler | null>(null);
  const liveVoiceActiveRef = useRef(false);
  const pendingSpeechRef = useRef(false);
  const session = useLiveVoiceSession({
    composer: runtime.thread.composer,
    open,
    onOpenChange,
    turnSchedulerRef,
    liveVoiceActiveRef,
    pendingSpeechRef,
    isSpeaking,
    speakingEndedAt,
    createSocket: (handlers) => createMockSttSocket(fixture, handlers),
    startCapture: fakeStartCapture(),
  });
  return (
    <MemoryRouter initialEntries={["/chat"]}>
      <AssistantRuntimeProvider runtime={runtime}>
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent variant="call" showCloseButton={false} aria-label="Voice conversation">
            <VoiceConversation
              mode={session.mode}
              amplitude={session.amplitude}
              muted={session.muted}
              onToggleMute={session.onToggleMute}
              onEnd={session.onEnd}
              extra={(
                <TooltipIconButton asChild tooltip="Voice settings">
                  <Link to="/settings/voices" aria-label="Voice settings">
                    <SettingsIcon />
                  </Link>
                </TooltipIconButton>
              )}
            />
          </DialogContent>
        </Dialog>
      </AssistantRuntimeProvider>
    </MemoryRouter>
  );
}

describe("live voice session", () => {
  test("renders nothing while closed", () => {
    const view = render(<Harness open={false} onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={[]} sentTexts={[]} />);
    expect(view.container).toBeEmptyDOMElement();
  });

  test("opening the session presents the voice call dialog", async () => {
    const props = { onOpenChange: () => {}, isSpeaking: false, speakingEndedAt: 0, fixture: [] as SttFixtureStep[], sentTexts: [] as string[] };
    const view = render(<Harness open={false} {...props} />);
    expect(view.queryByRole("dialog")).toBeNull();
    view.rerender(<Harness open={true} {...props} />);
    await waitFor(() => expect(view.getByRole("dialog", { name: "Voice conversation" })).toBeTruthy());
    expect(view.getByText("Connecting")).toBeTruthy();
  });

  test("listens, sends the final transcript through the real composer, and shows listening then speaking then listening again", async () => {
    const sentTexts: string[] = [];
    let isSpeaking = false;
    let speakingEndedAt = 0;
    const setSpeaking = (speaking: boolean) => {
      isSpeaking = speaking;
      if (!speaking) speakingEndedAt += 1;
      view.rerender(<Harness open={true} onOpenChange={() => {}} isSpeaking={isSpeaking} speakingEndedAt={speakingEndedAt} fixture={fixture} sentTexts={sentTexts} />);
    };
    const fixture: SttFixtureStep[] = [
      { delayMs: 0, message: { t: "ready" } },
      { delayMs: 150, message: { t: "final", v: "what's the weather" } },
    ];
    const view = render(<Harness open={true} onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={fixture} sentTexts={sentTexts} />);
    expect(voiceRuntime!.thread.getState().capabilities.queue).toBe(false);

    // "Listening" - the mock socket's own "ready" step.
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());

    // The final transcript sent the real turn.
    await waitFor(() => expect(sentTexts).toEqual(["what's the weather"]));
    await waitFor(() => expect(view.getByText("Thinking")).toBeTruthy());

    // chatModelAdapter.ts's own onSpeakingChange, relayed as a prop.
    act(() => setSpeaking(true));
    await waitFor(() => expect(view.getByText("Speaking")).toBeTruthy());

    act(() => setSpeaking(false));
    // Looping back: a fresh mock socket session opens (the same fixture
    // replays), so "Listening" shows again without the overlay closing.
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
  });

  // A code review caught this: a reply that never speaks at all (empty,
  // or every sentence's TTS synthesis failed) never fires
  // onSpeakingChange(true) first, so the "false" call arrives with
  // isSpeaking already false - a same-value React update that used to
  // never re-run the effect that resumes listening, leaving the call
  // stuck on "Thinking" forever. speakingEndedAt bumps on every "false"
  // call regardless of the previous value, closing that gap.
  test("a reply that never speaks (isSpeaking stays false throughout) still resumes listening once speakingEndedAt bumps", async () => {
    const sentTexts: string[] = [];
    const fixture: SttFixtureStep[] = [
      { delayMs: 0, message: { t: "ready" } },
      { delayMs: 150, message: { t: "final", v: "hi" } },
    ];
    const view = render(<Harness open={true} onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={fixture} sentTexts={sentTexts} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    await waitFor(() => expect(sentTexts).toEqual(["hi"]));
    await waitFor(() => expect(view.getByText("Thinking")).toBeTruthy());

    // isSpeaking never becomes true - only speakingEndedAt moves,
    // exactly what a same-value onSpeakingChange(false) call produces.
    act(() => {
      view.rerender(<Harness open={true} onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={1} fixture={fixture} sentTexts={sentTexts} />);
    });
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
  });

  test("no_speech re-listens instead of sending an empty turn", async () => {
    const sentTexts: string[] = [];
    const fixture: SttFixtureStep[] = [
      { delayMs: 0, message: { t: "ready" } },
      { delayMs: 150, message: { t: "no_speech" } },
    ];
    const view = render(<Harness open={true} onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={fixture} sentTexts={sentTexts} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    // The fixture replays (a fresh socket per generation) - still
    // listening, never a send.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(sentTexts).toEqual([]);
    expect(view.getByText("Listening")).toBeTruthy();
  });

  test("onEnd requests that the voice call dialog close", async () => {
    const fixture: SttFixtureStep[] = [{ delayMs: 0, message: { t: "ready" } }];
    const openChanges: boolean[] = [];
    const onOpenChange = (value: boolean) => openChanges.push(value);
    const view = render(<Harness open={true} onOpenChange={onOpenChange} isSpeaking={false} speakingEndedAt={0} fixture={fixture} sentTexts={[]} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    act(() => view.getByRole("button", { name: "End the call" }).click());
    expect(openChanges).toEqual([false]);
  });

  test("mute toggles the kit control and its accessible state", async () => {
    const fixture: SttFixtureStep[] = [{ delayMs: 0, message: { t: "ready" } }];
    const view = render(<Harness open={true} onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={fixture} sentTexts={[]} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    const mute = view.getByRole("button", { name: "Turn the microphone off" });
    expect(mute.getAttribute("aria-pressed")).toBe("false");
    act(() => mute.click());
    const unmute = view.getByRole("button", { name: "Turn the microphone on" });
    expect(unmute.getAttribute("aria-pressed")).toBe("true");
  });

  test("the extra Settings link points to Settings > Voice", async () => {
    const fixture: SttFixtureStep[] = [{ delayMs: 0, message: { t: "ready" } }];
    const view = render(<Harness open={true} onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={fixture} sentTexts={[]} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    const gear = view.getByRole("link", { name: "Voice settings" });
    expect(gear.getAttribute("href")).toBe("/settings/voices");
  });
});
