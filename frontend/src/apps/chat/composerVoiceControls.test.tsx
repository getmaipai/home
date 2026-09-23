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
    if (url.includes("/api/voice/catalog")) return Promise.resolve(Response.json({ entries: [{ path: "en/female/nova.wav", collection: "narrated" }] }));
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

describe("ComposerVoiceControls (HANDSFREE-01 (b); mounted via ComposerExtraEnd, VOICE-LIVE-01)", () => {
  test("absent with no Stack configured - the common household today", async () => {
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

  test("present once both stt and tts roles are ready - the waveform button and the voice chevron", async () => {
    const restore = stubEngines([
      { id: "stt", state: "ready" },
      { id: "tts", state: "ready" },
    ]);
    try {
      const view = renderWithQueryClient(<ComposerVoiceControls />);
      await view.findByLabelText("Start a voice conversation");
      expect(view.getByLabelText("Choose a voice")).toBeTruthy();
    } finally {
      restore();
    }
  });
});
