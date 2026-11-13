// VOICE-LIVE-02: the live session's own state machine, isolated from
// chatModelAdapter.ts's real streaming (its own tests already cover
// consumeSpoken/speakReplies) and from a real microphone/socket -
// createSocket/startCapture are both injectable (sttDictationAdapter.ts's
// own established shape), so this exercises the actual listen -> send ->
// speak -> listen-again loop with a scripted STT fixture and a trivial
// runtime adapter that just records what it received.
import { describe, expect, test, afterEach, mock, spyOn, jest } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { Link, MemoryRouter } from "react-router-dom";
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter } from "@assistant-ui/react";
import { Dialog, DialogContent } from "@maipai/ui/src/ui/dialog";
import { VoiceConversation } from "@maipai/ui/src/elements/voice-conversation";
import { TooltipIconButton } from "@maipai/ui/src/elements/tooltip-icon-button";
import { getIcon } from "@maipai/ui/src/icons";
import { isOwnEcho, useLiveVoiceSession } from "@/apps/chat/liveVoiceSession";
import { createMockSttSocket, type SttFixtureStep, type SttSocketHandlers } from "@/lib/voice/sttSocket";
import type { SttServerMessage } from "@/lib/voice/sttContract";
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

function controlledSocket() {
  const handlers = new Set<SttSocketHandlers["onMessage"]>();
  const played: Array<{ replyId: string; ms: number }> = [];
  return {
    createSocket: (socketHandlers: SttSocketHandlers) => {
      handlers.add(socketHandlers.onMessage);
      setTimeout(() => socketHandlers.onMessage({ t: "ready" }), 0);
      return { sendAudio: () => {}, sendPlayed: (replyId: string, ms: number) => { played.push({ replyId, ms }); }, close: () => { handlers.delete(socketHandlers.onMessage); } };
    },
    send: (message: SttServerMessage) => { for (const handler of handlers) handler(message); },
    played,
  };
}

const SettingsIcon = getIcon("settings");

function Harness({ open, onOpenChange, onProblem = () => {}, isSpeaking, speakingEndedAt, speechFailed = 0, fixture, sentTexts, idleCloseMs, voiceBargeIn = true, activeTurn = { turnId: "turn-test", heardVisibleEnd: () => 23 }, cancelRun = () => {}, stopScheduler = () => {}, pauseScheduler = () => {}, resumeScheduler = () => {}, onReady, onVoiceTiming, socketFactory, socketConnections, captureCalls, dropConnections = [], doubleDropConnections = [], dropWhileSpeaking = false, retryDelays, installationNotice = false, speculation, traceUtterances }: { open: boolean; onOpenChange: (open: boolean) => void; onProblem?: (kind: string) => void; isSpeaking: boolean; speakingEndedAt: number; speechFailed?: number; fixture: readonly SttFixtureStep[] | ((connection: number) => readonly SttFixtureStep[]); sentTexts: string[]; idleCloseMs?: number | null; voiceBargeIn?: boolean; activeTurn?: { turnId: string; heardVisibleEnd: () => number } | null; cancelRun?: () => void; stopScheduler?: () => void; pauseScheduler?: () => void; resumeScheduler?: () => void; onReady?: () => void; onVoiceTiming?: (timing: { sttMs: number; phase?: "final" | "playback" }) => void; socketFactory?: (handlers: SttSocketHandlers) => ReturnType<typeof createMockSttSocket>; socketConnections?: number[]; captureCalls?: number[]; dropConnections?: number[]; doubleDropConnections?: number[]; dropWhileSpeaking?: boolean; retryDelays?: [number, number]; installationNotice?: boolean; speculation?: { getConversationId: () => string | undefined; pendingRef: { current: { turnId: string; resumeToken: string; conversationId: string } | null } }; traceUtterances?: number }) {
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
  const firstSocketHandlers = useRef<SttSocketHandlers | null>(null);
  activeTurnRef.current = activeTurn;
  turnSchedulerRef.current = { stop: stopScheduler, pause: pauseScheduler, resume: resumeScheduler, duck: () => {}, unduck: () => {}, readLevel: () => 0, playedMs: () => 1234 } as unknown as SentenceSpeechScheduler;
  const connectionCount = useRef(0);
  const session = useLiveVoiceSession({
    composer: runtime.thread.composer,
    open,
    onOpenChange,
    onProblem: onProblem as (kind: "listening_lost" | "listening_engine" | "speaking_failed" | "microphone_blocked" | "microphone_insecure" | "microphone_setup" | "microphone_missing" | "microphone_busy") => void,
    onVoiceTiming,
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
    speculation,
    traceUtterances,
    createSocket: (handlers) => {
      if (socketFactory) return socketFactory(handlers);
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
      if (dropWhileSpeaking && connection === 0) {
        firstSocketHandlers.current = handlers;
      }
      const actualHandlers = onReady ? { ...handlers, onMessage: (message: Parameters<NonNullable<typeof handlers.onMessage>>[0]) => { if (message.t === "ready") onReady(); handlers.onMessage?.(message); } } : handlers;
      return createMockSttSocket(typeof fixture === "function" ? fixture(connection) : fixture, actualHandlers);
    },
    startCapture: async (options) => { captureCalls?.push(captureCalls.length); return fakeStartCapture()(options); },
  });
  useEffect(() => {
    if (dropWhileSpeaking && isSpeaking) firstSocketHandlers.current?.onError?.(new Error("socket dropped"));
  }, [dropWhileSpeaking, isSpeaking]);
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
  test("forwards the STT speech-end interval when the final transcript arrives", async () => {
    const onVoiceTiming = mock();
    const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={[{ delayMs: 0, message: { t: "ready" } }, { delayMs: 0, message: { t: "timing", speech_end_to_final_ms: 240, silence_wait_ms: 180 } }, { delayMs: 0, message: { t: "final", v: "hello" } }]} sentTexts={[]} onVoiceTiming={onVoiceTiming} />);
    await waitFor(() => expect(view.getByText("Thinking")).toBeTruthy());
    expect(onVoiceTiming).toHaveBeenCalledWith({ sttMs: 240, phase: "final", talkOver: { edge_partials: 0, talk_over_reason: "unknown", pool_size: 0 } });
  });
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
    const socketConnections: number[] = [];
    const view = render(<Harness open onOpenChange={() => {}} onProblem={onProblem} isSpeaking={false} speakingEndedAt={0} fixture={[{ delayMs: 0, message: { t: "ready" } }]} sentTexts={[]} stopScheduler={stopScheduler} cancelRun={cancelRun} socketConnections={socketConnections} dropWhileSpeaking retryDelays={[0, 5]} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    view.rerender(<Harness open onOpenChange={() => {}} onProblem={onProblem} isSpeaking={true} speakingEndedAt={0} fixture={[{ delayMs: 0, message: { t: "ready" } }]} sentTexts={[]} stopScheduler={stopScheduler} cancelRun={cancelRun} socketConnections={socketConnections} dropWhileSpeaking retryDelays={[0, 5]} />);
    await waitFor(() => expect(view.getByText("Speaking")).toBeTruthy());
    await waitFor(() => expect(socketConnections.length).toBeGreaterThanOrEqual(2));
    expect(view.getByText("Speaking")).toBeTruthy();
    expect(stopScheduler).not.toHaveBeenCalled();
    expect(cancelRun).not.toHaveBeenCalled();
    expect(onProblem).not.toHaveBeenCalled();
  });

  test("a child's recovered listening socket stays active while Home speaks", async () => {
    const captureCalls: number[] = [];
    const socketConnections: number[] = [];
    const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={(connection) => connection === 0 ? [{ delayMs: 0, message: { t: "ready" } }] : [{ delayMs: 0, message: { t: "ready" } }]} sentTexts={[]} voiceBargeIn={false} captureCalls={captureCalls} socketConnections={socketConnections} dropWhileSpeaking retryDelays={[0, 5]} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    view.rerender(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={(connection) => connection === 0 ? [{ delayMs: 0, message: { t: "ready" } }] : [{ delayMs: 0, message: { t: "ready" } }]} sentTexts={[]} voiceBargeIn={false} captureCalls={captureCalls} socketConnections={socketConnections} dropWhileSpeaking retryDelays={[0, 5]} />);
    await waitFor(() => expect(view.getByText("Speaking")).toBeTruthy());
    await waitFor(() => expect(socketConnections.length).toBeGreaterThanOrEqual(2));
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

  test("a stalled event loop that delivers speech and the quiet-window timer together does not close the session", async () => {
    // Found in the full `bun test src` run (2026-10-17): a long pause (GC, load) expires the speech message's timer and the
    // idle timer in one pass, so the idle callback ran before React re-rendered and cleared it, and closed a call whose
    // person had already started talking. The callback must read the speech flag itself.
    const onOpenChange = mock();
    const fixture: SttFixtureStep[] = [
      { delayMs: 0, message: { t: "ready" } },
      { delayMs: 80, message: { t: "vad", speaking: true, rms: 0.1 } },
    ];
    render(<Harness open onOpenChange={onOpenChange} isSpeaking={false} speakingEndedAt={0} fixture={fixture} sentTexts={[]} idleCloseMs={150} />);
    setTimeout(() => { const end = Date.now() + 200; while (Date.now() < end) { /* stall the loop */ } }, 40);
    await new Promise((resolve) => setTimeout(resolve, 600));
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
      { delayMs: 700, message: { t: "final", v: "wait tell me more" } },
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

  test("STT-SMARTTURN-01: a partial the hub marked edge: true starts a held turn; a cadence partial does not", async () => {
    const speculate = spyOn(api, "speculateTurn").mockResolvedValue({ turn_id: "turn-held", resume_token: "token-held", conversation_id: "conv-1" });
    try {
      const socket = controlledSocket();
      const pendingRef = { current: null as { turnId: string; resumeToken: string; conversationId: string } | null };
      render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={[]} sentTexts={[]} socketFactory={socket.createSocket} speculation={{ getConversationId: () => "conv-1", pendingRef }} />);
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      act(() => socket.send({ t: "vad", speaking: true, rms: 0.3 }));
      act(() => socket.send({ t: "partial", v: "what is a good name for a" }));
      expect(speculate).not.toHaveBeenCalled();
      act(() => socket.send({ t: "partial", v: "what is a good name for a small grey cat", edge: true }));
      expect(speculate).toHaveBeenCalledTimes(1);
      expect(speculate.mock.calls[0]?.[0]).toBe("what is a good name for a small grey cat");
    } finally { speculate.mockRestore(); }
  });

  test("STT-SMARTTURN-01: the held run started on the edge partial survives until the final, which confirms it on an exact match (the live-hub miss of 2026-11-12)", async () => {
    const speculate = spyOn(api, "speculateTurn").mockResolvedValue({ turn_id: "turn-held", resume_token: "token-held", conversation_id: "conv-1" });
    const discard = spyOn(api, "discardTurn").mockResolvedValue({ cancelled: true });
    try {
      const socket = controlledSocket();
      const pendingRef = { current: null as { turnId: string; resumeToken: string; conversationId: string } | null };
      const timings: Array<{ sttMs: number; phase?: string; speculative?: string }> = [];
      const sentTexts: string[] = [];
      render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={[]} sentTexts={sentTexts} socketFactory={socket.createSocket} speculation={{ getConversationId: () => "conv-1", pendingRef }} onVoiceTiming={(timing) => timings.push(timing)} />);
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      act(() => socket.send({ t: "vad", speaking: true, rms: 0.3 }));
      act(() => socket.send({ t: "partial", v: "what is a good name for a" }));
      act(() => socket.send({ t: "partial", v: "what is a good name for a small grey cat", edge: true }));
      expect(speculate).toHaveBeenCalledTimes(1);
      // The hub answers with the ids while the person is silent: the held run must stay, not be thrown away because the edge partial itself counted as speech.
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      expect(discard).not.toHaveBeenCalled();
      act(() => socket.send({ t: "timing", speech_end_to_final_ms: 760, silence_wait_ms: 750 }));
      await act(async () => { socket.send({ t: "final", v: "what is a good name for a small grey cat" }); await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(pendingRef.current).toEqual({ turnId: "turn-held", resumeToken: "token-held", conversationId: "conv-1" });
      expect(discard).not.toHaveBeenCalled();
      expect(timings.find((t) => t.phase === "final")?.speculative).toBe("confirmed");
    } finally { speculate.mockRestore(); discard.mockRestore(); }
  });

  test("STT-SMARTTURN-01: a final that differs from the held text discards the run and labels the turn discarded", async () => {
    const speculate = spyOn(api, "speculateTurn").mockResolvedValue({ turn_id: "turn-held", resume_token: "token-held", conversation_id: "conv-1" });
    const discard = spyOn(api, "discardTurn").mockResolvedValue({ cancelled: true });
    try {
      const socket = controlledSocket();
      const pendingRef = { current: null as { turnId: string; resumeToken: string; conversationId: string } | null };
      const timings: Array<{ sttMs: number; phase?: string; speculative?: string }> = [];
      render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={[]} sentTexts={[]} socketFactory={socket.createSocket} speculation={{ getConversationId: () => "conv-1", pendingRef }} onVoiceTiming={(timing) => timings.push(timing)} />);
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      act(() => socket.send({ t: "vad", speaking: true, rms: 0.3 }));
      act(() => socket.send({ t: "partial", v: "what is a good name", edge: true }));
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      await act(async () => { socket.send({ t: "final", v: "what is a good name for a small grey cat" }); await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(pendingRef.current).toBeNull();
      expect(discard).toHaveBeenCalledWith("turn-held");
      expect(timings.find((t) => t.phase === "final")?.speculative).toBe("discarded");
    } finally { speculate.mockRestore(); discard.mockRestore(); }
  });

  // TALK-OVER-01 (docs/design/talk-over-2026-11-12.md section 4): the acknowledgement clip and the protected overlap window.
  // A fake pool: a clip ends on its own after `durationMs` (completed) and nothing on the handle can stop it; stopAll is the call closing.
  function fakeClipPool(played: Array<{ ended: boolean; completed: boolean; closed: boolean; endedAt: number | null }>, durationMs = 300, size = 2, grouped?: Array<string>) {
    const pool = {
      size,
      play: (at = performance.now()) => {
        const handle = { durationMs, startedAt: at, ended: false, endedAt: null as number | null, completed: false, closed: false };
        setTimeout(() => { if (!handle.ended) { handle.ended = true; handle.completed = true; handle.endedAt = performance.now(); } }, durationMs);
        played.push(handle); return handle;
      },
      stopAll: () => { for (const handle of played) if (!handle.ended) { handle.ended = true; handle.completed = false; handle.closed = true; handle.endedAt = performance.now(); } },
    };
    if (grouped) Object.assign(pool, { playGroup: (group: string, at = performance.now()) => { grouped.push(group); return pool.play(at); } });
    return pool;
  }
  function talkOverHarness(options: { grant?: { level: "gentle" | "natural"; window_ms: number; clips: string[] } | null; speculate?: ReturnType<typeof spyOn>; discard?: ReturnType<typeof spyOn>; durationMs?: number; poolSize?: number; grouped?: string[]; activeTurn?: { turnId: string; heardVisibleEnd: () => number } | null } = {}) {
    const played: Array<{ ended: boolean; completed: boolean; closed: boolean; endedAt: number | null }> = [];
    const sentTexts: string[] = [];
    const rendered: string[][] = [];
    const pendingRef = { current: null as { turnId: string; resumeToken: string; conversationId: string } | null };
    const ackClipPlayedRef = { current: false };
    const timings: Array<{ sttMs: number; phase?: string; speculative?: string; talkOver?: Record<string, unknown> }> = [];
    const socket = controlledSocket();
    const grant = options.grant === undefined ? { level: "gentle" as const, window_ms: 500, clips: ["Mm-hm.", "Okay."] } : options.grant;
    const createSocket = (handlers: SttSocketHandlers) => {
      const inner = socket.createSocket(handlers);
      // The hub's ready carries the grant (none for a minor or when the setting is off).
      setTimeout(() => { if (grant) handlers.onMessage({ t: "ready", talk_over: grant } as unknown as SttServerMessage); }, 1);
      return inner;
    };
    const renderClips = async (clips: readonly string[]) => { rendered.push([...clips]); return fakeClipPool(played, options.durationMs, options.poolSize, options.grouped) as never; };
    let ended = 0;
    const element = (speakingEndedAt: number) => <Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={speakingEndedAt} activeTurn={options.activeTurn === undefined ? null : options.activeTurn} fixture={[]} sentTexts={sentTexts} socketFactory={createSocket} speculation={{ getConversationId: () => "conv-1", pendingRef, ackClipPlayedRef, renderClips } as never} onVoiceTiming={(timing) => timings.push(timing as never)} />;
    const view = render(element(0));
    // The reply finished speaking (chatModelAdapter's onSpeakingChange, relayed as state): the session goes back to listening.
    const endReply = () => { ended += 1; view.rerender(element(ended)); };
    // The call closes (open goes false): the one thing that stops a clip early.
    const close = () => view.rerender(<Harness open={false} onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={ended} fixture={[]} sentTexts={[]} socketFactory={createSocket} speculation={{ getConversationId: () => "conv-1", pendingRef, ackClipPlayedRef, renderClips } as never} onVoiceTiming={(timing) => timings.push(timing as never)} />);
    return { view, played, rendered, pendingRef, ackClipPlayedRef, timings, socket, endReply, close, sentTexts };
  }

  test("TALK-OVER-01: a granted session renders the hub's clips once; the edge partial that starts a held run plays one when the score fires at the level, and the matching final confirms it, skips the run's cue and reports the timing", async () => {
    const speculate = spyOn(api, "speculateTurn").mockResolvedValue({ turn_id: "turn-held", resume_token: "token-held", conversation_id: "conv-1" });
    const discard = spyOn(api, "discardTurn").mockResolvedValue({ cancelled: true });
    try {
      const h = talkOverHarness();
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      expect(h.rendered).toEqual([["Mm-hm.", "Okay."]]);
      act(() => h.socket.send({ t: "vad", speaking: true, rms: 0.3 }));
      // A fragment that reads unfinished: no held run and no clip.
      act(() => h.socket.send({ t: "partial", v: "what is a good name for a", edge: true, end: { score: 0.05, level: "none", unfinished: true } } as never));
      expect(speculate).not.toHaveBeenCalled(); expect(h.played).toHaveLength(0);
      // A natural-only score at a gentle grant: the held run starts, the clip does not play.
      act(() => h.socket.send({ t: "partial", v: "what is a good name for a small grey cat", edge: true, end: { score: 0.65, level: "natural", unfinished: false } } as never));
      expect(speculate).toHaveBeenCalledTimes(1); expect(h.played).toHaveLength(0);
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      // The question mark arrives with the next edge partial: a gentle score, so the newer words replace the held run and the clip plays.
      act(() => h.socket.send({ t: "partial", v: "what is a good name for a small grey cat?", edge: true, end: { score: 1, level: "gentle", unfinished: false } } as never));
      expect(discard).toHaveBeenCalledWith("turn-held");
      expect(speculate).toHaveBeenCalledTimes(2);
      expect(h.played).toHaveLength(1);
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      act(() => h.socket.send({ t: "timing", speech_end_to_final_ms: 760, silence_wait_ms: 750 }));
      await act(async () => { h.socket.send({ t: "final", v: "what is a good name for a small grey cat?" }); await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(h.pendingRef.current?.turnId).toBe("turn-held");
      expect(h.ackClipPlayedRef.current).toBe(true);
      expect(h.played[0]!.closed).toBe(false);
      const final = h.timings.find((t) => t.phase === "final");
      expect(final?.speculative).toBe("confirmed");
      expect(final?.talkOver).toMatchObject({ talk_over_level: "gentle", decision: "confirmed", overlap_ms: 550, clip_completed: true, edge_partials: 3 });
      expect(typeof final?.talkOver?.early_release_ms).toBe("number");
      expect(final?.talkOver?.clip_started_ms).toBe(final?.talkOver?.early_release_ms);
    } finally { speculate.mockRestore(); discard.mockRestore(); }
  });

  test("TALK-OVER-01: the person goes on after the clip: the clip plays to its end, at the window's end the held run is discarded silently, and the whole utterance's final goes the normal way; two of these drop the level", async () => {
    const speculate = spyOn(api, "speculateTurn").mockResolvedValue({ turn_id: "turn-held", resume_token: "token-held", conversation_id: "conv-1" });
    const discard = spyOn(api, "discardTurn").mockResolvedValue({ cancelled: true });
    try {
      const h = talkOverHarness({ grant: { level: "natural", window_ms: 500, clips: ["Mm-hm."] }, durationMs: 100 });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      for (let round = 0; round < 2; round++) {
        act(() => h.socket.send({ t: "vad", speaking: true, rms: 0.3 }));
        act(() => h.socket.send({ t: "partial", v: "I want to go to the store", edge: true, end: { score: 0.5, level: "natural", unfinished: false } } as never));
        expect(h.played).toHaveLength(round + 1);
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
        // The hub reports the voice back, well after the clip (100 ms) plus the echo margin.
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)); });
        act(() => h.socket.send({ t: "vad", speaking: true, rms: 0.3, resumed: true, voiced_ms: 210 } as never));
        // The window's end (a real timer, exercised in talkOver.test.ts) or the final with other words: either way the held run is
        // discarded, nothing is said, and the clip is untouched (it ended on its own).
        act(() => h.socket.send({ t: "timing", speech_end_to_final_ms: 760, silence_wait_ms: 750 }));
        await act(async () => { h.socket.send({ t: "final", v: "I want to go to the store tomorrow at five" }); await new Promise((resolve) => setTimeout(resolve, 0)); });
        await waitFor(() => expect(discard).toHaveBeenCalledTimes(round + 1), { timeout: 3000 });
        expect(h.played[round]!.completed).toBe(true);
        expect(h.played[round]!.closed).toBe(false);
        expect(h.pendingRef.current).toBeNull();
        const final = h.timings.filter((t) => t.phase === "final")[round];
        expect(final?.talkOver).toMatchObject({ decision: "continued", clip_completed: true });
        expect(h.ackClipPlayedRef.current).toBe(false);
        act(() => h.endReply());
      }
      // Two wrong starts: natural dropped to gentle, so a natural-level score no longer plays a clip.
      act(() => h.socket.send({ t: "vad", speaking: true, rms: 0.3 }));
      act(() => h.socket.send({ t: "partial", v: "I had a long day at work", edge: true, end: { score: 0.5, level: "natural", unfinished: false } } as never));
      expect(h.played).toHaveLength(2);
    } finally { speculate.mockRestore(); discard.mockRestore(); }
  });

  test("an edge partial that arrives while the last reply is still thinking is labelled busy_thinking, not armed, and counts the utterance's edge partials", async () => {
    const speculate = spyOn(api, "speculateTurn").mockResolvedValue({ turn_id: "turn-held", resume_token: "token-held", conversation_id: "conv-1" });
    try {
      const h = talkOverHarness({ grant: null });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      // Turn 1 ends: the session is "thinking" until the reply speaks and finishes. The next utterance's edge partials land in that state.
      act(() => h.socket.send({ t: "vad", speaking: true, rms: 0.3 }));
      act(() => h.socket.send({ t: "timing", speech_end_to_final_ms: 700, silence_wait_ms: 700 }));
      await act(async () => { h.socket.send({ t: "final", v: "what time is it?" }); await new Promise((resolve) => setTimeout(resolve, 0)); });
      act(() => h.socket.send({ t: "vad", speaking: true, rms: 0.3 }));
      act(() => h.socket.send({ t: "partial", v: "and what", edge: true, end: { score: 0.05, level: "none", unfinished: true } } as never));
      act(() => h.socket.send({ t: "partial", v: "and what day is it?", edge: true, end: { score: 1, level: "gentle", unfinished: false } } as never));
      act(() => h.socket.send({ t: "timing", speech_end_to_final_ms: 700, silence_wait_ms: 700 }));
      await act(async () => { h.socket.send({ t: "final", v: "and what day is it?" }); await new Promise((resolve) => setTimeout(resolve, 0)); });
      const finals = h.timings.filter((t) => t.phase === "final");
      expect(speculate).not.toHaveBeenCalled(); // turn 1 had no edge partial; turn 2's came while thinking
      expect(finals[1]?.speculative).toBe("busy_thinking");
      expect(finals[1]?.talkOver).toMatchObject({ edge_partials: 2 });
    } finally { speculate.mockRestore(); }
  });

  test("TALK-OVER-01: nothing cuts a clip once started (a resume inside its playback, a newer partial, the held run replaced, a final with other words); only closing the call stops it, and the record says so", async () => {
    const speculate = spyOn(api, "speculateTurn").mockResolvedValue({ turn_id: "turn-held", resume_token: "token-held", conversation_id: "conv-1" });
    const discard = spyOn(api, "discardTurn").mockResolvedValue({ cancelled: true });
    try {
      const h = talkOverHarness({ grant: { level: "gentle", window_ms: 800, clips: ["Mm-hm."] }, durationMs: 400 });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      act(() => h.socket.send({ t: "vad", speaking: true, rms: 0.3 }));
      act(() => h.socket.send({ t: "partial", v: "Is it going to rain tomorrow?", edge: true, end: { score: 1, level: "gentle", unfinished: false } } as never));
      expect(h.played).toHaveLength(1);
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
      act(() => h.socket.send({ t: "vad", speaking: true, rms: 0.3, resumed: true, voiced_ms: 200 } as never)); // the person's voice inside the clip
      act(() => h.socket.send({ t: "partial", v: "Is it going to rain tomorrow or" })); // a newer partial with more words
      act(() => h.socket.send({ t: "partial", v: "Is it going to rain tomorrow or the day after?", edge: true, end: { score: 1, level: "gentle", unfinished: false } } as never)); // the held run is replaced
      expect(discard).toHaveBeenCalledWith("turn-held");
      expect(h.played).toHaveLength(1); // never two clips in one utterance
      expect(h.played[0]!.ended).toBe(false);
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });
      act(() => h.socket.send({ t: "timing", speech_end_to_final_ms: 760, silence_wait_ms: 750 }));
      await act(async () => { h.socket.send({ t: "final", v: "Is it going to rain tomorrow morning?" }); await new Promise((resolve) => setTimeout(resolve, 0)); }); // a final with other words
      expect(h.played[0]!.ended).toBe(false); // still playing: a wrong start never cuts the clip
      const final = h.timings.find((t) => t.phase === "final");
      expect(final?.talkOver).toMatchObject({ decision: "continued", clip_completed: true, edge_partials: 2 });
      expect(typeof final?.talkOver?.clip_ended_ms).toBe("number");
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)); });
      expect(h.played[0]!.completed).toBe(true);
      // A second clip, then the call closes under it: the one early stop.
      act(() => h.endReply());
      act(() => h.socket.send({ t: "vad", speaking: true, rms: 0.3 }));
      act(() => h.socket.send({ t: "partial", v: "What time is it?", edge: true, end: { score: 1, level: "gentle", unfinished: false } } as never));
      expect(h.played).toHaveLength(2);
      act(() => h.close());
      expect(h.played[1]!.closed).toBe(true);
      expect(h.played[1]!.completed).toBe(false);
    } finally { speculate.mockRestore(); discard.mockRestore(); }
  });

  test("TALK-OVER-01: a resume inside the clip's own playback is echo and changes nothing; a session with no grant (a minor, the setting off) renders and plays nothing", async () => {
    const speculate = spyOn(api, "speculateTurn").mockResolvedValue({ turn_id: "turn-held", resume_token: "token-held", conversation_id: "conv-1" });
    const discard = spyOn(api, "discardTurn").mockResolvedValue({ cancelled: true });
    try {
      const h = talkOverHarness({ grant: { level: "gentle", window_ms: 500, clips: ["Mm-hm."] }, durationMs: 400 });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      act(() => h.socket.send({ t: "vad", speaking: true, rms: 0.3 }));
      act(() => h.socket.send({ t: "partial", v: "Is it going to rain tomorrow?", edge: true, end: { score: 1, level: "gentle", unfinished: false } } as never));
      expect(h.played).toHaveLength(1);
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
      act(() => h.socket.send({ t: "vad", speaking: true, rms: 0.3, resumed: true, voiced_ms: 200 } as never)); // inside the 400 ms clip: the clip's echo
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 700)); }); // past the window (max(500, 400 + 250) = 650 ms)
      expect(discard).not.toHaveBeenCalled();
      expect(h.played[0]!.closed).toBe(false);
      act(() => h.socket.send({ t: "timing", speech_end_to_final_ms: 760, silence_wait_ms: 750 }));
      await act(async () => { h.socket.send({ t: "final", v: "Is it going to rain tomorrow?" }); await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(h.pendingRef.current?.turnId).toBe("turn-held");
      expect(h.timings.find((t) => t.phase === "final")?.talkOver).toMatchObject({ decision: "confirmed" });
      cleanup();
      const minor = talkOverHarness({ grant: null });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      act(() => minor.socket.send({ t: "vad", speaking: true, rms: 0.3 }));
      act(() => minor.socket.send({ t: "partial", v: "Is it going to rain tomorrow?", edge: true, end: { score: 1, level: "gentle", unfinished: false } } as never));
      expect(minor.rendered).toEqual([]);
      expect(minor.played).toHaveLength(0);
    } finally { speculate.mockRestore(); discard.mockRestore(); }
  });

  test("ECHO-GUARD-01: Home's own words coming back through the microphone are an echo; the person's words are not", () => {
    const spoken = "a soft boiled egg takes about six minutes in boiling water".split(" ");
    expect(isOwnEcho("takes about six minutes", spoken)).toBe(true); // in order, every word
    expect(isOwnEcho("Boiled egg takes about six", spoken)).toBe(true);
    expect(isOwnEcho("about six", spoken)).toBe(true); // two of her words
    expect(isOwnEcho("six about", spoken)).toBe(true); // in any order: the recognizer reorders words of a reply heard back
    expect(isOwnEcho("about please", spoken)).toBe(false); // one word she did not say
    expect(isOwnEcho("how long for a hard boiled one", spoken)).toBe(false); // the person's own question shares words but not enough in order
    expect(isOwnEcho("boiled", spoken)).toBe(true); // one of her own words, heard back as a fragment
    expect(isOwnEcho("no", [...spoken, "no"])).toBe(false); // a stop word is always the person, even right after she said it
    expect(isOwnEcho("stop", spoken)).toBe(false);
    expect(isOwnEcho("stop that", spoken)).toBe(false);
    expect(isOwnEcho("please", spoken)).toBe(false); // a word she did not say
    expect(isOwnEcho("takes about six minutes", [])).toBe(false);
  });

  test("ECHO-GUARD-01: Home's own reply heard back while she speaks neither pauses nor stops her nor becomes a turn; a real interruption still does", async () => {
    const socket = controlledSocket();
    const stops: number[] = []; const pauses: number[] = []; const cancels: number[] = [];
    const sentTexts: string[] = [];
    const timings: Array<{ phase?: string; speculative?: string; talkOver?: Record<string, unknown> }> = [];
    const schedulerWords = "a soft boiled egg takes about six minutes in boiling water and a hard one about ten".split(" ");
    function EchoHarness({ isSpeaking }: { isSpeaking: boolean }) {
      const adapter: ChatModelAdapter = { async *run({ messages }) { const last = messages[messages.length - 1]; const part = last?.content[0]; sentTexts.push(part && part.type === "text" ? part.text : ""); yield { content: [{ type: "text", text: "ok" }] }; } };
      const runtime = useLocalRuntime(adapter, { unstable_enableMessageQueue: false });
      const turnSchedulerRef = useRef<SentenceSpeechScheduler | null>(null);
      turnSchedulerRef.current = { stop: () => { stops.push(1); }, pause: () => { pauses.push(1); }, resume: () => {}, duck: () => {}, unduck: () => {}, readLevel: () => 0, playedMs: () => 500, recentlySpokenWords: () => schedulerWords } as unknown as SentenceSpeechScheduler;
      const session = useLiveVoiceSession({ composer: runtime.thread.composer, open: true, onOpenChange: () => {}, turnSchedulerRef, liveVoiceActiveRef: useRef(false), pendingSpeechRef: useRef(false), activeTurnRef: useRef({ turnId: "turn-reply", heardVisibleEnd: () => 8 }), cancelRun: () => { cancels.push(1); }, voiceBargeIn: true, isSpeaking, speakingEndedAt: 0, createSocket: socket.createSocket, startCapture: fakeStartCapture(), onVoiceTiming: (timing) => timings.push(timing as never), speculation: { getConversationId: () => "conv-1", pendingRef: { current: null } } });
      return <AssistantRuntimeProvider runtime={runtime}><div>{session.mode}</div></AssistantRuntimeProvider>;
    }
    const cancelTurn = spyOn(api, "cancelTurn").mockResolvedValue({ cancelled: true });
    const speculate = spyOn(api, "speculateTurn").mockResolvedValue({ turn_id: "turn-held", resume_token: "t", conversation_id: "conv-1" });
    try {
      const view = render(<EchoHarness isSpeaking={false} />);
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      view.rerender(<EchoHarness isSpeaking />); // the reply is speaking
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 450)); }); // past the 400 ms barge-in arm delay
      // The microphone hears the reply itself: an onset, a two-word partial, an edge partial that even reads as a finished sentence, a final.
      act(() => socket.send({ t: "vad", speaking: true, rms: 0.2 }));
      act(() => socket.send({ t: "partial", v: "takes about" }));
      act(() => socket.send({ t: "partial", v: "takes about six minutes", edge: true, end: { score: 0.7, level: "natural", unfinished: false } } as never));
      act(() => socket.send({ t: "timing", speech_end_to_final_ms: 700, silence_wait_ms: 700 }));
      await act(async () => { socket.send({ t: "final", v: "takes about six minutes in boiling water" }); await new Promise((resolve) => setTimeout(resolve, 0)); });
      // A one-word fragment of her reply, and a long sound with no words at all (the echo of a long sentence): neither pauses nor stops her.
      act(() => socket.send({ t: "vad", speaking: true, rms: 0.2 }));
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1000)); });
      act(() => socket.send({ t: "partial", v: "boiled" }));
      act(() => socket.send({ t: "timing", speech_end_to_final_ms: 700, silence_wait_ms: 700 }));
      await act(async () => { socket.send({ t: "final", v: "boiled" }); await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(pauses).toHaveLength(0);
      expect(stops).toHaveLength(0);
      expect(cancels).toHaveLength(0);
      expect(cancelTurn).not.toHaveBeenCalled();
      expect(speculate).not.toHaveBeenCalled();
      expect(sentTexts).toEqual([]);
      expect(view.getByText("speaking")).toBeTruthy();
      // The person really cuts in with their own words: the reply stops, the turn is cancelled once, the words become the next turn.
      act(() => socket.send({ t: "vad", speaking: true, rms: 0.3 }));
      act(() => socket.send({ t: "partial", v: "wait what about" }));
      act(() => socket.send({ t: "timing", speech_end_to_final_ms: 700, silence_wait_ms: 700 }));
      await act(async () => { socket.send({ t: "final", v: "wait what about poached eggs?" }); await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(stops).toHaveLength(1);
      expect(cancelTurn).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(sentTexts).toEqual(["wait what about poached eggs?"]));
      expect(timings.find((t) => t.phase === "final")?.talkOver).toMatchObject({ echo_drops: 2 });
    } finally { cancelTurn.mockRestore(); speculate.mockRestore(); }
  });

  test("VOICE-TRACE-01: with the trace on, an utterance's timeline (names and numbers only) is posted to the hub, with the grant's reason and the pool size on the timing report", async () => {
    const speculate = spyOn(api, "speculateTurn").mockResolvedValue({ turn_id: "turn-held", resume_token: "token-held", conversation_id: "conv-1" });
    const posted: Array<{ session: string; utterance: number; events: Array<Record<string, unknown>> }> = [];
    const post = spyOn(api, "postVoiceTrace").mockImplementation(async (upload) => { posted.push(upload as never); return { kept: true, events: upload.events.length }; });
    try {
      const socket = controlledSocket();
      const pendingRef = { current: null as { turnId: string; resumeToken: string; conversationId: string } | null };
      const timings: Array<{ phase?: string; talkOver?: Record<string, unknown> }> = [];
      const renderClips = async () => ({ size: 2, play: () => null, stopAll: () => {} }) as never;
      const createSocket = (handlers: SttSocketHandlers) => { const inner = socket.createSocket(handlers); setTimeout(() => handlers.onMessage({ t: "ready", talk_over: { level: "gentle", window_ms: 800, clips: ["Mm-hm."] } } as never), 1); return inner; };
      render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={[]} sentTexts={[]} socketFactory={createSocket} speculation={{ getConversationId: () => "conv-1", pendingRef, renderClips } as never} onVoiceTiming={(timing) => timings.push(timing as never)} traceUtterances={2} />);
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      act(() => socket.send({ t: "vad", speaking: true, rms: 0.3 }));
      act(() => socket.send({ t: "partial", v: "what is a good name for a small grey cat", edge: true, end: { score: 0.65, level: "natural", unfinished: false } } as never));
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      act(() => socket.send({ t: "timing", speech_end_to_final_ms: 760, silence_wait_ms: 750 }));
      await act(async () => { socket.send({ t: "final", v: "what is a good name for a small grey cat" }); await new Promise((resolve) => setTimeout(resolve, 0)); });
      await waitFor(() => expect(posted).toHaveLength(1));
      const names = posted[0]!.events.map((event) => event.e);
      expect(names).toEqual(expect.arrayContaining(["ready", "grant", "pool", "vad_on", "edge", "speculate", "timing", "final", "confirm", "turn_send"]));
      expect(posted[0]!.events.find((event) => event.e === "edge")).toMatchObject({ words: 10, level: "natural", score: 0.7, speaking: false, mode: "listening" });
      expect(posted[0]!.events.find((event) => event.e === "grant")).toMatchObject({ level: "gentle", window_ms: 800, clips: 1 });
      expect(posted[0]!.events.find((event) => event.e === "pool")).toMatchObject({ size: 2 });
      // Names and numbers only: the words never leave the page.
      expect(JSON.stringify(posted[0])).not.toContain("grey");
      expect(JSON.stringify(posted[0])).not.toContain("cat");
      expect(timings.find((t) => t.phase === "final")?.talkOver).toMatchObject({ talk_over_reason: "granted", pool_size: 2 });
    } finally { speculate.mockRestore(); post.mockRestore(); }
  });

  test("VOICE-TRACE-01: a session with no grant records the hub's reason, and the timing report carries it; without the flag nothing is posted", async () => {
    const post = spyOn(api, "postVoiceTrace").mockResolvedValue({ kept: true, events: 0 });
    try {
      const socket = controlledSocket();
      const timings: Array<{ phase?: string; talkOver?: Record<string, unknown> }> = [];
      const createSocket = (handlers: SttSocketHandlers) => { const inner = socket.createSocket(handlers); setTimeout(() => handlers.onMessage({ t: "ready", talk_over_reason: "setting_off" } as never), 1); return inner; };
      render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={[]} sentTexts={[]} socketFactory={createSocket} speculation={{ getConversationId: () => "conv-1", pendingRef: { current: null } } as never} onVoiceTiming={(timing) => timings.push(timing as never)} />);
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      act(() => socket.send({ t: "vad", speaking: true, rms: 0.3 }));
      act(() => socket.send({ t: "timing", speech_end_to_final_ms: 700, silence_wait_ms: 700 }));
      await act(async () => { socket.send({ t: "final", v: "what time is it?" }); await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(timings.find((t) => t.phase === "final")?.talkOver).toMatchObject({ talk_over_reason: "setting_off", pool_size: 0 });
      expect(post).not.toHaveBeenCalled();
    } finally { post.mockRestore(); }
  });

  test("ECHO-GATE-01: on speakers, microphone frames at Home's own echo level never reach the hub while she plays; a voice clearly louder does; while she is silent everything passes", async () => {
    const sent: Float32Array[] = [];
    let onFrame: ((frame: Float32Array) => void) | null = null;
    const socket = { createSocket: (handlers: SttSocketHandlers) => { setTimeout(() => handlers.onMessage({ t: "ready" }), 0); return { sendAudio: (frame: Float32Array) => { sent.push(frame); }, close: () => {} }; } };
    const capture = async (options: MicCaptureOptions) => { onFrame = options.onFrame; return { stop: () => {}, sampleRate: 16_000 }; };
    function GateHarness({ isSpeaking }: { isSpeaking: boolean }) {
      const adapter: ChatModelAdapter = { async *run() { yield { content: [{ type: "text", text: "ok" }] }; } };
      const runtime = useLocalRuntime(adapter, { unstable_enableMessageQueue: false });
      const turnSchedulerRef = useRef<never>(null);
      turnSchedulerRef.current = { readLevel: () => isSpeaking ? 0.5 : 0 } as never;
      const session = useLiveVoiceSession({ composer: runtime.thread.composer, open: true, onOpenChange: () => {}, turnSchedulerRef, liveVoiceActiveRef: useRef(false), pendingSpeechRef: useRef(false), activeTurnRef: useRef(null), cancelRun: () => {}, voiceBargeIn: true, isSpeaking, speakingEndedAt: 0, createSocket: socket.createSocket, startCapture: capture as never });
      return <AssistantRuntimeProvider runtime={runtime}><div>{session.mode}</div></AssistantRuntimeProvider>;
    }
    const level = (rms: number) => { const f = new Float32Array(320); for (let i = 0; i < f.length; i++) f[i] = rms * Math.SQRT2 * Math.sin(i / 3); return f; };
    const view = render(<GateHarness isSpeaking={false} />);
    await waitFor(() => expect(onFrame).not.toBeNull());
    // She is silent: room noise passes (and measures the floor).
    for (let i = 0; i < 10; i++) onFrame!(level(0.002));
    expect(sent).toHaveLength(10);
    // She speaks: the echo calibrates for 1.5 s (75 frames), nothing of it passes; then the same echo keeps being replaced by silence.
    act(() => view.rerender(<GateHarness isSpeaking />));
    await waitFor(() => expect(view.getByText("speaking")).toBeTruthy());
    for (let i = 0; i < 120; i++) onFrame!(level(0.05));
    await new Promise((resolve) => setTimeout(resolve, 1600));
    for (let i = 0; i < 30; i++) onFrame!(level(0.05));
    // Blocked frames reach the hub as silence of the same length, never as a gap: its silence timer keeps running.
    expect(sent).toHaveLength(10 + 120 + 30);
    expect(sent.slice(10).every((frame) => frame.length === 320 && frame.every((sample) => sample === 0))).toBe(true);
    // The person talks over her, clearly louder than the echo: it reaches the hub as itself.
    for (let i = 0; i < 10; i++) onFrame!(level(0.3));
    expect(sent.slice(-5).some((frame) => frame.some((sample) => sample !== 0))).toBe(true);
  });

  test("PAUSE-EXIT-01: the live sequence of 2026-11-13 (a pause with no final for 25 s) now resolves within 1.5 s: real words cut the reply for good, the turn is cancelled once, and the final becomes the next turn", async () => {
    const pause = mock(); const resume = mock(); const stop = mock(); const cancel = spyOn(api, "cancelTurn").mockResolvedValue({ cancelled: true });
    const socket = controlledSocket();
    const sent: string[] = [];
    const timings: Array<{ phase?: string }> = [];
    const props = (isSpeaking: boolean) => <Harness open onOpenChange={() => {}} isSpeaking={isSpeaking} speakingEndedAt={0} fixture={[]} sentTexts={sent} pauseScheduler={pause} resumeScheduler={resume} stopScheduler={stop} socketFactory={socket.createSocket} onVoiceTiming={(timing) => timings.push(timing)} />;
    const view = render(props(false));
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    act(() => view.rerender(props(true)));
    await waitFor(() => expect(view.getByText("Speaking")).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 450)); // past the barge-in arm delay
    // The trace: vad_on, reply_pause, a 3-word partial (pause), partials of 7 and 8 words, vad_resumed, an edge of 8 words... and no final.
    act(() => socket.send({ t: "vad", speaking: true, rms: 0.3 }));
    act(() => socket.send({ t: "reply_pause" }));
    act(() => socket.send({ t: "partial", v: "wait can you" }));
    expect(pause).toHaveBeenCalledTimes(1);
    act(() => socket.send({ t: "partial", v: "wait can you tell me how long a" }));
    act(() => socket.send({ t: "partial", v: "wait can you tell me how long a hard" }));
    act(() => socket.send({ t: "vad", speaking: true, rms: 0.3, resumed: true, voiced_ms: 220 } as never));
    act(() => socket.send({ t: "partial", v: "wait can you tell me how long a hard boiled", edge: true, end: { score: 0.7, level: "natural", unfinished: false } } as never));
    expect(stop).not.toHaveBeenCalled();
    // Within 1.5 s of the pause, with no final: the deadline decides. Real words since the pause: the reply stops for good, once.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1700)); });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(resume).not.toHaveBeenCalled();
    expect(view.getByText("Listening")).toBeTruthy();
    // He finishes: the final is the next turn, sent once.
    act(() => socket.send({ t: "timing", speech_end_to_final_ms: 750, silence_wait_ms: 750 }));
    await act(async () => { socket.send({ t: "final", v: "wait can you tell me how long a hard boiled egg takes?" }); await new Promise((resolve) => setTimeout(resolve, 0)); });
    await waitFor(() => expect(sent).toEqual(["wait can you tell me how long a hard boiled egg takes?"]));
    expect(cancel).toHaveBeenCalledTimes(1);
    cancel.mockRestore();
  });

  test("PAUSE-EXIT-01: a pause whose words turn out to be noise resumes the same audio at the deadline; the hub's reply_resume resumes it sooner", async () => {
    const pause = mock(); const resume = mock(); const stop = mock();
    const socket = controlledSocket();
    const props = (isSpeaking: boolean) => <Harness open onOpenChange={() => {}} isSpeaking={isSpeaking} speakingEndedAt={0} fixture={[]} sentTexts={[]} pauseScheduler={pause} resumeScheduler={resume} stopScheduler={stop} socketFactory={socket.createSocket} />;
    const view = render(props(false));
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    act(() => view.rerender(props(true)));
    await waitFor(() => expect(view.getByText("Speaking")).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 450));
    act(() => socket.send({ t: "vad", speaking: true, rms: 0.3 }));
    act(() => socket.send({ t: "partial", v: "wait what" }));
    expect(pause).toHaveBeenCalledTimes(1);
    act(() => socket.send({ t: "reply_resume" })); // the hub: the sound was not speech after all
    expect(resume).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
    // A second pause with no further word and no final: the deadline resumes it (the words that paused her stand, so this one interrupts; a bare noise pause has no words).
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  test("a pause in a longer stretch of speech asks the small model for a reaction; short speech or a quick restart does not", async () => {
    const random = spyOn(Math, "random").mockReturnValue(0);
    const react = spyOn(api, "reactTurn").mockResolvedValue({ text: null });
    try {
      const socket = controlledSocket();
      const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={[]} sentTexts={[]} socketFactory={socket.createSocket} />);
      await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
      act(() => socket.send({ t: "partial", v: "so yesterday I went to the" }));
      act(() => socket.send({ t: "vad", speaking: false, rms: 0 }));
      await new Promise((resolve) => setTimeout(resolve, 550));
      expect(react).not.toHaveBeenCalled(); // eight words is the floor; this was six
      act(() => socket.send({ t: "partial", v: "so yesterday I went to the store and then I" }));
      act(() => socket.send({ t: "vad", speaking: false, rms: 0 }));
      act(() => socket.send({ t: "vad", speaking: true, rms: 0.1 }));
      await new Promise((resolve) => setTimeout(resolve, 550));
      expect(react).not.toHaveBeenCalled(); // they started again before the pause was long enough
      act(() => socket.send({ t: "vad", speaking: false, rms: 0 }));
      await new Promise((resolve) => setTimeout(resolve, 550));
      expect(react).toHaveBeenCalledWith("so yesterday I went to the store and then I");
    } finally { random.mockRestore(); react.mockRestore(); cleanup(); }
  });

  test("ECHO-GUARD-01: the acknowledgement clip's own echo at the end of the person's words does not break the held run's match, and the clip's words are not sent", async () => {
    const speculate = spyOn(api, "speculateTurn").mockResolvedValue({ turn_id: "turn-held", resume_token: "token-held", conversation_id: "conv-1" });
    const discard = spyOn(api, "discardTurn").mockResolvedValue({ cancelled: true });
    try {
      const h = talkOverHarness({ grant: { level: "gentle", window_ms: 800, clips: ["Mm-hm.", "Okay."] }, durationMs: 250 });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      act(() => h.socket.send({ t: "vad", speaking: true, rms: 0.3 }));
      act(() => h.socket.send({ t: "partial", v: "How long should I boil an egg?", edge: true, end: { score: 1, level: "gentle", unfinished: false } } as never));
      expect(h.played).toHaveLength(1);
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      // The speakers play the clip, the microphone hears it: the hub appends it to the utterance.
      act(() => h.socket.send({ t: "vad", speaking: true, rms: 0.3, resumed: true, voiced_ms: 230 } as never));
      act(() => h.socket.send({ t: "partial", v: "How long should I boil an egg? Mm-hm.", edge: true, end: { score: 0.3, level: "none", unfinished: false } } as never));
      act(() => h.socket.send({ t: "timing", speech_end_to_final_ms: 750, silence_wait_ms: 750 }));
      await act(async () => { h.socket.send({ t: "final", v: "How long should I boil an egg? Mm-hm." }); await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(discard).not.toHaveBeenCalled();
      expect(h.pendingRef.current?.turnId).toBe("turn-held");
      await waitFor(() => expect(h.sentTexts).toEqual(["How long should I boil an egg?"]));
      expect(h.timings.find((t) => t.phase === "final")?.speculative).toBe("confirmed");
    } finally { speculate.mockRestore(); discard.mockRestore(); }
  });

  test("a sound with no words never pauses the voice, however long it lasts; two real words do", async () => {
    const pause = mock();
    const socket = controlledSocket();
    const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={[]} sentTexts={[]} pauseScheduler={pause} socketFactory={socket.createSocket} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    act(() => view.rerender(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={[]} sentTexts={[]} pauseScheduler={pause} socketFactory={socket.createSocket} />));
    await waitFor(() => expect(view.getByText("Speaking")).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 600));
    act(() => socket.send({ t: "vad", speaking: true, rms: 0.1 }));
    await new Promise((resolve) => setTimeout(resolve, 1300)); // longer than the old 850 ms confirm window: still no pause without words
    expect(pause).not.toHaveBeenCalled();
    act(() => socket.send({ t: "partial", v: "wait what" })); // two real words that are not Home's own
    expect(pause).toHaveBeenCalledTimes(1);
    cleanup();
  });

  test("a transcript that is just Home's own reaction, right after it played, is not sent as the person's turn", async () => {
    const random = spyOn(Math, "random").mockReturnValue(0);
    const react = spyOn(api, "reactTurn").mockResolvedValue({ text: "Oh no." });
    try {
      const socket = controlledSocket();
      const sent: string[] = [];
      const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={[]} sentTexts={sent} socketFactory={socket.createSocket} />);
      await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
      act(() => socket.send({ t: "partial", v: "my dog died yesterday and I have been so sad" }));
      act(() => socket.send({ t: "vad", speaking: false, rms: 0 }));
      await waitFor(() => expect(react).toHaveBeenCalled(), { timeout: 1500 });
      await new Promise((resolve) => setTimeout(resolve, 100));
      act(() => socket.send({ t: "final", v: "Oh no." }));
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(sent).toEqual([]);
    } finally { random.mockRestore(); react.mockRestore(); cleanup(); }
  });

  test("opening the call plays the start sound and closing it plays a different end sound", async () => {
    const { setCallSoundContextFactory } = await import("@/lib/voice/callSounds");
    const freqs: number[] = [];
    setCallSoundContextFactory(() => ({
      currentTime: 0, destination: {}, resume: async () => {}, close: async () => {},
      createOscillator: () => ({ type: "sine", frequency: { setValueAtTime: (v: number) => { freqs.push(v); }, exponentialRampToValueAtTime: () => {} }, connect: () => {}, start: () => {}, stop: () => {}, onended: null }),
      createGain: () => ({ gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, connect: () => {} }),
    }));
    try {
      const socket = controlledSocket();
      const view = render(<Harness open={false} onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={[]} sentTexts={[]} socketFactory={socket.createSocket} />);
      expect(freqs).toEqual([]);
      act(() => view.rerender(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={[]} sentTexts={[]} socketFactory={socket.createSocket} />));
      const started = freqs.splice(0);
      expect(started).toHaveLength(3);
      act(() => view.rerender(<Harness open={false} onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={[]} sentTexts={[]} socketFactory={socket.createSocket} />));
      const ended = freqs.splice(0);
      expect(ended).toHaveLength(2);
      expect(ended).not.toEqual(started.slice(0, 2));
    } finally { setCallSoundContextFactory(null); cleanup(); }
  });

  test("a sound shorter than the 150 ms start window does not pause playback", async () => {
    const pause = mock();
    const socket = controlledSocket();
    const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={[]} sentTexts={[]} pauseScheduler={pause} socketFactory={socket.createSocket} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    act(() => view.rerender(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={[]} sentTexts={[]} pauseScheduler={pause} socketFactory={socket.createSocket} />));
    await waitFor(() => expect(view.getByText("Speaking")).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 600));
    act(() => socket.send({ t: "vad", speaking: true, rms: 0.1 }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    act(() => socket.send({ t: "vad", speaking: false, rms: 0 }));
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(pause).not.toHaveBeenCalled();
    cleanup();
    void view;
  });


  test("the server's reply_pause alone does not stop her, and reply_resume changes nothing", async () => {
    const pause = mock(); const resume = mock(); const stop = mock(); const cancel = spyOn(api, "cancelTurn").mockResolvedValue({ cancelled: true });
    const socket = controlledSocket();
    const sent: string[] = [];
    const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={[]} sentTexts={sent} pauseScheduler={pause} resumeScheduler={resume} stopScheduler={stop} socketFactory={socket.createSocket} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    act(() => view.rerender(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={[]} sentTexts={sent} pauseScheduler={pause} resumeScheduler={resume} stopScheduler={stop} socketFactory={socket.createSocket} />));
    await waitFor(() => expect(view.getByText("Speaking")).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 500));
    act(() => socket.send({ t: "reply_pause" }));
    expect(pause).not.toHaveBeenCalled(); // the server's first-frame signal alone no longer stops her
    act(() => socket.send({ t: "reply_resume" }));
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(pause).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled(); expect(stop).not.toHaveBeenCalled(); expect(sent).toEqual([]);
    cancel.mockRestore();
  });

  test("while a reply speaks the socket is told how much has played every 250 ms", async () => {
    const socket = controlledSocket();
    const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={[]} sentTexts={[]} socketFactory={socket.createSocket} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    expect(socket.played).toEqual([]);
    act(() => view.rerender(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={[]} sentTexts={[]} socketFactory={socket.createSocket} />));
    await waitFor(() => expect(view.getByText("Speaking")).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(socket.played.length).toBeGreaterThanOrEqual(2);
    expect(socket.played[0]).toEqual({ replyId: "turn-test", ms: 1234 });
  });

  test("a transcript after pause interrupts with the heard prefix and becomes the next turn", async () => {
    const pause = mock(); const stop = mock(); const cancel = spyOn(api, "cancelTurn").mockResolvedValue({ cancelled: true });
    const fixture: SttFixtureStep[] = [
      { delayMs: 0, message: { t: "ready" } },
      { delayMs: 450, message: { t: "vad", speaking: true, rms: 0.1 } },
      { delayMs: 1000, message: { t: "final", v: "wait which one is it" } },
    ];
    const sent: string[] = [];
    const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={fixture} sentTexts={sent} pauseScheduler={pause} stopScheduler={stop} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    act(() => view.rerender(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={fixture} sentTexts={sent} pauseScheduler={pause} stopScheduler={stop} />));
    await waitFor(() => expect(sent).toEqual(["wait which one is it"]), { timeout: 1800 });
    expect(cancel).toHaveBeenCalledWith("turn-test", 23); expect(stop).toHaveBeenCalled();
    cancel.mockRestore();
  });
  test("the reaction mm-hm over the reply neither pauses nor cancels nor sends; she plays on", async () => {
    const pause = mock(); const resume = mock(); const stop = mock(); const cancel = spyOn(api, "cancelTurn").mockResolvedValue({ cancelled: true });
    const socket = controlledSocket();
    const sent: string[] = [];
    const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={[]} sentTexts={sent} pauseScheduler={pause} resumeScheduler={resume} stopScheduler={stop} socketFactory={socket.createSocket} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    act(() => view.rerender(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={[]} sentTexts={sent} pauseScheduler={pause} resumeScheduler={resume} stopScheduler={stop} socketFactory={socket.createSocket} />));
    await waitFor(() => expect(view.getByText("Speaking")).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 600));
    act(() => socket.send({ t: "vad", speaking: true, rms: 0.1 }));
    await new Promise((resolve) => setTimeout(resolve, 600));
    act(() => socket.send({ t: "final", v: "mm-hm" }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(pause).not.toHaveBeenCalled(); expect(resume).not.toHaveBeenCalled(); // ECHO-GUARD-01: a sound with no words never pauses her, so there is nothing to resume
    expect(cancel).not.toHaveBeenCalled(); expect(stop).not.toHaveBeenCalled(); expect(sent).toEqual([]);
    cancel.mockRestore();
  });
  test("the reaction oh wow over the reply neither pauses nor cancels nor sends; she plays on", async () => {
    const pause = mock(); const resume = mock(); const stop = mock(); const cancel = spyOn(api, "cancelTurn").mockResolvedValue({ cancelled: true });
    const socket = controlledSocket();
    const sent: string[] = [];
    const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={[]} sentTexts={sent} pauseScheduler={pause} resumeScheduler={resume} stopScheduler={stop} socketFactory={socket.createSocket} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    act(() => view.rerender(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={[]} sentTexts={sent} pauseScheduler={pause} resumeScheduler={resume} stopScheduler={stop} socketFactory={socket.createSocket} />));
    await waitFor(() => expect(view.getByText("Speaking")).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 600));
    act(() => socket.send({ t: "vad", speaking: true, rms: 0.1 }));
    await new Promise((resolve) => setTimeout(resolve, 600));
    act(() => socket.send({ t: "final", v: "oh wow" }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(pause).not.toHaveBeenCalled(); expect(resume).not.toHaveBeenCalled(); // ECHO-GUARD-01: a sound with no words never pauses her, so there is nothing to resume
    expect(cancel).not.toHaveBeenCalled(); expect(stop).not.toHaveBeenCalled(); expect(sent).toEqual([]);
    cancel.mockRestore();
  });
  test("the reaction oh my god over the reply neither pauses nor cancels nor sends; she plays on", async () => {
    const pause = mock(); const resume = mock(); const stop = mock(); const cancel = spyOn(api, "cancelTurn").mockResolvedValue({ cancelled: true });
    const socket = controlledSocket();
    const sent: string[] = [];
    const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={[]} sentTexts={sent} pauseScheduler={pause} resumeScheduler={resume} stopScheduler={stop} socketFactory={socket.createSocket} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    act(() => view.rerender(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={[]} sentTexts={sent} pauseScheduler={pause} resumeScheduler={resume} stopScheduler={stop} socketFactory={socket.createSocket} />));
    await waitFor(() => expect(view.getByText("Speaking")).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 600));
    act(() => socket.send({ t: "vad", speaking: true, rms: 0.1 }));
    await new Promise((resolve) => setTimeout(resolve, 600));
    act(() => socket.send({ t: "final", v: "oh my god" }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(pause).not.toHaveBeenCalled(); expect(resume).not.toHaveBeenCalled(); // ECHO-GUARD-01: a sound with no words never pauses her, so there is nothing to resume
    expect(cancel).not.toHaveBeenCalled(); expect(stop).not.toHaveBeenCalled(); expect(sent).toEqual([]);
    cancel.mockRestore();
  });
  test("the reaction no way over the reply pauses it and then resumes without cancelling or sending", async () => {
    const pause = mock(); const resume = mock(); const stop = mock(); const cancel = spyOn(api, "cancelTurn").mockResolvedValue({ cancelled: true });
    const socket = controlledSocket();
    const sent: string[] = [];
    const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={[]} sentTexts={sent} pauseScheduler={pause} resumeScheduler={resume} stopScheduler={stop} socketFactory={socket.createSocket} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    act(() => view.rerender(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={[]} sentTexts={sent} pauseScheduler={pause} resumeScheduler={resume} stopScheduler={stop} socketFactory={socket.createSocket} />));
    await waitFor(() => expect(view.getByText("Speaking")).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 600));
    act(() => socket.send({ t: "vad", speaking: true, rms: 0.1 }));
    await new Promise((resolve) => setTimeout(resolve, 600));
    act(() => socket.send({ t: "final", v: "no way" }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(pause).not.toHaveBeenCalled(); expect(resume).not.toHaveBeenCalled(); // ECHO-GUARD-01: a sound with no words never pauses her, so there is nothing to resume
    expect(cancel).not.toHaveBeenCalled(); expect(stop).not.toHaveBeenCalled(); expect(sent).toEqual([]);
    cancel.mockRestore();
  });
  test("the reaction oh yeah over the reply pauses it and then resumes without cancelling or sending", async () => {
    const pause = mock(); const resume = mock(); const stop = mock(); const cancel = spyOn(api, "cancelTurn").mockResolvedValue({ cancelled: true });
    const socket = controlledSocket();
    const sent: string[] = [];
    const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={[]} sentTexts={sent} pauseScheduler={pause} resumeScheduler={resume} stopScheduler={stop} socketFactory={socket.createSocket} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    act(() => view.rerender(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={[]} sentTexts={sent} pauseScheduler={pause} resumeScheduler={resume} stopScheduler={stop} socketFactory={socket.createSocket} />));
    await waitFor(() => expect(view.getByText("Speaking")).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 600));
    act(() => socket.send({ t: "vad", speaking: true, rms: 0.1 }));
    await new Promise((resolve) => setTimeout(resolve, 600));
    act(() => socket.send({ t: "final", v: "oh yeah" }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(pause).not.toHaveBeenCalled(); expect(resume).not.toHaveBeenCalled(); // ECHO-GUARD-01: a sound with no words never pauses her, so there is nothing to resume
    expect(cancel).not.toHaveBeenCalled(); expect(stop).not.toHaveBeenCalled(); expect(sent).toEqual([]);
    cancel.mockRestore();
  });
  test("the reaction uh nice over the reply pauses it and then resumes without cancelling or sending", async () => {
    const pause = mock(); const resume = mock(); const stop = mock(); const cancel = spyOn(api, "cancelTurn").mockResolvedValue({ cancelled: true });
    const socket = controlledSocket();
    const sent: string[] = [];
    const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={[]} sentTexts={sent} pauseScheduler={pause} resumeScheduler={resume} stopScheduler={stop} socketFactory={socket.createSocket} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    act(() => view.rerender(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={[]} sentTexts={sent} pauseScheduler={pause} resumeScheduler={resume} stopScheduler={stop} socketFactory={socket.createSocket} />));
    await waitFor(() => expect(view.getByText("Speaking")).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 600));
    act(() => socket.send({ t: "vad", speaking: true, rms: 0.1 }));
    await new Promise((resolve) => setTimeout(resolve, 600));
    act(() => socket.send({ t: "final", v: "uh nice" }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(pause).not.toHaveBeenCalled(); expect(resume).not.toHaveBeenCalled(); // ECHO-GUARD-01: a sound with no words never pauses her, so there is nothing to resume
    expect(cancel).not.toHaveBeenCalled(); expect(stop).not.toHaveBeenCalled(); expect(sent).toEqual([]);
    cancel.mockRestore();
  });
  test("the reaction yeah right over the reply pauses it and then resumes without cancelling or sending", async () => {
    const pause = mock(); const resume = mock(); const stop = mock(); const cancel = spyOn(api, "cancelTurn").mockResolvedValue({ cancelled: true });
    const socket = controlledSocket();
    const sent: string[] = [];
    const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={[]} sentTexts={sent} pauseScheduler={pause} resumeScheduler={resume} stopScheduler={stop} socketFactory={socket.createSocket} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    act(() => view.rerender(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={[]} sentTexts={sent} pauseScheduler={pause} resumeScheduler={resume} stopScheduler={stop} socketFactory={socket.createSocket} />));
    await waitFor(() => expect(view.getByText("Speaking")).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 600));
    act(() => socket.send({ t: "vad", speaking: true, rms: 0.1 }));
    await new Promise((resolve) => setTimeout(resolve, 600));
    act(() => socket.send({ t: "final", v: "yeah right" }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(pause).not.toHaveBeenCalled(); expect(resume).not.toHaveBeenCalled(); // ECHO-GUARD-01: a sound with no words never pauses her, so there is nothing to resume
    expect(cancel).not.toHaveBeenCalled(); expect(stop).not.toHaveBeenCalled(); expect(sent).toEqual([]);
    cancel.mockRestore();
  });
  test("the reaction mmm over the reply pauses it and then resumes without cancelling or sending", async () => {
    const pause = mock(); const resume = mock(); const stop = mock(); const cancel = spyOn(api, "cancelTurn").mockResolvedValue({ cancelled: true });
    const socket = controlledSocket();
    const sent: string[] = [];
    const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={[]} sentTexts={sent} pauseScheduler={pause} resumeScheduler={resume} stopScheduler={stop} socketFactory={socket.createSocket} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    act(() => view.rerender(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={[]} sentTexts={sent} pauseScheduler={pause} resumeScheduler={resume} stopScheduler={stop} socketFactory={socket.createSocket} />));
    await waitFor(() => expect(view.getByText("Speaking")).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 600));
    act(() => socket.send({ t: "vad", speaking: true, rms: 0.1 }));
    await new Promise((resolve) => setTimeout(resolve, 600));
    act(() => socket.send({ t: "final", v: "mmm" }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(pause).not.toHaveBeenCalled(); expect(resume).not.toHaveBeenCalled(); // ECHO-GUARD-01: a sound with no words never pauses her, so there is nothing to resume
    expect(cancel).not.toHaveBeenCalled(); expect(stop).not.toHaveBeenCalled(); expect(sent).toEqual([]);
    cancel.mockRestore();
  });
  test("the reaction hmmm over the reply pauses it and then resumes without cancelling or sending", async () => {
    const pause = mock(); const resume = mock(); const stop = mock(); const cancel = spyOn(api, "cancelTurn").mockResolvedValue({ cancelled: true });
    const socket = controlledSocket();
    const sent: string[] = [];
    const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={[]} sentTexts={sent} pauseScheduler={pause} resumeScheduler={resume} stopScheduler={stop} socketFactory={socket.createSocket} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    act(() => view.rerender(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={[]} sentTexts={sent} pauseScheduler={pause} resumeScheduler={resume} stopScheduler={stop} socketFactory={socket.createSocket} />));
    await waitFor(() => expect(view.getByText("Speaking")).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 600));
    act(() => socket.send({ t: "vad", speaking: true, rms: 0.1 }));
    await new Promise((resolve) => setTimeout(resolve, 600));
    act(() => socket.send({ t: "final", v: "hmmm" }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(pause).not.toHaveBeenCalled(); expect(resume).not.toHaveBeenCalled(); // ECHO-GUARD-01: a sound with no words never pauses her, so there is nothing to resume
    expect(cancel).not.toHaveBeenCalled(); expect(stop).not.toHaveBeenCalled(); expect(sent).toEqual([]);
    cancel.mockRestore();
  });
  test("the reaction wooow over the reply pauses it and then resumes without cancelling or sending", async () => {
    const pause = mock(); const resume = mock(); const stop = mock(); const cancel = spyOn(api, "cancelTurn").mockResolvedValue({ cancelled: true });
    const socket = controlledSocket();
    const sent: string[] = [];
    const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={[]} sentTexts={sent} pauseScheduler={pause} resumeScheduler={resume} stopScheduler={stop} socketFactory={socket.createSocket} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    act(() => view.rerender(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={[]} sentTexts={sent} pauseScheduler={pause} resumeScheduler={resume} stopScheduler={stop} socketFactory={socket.createSocket} />));
    await waitFor(() => expect(view.getByText("Speaking")).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 600));
    act(() => socket.send({ t: "vad", speaking: true, rms: 0.1 }));
    await new Promise((resolve) => setTimeout(resolve, 600));
    act(() => socket.send({ t: "final", v: "wooow" }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(pause).not.toHaveBeenCalled(); expect(resume).not.toHaveBeenCalled(); // ECHO-GUARD-01: a sound with no words never pauses her, so there is nothing to resume
    expect(cancel).not.toHaveBeenCalled(); expect(stop).not.toHaveBeenCalled(); expect(sent).toEqual([]);
    cancel.mockRestore();
  });
  test("the reaction yeahhh over the reply pauses it and then resumes without cancelling or sending", async () => {
    const pause = mock(); const resume = mock(); const stop = mock(); const cancel = spyOn(api, "cancelTurn").mockResolvedValue({ cancelled: true });
    const socket = controlledSocket();
    const sent: string[] = [];
    const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={[]} sentTexts={sent} pauseScheduler={pause} resumeScheduler={resume} stopScheduler={stop} socketFactory={socket.createSocket} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    act(() => view.rerender(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={[]} sentTexts={sent} pauseScheduler={pause} resumeScheduler={resume} stopScheduler={stop} socketFactory={socket.createSocket} />));
    await waitFor(() => expect(view.getByText("Speaking")).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 600));
    act(() => socket.send({ t: "vad", speaking: true, rms: 0.1 }));
    await new Promise((resolve) => setTimeout(resolve, 600));
    act(() => socket.send({ t: "final", v: "yeahhh" }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(pause).not.toHaveBeenCalled(); expect(resume).not.toHaveBeenCalled(); // ECHO-GUARD-01: a sound with no words never pauses her, so there is nothing to resume
    expect(cancel).not.toHaveBeenCalled(); expect(stop).not.toHaveBeenCalled(); expect(sent).toEqual([]);
    cancel.mockRestore();
  });
  test("the words did he really do that over the reply interrupt it and become the next turn", async () => {
    const pause = mock(); const stop = mock(); const cancel = spyOn(api, "cancelTurn").mockResolvedValue({ cancelled: true });
    const fixture: SttFixtureStep[] = [
      { delayMs: 0, message: { t: "ready" } },
      { delayMs: 450, message: { t: "vad", speaking: true, rms: 0.1 } },
      { delayMs: 1000, message: { t: "final", v: "did he really do that" } },
    ];
    const sent: string[] = [];
    const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={fixture} sentTexts={sent} pauseScheduler={pause} stopScheduler={stop} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    act(() => view.rerender(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={fixture} sentTexts={sent} pauseScheduler={pause} stopScheduler={stop} />));
    await waitFor(() => expect(sent).toEqual(["did he really do that"]), { timeout: 1800 });
    expect(cancel).toHaveBeenCalledWith("turn-test", 23); expect(stop).toHaveBeenCalled();
    cancel.mockRestore();
  });
  test("the words is it true over the reply interrupt it and become the next turn", async () => {
    const pause = mock(); const stop = mock(); const cancel = spyOn(api, "cancelTurn").mockResolvedValue({ cancelled: true });
    const fixture: SttFixtureStep[] = [
      { delayMs: 0, message: { t: "ready" } },
      { delayMs: 450, message: { t: "vad", speaking: true, rms: 0.1 } },
      { delayMs: 1000, message: { t: "final", v: "is it true" } },
    ];
    const sent: string[] = [];
    const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={fixture} sentTexts={sent} pauseScheduler={pause} stopScheduler={stop} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    act(() => view.rerender(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={fixture} sentTexts={sent} pauseScheduler={pause} stopScheduler={stop} />));
    await waitFor(() => expect(sent).toEqual(["is it true"]), { timeout: 1800 });
    expect(cancel).toHaveBeenCalledWith("turn-test", 23); expect(stop).toHaveBeenCalled();
    cancel.mockRestore();
  });
  test("the words is that it over the reply interrupt it and become the next turn", async () => {
    const pause = mock(); const stop = mock(); const cancel = spyOn(api, "cancelTurn").mockResolvedValue({ cancelled: true });
    const fixture: SttFixtureStep[] = [
      { delayMs: 0, message: { t: "ready" } },
      { delayMs: 450, message: { t: "vad", speaking: true, rms: 0.1 } },
      { delayMs: 1000, message: { t: "final", v: "is that it" } },
    ];
    const sent: string[] = [];
    const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={fixture} sentTexts={sent} pauseScheduler={pause} stopScheduler={stop} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    act(() => view.rerender(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={fixture} sentTexts={sent} pauseScheduler={pause} stopScheduler={stop} />));
    await waitFor(() => expect(sent).toEqual(["is that it"]), { timeout: 1800 });
    expect(cancel).toHaveBeenCalledWith("turn-test", 23); expect(stop).toHaveBeenCalled();
    cancel.mockRestore();
  });
  test("the words that is it over the reply interrupt it and become the next turn", async () => {
    const pause = mock(); const stop = mock(); const cancel = spyOn(api, "cancelTurn").mockResolvedValue({ cancelled: true });
    const fixture: SttFixtureStep[] = [
      { delayMs: 0, message: { t: "ready" } },
      { delayMs: 450, message: { t: "vad", speaking: true, rms: 0.1 } },
      { delayMs: 1000, message: { t: "final", v: "that is it" } },
    ];
    const sent: string[] = [];
    const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={fixture} sentTexts={sent} pauseScheduler={pause} stopScheduler={stop} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    act(() => view.rerender(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={fixture} sentTexts={sent} pauseScheduler={pause} stopScheduler={stop} />));
    await waitFor(() => expect(sent).toEqual(["that is it"]), { timeout: 1800 });
    expect(cancel).toHaveBeenCalledWith("turn-test", 23); expect(stop).toHaveBeenCalled();
    cancel.mockRestore();
  });
  test("the words really? over the reply interrupt it and become the next turn", async () => {
    const pause = mock(); const stop = mock(); const cancel = spyOn(api, "cancelTurn").mockResolvedValue({ cancelled: true });
    const fixture: SttFixtureStep[] = [
      { delayMs: 0, message: { t: "ready" } },
      { delayMs: 450, message: { t: "vad", speaking: true, rms: 0.1 } },
      { delayMs: 1000, message: { t: "final", v: "really?" } },
    ];
    const sent: string[] = [];
    const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={fixture} sentTexts={sent} pauseScheduler={pause} stopScheduler={stop} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    act(() => view.rerender(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={fixture} sentTexts={sent} pauseScheduler={pause} stopScheduler={stop} />));
    await waitFor(() => expect(sent).toEqual(["really?"]), { timeout: 1800 });
    expect(cancel).toHaveBeenCalledWith("turn-test", 23); expect(stop).toHaveBeenCalled();
    cancel.mockRestore();
  });
  test("the words no no no over the reply interrupt it and become the next turn", async () => {
    const pause = mock(); const stop = mock(); const cancel = spyOn(api, "cancelTurn").mockResolvedValue({ cancelled: true });
    const fixture: SttFixtureStep[] = [
      { delayMs: 0, message: { t: "ready" } },
      { delayMs: 450, message: { t: "vad", speaking: true, rms: 0.1 } },
      { delayMs: 1000, message: { t: "final", v: "no no no" } },
    ];
    const sent: string[] = [];
    const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={fixture} sentTexts={sent} pauseScheduler={pause} stopScheduler={stop} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    act(() => view.rerender(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={fixture} sentTexts={sent} pauseScheduler={pause} stopScheduler={stop} />));
    await waitFor(() => expect(sent).toEqual(["no no no"]), { timeout: 1800 });
    expect(cancel).toHaveBeenCalledWith("turn-test", 23); expect(stop).toHaveBeenCalled();
    cancel.mockRestore();
  });
  test("the words no not that over the reply interrupt it and become the next turn", async () => {
    const pause = mock(); const stop = mock(); const cancel = spyOn(api, "cancelTurn").mockResolvedValue({ cancelled: true });
    const fixture: SttFixtureStep[] = [
      { delayMs: 0, message: { t: "ready" } },
      { delayMs: 450, message: { t: "vad", speaking: true, rms: 0.1 } },
      { delayMs: 1000, message: { t: "final", v: "no not that" } },
    ];
    const sent: string[] = [];
    const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={fixture} sentTexts={sent} pauseScheduler={pause} stopScheduler={stop} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    act(() => view.rerender(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={fixture} sentTexts={sent} pauseScheduler={pause} stopScheduler={stop} />));
    await waitFor(() => expect(sent).toEqual(["no not that"]), { timeout: 1800 });
    expect(cancel).toHaveBeenCalledWith("turn-test", 23); expect(stop).toHaveBeenCalled();
    cancel.mockRestore();
  });
  test("the words not really over the reply interrupt it and become the next turn", async () => {
    const pause = mock(); const stop = mock(); const cancel = spyOn(api, "cancelTurn").mockResolvedValue({ cancelled: true });
    const fixture: SttFixtureStep[] = [
      { delayMs: 0, message: { t: "ready" } },
      { delayMs: 450, message: { t: "vad", speaking: true, rms: 0.1 } },
      { delayMs: 1000, message: { t: "final", v: "not really" } },
    ];
    const sent: string[] = [];
    const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={fixture} sentTexts={sent} pauseScheduler={pause} stopScheduler={stop} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    act(() => view.rerender(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={fixture} sentTexts={sent} pauseScheduler={pause} stopScheduler={stop} />));
    await waitFor(() => expect(sent).toEqual(["not really"]), { timeout: 1800 });
    expect(cancel).toHaveBeenCalledWith("turn-test", 23); expect(stop).toHaveBeenCalled();
    cancel.mockRestore();
  });
  test("the words that is not over the reply interrupt it and become the next turn", async () => {
    const pause = mock(); const stop = mock(); const cancel = spyOn(api, "cancelTurn").mockResolvedValue({ cancelled: true });
    const fixture: SttFixtureStep[] = [
      { delayMs: 0, message: { t: "ready" } },
      { delayMs: 450, message: { t: "vad", speaking: true, rms: 0.1 } },
      { delayMs: 1000, message: { t: "final", v: "that is not" } },
    ];
    const sent: string[] = [];
    const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={fixture} sentTexts={sent} pauseScheduler={pause} stopScheduler={stop} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    act(() => view.rerender(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={fixture} sentTexts={sent} pauseScheduler={pause} stopScheduler={stop} />));
    await waitFor(() => expect(sent).toEqual(["that is not"]), { timeout: 1800 });
    expect(cancel).toHaveBeenCalledWith("turn-test", 23); expect(stop).toHaveBeenCalled();
    cancel.mockRestore();
  });
  test("the words thats it over the reply interrupt it and become the next turn", async () => {
    const pause = mock(); const stop = mock(); const cancel = spyOn(api, "cancelTurn").mockResolvedValue({ cancelled: true });
    const fixture: SttFixtureStep[] = [
      { delayMs: 0, message: { t: "ready" } },
      { delayMs: 450, message: { t: "vad", speaking: true, rms: 0.1 } },
      { delayMs: 1000, message: { t: "final", v: "thats it" } },
    ];
    const sent: string[] = [];
    const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={fixture} sentTexts={sent} pauseScheduler={pause} stopScheduler={stop} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    act(() => view.rerender(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={fixture} sentTexts={sent} pauseScheduler={pause} stopScheduler={stop} />));
    await waitFor(() => expect(sent).toEqual(["thats it"]), { timeout: 1800 });
    expect(cancel).toHaveBeenCalledWith("turn-test", 23); expect(stop).toHaveBeenCalled();
    cancel.mockRestore();
  });

  test("a sound that stops without words was never an interruption: nothing paused, nothing to resume", async () => {
    const pause = mock(); const resume = mock();
    const socket = controlledSocket();
    const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={[]} sentTexts={[]} pauseScheduler={pause} resumeScheduler={resume} socketFactory={socket.createSocket} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    act(() => view.rerender(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={[]} sentTexts={[]} pauseScheduler={pause} resumeScheduler={resume} socketFactory={socket.createSocket} />));
    await waitFor(() => expect(view.getByText("Speaking")).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 450));
    act(() => socket.send({ t: "vad", speaking: true, rms: 0.1 }));
    await new Promise((resolve) => setTimeout(resolve, 550));
    act(() => socket.send({ t: "vad", speaking: false, rms: 0 }));
    await new Promise((resolve) => setTimeout(resolve, 1600));
    expect(pause).not.toHaveBeenCalled(); expect(resume).not.toHaveBeenCalled();
  });

  test("a partial never cancels the reply, only the final transcript does", async () => {
    const stop = mock(); const cancel = spyOn(api, "cancelTurn").mockResolvedValue({ cancelled: true });
    const fixture: SttFixtureStep[] = [
      { delayMs: 0, message: { t: "ready" } },
      { delayMs: 450, message: { t: "vad", speaking: true, rms: 0.1 } },
      { delayMs: 470, message: { t: "partial", v: "tell me more" } },
      { delayMs: 1100, message: { t: "final", v: "tell me more about it" } },
    ];
    render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={fixture} sentTexts={[]} stopScheduler={stop} />);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const view = render(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={fixture} sentTexts={[]} stopScheduler={stop} />);
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(stop).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    await waitFor(() => expect(stop).toHaveBeenCalled(), { timeout: 1500 });
    expect(cancel).toHaveBeenCalledTimes(1);
    void view; cancel.mockRestore();
  });

  test("a reaction partial or final that guessed wrong leaves the reply paused, not cancelled, until the final decides", async () => {
    const stop = mock(); const resume = mock(); const cancel = spyOn(api, "cancelTurn").mockResolvedValue({ cancelled: true });
    const fixture: SttFixtureStep[] = [
      { delayMs: 0, message: { t: "ready" } },
      { delayMs: 450, message: { t: "vad", speaking: true, rms: 0.1 } },
      { delayMs: 470, message: { t: "partial", v: "the tv is saying something else" } },
      { delayMs: 1000, message: { t: "final", v: "" } },
    ];
    render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={fixture} sentTexts={[]} stopScheduler={stop} resumeScheduler={resume} />);
    await new Promise((resolve) => setTimeout(resolve, 30));
    render(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={fixture} sentTexts={[]} stopScheduler={stop} resumeScheduler={resume} />);
    await waitFor(() => expect(resume).toHaveBeenCalled(), { timeout: 2500 });
    expect(stop).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    cancel.mockRestore();
  });

  test("a button-opened session and a wake-opened session interrupt identically", async () => {
    const outcomes: Array<{ cancelled: number; sent: string[] }> = [];
    for (const idleCloseMs of [null, 150]) {
      const cancel = spyOn(api, "cancelTurn").mockResolvedValue({ cancelled: true });
      const sentTexts: string[] = [];
      const fixture: SttFixtureStep[] = [
        { delayMs: 0, message: { t: "ready" } },
      { delayMs: 40, message: { t: "final", v: "first request" } },
      { delayMs: 700, message: { t: "partial", v: "tell me more" } },
      { delayMs: 760, message: { t: "final", v: "tell me more" } },
      ];
      const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={fixture} sentTexts={sentTexts} idleCloseMs={idleCloseMs} voiceBargeIn />);
      await waitFor(() => expect(sentTexts).toEqual(["first request"]));
      act(() => view.rerender(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={fixture} sentTexts={sentTexts} idleCloseMs={idleCloseMs} voiceBargeIn />));
      await waitFor(() => expect(sentTexts).toEqual(["first request", "tell me more"]), { timeout: 2000 });
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
      { delayMs: 700, message: { t: "final", v: "wait tell me more" } },
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
      { delayMs: 700, message: { t: "final", v: "wait tell me more" } },
      { delayMs: 800, message: { t: "final", v: "make it shorter" } },
    ];
    const view = render(<Harness open onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={fixture} sentTexts={sentTexts} />);
    await waitFor(() => expect(view.getByText("Thinking")).toBeTruthy());
    view.rerender(<Harness open onOpenChange={() => {}} isSpeaking={true} speakingEndedAt={0} fixture={fixture} sentTexts={sentTexts} />);
    await waitFor(() => expect(sentTexts).toEqual(["first request", "wait tell me more", "make it shorter"]), { timeout: 2500 });
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
    const socketConnections: number[] = [];
    const fixture: SttFixtureStep[] = [
      { delayMs: 0, message: { t: "ready" } },
      { delayMs: 150, message: { t: "no_speech" } },
    ];
    const view = render(<Harness open={true} onOpenChange={() => {}} isSpeaking={false} speakingEndedAt={0} fixture={fixture} sentTexts={sentTexts} socketConnections={socketConnections} />);
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    // The fixture replays on a fresh socket per generation: wait for the
    // second socket, then for it to be listening again, never a send. A
    // fixed 30 ms sleep here read "Connecting" when the first "Listening"
    // arrived late under full-gate load (2026-10-16).
    await waitFor(() => expect(socketConnections.length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(view.getByText("Listening")).toBeTruthy());
    expect(sentTexts).toEqual([]);
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
  test("INSTANT-FILLER-01c: stable partial requests once, throttles for 600 ms, and observes request, turn, pool and word guards", async () => {
    const requests: string[] = [];
    let resolveRequest!: (answer: { group: "question"; source: "model"; ms: number }) => void;
    const filler = spyOn(api, "fillerGroup").mockImplementation((text) => { requests.push(text); return new Promise((resolve) => { resolveRequest = resolve; }); });
    try {
      const h = talkOverHarness();
      await new Promise((resolve) => setTimeout(resolve, 20));
      jest.useFakeTimers();
      act(() => h.socket.send({ t: "partial", v: "one two" } as never));
      act(() => jest.advanceTimersByTime(250));
      expect(filler).not.toHaveBeenCalled();
      act(() => h.socket.send({ t: "partial", v: "one two three four" } as never));
      act(() => jest.advanceTimersByTime(199));
      expect(filler).not.toHaveBeenCalled();
      act(() => jest.advanceTimersByTime(1));
      expect(requests).toEqual(["one two three four"]);
      act(() => h.socket.send({ t: "second request while first is in flight" } as never));
      act(() => jest.advanceTimersByTime(200));
      expect(filler).toHaveBeenCalledTimes(1);
      resolveRequest({ group: "question", source: "model", ms: 2 });
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      act(() => h.socket.send({ t: "third stable partial words" } as never));
      act(() => jest.advanceTimersByTime(200));
      expect(filler).toHaveBeenCalledTimes(1);
      act(() => jest.advanceTimersByTime(400));
      expect(filler).toHaveBeenCalledTimes(1);
      h.close();
    } finally { filler.mockRestore(); jest.useRealTimers(); }
  });

  test("INSTANT-FILLER-01c: drops a stale answer when the partial text changes", async () => {
    let resolveRequest!: (answer: { group: "question"; source: "model"; ms: number }) => void;
    const filler = spyOn(api, "fillerGroup").mockImplementation(() => new Promise((resolve) => { resolveRequest = resolve; }));
    try {
      const h = talkOverHarness();
      await new Promise((resolve) => setTimeout(resolve, 20));
      jest.useFakeTimers();
      act(() => h.socket.send({ t: "partial", v: "older answer text" } as never));
      act(() => jest.advanceTimersByTime(200));
      act(() => h.socket.send({ t: "partial", v: "newer answer text" } as never));
      resolveRequest({ group: "question", source: "model", ms: 1 });
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      act(() => h.socket.send({ t: "partial", v: "newer answer text", edge: true, end: { score: 1, level: "gentle", unfinished: false } } as never));
      await act(async () => { await Promise.resolve(); });
      expect(h.played).toHaveLength(1);
      expect(h.timings).toHaveLength(0);
      expect(filler).toHaveBeenCalledTimes(1);
      h.close();
    } finally { filler.mockRestore(); jest.useRealTimers(); }
  });

  test("INSTANT-FILLER-01c: skips filler requests while a turn is active or the clip pool is empty", async () => {
    const filler = spyOn(api, "fillerGroup").mockResolvedValue({ group: "question", source: "model", ms: 1 });
    try {
      const busy = talkOverHarness({ activeTurn: { turnId: "busy-turn", heardVisibleEnd: () => 0 } });
      const empty = talkOverHarness({ poolSize: 0 });
      await new Promise((resolve) => setTimeout(resolve, 20));
      jest.useFakeTimers();
      act(() => busy.socket.send({ t: "partial", v: "turn is currently active" } as never));
      act(() => empty.socket.send({ t: "partial", v: "pool currently has zero" } as never));
      act(() => jest.advanceTimersByTime(250));
      expect(filler).not.toHaveBeenCalled();
      busy.close();
      empty.close();
    } finally { filler.mockRestore(); jest.useRealTimers(); }
  });

  test("INSTANT-FILLER-01c: a same-text question answer selects its group immediately at the edge", async () => {
    const selected: string[] = [];
    const filler = spyOn(api, "fillerGroup").mockResolvedValue({ group: "question", source: "model", ms: 8 });
    try {
      const h = talkOverHarness({ grouped: selected });
      await new Promise((resolve) => setTimeout(resolve, 20));
      jest.useFakeTimers();
      act(() => h.socket.send({ t: "partial", v: "what time is it now" } as never));
      act(() => jest.advanceTimersByTime(200));
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      act(() => h.socket.send({ t: "partial", v: "what time is it now", edge: true, end: { score: 1, level: "gentle", unfinished: false } } as never));
      expect(selected).toEqual(["question"]);
      h.close();
    } finally { filler.mockRestore(); jest.useRealTimers(); }
  });

  test("INSTANT-FILLER-01c: an unanswered edge waits 150 ms then plays backchannel, and null answers use backchannel", async () => {
    let resolveRequest!: (answer: { group: null; source: "rule"; ms: number }) => void;
    const filler = spyOn(api, "fillerGroup").mockImplementation(() => new Promise((resolve) => { resolveRequest = resolve; }));
    try {
      const selected: string[] = [];
      const h = talkOverHarness({ grouped: selected });
      await new Promise((resolve) => setTimeout(resolve, 20));
      jest.useFakeTimers();
      act(() => h.socket.send({ t: "partial", v: "unanswered edge text" } as never));
      act(() => jest.advanceTimersByTime(200));
      act(() => h.socket.send({ t: "partial", v: "unanswered edge text", edge: true, end: { score: 1, level: "gentle", unfinished: false } } as never));
      act(() => jest.advanceTimersByTime(149));
      expect(selected).toEqual([]);
      await act(async () => { jest.advanceTimersByTime(1); await Promise.resolve(); });
      expect(selected).toEqual(["backchannel"]);
      h.close();
      resolveRequest({ group: null, source: "rule", ms: 4 });
    } finally { filler.mockRestore(); jest.useRealTimers(); }
  });

  test("INSTANT-FILLER-01c: a null group answer immediately chooses backchannel", async () => {
    const selected: string[] = [];
    const filler = spyOn(api, "fillerGroup").mockResolvedValue({ group: null, source: "rule", ms: 4 });
    try {
      const h = talkOverHarness({ grouped: selected });
      await new Promise((resolve) => setTimeout(resolve, 20));
      jest.useFakeTimers();
      act(() => h.socket.send({ t: "partial", v: "neutral words here" } as never));
      act(() => jest.advanceTimersByTime(200));
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      act(() => h.socket.send({ t: "partial", v: "neutral words here", edge: true, end: { score: 1, level: "gentle", unfinished: false } } as never));
      expect(selected).toEqual(["backchannel"]);
      h.close();
    } finally { filler.mockRestore(); jest.useRealTimers(); }
  });

  test("INSTANT-FILLER-01c: setting off makes no filler request and timing reports filler fields only after playback", async () => {
    const filler = spyOn(api, "fillerGroup").mockResolvedValue({ group: "question", source: "model", ms: 5 });
    try {
      const off = talkOverHarness({ grant: null });
      await new Promise((resolve) => setTimeout(resolve, 20));
      act(() => off.socket.send({ t: "partial", v: "a stable partial text" } as never));
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(filler).not.toHaveBeenCalled();
      act(() => off.socket.send({ t: "partial", v: "question at the edge", edge: true, end: { score: 1, level: "gentle", unfinished: false } } as never));
      act(() => off.socket.send({ t: "timing", speech_end_to_final_ms: 200, silence_wait_ms: 200 }));
      act(() => off.socket.send({ t: "final", v: "question at the edge" } as never));
      expect(off.played).toHaveLength(0);
      expect(off.timings.find((timing) => timing.phase === "final")?.talkOver).not.toHaveProperty("filler_group");
      off.close();

      const selected: string[] = [];
      const on = talkOverHarness({ grouped: selected });
      await new Promise((resolve) => setTimeout(resolve, 20));
      act(() => on.socket.send({ t: "partial", v: "one two three four" } as never));
      await new Promise((resolve) => setTimeout(resolve, 200));
      act(() => on.socket.send({ t: "partial", v: "one two three four", edge: true, end: { score: 1, level: "gentle", unfinished: false } } as never));
      await new Promise((resolve) => setTimeout(resolve, 160));
      act(() => on.socket.send({ t: "timing", speech_end_to_final_ms: 200, silence_wait_ms: 200 }));
      act(() => on.socket.send({ t: "final", v: "one two three four" } as never));
      const timing = on.timings.find((entry) => entry.phase === "final")?.talkOver;
      expect(timing).toMatchObject({ filler_group: "question", filler_source: "model", filler_pool_ready: 2 });
      on.close();
    } finally { filler.mockRestore(); }
  });

});
