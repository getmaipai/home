import { afterEach, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import FullLayout from "@maipai/ui/src/dashboard/layouts/full/FullLayout";
import { useHeaderExtra } from "@maipai/ui/src/dashboard/layouts/full/vertical/header/HeaderExtraContext";

afterEach(cleanup);

function PageTitle() { return <h1>Library</h1>; }
function PageActions() { return <button type="button">Upload</button>; }
function Page() {
  useHeaderExtra(PageTitle, PageActions);
  return <main>Library content</main>;
}

test("the shell row places the page actions before the companion avatar", async () => {
  const view = render(<MemoryRouter><Routes><Route element={<FullLayout rail topRightBand fallbackTitle="Home" topRight={<button type="button">Companion</button>} />}><Route path="/" element={<Page />} /></Route></Routes></MemoryRouter>);
  await view.findByRole("button", { name: "Upload" });
  const row = await waitFor(() => {
    const header = document.querySelector('[data-slot="rail-page-header"]');
    expect(header?.querySelector('[data-slot="rail-header-right"]')).toBeTruthy();
    expect(header?.querySelector('[data-slot="rail-top-right"]')).toBeTruthy();
    return header as HTMLElement;
  });
  const actions = row.querySelector('[data-slot="rail-header-right"]')!;
  const avatar = row.querySelector('[data-slot="rail-top-right"]')!;
  expect(actions.compareDocumentPosition(avatar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(row.querySelectorAll(":scope > h1")).toHaveLength(1);
});
