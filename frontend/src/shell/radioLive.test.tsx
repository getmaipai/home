// RADIO-03: a radio station in the one mini player. The held item is a station stream: the bar shows the kit's Live badge and no seek,
// the song the station reports replaces the subtitle and survives a page re-render, and Pause then Play loads the stream again.
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@maipai/ui/src/ui/tooltip";
import { createQueryClient } from "@maipai/ui/src/queryClient";
import { ToastProvider } from "@maipai/ui/src/primitives/Toast";
import { GlobalMiniPlayer, onPlayPageOf } from "@/shell/GlobalMiniPlayer";
import { createMediaStore, MediaDockContext, hlsPathFor, type HoistedMedia } from "@/shell/mediaHost";
import { liveStationIdOf, rejoinLiveOnResume } from "@/shell/radioLive";
import { isMediaPlayPage, playRoute } from "@/shell/mediaApps";

afterEach(cleanup);

const STREAM = "/api/plugins/music/radio/stream/source-abc123";

function held(src: string, subtitle: string): HoistedMedia {
  const el = document.createElement("audio");
  el.setAttribute("src", src);
  return { id: "source-abc123", src, kind: "audio", title: "Cabin FM", subtitle, appId: "music", el, started: true };
}
function mount(current: HoistedMedia) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <TooltipProvider>
        <ToastProvider>
          <MemoryRouter initialEntries={["/apps/music/radio"]}>
            <MediaDockContext.Provider value={{ current, clear: () => {}, next: async () => {} }}>
              <GlobalMiniPlayer />
            </MediaDockContext.Provider>
          </MemoryRouter>
        </ToastProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("a live station in the mini player", () => {
  test("shows the Live badge, the station name and the song, and offers no seek", () => {
    const current = held(STREAM, "Blue Hour - Cabin Trio");
    Object.defineProperty(current.el, "duration", { value: Number.POSITIVE_INFINITY, configurable: true });
    const view = mount(current);
    const bar = document.querySelector('[data-slot="global-mini-player"] [data-slot="player"][data-layout="mini"]')!;
    expect(bar.querySelector('[data-slot="player-live"]')?.textContent).toBe("Live");
    expect(bar.textContent).toContain("Cabin FM");
    expect(bar.textContent).toContain("Blue Hour - Cabin Trio");
    expect(view.queryByRole("slider", { name: "Seek" })).toBeNull();
    expect(view.queryByTestId("mini-time")).toBeNull();
    expect(bar.querySelector('[role="slider"]')).toBeNull();
  });

  test("a song with a length is not live: no badge", () => {
    const current = held("/api/media/items/source-abc123/content", "Artist");
    Object.defineProperty(current.el, "duration", { value: 200, configurable: true });
    const view = mount(current);
    expect(document.querySelector('[data-slot="player-live"]')).toBeNull();
    expect(view.queryByTestId("mini-time")).not.toBeNull();
  });
});

describe("station helpers", () => {
  test("selects native HLS or hls.js for an m3u8 source", () => {
    expect(hlsPathFor("/api/plugins/music/radio/stream/station-1.m3u8", true)).toBe("native");
    expect(hlsPathFor("/api/plugins/music/radio/stream/station-1.m3u8", false)).toBe("hls");
    expect(hlsPathFor("/api/plugins/music/radio/stream/station-1", false)).toBe("direct");
  });
  test("liveStationIdOf reads only the hub's own stream route", () => {
    expect(liveStationIdOf(STREAM)).toBe("source-abc123");
    expect(liveStationIdOf("/api/plugins/music/radio/stream/a%20b?x=1")).toBe("a b");
    expect(liveStationIdOf("/api/media/items/x/content")).toBeNull();
    expect(liveStationIdOf("https://other.example.com/api/plugins/music/radio/stream/x")).toBeNull();
    expect(liveStationIdOf("/api/plugins/music/radio/stream/")).toBeNull();
  });

  test("a station plays on its own page, and the bar stays up there because the page has no player", () => {
    expect(playRoute("station", "source-abc123")).toBe("/apps/music/station?id=source-abc123");
    expect(isMediaPlayPage("music", "station")).toBe(true);
    expect(isMediaPlayPage("music", "radio")).toBe(false);
    expect(onPlayPageOf(held(STREAM, ""), "/apps/music/station", "?id=source-abc123", undefined)).toBe(false);
  });

  test("the song the station reports stays when the page asks for the same item again", () => {
    const store = createMediaStore();
    const ref = { id: "source-abc123", src: STREAM, kind: "audio" as const, title: "Cabin FM", subtitle: "US · jazz" };
    const el = store.elementFor(ref, "music");
    store.setSubtitle(el, "Blue Hour");
    store.elementFor(ref, "music");
    expect(store.get()?.subtitle).toBe("Blue Hour");
    store.clear();
  });

  test("Pause then Play loads the stream again, once", () => {
    const el = document.createElement("audio");
    let loads = 0, plays = 0;
    el.load = () => { loads++; };
    el.play = () => { plays++; return Promise.resolve(); };
    const stop = rejoinLiveOnResume(el);
    el.dispatchEvent(new Event("play"));
    expect(loads).toBe(0);
    el.dispatchEvent(new Event("pause"));
    el.dispatchEvent(new Event("play"));
    expect([loads, plays]).toEqual([1, 1]);
    el.dispatchEvent(new Event("play"));
    expect(loads).toBe(1);
    stop();
    el.dispatchEvent(new Event("pause"));
    el.dispatchEvent(new Event("play"));
    expect(loads).toBe(1);
  });
});
