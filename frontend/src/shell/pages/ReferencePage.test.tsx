import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ApiError, api, type ReferenceArticleView } from "@/lib/api";
import { ReferencePage } from "@/shell/pages/ReferencePage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";

const article: ReferenceArticleView = {
  title: "Moon", book: "wiki_en", path: "A/Moon", source_label: "Wikipedia", licence: "CC BY-SA 4.0", snapshot_date: "2026-09-01",
  toc: [{ id: "history", title: "History", level: 2 }],
  blocks: [
    { type: "heading", level: 2, id: "history", text: "History" },
    { type: "paragraph", inlines: [{ type: "text", text: "Plain " }, { type: "strong", text: "strong" }, { type: "emphasis", text: "emphasis" }, { type: "link", text: "Earth", book: "wiki_en", path: "A/Earth" }, { type: "link", text: "outside", href: "https://example.org" }] },
    { type: "list", ordered: false, items: [[{ type: "text", text: "One" }]] },
    { type: "rows", rows: [{ label: "Discovered", value: "Ancient" }] },
    { type: "table", headers: ["Year", "Event"], rows: [["1969", "Landing"]] },
    { type: "figure", src: "/api/reference/media/wiki_en/moon.png", alt: "The Moon", caption: "Moon from orbit" },
    { type: "note", text: "A note" },
  ],
};

const books = [{ id: "wiki_en", source_label: "English Wikipedia", language: "en", size_bytes: 2_000_000, snapshot_date: "2026-09-01", licence: "CC BY-SA 4.0", article_count: 45 }];
const originals = { books: api.referenceBooks, suggest: api.referenceSuggest, search: api.referenceSearch, article: api.referenceArticle };

function mount(initial = "/reference") {
  const view = renderWithQueryClient(<MemoryRouter initialEntries={[initial]}><Routes><Route path="/reference/*" element={<ReferencePage />} /></Routes></MemoryRouter>);
  return { ...view, ...within(view.container) };
}

describe("Reference reader", () => {
  beforeEach(() => {
    api.referenceBooks = async () => books;
    api.referenceSuggest = async () => [{ title: "Moon suggestion", book: "wiki_en", path: "A/Moon" }];
    api.referenceSearch = async () => [{ title: "Moon", snippet: "Earth's satellite", book: "wiki_en", path: "A/Moon" }];
    api.referenceArticle = async () => article;
  });
  afterEach(() => { cleanup(); Object.assign(api, { referenceBooks: originals.books, referenceSuggest: originals.suggest, referenceSearch: originals.search, referenceArticle: originals.article }); });

  test("library home lists the readable book and its snapshot metadata", async () => {
    const view = mount();
    expect(await view.findByText("English Wikipedia")).toBeTruthy();
    expect(view.getByText(/2 MB/)).toBeTruthy();
    expect(view.getByText(/2026-09-01/)).toBeTruthy();
  });

  test("type-ahead suggestions open the article route", async () => {
    const view = mount();
    fireEvent.change(view.getByRole("textbox", { name: "Search reference" }), { target: { value: "moon" } });
    const suggestion = await view.findByRole("link", { name: "Moon suggestion" });
    fireEvent.click(suggestion);
    await waitFor(() => expect(view.getAllByRole("heading", { name: "Moon" }).length).toBeGreaterThan(0));
  });

  test("renders every closed block and internal links while leaving outside links plain", async () => {
    const view = mount("/reference/wiki_en/A/Moon");
    expect(await view.findByRole("heading", { name: "History" })).toBeTruthy();
    expect(view.getByText("Plain", { exact: false })).toBeTruthy();
    expect(view.getByText("One")).toBeTruthy();
    expect(view.getByText("Ancient")).toBeTruthy();
    expect(view.getByText("Landing")).toBeTruthy();
    expect(view.getByAltText("The Moon")).toBeTruthy();
    expect(view.getByText("A note")).toBeTruthy();
    expect(view.getByText("Earth").closest("a")?.getAttribute("href")).toBe("/reference/wiki_en/A/Earth");
    expect(view.getByText("outside").closest("a")).toBeNull();
    expect(view.getByText(/Snapshot 2026-09-01/)).toBeTruthy();
  });

  test("shows a plain unavailable state for 404", async () => {
    api.referenceArticle = async () => { throw new ApiError("Article not available.", 404); };
    const view = mount("/reference/wiki_en/absent");
    await waitFor(() => expect(view.getByRole("status")).toHaveTextContent("This article is not available."));
  });

  test("child article payload without links or figures renders no anchors or images", async () => {
    api.referenceArticle = async () => ({ ...article, toc: [], blocks: [{ type: "paragraph", inlines: [{ type: "text", text: "Child-safe text" }] }] });
    const view = mount("/reference/wiki_en/A/Moon");
    await view.findByText("Child-safe text");
    expect(document.querySelector("article a")).toBeNull();
    expect(document.querySelector("article img")).toBeNull();
  });

  test("NEWS-01: the article is drawn by the kit's one reader, with the table of contents ids, the source line and the licence under it", async () => {
    const view = mount("/reference/wiki_en/A/Moon");
    await view.findByText("A note");
    const reader = document.querySelector('[data-slot="article-view"]');
    expect(reader).not.toBeNull();
    expect(reader!.querySelector("h2#history")?.textContent).toBe("History");
    expect(reader!.textContent).toContain("Wikipedia");
    expect(reader!.textContent).toContain("CC BY-SA 4.0");
    expect(document.getElementById("reference-article")?.contains(reader)).toBe(true);
  });

  test("regression: a figure keeps its caption and an ordered list is numbered, not bulleted", async () => {
    api.referenceArticle = async () => ({ ...article, toc: [], blocks: [{ type: "list", ordered: true, items: [[{ type: "text", text: "First" }]] }, { type: "figure", src: "/api/reference/media/wiki_en/m.png", alt: "M", caption: "Cap" }] });
    const view = mount("/reference/wiki_en/A/Moon");
    await view.findByText("First");
    expect(document.querySelector("article ol")).not.toBeNull();
    expect(view.getByText("Cap")).toBeTruthy();
  });
});
