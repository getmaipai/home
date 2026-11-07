import { afterEach, beforeEach, expect, test } from "bun:test";
import { cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { api, type ReferenceArticleView } from "@/lib/api";
import { ReaderArticle } from "@/shell/reader/ReaderArticle";
import { PackageAppPage } from "@/shell/pages/PackageAppPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";

const article: ReferenceArticleView = { title: "Moon", book: "wiki_en", path: "Moon", source_label: "Reference", licence: "CC BY-SA 4.0", snapshot_date: "2026-09-01", toc: [], blocks: [{ type: "paragraph", inlines: [{ type: "text", text: "The Moon." }] }] };
const originalArticle = api.referenceArticle;
const originalFetch = globalThis.fetch;
const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  window.matchMedia = ((query: string) => ({ matches: query.includes("639.98"), media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as typeof window.matchMedia;
  api.referenceArticle = async () => article;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/plugins/news/pages/story")) return Promise.resolve(Response.json({ type: "page", id: "story", title: "Story", body: [{ type: "empty_state", icon: "newspaper", text: "Story page" }] }));
    if (url.startsWith("/api/apps")) return Promise.resolve(Response.json([{ package: "news", page: "index", label: "News", icon: "newspaper", description: "News", category: "Info", keywords: [], sections: [{ page: "story", label: "Story" }], to: "/apps/news", incognito: "unaffected" }]));
    if (url.startsWith("/api/plugins/news/pages/index")) return Promise.resolve(Response.json({ type: "page", id: "index", title: "News", body: [] }));
    return originalFetch(input, init);
  }) as typeof fetch;
});

afterEach(() => {
  cleanup();
  api.referenceArticle = originalArticle;
  globalThis.fetch = originalFetch;
  window.matchMedia = originalMatchMedia;
  document.documentElement.removeAttribute("data-app-reading");
});

test("ReaderArticle marks an open article and removes the marker on unmount", async () => {
  const view = renderWithQueryClient(<MemoryRouter><ReaderArticle book="wiki_en" path="Moon" routeFor={() => "/reference"} appName="Reference" onAppHome={() => {}} /></MemoryRouter>);
  await view.findByText("The Moon.");
  await waitFor(() => expect(document.documentElement.hasAttribute("data-app-reading")).toBe(true));
  view.unmount();
  expect(document.documentElement.hasAttribute("data-app-reading")).toBe(false);
});

test("News story still sets the reading marker", async () => {
  renderWithQueryClient(<MemoryRouter initialEntries={["/apps/news/story"]}><Routes><Route path="/apps/*" element={<PackageAppPage person={{ id: "p1", age_band: "adult" } as never} />} /></Routes></MemoryRouter>);
  await waitFor(() => expect(document.documentElement.hasAttribute("data-app-reading")).toBe(true));
});
