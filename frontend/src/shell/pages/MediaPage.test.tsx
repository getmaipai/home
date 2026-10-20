import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { MediaPage } from "@/shell/pages/MediaPage";

const originals = api.apps;
afterEach(() => { cleanup(); api.apps = originals; });

function Where() { return <p data-testid="where">{useLocation().pathname}</p>; }

function open(appIds: string[]) {
  api.apps = async () => appIds.map((id) => ({ package: id, page: "index" as const, label: id, icon: "film", description: "Media", category: "Media", keywords: [], sections: [], to: `/apps/${id}`, incognito: "unaffected" as const }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/media"]}><Routes><Route path="/media" element={<MediaPage />} /><Route path="*" element={<Where />} /></Routes></MemoryRouter></QueryClientProvider>);
}

test("Media tabs reuse the package routes and include Shows and Films", async () => {
  const view = open(["videos", "shows", "films", "music", "podcasts", "books"]);
  await waitFor(() => expect(view.getByRole("tab", { name: "Videos" })).toBeTruthy());
});

test("choosing a tab opens that app's own route", async () => {
  const view = open(["videos", "shows", "films", "music", "podcasts", "books"]);
  await waitFor(() => expect(view.getByRole("tab", { name: "Shows and Films" })).toBeTruthy());
  fireEvent.click(view.getByRole("tab", { name: "Shows and Films" }));
  await waitFor(() => expect(view.getByTestId("where").textContent).toBe("/apps/shows"));
});

test("Media omits package apps absent from the person's visible app catalog", async () => {
  const view = open(["videos", "music"]);
  await waitFor(() => expect(view.getByRole("tab", { name: "Videos" })).toBeTruthy());
  expect(view.queryByRole("tab", { name: "Shows and Films" })).toBeNull();
  expect(view.queryByRole("tab", { name: "Podcasts" })).toBeNull();
  expect(view.queryByRole("tab", { name: "Books" })).toBeNull();
});
