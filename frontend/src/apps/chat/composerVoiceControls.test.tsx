import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { ComposerVoiceControls } from "@/apps/chat/composerVoiceControls";

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
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

// VOICE-LIVE-03b (owner's ruling, 2026-09-23): the composer's own voice
// control is now just the waveform pill - no chevron, no voice list, no
// microphone menu, all moved to Settings' own VoiceCatalogSection.tsx
// (VoiceCatalogSection.test.tsx covers the readable-name rendering and
// the microphone group there instead).
describe("ComposerVoiceControls (HANDSFREE-01 (b); mounted via ComposerExtraEnd, VOICE-LIVE-01)", () => {
  // Not "no Stack configured" any more - VOICE-LIVE-01b (2026-09-23) made
  // that always answer with Home's own five real roles. An empty roles
  // list is now the overview-not-answered-yet case (the query's first
  // render, or a genuinely broken /api/engines) - readyRole() still has
  // to read that as not-ready, not crash.
  test("absent when the overview reports no roles at all", async () => {
    const restore = stubEngines([]);
    try {
      const view = renderWithQueryClient(<ComposerVoiceControls />);
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
      const view = renderWithQueryClient(<ComposerVoiceControls />);
      await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
      expect(view.queryByLabelText("Start a voice conversation")).toBeNull();
    } finally {
      restore();
    }
  });

  test("present once both stt and tts roles are ready - the waveform pill, alone", async () => {
    const restore = stubEngines([
      { id: "stt", state: "ready" },
      { id: "tts", state: "ready" },
    ]);
    try {
      const view = renderWithQueryClient(<ComposerVoiceControls />);
      const waveform = await view.findByLabelText("Start a voice conversation");
      expect(waveform).toBeTruthy();
      // No chevron, no voice/microphone menu left on the composer -
      // VOICE-LIVE-03b moved both into Settings.
      expect(view.queryByLabelText("Choose a voice")).toBeNull();
    } finally {
      restore();
    }
  });
});
