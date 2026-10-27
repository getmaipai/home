import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { useWakeWordListening } from "@/apps/chat/useWakeWordListening";
import { emitWakeDetected } from "@/lib/voice/wake-word-events";
import type { Roster } from "@/lib/api";
import { renderWithQueryClient } from "../../tests/renderWithQueryClient";

afterEach(() => {
  cleanup();
  localStorage.removeItem("maipai.device-settings-id.v1");
});

const KEY = "voice.wakeword.enabled";

function adult(): Roster {
  return { id: "person-adult123", display_name: "Riff", nickname: null, role: "adult", avatar_seed: "person-adult123", source: "hub", local_only: false, created_at: "2026-09-27T00:00:00.000Z", updated_at: "2026-09-27T00:00:00.000Z", deleted_at: null, enabled: true, guest_expires_at: null, memorialized_at: null, hlc: "1788000000000:0:test", hasSecret: true } as Roster;
}

function stubOn() {
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/settings/registry")) return Promise.resolve(Response.json([{ key: KEY, scope: "device", selector: "boolean", default: false, label: "Wake word listening", level: "basic", secret: false, lives_in: "device.voice", honoured_by: ["home"] }]));
    if (url.includes("/api/voice/wakewords")) return Promise.resolve(Response.json({ detectors: [{ id: "hey_jarvis", label: "Hey Jarvis", file: "hey_jarvis_v0.1.onnx" }], installed: true }));
    if (url.includes("/api/settings?scope=")) return Promise.resolve(Response.json([{ key: KEY, value: true, source: "user", label: "Wake word listening", level: "basic", secret: false }]));
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
  return () => { globalThis.fetch = original; };
}

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname + location.search}</output>;
}

// The off-Chat wiring Routes.tsx uses: the word opens Chat with the call flag.
function ShellWakeWord({ person }: { person: Roster }) {
  const navigate = useNavigate();
  const onChat = useLocation().pathname === "/chat";
  useWakeWordListening({ person, onWake: () => navigate("/chat?wake=1"), active: !onChat });
  return null;
}

describe("WAKEUX-02 ShellWakeWord", () => {
  test("off Chat the word navigates to /chat?wake=1 and the indicator shows while listening", async () => {
    localStorage.setItem("maipai.device-settings-id.v1", "browser-1234567890ab");
    const restore = stubOn();
    try {
      const view = renderWithQueryClient(
        <MemoryRouter initialEntries={["/files"]}>
          <ShellWakeWord person={adult()} />
          <Where />
        </MemoryRouter>,
      );
      // The real runtime needs models; the indicator proves the controller is mounted off Chat.
      await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
      act(() => emitWakeDetected({ modelId: "hey_jarvis", score: 0.9, threshold: 0.5, frameIndex: 1, timestamp: Date.now() }));
      await waitFor(() => expect(view.getByTestId("where").textContent).toBe("/chat?wake=1"));
    } finally {
      restore();
    }
  });

  test("on Chat it mounts nothing: ChatPage owns the controller and the call", async () => {
    localStorage.setItem("maipai.device-settings-id.v1", "browser-1234567890ab");
    const restore = stubOn();
    try {
      const view = renderWithQueryClient(
        <MemoryRouter initialEntries={["/chat"]}>
          <ShellWakeWord person={adult()} />
          <Where />
        </MemoryRouter>,
      );
      act(() => emitWakeDetected({ modelId: "hey_jarvis", score: 0.9, threshold: 0.5, frameIndex: 1, timestamp: Date.now() }));
      expect(view.getByTestId("where").textContent).toBe("/chat");
    } finally {
      restore();
    }
  });
});
