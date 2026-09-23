import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { ComposerVoiceControls } from "@/apps/chat/composerVoiceControls";
import { readMicDevicePreference } from "@/lib/voice/micDevicePreference";

afterEach(cleanup);

function stubEngines(roles: { id: string; state: string }[]): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/engines")) {
      return Promise.resolve(
        Response.json({
          configured: roles.length > 0,
          roles: roles.map((r) => ({ id: r.id, label: r.id, wire: "chat", residency: "resident", endpoints: [], quality: [], sharesModelWith: null, state: { state: r.state, since: "2026-09-22T00:00:00.000Z" }, reason: null, model: null, check: { state: "not checked", at: null, reason: null, stale: false } })),
          engines: [],
          budget: null,
        }),
      );
    }
    if (url.includes("/api/voice/catalog")) return Promise.resolve(Response.json({ entries: [{ path: "en/female/nova.wav", collection: "narrated" }] }));
    // api.settingsValues() (VoiceChevron's currentQuery) expects a real
    // ResolvedSetting[] - it calls .find() on the resolved data, which
    // throws on the generic {} fallback below.
    if (url.includes("/api/settings")) return Promise.resolve(Response.json([]));
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

// The same Object.defineProperty(navigator, "mediaDevices", ...) pattern
// useWakeWord.test.ts and sttDictationAdapter.test.ts already use -
// MicrophoneGroup's useAudioInputDevices() calls enumerateDevices() and
// a devicechange listener unconditionally on mount, and bun's test
// environment has no real navigator.mediaDevices to answer them.
function stubMediaDevices(devices: MediaDeviceInfo[]): () => void {
  const original = navigator.mediaDevices;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      enumerateDevices: () => Promise.resolve(devices),
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  });
  return () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: original });
  };
}

describe("ComposerVoiceControls (HANDSFREE-01 (b); mounted via ComposerExtraEnd, VOICE-LIVE-01)", () => {
  // Not "no Stack configured" any more - VOICE-LIVE-01b (2026-09-23) made
  // that always answer with Home's own five real roles. An empty roles
  // list is now the overview-not-answered-yet case (the query's first
  // render, or a genuinely broken /api/engines) - readyRole() still has
  // to read that as not-ready, not crash.
  test("absent when the overview reports no roles at all", async () => {
    const restore = stubEngines([]);
    try {
      const view = renderWithQueryClient(<ComposerVoiceControls personId="person-1" />);
      await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
      expect(view.queryByLabelText("Start a voice conversation")).toBeNull();
    } finally {
      restore();
    }
  });

  test("absent when only one of stt/tts is ready", async () => {
    const restore = stubEngines([
      { id: "stt", state: "ready" },
      { id: "tts", state: "loaded" },
    ]);
    try {
      const view = renderWithQueryClient(<ComposerVoiceControls personId="person-1" />);
      await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
      expect(view.queryByLabelText("Start a voice conversation")).toBeNull();
    } finally {
      restore();
    }
  });

  test("present once both stt and tts roles are ready - the waveform button and the voice chevron", async () => {
    const restore = stubEngines([
      { id: "stt", state: "ready" },
      { id: "tts", state: "ready" },
    ]);
    const restoreMedia = stubMediaDevices([]);
    try {
      const view = renderWithQueryClient(<ComposerVoiceControls personId="person-1" />);
      await view.findByLabelText("Start a voice conversation");
      expect(view.getByLabelText("Choose a voice")).toBeTruthy();
      view.unmount();
      // MicrophoneGroup's unmount effect (navigator.mediaDevices.removeEventListener)
      // runs as a passive effect, a tick after unmount() returns - wait
      // for it before restoreMedia() below, or it fires against the
      // already-restored (real, undefined) navigator.mediaDevices.
      await new Promise((r) => setTimeout(r, 0));
    } finally {
      restoreMedia();
      restore();
    }
  });

  // A code review (2026-09-23): the failed-write comment claimed "the
  // next menu open" would re-read the real setting and correct a bad
  // optimistic pick, but VoiceChevron never remounts on open/close, so
  // nothing was actually re-reading anything - the active item just
  // stayed wrong, silently, with no error and no self-correction ever.
  test("a failed voice selection rolls back to the last known-good choice, not a silently-wrong optimistic one", async () => {
    const original = globalThis.fetch;
    let selectCalls = 0;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/engines")) {
        const roles = ["stt", "tts"].map((id) => ({ id, label: id, wire: "chat", residency: "resident", endpoints: [], quality: [], sharesModelWith: null, state: { state: "ready", since: "2026-09-23T00:00:00.000Z" }, reason: null, model: null, check: { state: "not checked", at: null, reason: null, stale: false } }));
        return Promise.resolve(Response.json({ configured: true, roles, engines: [], budget: null }));
      }
      if (url.includes("/api/voice/catalog/select")) {
        selectCalls++;
        return Promise.resolve(new Response("write failed", { status: 500 }));
      }
      if (url.includes("/api/voice/catalog")) {
        return Promise.resolve(Response.json({ entries: [{ path: "en/female/nova.wav", collection: "narrated" }, { path: "en/male/oliver.wav", collection: "narrated" }] }));
      }
      if (url.includes("/api/settings")) {
        return Promise.resolve(Response.json([{ key: "tts.voice_id", value: "hf://kyutai/tts-voices/en/female/nova.wav" }]));
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
    const restoreMedia = stubMediaDevices([]);
    try {
      const view = renderWithQueryClient(<ComposerVoiceControls personId="person-1" />);
      const chevron = await view.findByLabelText("Choose a voice");
      chevron.click();
      const oliver = await view.findByText("oliver.wav");
      oliver.click();
      await waitFor(() => expect(selectCalls).toBe(1));
      // Back to the real, still-unchanged server value - not stuck
      // showing "oliver.wav" as chosen when the write never took.
      // ComposerMenuItem (commons ui) marks the active row with
      // data-active on its own <button>.
      chevron.click();
      const novaButton = (await view.findByText("nova.wav")).closest("button")!;
      const oliverButton = (await view.findByText("oliver.wav")).closest("button")!;
      expect(novaButton).toHaveAttribute("data-active", "true");
      expect(oliverButton).not.toHaveAttribute("data-active");
      view.unmount();
      await new Promise((r) => setTimeout(r, 0));
    } finally {
      restoreMedia();
      globalThis.fetch = original;
    }
  });

  test("VOICE-LIVE-03: two input devices are listed in the chevron's menu, and choosing the second writes the mic preference", async () => {
    const restore = stubEngines([
      { id: "stt", state: "ready" },
      { id: "tts", state: "ready" },
    ]);
    const devices = [
      { deviceId: "mic-1", kind: "audioinput", label: "Built-in Microphone" } as MediaDeviceInfo,
      { deviceId: "mic-2", kind: "audioinput", label: "USB Headset" } as MediaDeviceInfo,
    ];
    const restoreMedia = stubMediaDevices(devices);
    try {
      const view = renderWithQueryClient(<ComposerVoiceControls personId="person-1" />);
      const chevron = await view.findByLabelText("Choose a voice");
      chevron.click();
      const second = await view.findByText("USB Headset");
      expect(view.getByText("Built-in Microphone")).toBeTruthy();
      second.click();
      expect(readMicDevicePreference()).toBe("mic-2");
      view.unmount();
      await new Promise((r) => setTimeout(r, 0)); // let MicrophoneGroup's unmount effect run before restoreMedia() - see the comment above
    } finally {
      restoreMedia();
      restore();
      localStorage.removeItem("maipai.chat.mic-device-id");
    }
  });
});
