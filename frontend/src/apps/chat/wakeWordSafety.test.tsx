import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import * as fs from "node:fs";
import { useState } from "react";
import { VoiceSessionProvider } from "@/apps/chat/voiceSessionContext";
import { useWakeWordListening } from "@/apps/chat/useWakeWordListening";
import { useVoiceSession } from "@/apps/chat/voiceSessionContext";
import { LauncherBubble } from "@maipai/ui/src/elements/launcher-bubble";
import { Button } from "@maipai/ui/src/ui/button";
import { emitWakeDetected } from "@/lib/voice/wake-word-events";
import type { Roster, ResolvedSetting } from "@/lib/api";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";

afterEach(() => {
  cleanup();
  localStorage.removeItem("maipai.device-settings-id.v1");
});

const KEY = "voice.wakeword.enabled";
const DEVICE_SCOPE = "device:browser-1234567890ab";

function adult(): Roster {
  return {
    id: "person-adult123",
    display_name: "Riff",
    nickname: null,
    role: "adult",
    avatar_seed: "person-adult123",
    source: "hub",
    local_only: false,
    created_at: "2026-09-27T00:00:00.000Z",
    updated_at: "2026-09-27T00:00:00.000Z",
    deleted_at: null,
    enabled: true,
    guest_expires_at: null,
    memorialized_at: null,
    hlc: "1788000000000:0:test",
    hasSecret: true,
  } as Roster;
}

function setting(value: boolean): ResolvedSetting {
  return { key: KEY, value, source: value ? "user" : "default", label: "Wake word listening", level: "basic", secret: false };
}

function stubWakewordSettings(initialValue: boolean) {
  const original = globalThis.fetch;
  const writes: Array<{ scope: string; key: string; value: boolean }> = [];
  let value = initialValue;
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/settings/registry")) {
      return Promise.resolve(Response.json([{ key: KEY, scope: "device", selector: "boolean", default: false, label: "Wake word listening", level: "basic", secret: false, lives_in: "device.voice", honoured_by: ["home"] }]));
    }
    if (url.includes("/api/voice/wakewords")) return Promise.resolve(Response.json({ detectors: [{ id: "hey_jarvis", label: "Hey Jarvis", file: "hey_jarvis_v0.1.onnx" }], installed: true }));
    if (url.includes("/api/settings?scope=")) return Promise.resolve(Response.json([setting(value)]));
    if (url === "/api/settings" && init?.method === "PUT") {
      const body = JSON.parse(String(init.body)) as { scope: string; key: string; value: boolean };
      writes.push(body);
      value = body.value;
      return Promise.resolve(Response.json(setting(value)));
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
  return { writes, restore: () => { globalThis.fetch = original; } };
}

// Stands in for the two use sites (Routes off Chat, ChatPage on it): the hook plus the kit Element it feeds.
function WakeWordController({ person, runtime, onWake }: { person: Roster; runtime?: Parameters<typeof useWakeWordListening>[0]["runtime"]; onWake?: () => void }) {
  const voiceSession = useVoiceSession();
  const wake = useWakeWordListening({
    person,
    runtime,
    voiceOpen: voiceSession?.open ?? false,
    onWake: onWake ?? (() => { if (voiceSession?.openFromWake) voiceSession.openFromWake(); else voiceSession?.setOpen(true); }),
  });
  return wake.indicator ? <LauncherBubble docked open={false} unread={0} greeting="" prompts={[]} {...wake.indicator} /> : null;
}

function ControllerHarness({ runtime, person = adult(), openFromWake }: { runtime?: React.ComponentProps<typeof WakeWordController>["runtime"]; person?: Roster; openFromWake?: () => void }) {
  const [open, setOpen] = useState(false);
  const [openedByWake, setOpenedByWake] = useState(false);
  const closeAwareSetOpen = (value: boolean) => {
    if (!value) setOpenedByWake(false);
    setOpen(value);
  };
  const openSessionFromWake = () => {
    setOpenedByWake(true);
    setOpen(true);
    openFromWake?.();
  };
  return (
    <>
      <VoiceSessionProvider value={{ open, setOpen: closeAwareSetOpen, openFromWake: openFromWake ? openSessionFromWake : undefined }}>
        <WakeWordController person={person} runtime={runtime} />
      </VoiceSessionProvider>
      <output data-testid="voice-session-open">{String(open)}</output>
      <output data-testid="voice-session-wake-origin">{String(openedByWake)}</output>
      <Button data-testid="close-voice-session" onClick={() => closeAwareSetOpen(false)}>Close session</Button>
      <Button data-testid="open-voice-session-by-button" onClick={() => closeAwareSetOpen(true)}>Open session by button</Button>
    </>
  );
}

function modelLoadNoop() {
  return Promise.resolve([]);
}

function inertLoop() {
  return { setEnabled: () => {}, pushFrame: () => {}, onError: null as ((err: unknown) => void) | null };
}

describe("HANDSFREE-01(c) wake-word safety", () => {
  test("(i) an available stock detector and default setting do not open the mic until explicit opt-in", async () => {
    localStorage.setItem("maipai.device-settings-id.v1", "browser-1234567890ab");
    const fetcher = stubWakewordSettings(false);
    const startCapture = mock(async () => ({ stop: () => {}, sampleRate: 16_000 }));
    try {
      const view = renderWithQueryClient(
        <ControllerHarness runtime={{ loadModels: modelLoadNoop, startCapture, createLoop: inertLoop }} />,
      );
      await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
      expect(view.queryByText("Listening for Hey Jarvis")).toBeNull();
      expect(startCapture).not.toHaveBeenCalled();
    } finally {
      fetcher.restore();
    }
  });

  test("(iii)/(iv) the one indicator shows only while the mic is open, on any page, and carries its own Turn off (see (i) and (vi))", async () => {
    localStorage.setItem("maipai.device-settings-id.v1", "browser-1234567890ab");
    const fetcher = stubWakewordSettings(true);
    const woke = mock();
    try {
      const view = renderWithQueryClient(
        <WakeWordController person={adult()} onWake={woke} runtime={{ loadModels: modelLoadNoop, startCapture: async () => ({ stop: () => {}, sampleRate: 16_000 }), createLoop: inertLoop }} />,
      );
      await view.findByText("Listening for Hey Jarvis");
      expect(view.getByRole("button", { name: "Turn off wake word listening" })).toBeTruthy();
      act(() => emitWakeDetected({ modelId: "hey_jarvis", score: 0.9, threshold: 0.5, frameIndex: 1, timestamp: Date.now() }));
      await waitFor(() => expect(woke).toHaveBeenCalledTimes(1));
    } finally {
      fetcher.restore();
    }
  });

  test("(v) captured pre-wake audio only enters the in-memory detector; no file, turn, or memory request occurs", async () => {
    localStorage.setItem("maipai.device-settings-id.v1", "browser-1234567890ab");
    const fetcher = stubWakewordSettings(true);
    let deliverFrame: ((frame: Float32Array) => void) | undefined;
    const startCapture = mock(async ({ onFrame }: { onFrame: (frame: Float32Array) => void }) => {
      deliverFrame = onFrame;
      return { stop: () => {}, sampleRate: 16_000 };
    });
    const bunWriteSpy = spyOn(Bun, "write");
    const fsWriteSpy = spyOn(fs, "writeFileSync");
    try {
      const view = renderWithQueryClient(
        <ControllerHarness runtime={{ loadModels: modelLoadNoop, startCapture }} />,
      );
      await view.findByText("Listening for Hey Jarvis");
      const preWakeFrame = new Float32Array(160).fill(0.125); // below one detector frame: buffered in the real WakeWordLoop's typed-array accumulator
      deliverFrame!(preWakeFrame);
      await Promise.resolve();
      const requests = (globalThis.fetch as unknown as { mock: { calls: [RequestInfo | URL, RequestInit?][] } }).mock.calls;
      const urls = requests.map(([input]) => typeof input === "string" ? input : input.toString());
      expect(urls.some((url) => /\/api\/(turn|memory)(\/|\?|$)/.test(url))).toBe(false);
      expect(bunWriteSpy).not.toHaveBeenCalled();
      expect(fsWriteSpy).not.toHaveBeenCalled();
      expect(startCapture).toHaveBeenCalledTimes(1);
    } finally {
      bunWriteSpy.mockRestore();
      fsWriteSpy.mockRestore();
      fetcher.restore();
    }
  });

  test("(vi) the live indicator stops capture and persists off with one action", async () => {
    localStorage.setItem("maipai.device-settings-id.v1", "browser-1234567890ab");
    const fetcher = stubWakewordSettings(true);
    let stopped = 0;
    const startCapture = mock(async () => ({ stop: () => { stopped++; }, sampleRate: 16_000 }));
    try {
      const view = renderWithQueryClient(
        <ControllerHarness runtime={{ loadModels: modelLoadNoop, startCapture, createLoop: inertLoop }} />,
      );
      await view.findByText("Listening for Hey Jarvis");
      fireEvent.click(view.getByRole("button", { name: "Turn off wake word listening" }));
      await waitFor(() => expect(stopped).toBe(1));
      await waitFor(() => expect(fetcher.writes).toEqual([{ scope: DEVICE_SCOPE, key: KEY, value: false }]));
      expect(view.queryByText("Listening for Hey Jarvis")).toBeNull();
    } finally {
      fetcher.restore();
    }
  });

  test("without openFromWake, wake detection still opens the session as before", async () => {
    localStorage.setItem("maipai.device-settings-id.v1", "browser-1234567890ab");
    const fetcher = stubWakewordSettings(true);
    const view = renderWithQueryClient(
      <ControllerHarness runtime={{ loadModels: modelLoadNoop, startCapture: async () => ({ stop: () => {}, sampleRate: 16_000 }), createLoop: inertLoop }} />,
    );
    try {
      await view.findByText("Listening for Hey Jarvis");
      act(() => emitWakeDetected({ modelId: "hey_jarvis", score: 0.9, threshold: 0.5, frameIndex: 1, timestamp: Date.now() }));
      await waitFor(() => expect(view.getByTestId("voice-session-open").textContent).toBe("true"));
    } finally {
      fetcher.restore();
    }
  });

  test("WAKEUX: a hidden tab stops listening and a shown tab resumes", async () => {
    localStorage.setItem("maipai.device-settings-id.v1", "browser-1234567890ab");
    const fetcher = stubWakewordSettings(true);
    const setHidden = (hidden: boolean) => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
      document.dispatchEvent(new Event("visibilitychange"));
    };
    const view = renderWithQueryClient(
      <WakeWordController person={adult()} runtime={{ loadModels: modelLoadNoop, startCapture: async () => ({ stop: () => {}, sampleRate: 16_000 }), createLoop: inertLoop }} />,
    );
    try {
      await view.findByText("Listening for Hey Jarvis");
      act(() => setHidden(true));
      await waitFor(() => expect(view.queryByText("Listening for Hey Jarvis")).toBeNull());
      act(() => setHidden(false));
      await view.findByText("Listening for Hey Jarvis");
    } finally {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      fetcher.restore();
    }
  });

  test("a wake detection opens the session through openFromWake", async () => {
    localStorage.setItem("maipai.device-settings-id.v1", "browser-1234567890ab");
    const fetcher = stubWakewordSettings(true);
    const setOrigin = mock();
    const view = renderWithQueryClient(
      <ControllerHarness
        openFromWake={setOrigin}
        runtime={{ loadModels: modelLoadNoop, startCapture: async () => ({ stop: () => {}, sampleRate: 16_000 }), createLoop: inertLoop }}
      />,
    );
    try {
      await view.findByText("Listening for Hey Jarvis");
      act(() => emitWakeDetected({ modelId: "hey_jarvis", score: 0.9, threshold: 0.5, frameIndex: 1, timestamp: Date.now() }));
      await waitFor(() => expect(setOrigin).toHaveBeenCalledTimes(1));
      expect(view.getByTestId("voice-session-open").textContent).toBe("true");
      expect(view.getByTestId("voice-session-wake-origin").textContent).toBe("true");
      fireEvent.click(view.getByTestId("close-voice-session"));
      fireEvent.click(view.getByTestId("open-voice-session-by-button"));
      expect(view.getByTestId("voice-session-wake-origin").textContent).toBe("false");
      expect(view.getByTestId("voice-session-open").textContent).toBe("true");
    } finally {
      fetcher.restore();
    }
  });
});
