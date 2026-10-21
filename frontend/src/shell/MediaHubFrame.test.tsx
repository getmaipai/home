// MEDIA-HUB-05: the media hub's left column: the media apps from the person's catalog, in the hub's order, the one the page shows
// marked active, a row click navigating to the app's own route, and the page content beside the column.
import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@maipai/ui/src/ui/tooltip";
import { api } from "@/lib/api";
import { MediaHubFrame } from "@/shell/MediaHubFrame";

const originals = api.apps;
afterEach(() => { cleanup(); api.apps = originals; });

function Where() { return <p data-testid="where">{useLocation().pathname}</p>; }

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
  await waitFor(() => expect(view.container.querySelectorAll('[data-slot="section-sidebar"] a[href^="/apps/"]')).toHaveLength(5));
  return [...view.container.querySelectorAll<HTMLElement>('[data-slot="section-sidebar"] a[href^="/apps/"]')];
}

test("the column lists the media apps in the hub's order", async () => {
  const view = open("videos");
  expect(view.getByTestId("media-hub-frame")).toBeTruthy();
  expect(view.getByText("Media")).toBeTruthy();
  const rows = await links(view);
  expect(rows.map((row) => row.textContent)).toEqual(["Videos", "Shows", "Music", "Podcasts", "Books"]);
});

test("the app the page shows is marked active and the others are not", async () => {
  const view = open("music");
  const rows = await links(view);
  const byLabel = (label: string) => rows.find((row) => row.textContent === label) as HTMLElement;
  expect(byLabel("Music").getAttribute("aria-current")).toBe("page");
  for (const label of ["Videos", "Shows", "Podcasts", "Books"]) expect(byLabel(label).getAttribute("aria-current")).toBeNull();
});

test("clicking a row navigates to that app's own route", async () => {
  const view = open("music");
  const podcasts = (await links(view)).find((row) => row.textContent === "Podcasts") as HTMLElement;
  fireEvent.click(podcasts);
  await waitFor(() => expect(view.getByTestId("where").textContent).toBe("/apps/podcasts"));
});

test("the children render beside the column", async () => {
  const view = open("videos");
  await links(view);
  expect(view.getByTestId("children").textContent).toBe("The content");
});
