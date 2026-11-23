// A10: host.onPlay shows the pressed song in the mini player before any fetch finishes, and clears it again if the play fails.
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
import { musicPlayer } from "@/shell/music/musicPlayer";
import { setPlayMode } from "@/shell/media/playMode";

const realFetch = globalThis.fetch;
const realCanPlayType = HTMLMediaElement.prototype.canPlayType;
afterEach(() => { cleanup(); globalThis.fetch = realFetch; HTMLMediaElement.prototype.canPlayType = realCanPlayType; setPlayMode({ shuffle: false, repeat: "off" }); musicPlayer.stop(); });

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

describe("MediaHost.onPlay pending song", () => {
  test("shows the pressed row's title, artist line and artwork before the song's data arrives, and the loaded track clears it", async () => {
    HTMLMediaElement.prototype.canPlayType = () => "probably";
    mount("/apps/audio/songs");
    let release: (value: Response) => void = () => {};
    const gate = new Promise<Response>((resolve) => { release = resolve; });
    globalThis.fetch = mock((input: RequestInfo | URL) => String(input).includes("/data/item") ? gate : Promise.resolve(Response.json([]))) as unknown as typeof fetch;
    let done: Promise<void> = Promise.resolve();
    act(() => { done = host!.onPlay("song-1", { id: "song-1", kind: "track", title: "Pancakes", channel: "Sage", thumbnail: "/thumb" }) as Promise<void>; });
    expect(musicPlayer.get().track).toBeNull();
    expect(musicPlayer.get().pending).toEqual({ key: "song-1", title: "Pancakes", subtitle: "Sage", artworkUrl: "/thumb" });
    release(Response.json({ id: "song-1", kind: "track", src: "/api/media/song-1", title: "Pancakes", subtitle: "Sage", poster: "/thumb", duration_s: 80 }));
    await act(async () => { await done; });
    expect(musicPlayer.get().track?.mediaId).toBe("song-1");
    expect(musicPlayer.get().pending).toBeNull();
  });

  test("clears the pending song and still rejects when the song is not available", async () => {
    mount("/apps/audio/songs");
    globalThis.fetch = mock(() => Promise.resolve(Response.json([]))) as unknown as typeof fetch;
    let failure: unknown = null;
    await act(async () => { await (host!.onPlay("song-2", { id: "song-2", kind: "track", title: "Gone" }) as Promise<void>).catch((error: unknown) => { failure = error; }); });
    expect(failure).toBeInstanceOf(Error);
    expect(musicPlayer.get().pending).toBeNull();
  });

  test("a row with no title shows no pending bar", () => {
    mount("/apps/audio/songs");
    globalThis.fetch = mock(() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    act(() => { void host!.onPlay("song-3", { id: "song-3", kind: "track" }); });
    expect(musicPlayer.get().pending).toBeNull();
  });
});
