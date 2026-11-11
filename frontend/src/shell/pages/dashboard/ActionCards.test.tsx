import { afterEach, expect, mock, test } from "bun:test";
import { cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ActionCards } from "@/shell/pages/dashboard/ActionCards";
import { renderWithQueryClient } from "../../../../tests/renderWithQueryClient";

afterEach(() => { cleanup(); });

function open(apps: string[]) {
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : String(input);
    if (url.includes("/api/apps")) return Promise.resolve(Response.json(apps.map((id) => ({ package: id, page: "index", label: id, icon: "image", description: "App", category: "Tools", keywords: [], sections: [], to: `/apps/${id}`, incognito: "unaffected" }))));
    return Promise.resolve(Response.json({}));
  }) as unknown as typeof fetch;
  const view = renderWithQueryClient(<MemoryRouter><ActionCards onFocusAsk={() => {}} /></MemoryRouter>);
  return { view, restore: () => { globalThis.fetch = original; } };
}

test("six actions include the News route", async () => {
  const { view, restore } = open(["videos", "music", "news"]);
  try {
    const grid = await view.findByRole("list", { name: "Things to do" });
    expect(grid.querySelectorAll("li")).toHaveLength(6);
    expect(view.getByRole("link", { name: /Read the news/ }).getAttribute("href")).toBe("/apps/news");
    expect(view.getByRole("link", { name: /Make a video/ }).getAttribute("href")).toBe("/apps/videos/create");
    expect(view.getByRole("link", { name: /Make a song/ }).getAttribute("href")).toBe("/apps/music/create");
  } finally { restore(); }
});

test("a child only sees action cards for apps in the child's allowed catalog", async () => {
  const { view, restore } = open(["videos"]);
  try {
    const grid = await view.findByRole("list", { name: "Things to do" });
    expect(grid.querySelectorAll("li")).toHaveLength(4);
    expect(view.queryByText("Read the news")).toBeNull();
    expect(view.queryByText("Make a song")).toBeNull();
    expect(view.getByRole("link", { name: /Make a video/ }).getAttribute("href")).toBe("/apps/videos/create");
  } finally { restore(); }
});
