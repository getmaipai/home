import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TrashPage, type TrashRow } from "./TrashPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { Roster } from "@/lib/api";

const originalFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; });
const person = { id: "person-atlas01", role: "owner", display_name: "atlas" } as Roster;
const row: TrashRow = { kind: "media_item", id: "media-nova001", title: "nova", deleted_at: "2026-10-17T00:00:00.000Z", trash_until: "2026-11-16T00:00:00.000Z", can_restore: true, can_purge: true };
function fixture(initial: TrashRow[] = [row], fail = false) {
  let rows = initial;
  const writes: Array<{ url: string; method: string }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method && init.method !== "GET") {
      writes.push({ url, method: init.method });
      if (fail) return Response.json({ error: "Could not save. Try again." }, { status: 500 });
      rows = [];
      return Response.json({ success: true });
    }
    return Response.json({ rows });
  }) as typeof fetch;
  return writes;
}
function renderPage() { return renderWithQueryClient(<MemoryRouter><TrashPage person={person} /></MemoryRouter>); }

test("empty Trash explains the 30 day window", async () => {
  fixture([]);
  const view = renderPage();
  await waitFor(() => expect(view.getByText("Trash is empty. Things you delete stay here for 30 days.")).toBeTruthy());
});
test("Restore writes to the trash route and refreshes the list", async () => {
  const writes = fixture();
  const view = renderPage();
  await waitFor(() => expect(view.getByText("nova")).toBeTruthy());
  fireEvent.click(view.getByRole("button", { name: "Restore" }));
  await waitFor(() => expect(view.getByText("Trash is empty. Things you delete stay here for 30 days.")).toBeTruthy());
  expect(writes).toEqual([{ url: "/api/trash/media_item/media-nova001/restore", method: "POST" }]);
});
test("Delete forever needs confirmation; cancel leaves the item", async () => {
  const writes = fixture();
  const view = renderPage();
  await waitFor(() => expect(view.getByText("nova")).toBeTruthy());
  fireEvent.click(view.getByRole("button", { name: "Delete forever" }));
  await waitFor(() => expect(view.getByRole("alertdialog")).toBeTruthy());
  expect(writes).toHaveLength(0);
  fireEvent.click(view.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(view.queryByRole("alertdialog")).toBeNull());
  fireEvent.click(view.getByRole("button", { name: "Delete forever" }));
  await waitFor(() => expect(view.getByRole("alertdialog")).toBeTruthy());
  const buttons = view.getAllByRole("button", { name: "Delete forever" });
  fireEvent.click(buttons[buttons.length - 1]!);
  await waitFor(() => expect(writes).toEqual([{ url: "/api/trash/media_item/media-nova001", method: "DELETE" }]));
});
test("a failed action shows what to do and keeps the item", async () => {
  fixture([row], true);
  const view = renderPage();
  await waitFor(() => expect(view.getByText("nova")).toBeTruthy());
  fireEvent.click(view.getByRole("button", { name: "Restore" }));
  await waitFor(() => expect(view.getByRole("alert").textContent).toContain("Refresh Trash and try again."));
  expect(view.getByText("nova")).toBeTruthy();
});
