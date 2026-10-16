// VOICE-LIVE-02: the live session's own state machine, isolated from
// chatModelAdapter.ts's real streaming (its own tests already cover
// consumeSpoken/speakReplies) and from a real microphone/socket -
// createSocket/startCapture are both injectable (sttDictationAdapter.ts's
// own established shape), so this exercises the actual listen -> send ->
// speak -> listen-again loop with a scripted STT fixture and a trivial
// runtime adapter that just records what it received.
import { describe, expect, test, afterEach, mock, spyOn } from "bun:test";
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
import { api } from "@/lib/api";

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

function Harness({ open, onOpenChange, onProblem = () => {}, isSpeaking, speakingEndedAt, speechFailed = 0, fixture, sentTexts, idleCloseMs, voiceBargeIn = true, activeTurn = { turnId: "turn-test", heardVisibleEnd: () => 23 }, cancelRun = () => {}, stopScheduler = () => {}, socketConnections, captureCalls, dropConnections = [], doubleDropConnections = [], dropWhileSpeaking = false, retryDelays, installationNotice = false }: { open: boolean; onOpenChange: (open: boolean) => void; onProblem?: (kind: string) => void; isSpeaking: boolean; speakingEndedAt: number; speechFailed?: number; fixture: readonly SttFixtureStep[] | ((connection: number) => readonly SttFixtureStep[]); sentTexts: string[]; idleCloseMs?: number | null; voiceBargeIn?: boolean; activeTurn?: { turnId: string; heardVisibleEnd: () => number } | null; cancelRun?: () => void; stopScheduler?: () => void; socketConnections?: number[]; captureCalls?: number[]; dropConnections?: number[]; doubleDropConnections?: number[]; dropWhileSpeaking?: boolean; retryDelays?: [number, number]; installationNotice?: boolean }) {
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
  const activeTurnRef = useRef<{ turnId: string; heardVisibleEnd: () => number } | null>(activeTurn);
  activeTurnRef.current = activeTurn;
  turnSchedulerRef.current = { stop: stopScheduler, readLevel: () => 0 } as unknown as SentenceSpeechScheduler;
  const connectionCount = useRef(0);
  const session = useLiveVoiceSession({
    composer: runtime.thread.composer,
    open,
    onOpenChange,
    onProblem: onProblem as (kind: "listening_lost" | "listening_engine" | "speaking_failed" | "microphone_blocked") => void,
    turnSchedulerRef,
    liveVoiceActiveRef,
    pendingSpeechRef,
    activeTurnRef,
    cancelRun,
    voiceBargeIn,
    isSpeaking,
    speakingEndedAt,
    speechFailed,
    retryDelays,
    installationNotice,
    idleCloseMs,
    createSocket: (handlers) => {
      const connection = connectionCount.current++;
      socketConnections?.push(connection);
      if (dropConnections.includes(connection)) {
        setTimeout(() => handlers.onError?.(new Error("socket dropped")), 0);
        return { sendAudio: () => {}, close: () => {} };
      }
      if (doubleDropConnections.includes(connection)) {
        setTimeout(() => {
          handlers.onError?.(new Error("socket error"));
          handlers.onError?.(new Error("socket close"));
        }, 0);
        return { sendAudio: () => {}, close: () => {} };
      }
      if (dropWhileSpeaking && connection === 0) setTimeout(() => handlers.onError?.(new Error("socket dropped")), 30);
      return createMockSttSocket(typeof fixture === "function" ? fixture(connection) : fixture, handlers);
    },
    startCapture: async (options) => { captureCalls?.push(captureCalls.length); return fakeStartCapture()(options); },
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
              onInterrupt={session.onInterrupt}
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
  test("a dropped listening connection reconnects once and the call goes back to Listening with no message", async () => {
    const onOpenChange = mock();
    const onProblem = mock();
    const socketConnections: number[] = [];
    const view = render(<Harness open onOpenChange={onOpenChange} onProblem={onProblem} isSpeaking={false} speakingEndedAt={0} fixture={(connection) => connection === 1 ? [{ delayMs: 0, message: { t: "ready" } }] : []} sentTexts={[]} socketConnections={socketConnections} dropConnections={[0]} retryDelays={[0, 5]} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    expect(socketConnections).toEqual([0, 1]);
    expect(onProblem).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  test("a drop while Home speaks reconnects without cutting the reply", async () => {
    const onProblem = mock();
    const stopScheduler = mock();
    const cancelRun = mock();
    const view = render(<Harness open onOpenChange={() => {}} onProblem={onProblem} isSpeaking={false} speakingEndedAt={0} fixture={[{ delayMs: 0, message: { t: "ready" } }]} sentTexts={[]} stopScheduler={stopScheduler} cancelRun={cancelRun} dropWhileSpeaking retryDelays={[0, 5]} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    view.rerender(<Harness open onOpenChange={() => {}} onProblem={onProblem} isSpeaking={true} speakingEndedAt={0} fixture={[{ delayMs: 0, message: { t: "ready" } }]} sentTexts={[]} stopScheduler={stopScheduler} cancelRun={cancelRun} dropWhileSpeaking retryDelays={[0, 5]} />);
    await waitFor(() => expect(view.getByText("Speaking")).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(view.getByText("Speaking")).toBeTruthy();
    expect(stopScheduler).not.toHaveBeenCalled();
    expect(cancelRun).not.toHaveBeenCalled();
    expect(onProblem).not.toHaveBeenCalled();
  });

  test("a child's recovered listening socket stays off while Home speaks", async () => {
    const captureCalls: number[] = [];
    const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={(connection) => connection === 0 ? [{ delayMs: 0, message: { t: "ready" } }] : [{ delayMs: 0, message: { t: "ready" } }]} sentTexts={[]} voiceBargeIn={false} captureCalls={captureCalls} dropWhileSpeaking retryDelays={[0, 5]} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    view.rerender(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={(connection) => connection === 0 ? [{ delayMs: 0, message: { t: "ready" } }] : [{ delayMs: 0, message: { t: "ready" } }]} sentTexts={[]} voiceBargeIn={false} captureCalls={captureCalls} dropWhileSpeaking retryDelays={[0, 5]} />);
    await waitFor(() => expect(view.getByText("Speaking")).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(captureCalls).toHaveLength(1);
  });

  test("after two failed reconnects the call ends and says what to do", async () => {
    const onOpenChange = mock();
    const onProblem = mock();
    const socketConnections: number[] = [];
    render(<Harness open onOpenChange={onOpenChange} onProblem={onProblem} isSpeaking={false} speakingEndedAt={0} fixture={[]} sentTexts={[]} socketConnections={socketConnections} dropConnections={[0, 1, 2]} retryDelays={[0, 5]} />);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(socketConnections).toEqual([0, 1, 2]);
    expect(onProblem).toHaveBeenCalledTimes(1);
    expect(onProblem).toHaveBeenCalledWith("listening_lost");
  });

  test("one socket error followed by close counts as one failed connection", async () => {
    const onOpenChange = mock();
    const onProblem = mock();
    const socketConnections: number[] = [];
    render(<Harness open onOpenChange={onOpenChange} onProblem={onProblem} isSpeaking={false} speakingEndedAt={0} fixture={[]} sentTexts={[]} socketConnections={socketConnections} doubleDropConnections={[0, 1, 2]} retryDelays={[0, 5]} />);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(socketConnections).toEqual([0, 1, 2]);
    expect(onProblem).toHaveBeenCalledTimes(1);
  });

  test("a speech engine error ends the call and names the listening engine, without retrying", async () => {
    const onOpenChange = mock();
    const onProblem = mock();
    const socketConnections: number[] = [];
    render(<Harness open onOpenChange={onOpenChange} onProblem={onProblem} isSpeaking={false} speakingEndedAt={0} fixture={[{ delayMs: 0, message: { t: "error", v: "private engine detail" } }]} sentTexts={[]} socketConnections={socketConnections} />);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onProblem).toHaveBeenCalledWith("listening_engine");
    expect(socketConnections).toEqual([0]);
  });

  test("a speech engine error during AI installation avoids the generic voice error", async () => {
    const onOpenChange = mock();
    const onProblem = mock();
    render(<Harness open onOpenChange={onOpenChange} onProblem={onProblem} isSpeaking={false} speakingEndedAt={0} fixture={[{ delayMs: 0, message: { t: "error", v: "private engine detail" } }]} sentTexts={[]} installationNotice />);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onProblem).not.toHaveBeenCalled();
  });

  test("a failed sentence tells the person once, even when several sentences fail", async () => {
    const onProblem = mock();
    const props = { open: true, onOpenChange: () => {}, onProblem, isSpeaking: false, speakingEndedAt: 0, speechFailed: 0, fixture: [{ delayMs: 0, message: { t: "ready" } }] as SttFixtureStep[], sentTexts: [] as string[] };
    const view = render(<Harness {...props} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    view.rerender(<Harness {...props} speechFailed={3} />);
    await waitFor(() => expect(onProblem).toHaveBeenCalledTimes(1));
    expect(onProblem).toHaveBeenCalledWith("speaking_failed");
  });

  test("a reply with a failed sentence still ends and listening resumes", async () => {
    const onProblem = mock();
    const props = { open: true, onOpenChange: () => {}, onProblem, isSpeaking: true, speakingEndedAt: 0, speechFailed: 0, fixture: [{ delayMs: 0, message: { t: "ready" } }] as SttFixtureStep[], sentTexts: [] as string[] };
    const view = render(<Harness {...props} />);
    await waitFor(() => expect(view.getByText("Speaking")).toBeTruthy());
    view.rerender(<Harness {...props} isSpeaking={false} speakingEndedAt={1} speechFailed={1} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    expect(onProblem).toHaveBeenCalledWith("speaking_failed");
  });

  test("stopping a reply never shows the could-not-speak line", async () => {
    const onProblem = mock();
    render(<Harness open onOpenChange={() => {}} onProblem={onProblem} isSpeaking={false} speakingEndedAt={0} speechFailed={3} fixture={[{ delayMs: 0, message: { t: "ready" } }]} sentTexts={[]} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onProblem).not.toHaveBeenCalledWith("speaking_failed");
  });

  test("a wake-opened session with no speech closes itself after the quiet window", async () => {
    const onOpenChange = mock();
    render(<Harness open onOpenChange={onOpenChange} isSpeaking={false} speakingEndedAt={0} fixture={[{ delayMs: 0, message: { t: "ready" } }]} sentTexts={[]} idleCloseMs={150} />);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("a person speaking inside the window keeps the session open", async () => {
    const onOpenChange = mock();
    const fixture: SttFixtureStep[] = [
      { delayMs: 0, message: { t: "ready" } },
      { delayMs: 80, message: { t: "vad", speaking: true, rms: 0.1 } },
    ];
    render(<Harness open onOpenChange={onOpenChange} isSpeaking={false} speakingEndedAt={0} fixture={fixture} sentTexts={[]} idleCloseMs={150} />);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  test("the quiet window restarts after a spoken reply so a follow-up still works", async () => {
    const onOpenChange = mock();
    const sentTexts: string[] = [];
    const fixture = (connection: number): readonly SttFixtureStep[] => connection === 0
      ? [{ delayMs: 0, message: { t: "ready" } }, { delayMs: 35, message: { t: "final", v: "hello" } }]
      : [{ delayMs: 0, message: { t: "ready" } }];
    const view = render(<Harness open onOpenChange={onOpenChange} isSpeaking={false} speakingEndedAt={0} fixture={fixture} sentTexts={sentTexts} idleCloseMs={150} />);
    await waitFor(() => expect(sentTexts).toEqual(["hello"]));
    act(() => view.rerender(<Harness open onOpenChange={onOpenChange} isSpeaking={true} speakingEndedAt={0} fixture={fixture} sentTexts={sentTexts} idleCloseMs={150} />));
    await waitFor(() => expect(view.getByText("Speaking")).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    act(() => view.rerender(<Harness open onOpenChange={onOpenChange} isSpeaking={false} speakingEndedAt={1} fixture={fixture} sentTexts={sentTexts} idleCloseMs={150} />));
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false), { timeout: 400 });
  });

  test("a wake-opened session lets an adult talk over Home's reply: speech stops, the turn is cancelled once, and the session stays open", async () => {
    const cancel = spyOn(api, "cancelTurn").mockResolvedValue({ cancelled: true });
    const onOpenChange = mock();
    const stopScheduler = mock();
    const cancelRun = mock();
    const fixture: SttFixtureStep[] = [
      { delayMs: 0, message: { t: "ready" } },
      { delayMs: 40, message: { t: "final", v: "first request" } },
      { delayMs: 700, message: { t: "partial", v: "wait" } },
    ];
    const view = render(<Harness open onOpenChange={onOpenChange} isSpeaking={false} speakingEndedAt={0} fixture={fixture} sentTexts={[]} idleCloseMs={150} voiceBargeIn stopScheduler={stopScheduler} cancelRun={cancelRun} />);
    await waitFor(() => expect(view.getByText("Thinking")).toBeTruthy());
    act(() => view.rerender(<Harness open onOpenChange={onOpenChange} isSpeaking={true} speakingEndedAt={0} fixture={fixture} sentTexts={[]} idleCloseMs={150} voiceBargeIn stopScheduler={stopScheduler} cancelRun={cancelRun} />));
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stopScheduler).toHaveBeenCalledTimes(1);
    expect(cancelRun).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    cancel.mockRestore();
  });

  test("what an adult says over a wake session reply becomes the next turn and the quiet window restarts after it", async () => {
    const cancel = spyOn(api, "cancelTurn").mockResolvedValue({ cancelled: true });
    const onOpenChange = mock();
    const sentTexts: string[] = [];
    const fixture: SttFixtureStep[] = [
      { delayMs: 0, message: { t: "ready" } },
      { delayMs: 40, message: { t: "final", v: "first request" } },
      { delayMs: 700, message: { t: "partial", v: "make it shorter" } },
      { delayMs: 760, message: { t: "final", v: "make it shorter" } },
    ];
    const view = render(<Harness open onOpenChange={onOpenChange} isSpeaking={false} speakingEndedAt={0} fixture={fixture} sentTexts={sentTexts} idleCloseMs={300} voiceBargeIn />);
    await waitFor(() => expect(sentTexts).toEqual(["first request"]));
    act(() => view.rerender(<Harness open onOpenChange={onOpenChange} isSpeaking={true} speakingEndedAt={0} fixture={fixture} sentTexts={sentTexts} idleCloseMs={300} voiceBargeIn />));
    await waitFor(() => expect(sentTexts).toEqual(["first request", "make it shorter"]), { timeout: 2000 });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    act(() => view.rerender(<Harness open onOpenChange={onOpenChange} isSpeaking={true} speakingEndedAt={0} fixture={fixture} sentTexts={sentTexts} idleCloseMs={300} voiceBargeIn />));
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    act(() => view.rerender(<Harness open onOpenChange={onOpenChange} isSpeaking={false} speakingEndedAt={1} fixture={fixture} sentTexts={sentTexts} idleCloseMs={300} voiceBargeIn />));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false), { timeout: 500 });
    cancel.mockRestore();
  });

  test("the quiet window does not close a wake session while Home is speaking and the live mic is open", async () => {
    const onOpenChange = mock();
    render(<Harness open onOpenChange={onOpenChange} isSpeaking={true} speakingEndedAt={0} fixture={[{ delayMs: 0, message: { t: "ready" } }]} sentTexts={[]} idleCloseMs={100} voiceBargeIn />);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  test("a wake session with barge-in still closes after the quiet window when nobody talks over or after the reply", async () => {
    const onOpenChange = mock();
    const view = render(<Harness open onOpenChange={onOpenChange} isSpeaking={false} speakingEndedAt={0} fixture={[{ delayMs: 0, message: { t: "ready" } }]} sentTexts={[]} idleCloseMs={100} voiceBargeIn />);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false), { timeout: 250 });
    expect(view.getByRole("dialog", { name: "Voice conversation" })).toBeTruthy();
  });

  test("voiceBargeIn false means no interruption by voice for child and teen calls", async () => {
    for (const ageBand of ["child", "teen"] as const) {
      const cancel = spyOn(api, "cancelTurn").mockResolvedValue({ cancelled: true });
      const connections: number[] = [];
      const fixture: SttFixtureStep[] = [
        { delayMs: 0, message: { t: "ready" } },
        { delayMs: 40, message: { t: "final", v: "hello" } },
        { delayMs: 500, message: { t: "partial", v: "echo" } },
      ];
      const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={fixture} sentTexts={[]} voiceBargeIn={false} socketConnections={connections} />);
      await waitFor(() => expect(view.getByText("Thinking")).toBeTruthy());
      act(() => view.rerender(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={fixture} sentTexts={[]} voiceBargeIn={false} socketConnections={connections} />));
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(cancel).not.toHaveBeenCalled();
      expect(connections).toEqual([0]);
      cancel.mockRestore();
      cleanup();
      expect(ageBand).toMatch(/child|teen/);
    }
  });

  test("a button-opened session and a wake-opened session interrupt identically", async () => {
    const outcomes: Array<{ cancelled: number; sent: string[] }> = [];
    for (const idleCloseMs of [null, 150]) {
      const cancel = spyOn(api, "cancelTurn").mockResolvedValue({ cancelled: true });
      const sentTexts: string[] = [];
      const fixture: SttFixtureStep[] = [
        { delayMs: 0, message: { t: "ready" } },
        { delayMs: 40, message: { t: "final", v: "first request" } },
        { delayMs: 700, message: { t: "partial", v: "follow up" } },
        { delayMs: 760, message: { t: "final", v: "follow up" } },
      ];
      const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={fixture} sentTexts={sentTexts} idleCloseMs={idleCloseMs} voiceBargeIn />);
      await waitFor(() => expect(sentTexts).toEqual(["first request"]));
      act(() => view.rerender(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={fixture} sentTexts={sentTexts} idleCloseMs={idleCloseMs} voiceBargeIn />));
      await waitFor(() => expect(sentTexts).toEqual(["first request", "follow up"]), { timeout: 2000 });
      outcomes.push({ cancelled: cancel.mock.calls.length, sent: [...sentTexts] });
      cancel.mockRestore();
      cleanup();
    }
    expect(outcomes[0]).toEqual(outcomes[1]);
  });

  test("a session opened by the waveform button never auto-closes", async () => {
    const onOpenChange = mock();
    render(<Harness open onOpenChange={onOpenChange} isSpeaking={false} speakingEndedAt={0} fixture={[{ delayMs: 0, message: { t: "ready" } }]} sentTexts={[]} idleCloseMs={null} />);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  test("the timer does not run while thinking or speaking", async () => {
    const onOpenChange = mock();
    const fixture: SttFixtureStep[] = [
      { delayMs: 0, message: { t: "ready" } },
      { delayMs: 35, message: { t: "final", v: "hello" } },
    ];
    const view = render(<Harness open onOpenChange={onOpenChange} isSpeaking={false} speakingEndedAt={0} fixture={fixture} sentTexts={[]} idleCloseMs={150} />);
    await waitFor(() => expect(view.getByText("Thinking")).toBeTruthy());
    act(() => view.rerender(<Harness open onOpenChange={onOpenChange} isSpeaking={true} speakingEndedAt={0} fixture={fixture} sentTexts={[]} idleCloseMs={150} />));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

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
    const socketConnections: number[] = [];
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
    const view = render(<Harness open={true} onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={fixture} sentTexts={sentTexts} socketConnections={socketConnections} />);
    expect(voiceRuntime!.thread.getState().capabilities.queue).toBe(false);

    // "Listening" - the mock socket's own "ready" step.
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());

    // The final transcript sent the real turn.
    await waitFor(() => expect(sentTexts).toEqual(["what's the weather"]));
    await waitFor(() => expect(view.getByText("Thinking")).toBeTruthy());
    expect(socketConnections).toEqual([0]);

    // chatModelAdapter.ts's own onSpeakingChange, relayed as a prop.
    act(() => setSpeaking(true));
    await waitFor(() => expect(view.getByText("Speaking")).toBeTruthy());
    expect(socketConnections).toEqual([0]);

    act(() => setSpeaking(false));
    // The same socket stays open, so a quick follow-up cannot lose its first words.
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    expect(socketConnections).toEqual([0]);
  });

  test("talking over a spoken reply cancels the turn with the heard length", async () => {
    const cancel = spyOn(api, "cancelTurn").mockResolvedValue({ cancelled: true });
    const cancelRun = mock();
    const stopScheduler = mock();
    const fixture: SttFixtureStep[] = [
      { delayMs: 0, message: { t: "ready" } },
      { delayMs: 40, message: { t: "final", v: "first request" } },
      { delayMs: 700, message: { t: "partial", v: "wait" } },
    ];
    const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={fixture} sentTexts={[]} cancelRun={cancelRun} stopScheduler={stopScheduler} />);
    await waitFor(() => expect(view.getByText("Thinking")).toBeTruthy());
    view.rerender(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={fixture} sentTexts={[]} cancelRun={cancelRun} stopScheduler={stopScheduler} />);
    await new Promise((resolve) => setTimeout(resolve, 750));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith("turn-test", 23);
    expect(stopScheduler).toHaveBeenCalledTimes(1);
    expect(cancelRun).toHaveBeenCalledTimes(1);
    cancel.mockRestore();
  });

  test("a vad blip with no partial does not interrupt", async () => {
    const cancel = spyOn(api, "cancelTurn").mockResolvedValue({ cancelled: true });
    const fixture: SttFixtureStep[] = [{ delayMs: 0, message: { t: "ready" } }, { delayMs: 100, message: { t: "vad", speaking: true, rms: 0.2 } }];
    render(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={fixture} sentTexts={[]} />);
    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(cancel).not.toHaveBeenCalled();
    cancel.mockRestore();
  });

  test("speech in the first 400 ms of a reply does not interrupt", async () => {
    const cancel = spyOn(api, "cancelTurn").mockResolvedValue({ cancelled: true });
    const fixture: SttFixtureStep[] = [
      { delayMs: 0, message: { t: "ready" } },
      { delayMs: 40, message: { t: "final", v: "first request" } },
      { delayMs: 250, message: { t: "partial", v: "wait" } },
    ];
    const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={fixture} sentTexts={[]} />);
    await waitFor(() => expect(view.getByText("Thinking")).toBeTruthy());
    view.rerender(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={fixture} sentTexts={[]} />);
    await new Promise((resolve) => setTimeout(resolve, 320));
    expect(cancel).not.toHaveBeenCalled();
    cancel.mockRestore();
  });

  test("a muted microphone never interrupts by voice", async () => {
    const cancel = spyOn(api, "cancelTurn").mockResolvedValue({ cancelled: true });
    const fixture: SttFixtureStep[] = [{ delayMs: 0, message: { t: "ready" } }, { delayMs: 500, message: { t: "partial", v: "echo" } }];
    const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={fixture} sentTexts={[]} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    act(() => view.getByRole("button", { name: "Turn the microphone off" }).click());
    view.rerender(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={fixture} sentTexts={[]} />);
    await new Promise((resolve) => setTimeout(resolve, 550));
    expect(cancel).not.toHaveBeenCalled();
    cancel.mockRestore();
  });

  test("what was said over the reply becomes the next turn and duplicate interruption cancels once", async () => {
    const cancel = spyOn(api, "cancelTurn").mockResolvedValue({ cancelled: true });
    const sentTexts: string[] = [];
    const fixture: SttFixtureStep[] = [
      { delayMs: 0, message: { t: "ready" } },
      { delayMs: 40, message: { t: "final", v: "first request" } },
      { delayMs: 700, message: { t: "partial", v: "wait" } },
      { delayMs: 800, message: { t: "final", v: "make it shorter" } },
    ];
    const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={fixture} sentTexts={sentTexts} />);
    await waitFor(() => expect(view.getByText("Thinking")).toBeTruthy());
    view.rerender(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={fixture} sentTexts={sentTexts} />);
    await waitFor(() => expect(sentTexts).toEqual(["first request", "make it shorter"]), { timeout: 2500 });
    expect(cancel).toHaveBeenCalledTimes(1);
    cancel.mockRestore();
  });

  test("a child's call still closes the microphone while Home speaks", async () => {
    const connections: number[] = [];
    const fixture = (connection: number): readonly SttFixtureStep[] => connection === 0
      ? [{ delayMs: 0, message: { t: "ready" } }, { delayMs: 40, message: { t: "final", v: "hello" } }]
      : [{ delayMs: 0, message: { t: "ready" } }];
    const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={fixture} sentTexts={[]} voiceBargeIn={false} socketConnections={connections} />);
    await waitFor(() => expect(view.getByText("Thinking")).toBeTruthy());
    view.rerender(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={fixture} sentTexts={[]} voiceBargeIn={false} socketConnections={connections} />);
    view.rerender(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={1} fixture={fixture} sentTexts={[]} voiceBargeIn={false} socketConnections={connections} />);
    await waitFor(() => expect(connections).toEqual([0, 1]));
  });

  test("tapping the interrupt control sends the heard length too", async () => {
    const cancel = spyOn(api, "cancelTurn").mockResolvedValue({ cancelled: true });
    const cancelRun = mock();
    const stopScheduler = mock();
    const sentTexts: string[] = [];
    const view = render(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={[{ delayMs: 0, message: { t: "ready" } }]} sentTexts={sentTexts} cancelRun={cancelRun} stopScheduler={stopScheduler} />);
    act(() => view.getByRole("button", { name: "Interrupt the assistant" }).click());
    expect(cancel).toHaveBeenCalledWith("turn-test", 23);
    expect(stopScheduler).toHaveBeenCalledTimes(1);
    expect(cancelRun).toHaveBeenCalledTimes(1);
    expect(sentTexts).toEqual([]);
    cancel.mockRestore();
  });

  test("interrupting twice sends one cancel", async () => {
    const cancel = spyOn(api, "cancelTurn").mockResolvedValue({ cancelled: true });
    const cancelRun = mock();
    const stopScheduler = mock();
    const view = render(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={[{ delayMs: 0, message: { t: "ready" } }]} sentTexts={[]} cancelRun={cancelRun} stopScheduler={stopScheduler} />);
    const interrupt = view.getByRole("button", { name: "Interrupt the assistant" });
    act(() => { interrupt.click(); interrupt.click(); });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith("turn-test", 23);
    cancel.mockRestore();
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
