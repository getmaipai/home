import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@maipai/ui/src/ui/tooltip";
import { api, type MediaSearch } from "@/lib/api";
import { MediaSearchPage } from "@/shell/pages/MediaSearchPage";

const originals = { mediaSearch: api.mediaSearch, apps: api.apps };
afterEach(() => { cleanup(); api.mediaSearch = originals.mediaSearch; api.apps = originals.apps; });

function Where() { const location = useLocation(); return <p data-testid="where">{location.pathname}{location.search}</p>; }
const result: MediaSearch = { groups: [{ app: "videos", heading: "Videos", rows: [{ id: "media-one", app: "videos", kind: "video", title: "Garden Road", subtitle: "Home videos", artwork_url: null, href: "/apps/videos/watch?id=file-one", percent: null, at: "2026-10-20T00:00:00Z" }] }] };

function open(search: () => Promise<MediaSearch>, initial = "/media/search?q=Garden%20Road") {
  api.mediaSearch = search;
  api.apps = async () => ["videos", "shows", "music", "podcasts", "books"].map((id) => ({ package: id, page: "index" as const, label: id, icon: "film", description: "Media", category: "Media", keywords: [], sections: [], to: `/apps/${id}`, incognito: "unaffected" as const }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><TooltipProvider><MemoryRouter initialEntries={[initial]}><Routes>
    <Route path="/media/search" element={<MediaSearchPage />} /><Route path="*" element={<Where />} />
  </Routes></MemoryRouter></TooltipProvider></QueryClientProvider>);
}

test("groups render in shelves and a tile opens its href", async () => {
  const view = open(async () => result);
  await waitFor(() => expect(view.getByText("Videos")).toBeTruthy());
  const tile = await view.findByRole("button", { name: "Garden Road" });
  fireEvent.click(tile);
  await waitFor(() => expect(view.getByTestId("where").textContent).toBe("/apps/videos/watch?id=file-one"));
});

test("no matches show the query in the empty state and the search column is present", async () => {
  const view = open(async () => ({ groups: [] }));
  await waitFor(() => expect(view.getByText('No matches for "Garden Road". Try another word.')).toBeTruthy());
  expect(view.getByRole("searchbox", { name: "Search Media" })).toBeTruthy();
});

test("an empty query shows the prompt", async () => {
  const view = open(async () => ({ groups: [] }), "/media/search");
  expect(view.getByText("Search for a title across your media apps.")).toBeTruthy();
});

test("an error has retry copy", async () => {
  const view = open(() => Promise.reject(new Error("offline")));
  await waitFor(() => expect(view.getByText("Could not search Media. Check your connection and try again.")).toBeTruthy());
  expect(view.getByRole("button", { name: "Try again" })).toBeTruthy();
});
