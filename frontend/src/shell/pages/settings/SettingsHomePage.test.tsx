import { afterEach, expect, test } from "bun:test";
import { cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { renderWithQueryClient } from "../../../../tests/renderWithQueryClient";
import { SettingsHomePage } from "@/shell/pages/settings/SettingsHomePage";
import { makePerson, mockHome, type HomeFixture } from "@/shell/pages/settings/settingsTestKit";

let fixture: HomeFixture | null = null;
afterEach(() => { cleanup(); fixture?.restore(); fixture = null; });

function Location() { const location = useLocation(); return <output data-testid="location">{location.pathname}</output>; }
function open(role: "owner" | "admin" | "adult" | "teen" | "child", attention: Parameters<typeof mockHome>[0] extends infer P ? P extends { attention?: infer A } ? A : never : never = { items: [], areas: {} }) {
  fixture = mockHome({ attention });
  return renderWithQueryClient(<MemoryRouter initialEntries={["/settings"]}><Location /><Routes><Route path="settings" element={<SettingsHomePage person={makePerson(role)} />} /></Routes></MemoryRouter>);
}

test("Settings home shows attention items and the empty state, with spec area links", async () => {
  const view = open("owner", { items: [{ id: "search", kind: "missing", area: "search", title: "Web search has no address.", line: "Home cannot reach search.", action: { label: "Set up web search", href: "/settings/search?tab=search" } }], areas: { search: { state: "missing", summary: "Set up web search" } } });
  expect(await view.findByText("Web search has no address.")).toBeTruthy();
  expect(view.getByText("Needs attention · 1")).toBeTruthy();
  expect(view.getAllByRole("link", { name: "Search and web" })[0]!.getAttribute("href")).toBe("/settings/search");
  cleanup(); fixture?.restore(); fixture = null;
  const empty = open("owner");
  expect(await empty.findByText("Everything is fine.")).toBeTruthy();
  expect(empty.getByText("Checked just now.")).toBeTruthy();
});

test("non-admin sees personal areas without the household group", async () => {
  const view = open("adult");
  await waitFor(() => expect(view.getAllByRole("link", { name: "Profile and sign-in" }).length).toBeGreaterThan(0));
  expect(view.queryByRole("heading", { name: "The home" })).toBeNull();
  expect(view.queryByRole("link", { name: "Household and people" })).toBeNull();
});
