// MEDIA-VIDEOS-01: a media app's shell half. A `play` action opens the owning app's play page, a play page opened by link carries
// its query as page state (so the item's data call has its id), the Home tab is named Home, `/media/<id>` resolves to its app, and the
// Player's element is registered with the audio session while the play page shows it.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes as RouterRoutes } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@maipai/ui/src/ui/tooltip";
import { createQueryClient } from "@maipai/ui/src/queryClient";
import { Routes } from "@/shell/Routes";
import { mockHome, makePerson, type HomeFixture } from "@/shell/pages/settings/settingsTestKit";
import { chaptersWithEnds, MediaPlayerRegistration } from "@/shell/MediaPlayerRegistration";
import { mediaAppOfPath, playRoute } from "@/shell/mediaApps";
import type { AppRow } from "@/lib/api";

const row: AppRow = {
  package: "videos", page: "index", label: "Videos", icon: "circle-play", description: "Videos.", category: "Media", keywords: [],
  sections: [{ page: "library", label: "Library", icon: null }, { page: "watch", label: "Watch", icon: null }], to: "/apps/videos", incognito: "unaffected",
};
const shelf = (path: string) => ({
  type: "media_shelf", heading: path, bind: { source: "package", path }, item_key_field: "id", item_label_field: "title", item_media_field: "thumbnail", aspect: "wide",
  on_select: { play: { media_id: "{id}" } }, empty_state: { type: "empty_state", icon: "film", text: "Nothing here." },
});
const indexPage = { type: "page", id: "index", title: "Videos", body: [shelf("recent")] };
const watchPage = {
  type: "page", id: "watch", title: "Watch",
  body: [{ type: "player", bind: { source: "package", path: "item", params: { id: "$state.id" } }, kind: "video", empty_state: { type: "empty_state", icon: "film", text: "Not on the hub." } }],
};

let home: HomeFixture;
let itemBodies: string[];
let baseFetch: typeof fetch;

beforeEach(() => {
  itemBodies = [];
  home = mockHome();
  baseFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.startsWith("/api/apps")) return Promise.resolve(Response.json([row]));
    if (url.startsWith("/api/plugins/videos/pages/index")) return Promise.resolve(Response.json(indexPage));
    if (url.startsWith("/api/plugins/videos/pages/watch")) return Promise.resolve(Response.json(watchPage));
    if (url.startsWith("/api/plugins/videos/data/recent")) return Promise.resolve(Response.json([{ id: "media-aaaaaa", title: "Building a birdhouse", kind: "video", thumbnail: null }]));
    if (url.startsWith("/api/plugins/videos/data/item")) {
      itemBodies.push(String(init?.body));
      return Promise.resolve(Response.json({ id: "media-aaaaaa", title: "Building a birdhouse", src: "/api/media/items/media-aaaaaa/content", channel: "Bramble Workshop", poster: null, duration_s: 14, chapters: [{ start_s: 0, title: "Intro" }, { start_s: 4, title: "Boards" }] }));
    }
    if (url.startsWith("/api/media/items/media-aaaaaa")) return Promise.resolve(Response.json({ item: { id: "media-aaaaaa", kind: "video", title: "Building a birdhouse" } }));
    if (url.startsWith("/api/media/items/media-gone")) return Promise.resolve(Response.json({ error: "no" }, { status: 404 }));
    return baseFetch(input, init);
  }) as typeof fetch;
});

afterEach(() => {
  cleanup();
  home.restore();
});

function open(path: string) {
  const client = createQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[path]}>
          <RouterRoutes><Route path="/*" element={<Routes person={makePerson("owner")} onSignedIn={() => {}} />} /></RouterRoutes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("a media app in the shell", () => {
  test("the first tab is Home and a tile's play action opens the watch page with the id in the address", async () => {
    const view = open("/apps/videos");
    expect(await view.findByRole("tab", { name: "Home" })).toBeTruthy();
    const tile = await view.findByRole("button", { name: /Building a birdhouse/ });
    fireEvent.click(tile);
    await waitFor(() => expect(itemBodies.length).toBeGreaterThan(0));
    expect(JSON.parse(itemBodies[0]!)).toEqual({ id: "media-aaaaaa" });
  });

  test("a watch page opened by link carries its query as page state, so the item call has its id", async () => {
    open("/apps/videos/watch?id=media-aaaaaa");
    await waitFor(() => expect(itemBodies.length).toBeGreaterThan(0));
    expect(itemBodies.every((body) => JSON.parse(body).id === "media-aaaaaa")).toBe(true);
  });

  test("the Player's media element is registered with the audio session while the watch page shows it", async () => {
    // happy-dom cannot draw Media Chrome's time range, so a stand-in element carries the kit's own data-slot.
    const container = document.createElement("div");
    const video = document.createElement("video");
    video.setAttribute("data-slot", "player-media");
    container.appendChild(video);
    document.body.appendChild(container);
    const { audioSession } = await import("@/shell/audioSession");
    const client = createQueryClient();
    render(
      <QueryClientProvider client={client}>
        <MediaPlayerRegistration appId="videos" mediaId="media-aaaaaa" container={container} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(itemBodies.length).toBeGreaterThan(0));
    // A registered element's own play event takes focus; the session then names what plays.
    await waitFor(() => {
      video.dispatchEvent(new Event("play"));
      expect(audioSession.getSnapshot().current).toMatchObject({ kind: "video", item: { title: "Building a birdhouse" } });
    });
    container.remove();
  });

  test("/media/<id> opens the item in the app that owns its kind; an unknown item is not found", async () => {
    const view = open("/media/media-aaaaaa");
    await waitFor(() => expect(itemBodies.length).toBeGreaterThan(0));
    cleanup();
    const gone = open("/media/media-gone");
    await gone.findByText(/That page does not exist/);
    expect(view).toBeTruthy();
  });
});

describe("media app helpers", () => {
  test("playRoute names the owning app's play page, and a kind no app plays has none", () => {
    expect(playRoute("video", "media-a b")).toBe("/apps/videos/watch?id=media-a%20b");
    expect(playRoute("episode", "media-x")).toBe("/apps/shows/watch?id=media-x");
    expect(playRoute("track", "media-x")).toBe("/apps/music/play?id=media-x");
    expect(playRoute("mystery", "media-x")).toBeNull();
  });

  test("mediaAppOfPath finds a media app's area and nothing else", () => {
    expect(mediaAppOfPath("/apps/videos/watch")).toBe("videos");
    expect(mediaAppOfPath("/apps/videos")).toBe("videos");
    expect(mediaAppOfPath("/apps/weather")).toBeNull();
    expect(mediaAppOfPath("/chat")).toBeNull();
  });

  test("chapters get an end each: the next start, the last the length", () => {
    expect(chaptersWithEnds([{ start_s: 4, title: "Boards" }, { start_s: 0, title: "Intro" }], 14)).toEqual([
      { start_s: 0, end_s: 4, title: "Intro" },
      { start_s: 4, end_s: 14, title: "Boards" },
    ]);
  });
});
