// A10: the mini player draws the clicked song's pending bar as soon as the store holds one, with or without a track already playing.
import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@maipai/ui/src/ui/tooltip";
import { ToastProvider } from "@maipai/ui/src/primitives/Toast";
import { createQueryClient } from "@maipai/ui/src/queryClient";
import { MusicPlayerBar } from "./MusicPlayerBar";
import { musicPlayer } from "./musicPlayer";

afterEach(() => { cleanup(); musicPlayer.stop(); });
const realCanPlayType = HTMLMediaElement.prototype.canPlayType;
afterEach(() => { HTMLMediaElement.prototype.canPlayType = realCanPlayType; });

const mount = () => render(<QueryClientProvider client={createQueryClient()}><TooltipProvider><ToastProvider><MemoryRouter><MusicPlayerBar /></MemoryRouter></ToastProvider></TooltipProvider></QueryClientProvider>);

describe("MusicPlayerBar with a pending song", () => {
  test("draws nothing without a track or a pending song, then the pending bar once one is shown, and removes it when cleared", () => {
    const view = mount();
    expect(view.container.querySelector('[data-testid="music-player-pending"]')).toBeNull();
    act(() => musicPlayer.showPending({ key: "m1", title: "Pancakes", subtitle: "Sage", artworkUrl: "/thumb" }));
    const pending = view.container.querySelector('[data-testid="music-player-pending"]');
    expect(pending?.textContent).toContain("Pancakes");
    expect(view.container.querySelector('[data-slot="global-mini-player"]')).not.toBeNull();
    act(() => musicPlayer.showPending(null));
    expect(view.container.querySelector('[data-testid="music-player-pending"]')).toBeNull();
  });

  test("while another song already plays, the clicked song's pending bar replaces the player body until the new track loads", () => {
    HTMLMediaElement.prototype.canPlayType = () => "probably";
    const old = { key: "old", url: "/a/old", title: "Old song", state: "done" as const, hasFile: true, mediaType: "audio/mp4" };
    const view = mount();
    act(() => musicPlayer.toggle(old, [old]));
    expect(view.container.querySelector('[data-testid="music-player-pending"]')).toBeNull();
    act(() => musicPlayer.showPending({ key: "new", title: "New song", artworkUrl: null }));
    expect(view.container.querySelector('[data-testid="music-player-pending"]')?.textContent).toContain("New song");
    act(() => musicPlayer.toggle({ ...old, key: "new", url: "/a/new", title: "New song" }, [old, { ...old, key: "new", url: "/a/new", title: "New song" }]));
    expect(view.container.querySelector('[data-testid="music-player-pending"]')).toBeNull();
  });
});
