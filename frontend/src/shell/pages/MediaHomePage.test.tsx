import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, type MediaHome, type MediaHomeRow } from "@/lib/api";
import { MediaHomePage } from "@/shell/pages/MediaHomePage";

const originals = { mediaHome: api.mediaHome, apps: api.apps };
afterEach(() => { cleanup(); api.mediaHome = originals.mediaHome; api.apps = originals.apps; });

function Where() { return <p data-testid="where">{useLocation().pathname}</p>; }

function row(overrides: Partial<MediaHomeRow>): MediaHomeRow {
  return { id: "media-abc123", app: "videos", kind: "movie", title: "A Title", subtitle: "A Subtitle", artwork_url: "/art.png", href: "/media/media-abc123", percent: null, at: "2026-01-01T00:00:00Z", ...overrides };
}

function open(home: () => Promise<MediaHome>) {
  api.mediaHome = home;
  api.apps = async () => ["videos", "music"].map((id) => ({ package: id, page: "index" as const, label: id, icon: "film", description: "Media", category: "Media", keywords: [], sections: [], to: `/apps/${id}`, incognito: "unaffected" as const }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/media"]}><Routes><Route path="/media" element={<MediaHomePage />} /><Route path="*" element={<Where />} /></Routes></MemoryRouter></QueryClientProvider>);
}

test("the shelves draw with their headings and row titles", async () => {
  const view = open(async () => ({
    continue: [row({ percent: 42 })],
    new: [row({ id: "new-1", title: "Fresh" })],
    recent_music: [row({ id: "music-1", app: "music", title: "Played" })],
    made_at_home: [],
  }));
  await waitFor(() => expect(view.getByText("Pick up where you left off")).toBeTruthy());
  expect(view.getByText("New in your media")).toBeTruthy();
  expect(view.getByText("Recently played")).toBeTruthy();
  expect(view.getByText("A Title")).toBeTruthy();
});

test("clicking a continue row opens its href", async () => {
  const view = open(async () => ({ continue: [row({ percent: 42 })], new: [], recent_music: [], made_at_home: [] }));
  const tile = await view.findByRole("button", { name: "A Title" });
  fireEvent.click(tile);
  await waitFor(() => expect(view.getByTestId("where").textContent).toBe("/media/media-abc123"));
});

test("with nothing in the library the empty state shows instead of the shelves", async () => {
  const view = open(async () => ({ continue: [], new: [], recent_music: [], made_at_home: [] }));
  await waitFor(() => expect(view.getByText("Nothing here yet. Add music, videos, shows, podcasts or books to your library and they show up here.")).toBeTruthy());
  expect(view.queryByText("Pick up where you left off")).toBeNull();
  expect(view.queryByText("New in your media")).toBeNull();
  expect(view.queryByText("Recently played")).toBeNull();
});

test("made at home rows show their shelf and navigate to the app href", async () => {
  const view = open(async () => ({ continue: [], new: [], recent_music: [], made_at_home: [row({ id: "made-1", app: "music", title: "Made Song", href: "/apps/music/play?id=made-1" })] }));
  expect(await view.findByText("Made at home")).toBeTruthy();
  expect(view.queryByText("Nothing here yet. Add music, videos, shows, podcasts or books to your library and they show up here.")).toBeNull();
  fireEvent.click(await view.findByRole("button", { name: "Made Song" }));
  await waitFor(() => expect(view.getByTestId("where").textContent).toBe("/apps/music/play"));
});

test("a failed load shows the retry message", async () => {
  const view = open(() => Promise.reject(new Error("down")));
  await waitFor(() => expect(view.getByText("Could not load Media. Check your connection and try again.")).toBeTruthy());
  expect(view.getByRole("button", { name: "Try again" })).toBeTruthy();
});

test("the hub column is drawn with Home as its active row", async () => {
  const view = open(async () => ({ continue: [], new: [], recent_music: [], made_at_home: [] }));
  const frame = await view.findByTestId("media-hub-frame");
  expect(frame).toBeTruthy();
  const home = view.getByRole("link", { name: "Home" });
  expect(home.getAttribute("aria-current")).toBe("page");
});
