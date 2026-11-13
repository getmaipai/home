// VIDEO-UI-06 (K8): the host's `makingNotice`. A control that starts a picture or a clip asks the host for the one line to show while that engine is
// not ready. The host reads the same ["health"] query the chat composer and `useMakingAvailability` read, so it adds no request of its own, and it says
// nothing while the engine is ready (or the hub sent no row), so a control is never disabled on a guess.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useContext } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@maipai/ui/src/ui/tooltip";
import { createQueryClient } from "@maipai/ui/src/queryClient";
import { ToastProvider } from "@maipai/ui/src/primitives/Toast";
import { MediaHostContext, type MediaHost } from "@maipai/ui/src/schema/mediaHost";
import { MAKING_NOT_READY_LINE, MediaHostProvider } from "@/shell/mediaHost";

afterEach(cleanup);
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const notice = { adult: "Video is paused while this computer finishes other work. It starts again by itself.", teen: "Teen line.", child: "Videos are resting for a bit.", repairs_link: null };
const PAUSED = { kind: "failed", pid: null, alive: false, availability: "unavailable", cause: "memory", notice };
const READY = { kind: "none", pid: null, alive: true, availability: "ready" };
const CHAT = { kind: "url", pid: null, alive: true, availability: "ready" };

let host: MediaHost | null = null;
function Probe() { host = useContext(MediaHostContext); return null; }
function mount(engines: Record<string, unknown>, ageBand?: "adult" | "teen" | "child") {
  host = null;
  const calls: string[] = [];
  globalThis.fetch = mock((url: string | URL | Request) => { calls.push(String(url)); return Promise.resolve(Response.json({ engines: { chat: CHAT, ...engines } })); }) as unknown as typeof fetch;
  render(
    <QueryClientProvider client={createQueryClient()}>
      <TooltipProvider><ToastProvider><MemoryRouter>
        <MediaHostProvider personId="person-1" {...(ageBand ? { ageBand } : {})}><Probe /></MediaHostProvider>
      </MemoryRouter></ToastProvider></TooltipProvider>
    </QueryClientProvider>,
  );
  return calls;
}

describe("MediaHost.makingNotice", () => {
  test("a paused video engine gives the person's own line, and pictures stay free while only video is paused", async () => {
    const calls = mount({ video: PAUSED, image: READY }, "adult");
    await waitFor(() => expect(host!.makingNotice!("video")).toBe(notice.adult));
    expect(host!.makingNotice!("picture")).toBeUndefined();
    // The notice itself asks for nothing; the only other requests are the person's Music sound settings (crossfade and Equalizer) and the list of songs kept offline.
    expect(calls.every((url) => url.includes("/api/health") || url.includes("/api/settings") || url.includes("/api/plugins/audio/offline"))).toBe(true);
    expect(calls.filter((url) => url.includes("/api/health")).length).toBeGreaterThan(0);
  });

  test("a child reads the child line; no band known reads the gentlest", async () => {
    mount({ video: PAUSED }, "child");
    await waitFor(() => expect(host!.makingNotice!("video")).toBe(notice.child));
    cleanup();
    mount({ video: PAUSED });
    await waitFor(() => expect(host!.makingNotice!("video")).toBe(notice.child));
  });

  test("a not-ready row with no words still gets one plain line, and a ready row or a hub with no row says nothing", async () => {
    mount({ video: { kind: "failed", pid: null, alive: false, availability: "unavailable" } }, "adult");
    await waitFor(() => expect(host!.makingNotice!("video")).toBe(MAKING_NOT_READY_LINE.video));
    cleanup();
    mount({ video: READY, image: READY }, "adult");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(host!.makingNotice!("video")).toBeUndefined();
    expect(host!.makingNotice!("picture")).toBeUndefined();
    cleanup();
    mount({}, "adult");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(host!.makingNotice!("video")).toBeUndefined();
  });

  test("a clip or a sound can be picked now (the Studio's pickers), and a second ask closes the first with null", async () => {
    mount({ video: READY }, "adult");
    await waitFor(() => expect(host).not.toBeNull());
    let first!: Promise<unknown>;
    act(() => { first = host!.pickMedia!("video"); });
    act(() => { void host!.pickMedia!("audio"); });
    expect(await first).toBeNull();
  });
});
