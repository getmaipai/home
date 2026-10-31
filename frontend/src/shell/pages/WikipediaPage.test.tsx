import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { api, type ReferenceArticleView, type ReferenceBookView, type Roster } from "@/lib/api";
import { WikipediaPage, wikipediaBooks } from "@/shell/pages/WikipediaPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";

const book = (id: string, label: string): ReferenceBookView => ({ id, source_label: label, language: "en", size_bytes: 1_000_000, snapshot_date: "2026-09-01", licence: "CC BY-SA 4.0", article_count: 10 });
const article: ReferenceArticleView = { title: "Aurora", book: "wikipedia_en_all_maxi_2026-09", path: "Aurora", source_label: "Wikipedia", licence: "CC BY-SA 4.0", snapshot_date: "2026-09-01", toc: [], blocks: [{ type: "paragraph", inlines: [{ type: "text", text: "Lights in the sky." }] }] };
const originals = { books: api.referenceBooks, article: api.referenceArticle, random: api.referenceRandom, suggest: api.referenceSuggest, saves: api.referenceSaves, save: api.referenceSave, unsave: api.referenceUnsave, keyPoints: api.referenceKeyPoints };

function ChatProbe() { return <p data-testid="chat-ask">{decodeURIComponent(useLocation().search)}</p>; }

function mount(initial = "/wikipedia", person?: Roster) {
  const view = renderWithQueryClient(<MemoryRouter initialEntries={[initial]}><Routes><Route path="/wikipedia/*" element={<WikipediaPage {...(person ? { person } : {})} />} /><Route path="/chat" element={<ChatProbe />} /></Routes></MemoryRouter>);
  return { ...view, ...within(view.container) };
}

describe("wikipediaBooks", () => {
  test("keeps only Wikipedia sets and puts Simple English after the full one", () => {
    const list = wikipediaBooks([book("wikipedia_en_simple_all_maxi_2026-09", "Simple English Wikipedia"), book("vikidia_en_all_2026-09", "Vikidia"), book("wikipedia_en_all_maxi_2026-09", "Wikipedia")]);
    expect(list.map((b) => b.id)).toEqual(["wikipedia_en_all_maxi_2026-09", "wikipedia_en_simple_all_maxi_2026-09"]);
  });
});

describe("Wikipedia app", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    api.referenceBooks = async () => [book("wikipedia_en_all_maxi_2026-09", "Wikipedia")];
    api.referenceArticle = async () => article;
    api.referenceRandom = async () => ({ title: "Aurora", book: "wikipedia_en_all_maxi_2026-09", path: "Aurora" });
    api.referenceSuggest = async () => [{ title: "Aurora", book: "wikipedia_en_all_maxi_2026-09", path: "Aurora" }];
    api.referenceSaves = async () => ({ saves: [] });
  });
  afterEach(() => { cleanup(); Object.assign(api, { referenceBooks: originals.books, referenceArticle: originals.article, referenceRandom: originals.random, referenceSuggest: originals.suggest, referenceSaves: originals.saves, referenceSave: originals.save, referenceUnsave: originals.unsave, referenceKeyPoints: originals.keyPoints }); });

  test("with no Wikipedia in the library it says so and what to do, with no search box", async () => {
    api.referenceBooks = async () => [book("vikidia_en_all_2026-09", "Vikidia")];
    const view = mount();
    expect(await view.findByText("Wikipedia is not in your library yet")).toBeTruthy();
    expect(view.getByText(/Settings, Offline data/)).toBeTruthy();
    expect(view.queryByRole("search")).toBeNull();
  });

  test("the home screen has the search box, Home and Explore, a Random article button, picture picks and the attribution line", async () => {
    const view = mount();
    expect(await view.findByRole("search")).toBeTruthy();
    expect(view.getByRole("button", { name: "Home" }).getAttribute("aria-pressed")).toBe("true");
    expect(view.getByRole("button", { name: "Explore" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Random article" })).toBeTruthy();
    expect(await view.findByText("Something to read")).toBeTruthy();
    expect(view.getByText(/CC BY-SA 4.0, kept on this computer/)).toBeTruthy();
  });

  test("an article draws through the reader with the app's own home in the breadcrumb, and it is remembered under Recent", async () => {
    const view = mount(`/wikipedia/a/${encodeURIComponent("wikipedia_en_all_maxi_2026-09")}/Aurora`);
    expect(await view.findByText("Lights in the sky.")).toBeTruthy();
    expect(document.querySelector('nav[aria-label="Breadcrumb"]')?.textContent).toContain("Wikipedia");
    await waitFor(() => expect(window.sessionStorage.getItem("maipai.wikipedia.recent")).toContain("Aurora"));
  });

  test("an adult can ask for Key points and Discuss the article in chat; a child gets neither Discuss nor a chat link", async () => {
    api.referenceKeyPoints = async () => ({ key_points: { text: "Aurora is light in the sky.\n\u2022 It happens near the poles.", band: "adult" } });
    const path = `/wikipedia/a/${encodeURIComponent("wikipedia_en_all_maxi_2026-09")}/Aurora`;
    const view = mount(path, { age_band: "adult" } as Roster);
    expect(await view.findByText("It happens near the poles.")).toBeTruthy();
    fireEvent.click(await view.findByRole("button", { name: /Discuss/ }));
    const ask = (await view.findByTestId("chat-ask")).textContent ?? "";
    expect(ask).toContain("I'd like to talk about this article.");
    expect(ask).toContain("maipai://reference/article/");
    cleanup();
    const kid = mount(path, { age_band: "child" } as Roster);
    expect(await kid.findByText("Lights in the sky.")).toBeTruthy();
    expect(kid.queryByRole("button", { name: /Discuss/ })).toBeNull();
  });

  test("Random article opens the article the hub picked", async () => {
    const view = mount();
    fireEvent.click(await view.findByRole("button", { name: "Random article" }));
    expect(await view.findByText("Lights in the sky.")).toBeTruthy();
  });

  test("a search runs through the results page with the count", async () => {
    const original = api.referenceSearchPage;
    api.referenceSearchPage = async () => ({ hits: [{ title: "Aurora", snippet: "Lights", book: "wikipedia_en_all_maxi_2026-09", path: "Aurora" }], total: 120 });
    try {
      const view = mount("/wikipedia/search?q=aurora");
      expect(await view.findByText("Search results for “aurora”")).toBeTruthy();
      expect(await view.findByText("About 120 results")).toBeTruthy();
    } finally { api.referenceSearchPage = original; }
  });

  test("Save on an article saves it through the hub, and the Saved section lists it with a Remove button", async () => {
    const saved: Array<{ id: string; book: string; path: string; title: string; saved_at: string; offline: boolean }> = [];
    api.referenceSaves = async () => ({ saves: [...saved] });
    api.referenceSave = async (b, p) => { const row = { id: "refsave-aaaaaa", book: b, path: p, title: "Aurora", saved_at: "2026-10-30T00:00:00Z", offline: false }; saved.push(row); return row; };
    api.referenceUnsave = async () => { saved.length = 0; return { removed: true }; };
    const view = mount(`/wikipedia/a/${encodeURIComponent("wikipedia_en_all_maxi_2026-09")}/Aurora`);
    await view.findByText("Lights in the sky.");
    fireEvent.click((await view.findAllByRole("button", { name: "Save" }))[0]!);
    await waitFor(() => expect(saved.length).toBe(1));
    fireEvent.click(within(view.getByRole("navigation", { name: "Wikipedia sections" })).getByRole("button", { name: "Saved" }));
    expect(await view.findByRole("link", { name: /Aurora/ })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Remove Aurora from Saved" }));
    expect(await view.findByText(/Nothing saved yet/)).toBeTruthy();
  });

  test("there is no Offline section and no Keep button: the whole book is already on this computer", async () => {
    const view = mount();
    await view.findByRole("search");
    expect(view.queryByRole("button", { name: "Offline" })).toBeNull();
    expect(view.queryByText(/Keep on this device/)).toBeNull();
  });
});
