// NOW-PLAYING-01: the host gives the kit's Now Playing the play mode (shuffle, repeat) and the Up next button on Audio pages only, from the
// same play mode the stage uses, and Up next asks the Audio page's player section to open the stage on its queue view.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { useContext } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@maipai/ui/src/ui/tooltip";
import { createQueryClient } from "@maipai/ui/src/queryClient";
import { ToastProvider } from "@maipai/ui/src/primitives/Toast";
import { MediaHostContext, type MediaHost } from "@maipai/ui/src/schema/mediaHost";
import { MediaHostProvider } from "@/shell/mediaHost";
import { getPlayMode, setPlayMode } from "@/shell/media/playMode";
import { getStageRequest } from "@/shell/media/stageRequest";

afterEach(cleanup);
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; setPlayMode({ shuffle: false, repeat: "off" }); });

let host: MediaHost | null = null;
function Probe() { host = useContext(MediaHostContext); return null; }
function mount(path: string) {
  host = null;
  globalThis.fetch = mock(() => Promise.resolve(Response.json({ engines: {} }))) as unknown as typeof fetch;
  render(
    <QueryClientProvider client={createQueryClient()}>
      <TooltipProvider><ToastProvider><MemoryRouter initialEntries={[path]}>
        <MediaHostProvider personId="person-1"><Probe /></MediaHostProvider>
      </MemoryRouter></ToastProvider></TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("MediaHost.playMode and openQueue", () => {
  test("Audio pages get the stage's play mode; shuffle and repeat buttons change it, repeat going off, all, one, off", () => {
    mount("/apps/audio/play");
    expect(host!.playMode).toMatchObject({ shuffle: false, repeat: "off" });
    act(() => host!.playMode!.onShuffle());
    expect(getPlayMode().shuffle).toBe(true);
    expect(host!.playMode!.shuffle).toBe(true);
    act(() => host!.playMode!.onRepeat());
    expect(getPlayMode().repeat).toBe("all");
    act(() => host!.playMode!.onRepeat());
    expect(host!.playMode!.repeat).toBe("one");
    act(() => host!.playMode!.onRepeat());
    expect(getPlayMode().repeat).toBe("off");
  });

  test("Up next asks the stage to open on its queue view", () => {
    mount("/apps/audio/play");
    const before = getStageRequest().seq;
    act(() => host!.openQueue!());
    expect(getStageRequest()).toEqual({ seq: before + 1, view: "queue" });
  });

  test("another app's player gets neither, so a podcast never shows music shuffle", () => {
    mount("/apps/podcasts/play");
    expect(host!.playMode).toBeUndefined();
    expect(host!.openQueue).toBeUndefined();
  });
});
