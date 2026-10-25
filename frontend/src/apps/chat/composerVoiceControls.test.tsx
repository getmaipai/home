import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, waitFor } from "@testing-library/react";
import { AdminContext } from "@/apps/chat/chatThreadContexts";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { ComposerVoiceControls, useVoiceCallReady } from "@/apps/chat/composerVoiceControls";

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
      const view = renderWithQueryClient(<AdminContext.Provider value><ComposerVoiceControls /></AdminContext.Provider>);
      await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
      expect(view.queryByLabelText("Start a voice conversation")).toBeNull();
    } finally {
      restore();
    }
  });

  test("present when stt is ready and tts is installed but not loaded yet (a cold Stack)", async () => {
    const restore = stubEngines([
      { id: "stt", state: "installed" },
      { id: "tts", state: "installed" },
    ]);
    try {
      const view = renderWithQueryClient(<AdminContext.Provider value><ComposerVoiceControls /></AdminContext.Provider>);
      expect(await view.findByLabelText("Start a voice conversation")).toBeTruthy();
    } finally {
      restore();
    }
  });

  for (const bad of ["offline", "notInstalled"]) {
    test(`absent when tts is ${bad}`, async () => {
      const restore = stubEngines([
        { id: "stt", state: "ready" },
        { id: "tts", state: bad },
      ]);
      try {
        const view = renderWithQueryClient(<AdminContext.Provider value><ComposerVoiceControls /></AdminContext.Provider>);
        await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
        await new Promise((r) => setTimeout(r, 50));
        expect(view.queryByLabelText("Start a voice conversation")).toBeNull();
      } finally {
        restore();
      }
    });
  }

  test("absent when only stt is present and tts has no role", async () => {
    const restore = stubEngines([
      { id: "stt", state: "ready" },
    ]);
    try {
      const view = renderWithQueryClient(<AdminContext.Provider value><ComposerVoiceControls /></AdminContext.Provider>);
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
      const view = renderWithQueryClient(<AdminContext.Provider value><ComposerVoiceControls /></AdminContext.Provider>);
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

// MOBILE-LIVE-01: GET /api/engines is owner/admin only. Asked as an adult it
// is a 403 that the browser prints as a console error on every Chat visit.
describe("ComposerVoiceControls for someone who is not an owner or admin", () => {
  test("never asks the admin-only engines route", async () => {
    const restore = stubEngines([]);
    try {
      renderWithQueryClient(<ComposerVoiceControls />);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const enginesRequests = (globalThis.fetch as unknown as ReturnType<typeof mock>).mock.calls.filter(([input]) => {
        const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
        return url.includes("/api/engines");
      });
      expect(enginesRequests).toHaveLength(0);
    } finally {
      restore();
    }
  });
});

// DOTS-CHAT-01: the chat header's Call button and the composer waveform share one gate.
describe("useVoiceCallReady (the Call gate)", () => {
  function Probe({ disabled, engineDown }: { disabled?: boolean; engineDown?: string }) {
    return <span data-testid="ready">{String(useVoiceCallReady(disabled, engineDown))}</span>;
  }
  const both = [{ id: "stt", state: "ready" }, { id: "tts", state: "ready" }];

  test("true once speech in and out are usable", async () => {
    const restore = stubEngines(both);
    try {
      const view = renderWithQueryClient(<AdminContext.Provider value><Probe /></AdminContext.Provider>);
      await waitFor(() => expect(view.getByTestId("ready").textContent).toBe("true"));
    } finally { restore(); }
  });

  test("false without speech out, while a turn runs (disabled) and with the engine down", async () => {
    const restore = stubEngines([{ id: "stt", state: "ready" }]);
    try {
      const view = renderWithQueryClient(<AdminContext.Provider value><Probe /></AdminContext.Provider>);
      await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
      expect(view.getByTestId("ready").textContent).toBe("false");
    } finally { restore(); }
    const again = stubEngines(both);
    try {
      const running = renderWithQueryClient(<AdminContext.Provider value><Probe disabled /></AdminContext.Provider>);
      await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
      expect(running.container.textContent).toBe("false");
      const down = renderWithQueryClient(<AdminContext.Provider value><Probe engineDown="Chat is unavailable" /></AdminContext.Provider>);
      expect(down.container.textContent).toBe("false");
    } finally { again(); }
  });

  test("false for someone who is not an admin (the engines route is admin-only)", async () => {
    const restore = stubEngines(both);
    try {
      const view = renderWithQueryClient(<AdminContext.Provider value={false}><Probe /></AdminContext.Provider>);
      await new Promise((r) => setTimeout(r, 50));
      expect(view.getByTestId("ready").textContent).toBe("false");
    } finally { restore(); }
  });
});
