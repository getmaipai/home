// MEDIA-VIDEOS-01: a media app's shell half. A `play` action opens the owning app's play page, a play page opened by link carries
// its query as page state (so the item's data call has its id), the Home tab is named Home, `/media/<id>` resolves to its app, and the
// Player's element is registered with the audio session while the play page shows it.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ToastProvider } from "@maipai/ui/src/primitives/Toast";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { Link, MemoryRouter, Route, Routes as RouterRoutes } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@maipai/ui/src/ui/tooltip";
import { createQueryClient } from "@maipai/ui/src/queryClient";
import { Routes } from "@/shell/Routes";
import { mockHome, makePerson, type HomeFixture } from "@/shell/pages/settings/settingsTestKit";
import { chaptersWithEnds, MediaPlayerRegistration } from "@/shell/MediaPlayerRegistration";
import { isMediaApp, mediaAppOfPath, playPageOf, playRoute, usesFamilyHeader } from "@/shell/mediaApps";
import { createMediaStore } from "@/shell/mediaHost";
import type { AppRow } from "@/lib/api";

const row: AppRow = {
  package: "videos", page: "index", label: "Videos", icon: "circle-play", description: "Videos.", category: "Media", keywords: [],
  sections: [{ page: "library", label: "Library", icon: null }, { page: "watch", label: "Watch", icon: null }], to: "/apps/videos", incognito: "unaffected",
};
const newsRow: AppRow = {
  package: "news", page: "index", label: "News", icon: "newspaper", description: "News.", category: "Info", keywords: [],
  sections: [{ page: "following", label: "Following", icon: null }, { page: "saved", label: "Saved", icon: null }], to: "/apps/news", incognito: "unaffected",
  settings_area: { id: "news" },
} as unknown as AppRow;
const weatherRow: AppRow = {
  package: "weather", page: "index", label: "Weather", icon: "cloud-sun", description: "Forecasts.", category: "Utilities", keywords: [],
  sections: [], to: "/apps/weather", incognito: "unaffected", settings_area: { id: "weather" },
} as unknown as AppRow;
const newsPage = { type: "page", id: "news", title: "Today", body: [{ type: "empty_state", icon: "newspaper", text: "No stories yet. Check back soon." }] };
const shelf = (path: string) => ({
  type: "media_shelf", heading: path, bind: { source: "package", path }, item_key_field: "id", item_label_field: "title", item_media_field: "thumbnail", aspect: "wide",
  on_select: { play: { media_id: "{id}" } }, empty_state: { type: "empty_state", icon: "film", text: "Nothing here." },
});
const indexPage = { type: "page", id: "index", title: "Videos", body: [shelf("recent")] };
const madeIndexPage = { type: "page", id: "index", title: "Videos", body: [{ ...shelf("made-at-home"), heading: "Made at home", item_subtitle_field: "{channel}" }] };
const watchPage = {
  type: "page", id: "watch", title: "Watch",
  body: [{ type: "player", bind: { source: "package", path: "item", params: { id: "$state.id" } }, kind: "video", empty_state: { type: "empty_state", icon: "film", text: "Not on the hub." } }],
};
const videosWatchPage = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../backend/packages/videos/pages/watch.json"), "utf8")) as unknown;
const musicPlayPage = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../backend/packages/music/pages/play.json"), "utf8")) as unknown;
const weatherIndexPage = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../backend/packages/weather/pages/index.json"), "utf8")) as unknown;

let home: HomeFixture;
let itemBodies: string[];
let shareBodies: string[];
let baseFetch: typeof fetch;

beforeEach(() => {
  itemBodies = [];
  shareBodies = [];
  home = mockHome();
  baseFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.startsWith("/api/apps")) return Promise.resolve(Response.json([row, newsRow, weatherRow]));
    if (url.startsWith("/api/plugins/news/pages/")) return Promise.resolve(Response.json(newsPage));
    if (url.startsWith("/api/plugins/weather/pages/")) return Promise.resolve(Response.json(weatherIndexPage));
    if (url.startsWith("/api/plugins/videos/pages/index")) return Promise.resolve(Response.json(indexPage));
    if (url.startsWith("/api/plugins/videos/pages/watch")) return Promise.resolve(Response.json(watchPage));
    if (url.startsWith("/api/plugins/videos/data/recent")) return Promise.resolve(Response.json([{ id: "media-aaaaaa", title: "Building a birdhouse", kind: "video", thumbnail: null }]));
    if (url.startsWith("/api/plugins/videos/data/item")) {
      itemBodies.push(String(init?.body));
      return Promise.resolve(Response.json({ id: "media-aaaaaa", title: "Building a birdhouse", src: "/api/media/items/media-aaaaaa/content", channel: "Bramble Workshop", poster: null, duration_s: 14, chapters: [{ start_s: 0, title: "Intro" }, { start_s: 4, title: "Boards" }] }));
    }
    if (url.startsWith("/api/plugins/videos/actions/")) {
      shareBodies.push(JSON.stringify({ url, body: init?.body }));
      return Promise.resolve(Response.json({ ok: true }));
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

function open(path: string, extra: ReactNode = null) {
  const client = createQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider><TooltipProvider>
        <MemoryRouter initialEntries={[path]}>
          <RouterRoutes><Route path="/*" element={<Routes person={makePerson("owner")} onSignedIn={() => {}} />} /></RouterRoutes>
          {extra}
        </MemoryRouter>
      </TooltipProvider></ToastProvider>
    </QueryClientProvider>,
  );
}

describe("a media app's first tab", () => {
  test("is Home for the video apps, Listen now for the audio apps and Reading now for Books", async () => {
    const { homeLabelOf, playRoute } = await import("@/shell/mediaApps");
    expect(["videos", "shows", "podcasts", "music", "books"].map(homeLabelOf)).toEqual(["Home", "Home", "Listen now", "Listen now", "Reading now"]);
    expect(playRoute("podcast_episode", "media-aaaaaa")).toBe("/apps/podcasts/play?id=media-aaaaaa");
  });
});

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

  test("the shipped Videos watch schema renders the shared creation header and its share panel", async () => {
    const recipients = ["Aster", "Basil", "Clover", "Dove"].map((name, index) => ({ id: `person-${index}`, name, avatar_url: null }));
    const candidates = [...recipients, { id: "person-4", name: "Elm", avatar_url: null }];
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith("/api/plugins/videos/pages/watch")) return Promise.resolve(Response.json(videosWatchPage));
      if (url.startsWith("/api/plugins/videos/data/creation")) {
        if (JSON.parse(String(init?.body ?? "{}")).scope === "people") return Promise.resolve(Response.json(candidates));
        return Promise.resolve(Response.json([{ id: "file-rw9pa63jd4", title: "A paper boat on a lake", creator: { name: "Jesse Torres", href: "/people/person-jesse", avatar_url: null }, made_at: "2026-10-21T12:00:00Z", description: "A paper boat glides over a bright blue lake. The morning sun shines on gentle waves. The water moves slowly along the shore. A small bird flies over the boat.", visibility: { mode: "shared", people: recipients, can_manage: true } }]));
      }
      if (url.startsWith("/api/plugins/videos/data/item")) return Promise.resolve(Response.json({ id: "file-rw9pa63jd4", title: "A paper boat on a lake", src: "/api/files/file-rw9pa63jd4/content", channel: "Jesse", poster: null, duration_s: 14, chapters: [] }));
      if (url.startsWith("/api/plugins/videos/data/up-next")) return Promise.resolve(Response.json([]));
      if (url.startsWith("/api/plugins/videos/actions/")) {
        shareBodies.push(JSON.stringify({ url, body: init?.body }));
        return Promise.resolve(Response.json({ ok: true }));
      }
      return baseFetch(input, init);
    }) as typeof fetch;
    const view = open("/apps/videos/watch?id=file-rw9pa63jd4");
    const title = await view.findByRole("heading", { level: 1, name: "A paper boat on a lake" });
    expect(title.className).toContain("font-bold");
    const creatorLink = view.getByRole("link", { name: "Jesse Torres, open profile" });
    expect(creatorLink.getAttribute("href")).toBe("/people/person-jesse");
    expect(creatorLink.querySelector('[data-slot="avatar"]')).toBeTruthy();
    expect(view.container.querySelector("time")?.textContent).toMatch(/^Made /);
    const shared = view.getByRole("button", { name: "Shared, manage sharing" });
    expect(shared.textContent).toContain("Shared");
    expect(shared.textContent).toContain("+1");
    expect(shared.querySelectorAll('[data-slot="avatar"]')).toHaveLength(3);
    const description = view.getByText(/A paper boat glides/);
    expect(description.className).toContain("line-clamp-3");
    fireEvent.click(view.getByRole("button", { name: "Show more" }));
    expect(view.getByRole("button", { name: "Show less" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/[{}]/);
    fireEvent.click(shared);
    expect(await view.findByRole("dialog")).toBeTruthy();
    expect(view.getByRole("dialog").textContent).toContain("Who can see this?");
    fireEvent.click(view.getByRole("switch", { name: "Elm" }));
    await waitFor(() => expect(shareBodies).toHaveLength(1));
    expect(JSON.parse(shareBodies[0]!)).toEqual({ url: "/api/plugins/videos/actions/share-add", body: JSON.stringify({ id: "file-rw9pa63jd4", person_id: "person-4" }) });
  });

  test("the shipped Music play schema renders song details and shares with the creation row file id", async () => {
    const musicApp = { ...row, package: "music", page: "index", label: "Music", description: "Music.", to: "/apps/music", sections: [{ page: "index", label: "Listen now", icon: null }, { page: "play", label: "Now playing", icon: null }] } as AppRow;
    const recipients = ["Aster", "Basil"].map((name, index) => ({ id: `person-${index}`, name, avatar_url: null }));
    const candidate = { id: "person-2", name: "Clover", avatar_url: null };
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith("/api/apps")) return Promise.resolve(Response.json([musicApp]));
      if (url.startsWith("/api/plugins/music/pages/play")) return Promise.resolve(Response.json(musicPlayPage));
      if (url.startsWith("/api/plugins/music/data/header")) {
        if (JSON.parse(String(init?.body ?? "{}")).scope === "creation-people") return Promise.resolve(Response.json([candidate]));
        return Promise.resolve(Response.json([{ id: "file-song-123", title: "River song", creator: { name: "Jesse Torres", href: "/people/person-jesse", avatar_url: null }, made_at: "2026-10-21T12:00:00Z", description: "[Verse] Morning light by the river. The water moves beneath the willow trees.", visibility: { mode: "shared", people: recipients, can_manage: true } }]));
      }
      if (url.startsWith("/api/plugins/music/data/item")) return Promise.resolve(Response.json({ id: "file-song-123", title: "River song", src: "/api/files/file-song-123/content", duration_s: 20, chapters: [] }));
      if (url.startsWith("/api/plugins/music/data/up-next")) return Promise.resolve(Response.json([]));
      if (url.startsWith("/api/plugins/music/actions/")) {
        shareBodies.push(JSON.stringify({ url, body: init?.body }));
        return Promise.resolve(Response.json({ ok: true }));
      }
      return baseFetch(input, init);
    }) as typeof fetch;
    const view = open("/apps/music/play?id=file-song-123");
    const title = await view.findByRole("heading", { level: 1, name: "River song" });
    expect(title.className).toContain("font-bold");
    expect(view.getByRole("link", { name: "Jesse Torres, open profile" }).getAttribute("href")).toBe("/people/person-jesse");
    expect(view.container.querySelector("time")?.textContent).toMatch(/^Made /);
    const shared = view.getByRole("button", { name: "Shared, manage sharing" });
    expect(shared.querySelectorAll('[data-slot="avatar"]')).toHaveLength(2);
    expect(view.getByText(/\[Verse\] Morning light/).className).toContain("line-clamp-3");
    fireEvent.click(shared);
    expect(await view.findByRole("dialog")).toBeTruthy();
    fireEvent.click(view.getByRole("switch", { name: "Clover" }));
    await waitFor(() => expect(shareBodies).toHaveLength(1));
    expect(JSON.parse(shareBodies[0]!)).toEqual({ url: "/api/plugins/music/actions/share-add", body: JSON.stringify({ id: "file-song-123", person_id: "person-2" }) });
    expect(document.body.textContent).not.toMatch(/\{[^{}]+\}/);
  });

  test("the shipped Videos watch schema shows a private lock chip", async () => {
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith("/api/plugins/videos/pages/watch")) return Promise.resolve(Response.json(videosWatchPage));
      if (url.startsWith("/api/plugins/videos/data/creation-people")) return Promise.resolve(Response.json([]));
      if (url.startsWith("/api/plugins/videos/data/creation")) return Promise.resolve(Response.json([{ title: "Quiet morning", creator: { name: "Jesse" }, made_at: "2026-10-21T12:00:00Z", description: "A quiet morning.", visibility: { mode: "private", people: [], can_manage: false } }]));
      if (url.startsWith("/api/plugins/videos/data/item")) return Promise.resolve(Response.json({ id: "media-aaaaaa", title: "Quiet morning", src: "/video.mp4", duration_s: 10, chapters: [] }));
      if (url.startsWith("/api/plugins/videos/data/up-next")) return Promise.resolve(Response.json([]));
      return baseFetch(input, init);
    }) as typeof fetch;
    const view = open("/apps/videos/watch?id=media-aaaaaa");
    expect(await view.findByRole("button", { name: "Private, view sharing" })).toBeTruthy();
  });

  test("Made at home renders a creator line without leaking an unresolved template token", async () => {
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith("/api/apps")) return Promise.resolve(Response.json([row]));
      if (url.startsWith("/api/plugins/videos/pages/index")) return Promise.resolve(Response.json(madeIndexPage));
      if (url.startsWith("/api/plugins/videos/data/made-at-home")) return Promise.resolve(Response.json([{ id: "file-rw9pa63jd4", title: "Paper boat", channel: "Jesse", thumbnail: null }]));
      return baseFetch(input, init);
    }) as typeof fetch;
    const view = open("/apps/videos");
    expect(await view.findByRole("button", { name: /Paper boat/ })).toBeTruthy();
    expect(document.body.textContent).toContain("Jesse");
    expect(document.body.textContent).not.toMatch(/[{}]/);
  });

  test("the host's media element is registered with the audio session", async () => {
    const container = document.createElement("div");
    const video = document.createElement("video");
    container.appendChild(video);
    document.body.appendChild(container);
    const { audioSession } = await import("@/shell/audioSession");
    const client = createQueryClient();
    render(
      <QueryClientProvider client={client}>
        <MediaPlayerRegistration appId="videos" mediaId="media-aaaaaa" element={video} />
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

describe("MEDIA-POLISH-01 the docked mini bar", () => {
  test("the watch page plays in the host's element, has no app header, and the shell unloads it when it goes", async () => {
    const view = open("/apps/videos/watch?id=media-aaaaaa");
    await waitFor(() => expect(document.querySelector('[data-slot="player"][data-layout="video"] video')).not.toBeNull());
    const video = document.querySelector('[data-slot="player"][data-layout="video"] video') as HTMLVideoElement;
    expect(video.getAttribute("src")).toBe("/api/media/items/media-aaaaaa/content");
    // The play page has no app header: the picture starts the page.
    expect(view.queryByRole("tab", { name: "Home" })).toBeNull();
    expect(document.querySelector('[data-layout="mini"]')).toBeNull();
    cleanup();
    expect(video.isConnected).toBe(false);
  });

  test("leaving the watch page by its tab keeps the element playing in the dock, which opens the player again", async () => {
    const view = open("/apps/videos/watch?id=media-aaaaaa", <><Link to="/apps/videos">Go to Videos</Link><Link to="/apps/weather">Go to Weather</Link></>);
    await waitFor(() => expect(document.querySelector('[data-slot="player"][data-layout="video"] video')).not.toBeNull());
    const video = document.querySelector('[data-slot="player"][data-layout="video"] video') as HTMLVideoElement;
    video.dispatchEvent(new Event("play"));
    fireEvent.click(view.getByRole("link", { name: "Go to Weather" }));
    // Another app's area draws no bar (RULES S2); the element waits, still in the document, in the kit's parking spot.
    await waitFor(() => expect(document.querySelector('[data-slot="player"][data-layout="video"]')).toBeNull());
    expect(document.querySelector('[data-layout="mini"]')).toBeNull();
    expect(video.isConnected).toBe(true);
    fireEvent.click(view.getByRole("link", { name: "Go to Videos" }));
    await waitFor(() => expect(document.querySelector('[data-slot="player"][data-layout="mini"]')).not.toBeNull());
    const dock = document.querySelector('[data-slot="player"][data-layout="mini"]')!;
    expect(dock.getAttribute("data-placement")).toBe("dock");
    const contentColumn = dock.parentElement!;
    expect(contentColumn.lastElementChild).toBe(dock);
    expect(contentColumn.lastElementChild?.previousElementSibling?.getAttribute("aria-hidden")).toBe("true");
    expect(contentColumn.lastElementChild?.previousElementSibling?.className).toContain("flex-1");
    expect(dock.querySelector("video")).toBe(video);
    expect(await view.findByRole("button", { name: "Open the player: Building a birdhouse" })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Close the player: Building a birdhouse" }));
    await waitFor(() => expect(document.querySelector('[data-layout="mini"]')).toBeNull());
    // Three page loads through the whole shell: slower than the default 5 s on a loaded machine.
  }, 30_000);

  test("the host keeps one element per item and unloads the old one for a new item", () => {
    const store = createMediaStore();
    const a = store.elementFor({ id: "m1", src: "/a", kind: "video", title: "A" }, "videos");
    expect(store.elementFor({ id: "m1", src: "/a", kind: "video", title: "A" }, "videos")).toBe(a);
    document.body.appendChild(a);
    const b = store.elementFor({ id: "m2", src: "/b", kind: "video", title: "B" }, "videos");
    expect(b).not.toBe(a);
    expect(a.getAttribute("src")).toBeNull();
    expect(a.isConnected).toBe(false);
    expect(store.get()).toMatchObject({ id: "m2", appId: "videos", started: false });
    store.clear();
    expect(store.get()).toBeNull();
  });
});

describe("media app helpers", () => {
  test("playRoute names the owning app's play page, and a kind no app plays has none", () => {
    expect(playRoute("video", "media-a b")).toBe("/apps/videos/watch?id=media-a%20b");
    expect(playRoute("episode", "media-x")).toBe("/apps/shows/watch?id=media-x");
    expect(playRoute("track", "media-x")).toBe("/apps/music/play?id=media-x");
    expect(playRoute("mystery", "media-x")).toBeNull();
    expect(playPageOf("videos")).toBe("watch");
    expect(playPageOf("weather")).toBeNull();
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

describe("an app's first tab for the apps that are not media apps", () => {
  test("News calls it Today and every other package app keeps Overview", async () => {
    const { appHomeLabel } = await import("@/shell/mediaApps");
    expect(appHomeLabel("news", false)).toBe("Today");
    expect(appHomeLabel("weather", false)).toBe("Overview");
    expect(appHomeLabel("music", true)).toBe("Listen now");
  });
});

describe("family app headers", () => {
  test("usesFamilyHeader is the media apps, News and Weather; isMediaApp stays the media apps", () => {
    expect(["videos", "shows", "music", "podcasts", "books", "news", "weather"].every(usesFamilyHeader)).toBe(true);
    expect(isMediaApp("news")).toBe(false);
    expect(isMediaApp("weather")).toBe(false);
  });

  test("the title is large, the controls are icons on the end side, and the sections are pill tabs starting at Today", async () => {
    const view = open("/apps/news");
    await view.findByRole("tab", { name: "Today" });
    const headings = view.getAllByRole("heading", { level: 1, name: "News" });
    expect(headings.some((heading) => heading.className.includes("text-2xl"))).toBe(true);
    // The app's own sr-only heading is gone (the visible title is the heading), as for a media app.
    expect(headings.some((heading) => heading.className.includes("sr-only") && heading.closest("[data-testid=package-app]") !== null)).toBe(false);
    expect(await view.findByRole("tab", { name: "Today" })).toBeTruthy();
    expect(view.getByRole("tab", { name: "Following" })).toBeTruthy();
    expect(view.getByRole("tablist", { name: "Sections" }).getAttribute("data-variant")).toBe("pill");
    expect(view.getByRole("link", { name: "News settings" })).toBeTruthy();
    expect(view.queryByRole("button", { name: /favorites/ })).toBeNull();
    expect(view.queryByRole("button", { name: /Close the player/ })).toBeNull();
  });

  test("a media app keeps the same header", async () => {
    const view = open("/apps/videos");
    expect((await view.findAllByRole("heading", { level: 1, name: "Videos" })).length).toBeGreaterThan(0);
    expect(view.getByRole("tablist", { name: "Sections" }).getAttribute("data-variant")).toBe("pill");
  });

  test("Weather has one h1 and a visible title on desktop and at phone width", async () => {
    const originalMatchMedia = window.matchMedia;
    const originalWidth = window.innerWidth;
    try {
      for (const width of [1440, 390]) {
        Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
        window.matchMedia = ((query: string) => ({ matches: query.includes("639.98") ? width < 640 : query.includes("max-width") && width <= 768, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as typeof window.matchMedia;
        const view = open("/apps/weather");
        await waitFor(() => expect(view.container.querySelectorAll('[data-testid="package-app"] h1')).toHaveLength(1));
        const pageHeadings = view.container.querySelectorAll('[data-testid="package-app"] h1');
        expect(pageHeadings).toHaveLength(1);
        if (width === 1440) {
          const heading = await view.findByRole("heading", { level: 1, name: "Weather" });
          expect(heading.className).not.toContain("sr-only");
        } else {
          expect(pageHeadings[0]?.className).toContain("sr-only");
          expect(document.querySelector('[data-slot="rail-page-header"]')?.textContent).toContain("Weather");
        }
        expect(view.getByRole("link", { name: "Weather settings" })).toBeTruthy();
        cleanup();
      }
    } finally {
      window.matchMedia = originalMatchMedia;
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });
});
