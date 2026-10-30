// MEDIA-HUB-05: the media hub's left column: a Home row first, then the media apps from the person's catalog, in the hub's order,
// the one the page shows marked active, a row click navigating to that row's route, and the page content beside the column.
import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@maipai/ui/src/ui/tooltip";
import { api } from "@/lib/api";
import { MediaHubFrame } from "@/shell/MediaHubFrame";

const originals = api.apps;
afterEach(() => { cleanup(); api.apps = originals; });

function Where() { const location = useLocation(); return <p data-testid="where">{location.pathname}{location.search}</p>; }

const labels: Record<string, string> = { videos: "Videos", shows: "Shows", music: "Music", podcasts: "Podcasts", books: "Books" };
const ids = ["videos", "shows", "music", "podcasts", "books"];

function open(packageId: string) {
  api.apps = async () => ids.map((id) => ({ package: id, page: "index" as const, label: labels[id] ?? id, icon: "film", description: "Media", category: "Media", keywords: [], sections: [], to: `/apps/${id}`, incognito: "unaffected" as const }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<MediaHubFrame packageId={packageId}><div data-testid="children">The content</div></MediaHubFrame>} />
            <Route path="*" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

async function links(view: ReturnType<typeof open>) {
  await waitFor(() => expect(view.container.querySelectorAll('[data-slot="section-sidebar"] a')).toHaveLength(6));
  return [...view.container.querySelectorAll<HTMLElement>('[data-slot="section-sidebar"] a')];
}

test("the column lists Home first, then the media apps in the hub's order", async () => {
  const view = open("videos");
  expect(view.getByTestId("media-hub-frame")).toBeTruthy();
  // The column carries no title of its own: the header row says Media (owner, 2026-10-29).
  expect(view.container.querySelector('[data-slot="section-sidebar"] h2')).toBeNull();
  const rows = await links(view);
  expect(rows.map((row) => row.textContent)).toEqual(["Home", "Videos", "Shows", "Music", "Podcasts", "Books"]);
});

test("the app the page shows is marked active and the others are not", async () => {
  const view = open("music");
  const rows = await links(view);
  const byLabel = (label: string) => rows.find((row) => row.textContent === label) as HTMLElement;
  expect(byLabel("Music").getAttribute("aria-current")).toBe("page");
  for (const label of ["Home", "Videos", "Shows", "Podcasts", "Books"]) expect(byLabel(label).getAttribute("aria-current")).toBeNull();
});

test("when the page is Home, the Home row is the active one and no app row is", async () => {
  const view = open("home");
  const rows = await links(view);
  const byLabel = (label: string) => rows.find((row) => row.textContent === label) as HTMLElement;
  expect(byLabel("Home").getAttribute("aria-current")).toBe("page");
  for (const label of ["Videos", "Shows", "Music", "Podcasts", "Books"]) expect(byLabel(label).getAttribute("aria-current")).toBeNull();
});

test("clicking a row navigates to that app's own route", async () => {
  const view = open("music");
  const podcasts = (await links(view)).find((row) => row.textContent === "Podcasts") as HTMLElement;
  fireEvent.click(podcasts);
  await waitFor(() => expect(view.getByTestId("where").textContent).toBe("/apps/podcasts"));
});

test("clicking Home navigates to the media hub's own route", async () => {
  const view = open("videos");
  const home = (await links(view)).find((row) => row.textContent === "Home") as HTMLElement;
  fireEvent.click(home);
  await waitFor(() => expect(view.getByTestId("where").textContent).toBe("/media"));
});

test("typing in the column search and pressing Enter opens Media search", async () => {
  const view = open("search");
  fireEvent.click(await view.findByRole("button", { name: "Search Media" }));
  const field = await view.findByRole("searchbox", { name: "Search Media" });
  fireEvent.change(field, { target: { value: "Garden Road" } });
  fireEvent.keyDown(field, { key: "Enter", code: "Enter" });
  await waitFor(() => expect(view.getByTestId("where").textContent).toBe("/media/search?q=Garden%20Road"));
});

test("the children render beside the column", async () => {
  const view = open("videos");
  await links(view);
  expect(view.getByTestId("children").textContent).toBe("The content");
});
