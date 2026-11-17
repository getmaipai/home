// The Users roster: one card per person in a grid, one Add user button, the household companions switch below the roster.
import { afterEach, expect, spyOn, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { UsersSection } from "@/apps/settings/UsersSection";
import { api, type PersonRosterEntry, type Roster } from "@/lib/api";

afterEach(cleanup);

const entry = (id: string, role: string, display_name: string, extra: Record<string, unknown> = {}) =>
  ({ id, role, display_name, avatar_seed: id, age_band: role === "child" ? "child" : role === "teen" ? "teen" : "adult", guest_expires_at: null, ...extra }) as unknown as PersonRosterEntry;
const sage = { id: "owner", role: "owner", display_name: "Sage" } as Roster;

function setup(rows: PersonRosterEntry[], onOpenPerson: (id: string) => void = () => {}) {
  const spies = [
    spyOn(api, "people").mockResolvedValue(rows as never),
    spyOn(api, "siteBlocks").mockResolvedValue({ label: "Blocked sites", rows: [], setBy: {}, defaults: [], mine: [], locked: [], resetLabel: "Reset" } as never),
    spyOn(api, "settingsRegistry").mockResolvedValue([] as never),
    spyOn(api, "settingsValues").mockResolvedValue([] as never),
  ];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/users"]}><Routes>
    <Route path="/users" element={<UsersSection person={sage} onOpenPerson={onOpenPerson} />} />
    <Route path="/people/:id" element={<p>Profile page</p>} />
  </Routes></MemoryRouter></QueryClientProvider>);
  return { view, restore: () => spies.forEach((spy) => spy.mockRestore()) };
}

const rows = () => [entry("owner", "owner", "Sage"), entry("t", "teen", "Marlow"), entry("c", "child", "Nova"), entry("g", "guest", "Visitor", { guest_expires_at: "2026-12-24T12:00:00.000Z" })];

test("the header says what the page is for and offers one Add user button", async () => {
  const { view, restore } = setup(rows());
  try {
    await view.findByRole("button", { name: "Marlow, Teen" });
    expect(view.getByRole("heading", { name: "Users" })).toBeTruthy();
    expect(view.getByText("Who lives here, what they can do and what they can see.")).toBeTruthy();
    expect(view.getAllByRole("button", { name: "Add user" })).toHaveLength(1);
  } finally { restore(); }
});

test("each person is one card with their name and a plain role badge, in a list the screen reader names Household", async () => {
  const { view, restore } = setup(rows());
  try {
    await view.findByRole("button", { name: "Marlow, Teen" });
    const list = view.getByRole("list", { name: "Household" });
    expect(list.querySelectorAll("li")).toHaveLength(4);
    for (const [name, role] of [["Sage", "Owner"], ["Marlow", "Teen"], ["Nova", "Child"], ["Visitor", "Guest"]]) {
      const card = view.getByRole("button", { name: name === "Sage" ? "Sage, you" : `${name}, ${role}` });
      expect(card.textContent).toContain(name!);
      expect(card.textContent).toContain(role!);
    }
    // No icons float at the edge of a card any more: edit and remove live on the person's own page.
    expect(view.queryByRole("button", { name: /^(Edit|Remove) / })).toBeNull();
    expect(view.queryByRole("button", { name: /Role and access/ })).toBeNull();
  } finally { restore(); }
});

test("the whole card opens that person's page; your own card says You and opens your own profile", async () => {
  const opened: string[] = [];
  const { view, restore } = setup(rows(), (id) => opened.push(id));
  try {
    fireEvent.click(await view.findByRole("button", { name: "Nova, Child" }));
    expect(opened).toEqual(["c"]);
    expect(view.getByText("You")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Sage, you" }));
    expect(await view.findByText("Profile page")).toBeTruthy();
    expect(opened).toEqual(["c"]);
  } finally { restore(); }
});

test("a guest card says when the visit ends", async () => {
  const { view, restore } = setup(rows());
  try {
    await view.findByRole("button", { name: "Visitor, Guest" });
    expect(view.getByText(/Guest until Dec 24, 2026/)).toBeTruthy();
  } finally { restore(); }
});

test("Add user opens the form and a new person is created from it", async () => {
  const create = spyOn(api, "createPerson").mockResolvedValue(entry("new", "adult", "Avery") as never);
  const { view, restore } = setup(rows());
  try {
    fireEvent.click(await view.findByRole("button", { name: "Add user" }));
    fireEvent.change(await view.findByPlaceholderText("Name"), { target: { value: "Avery" } });
    fireEvent.change(view.getByLabelText("PIN or password"), { target: { value: "123456" } });
    fireEvent.change(view.getByLabelText("Confirm passcode"), { target: { value: "123456" } });
    fireEvent.submit(view.getByPlaceholderText("Name").closest("form")!);
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ displayName: "Avery", role: "adult", secret: "123456" })));
    await waitFor(() => expect(view.queryByPlaceholderText("Name")).toBeNull());
  } finally { create.mockRestore(); restore(); }
}, 20000);

test("a failed load says what went wrong and how to retry", async () => {
  const people = spyOn(api, "people").mockRejectedValue(new Error("down"));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><MemoryRouter><UsersSection person={sage} onOpenPerson={() => {}} /></MemoryRouter></QueryClientProvider>);
  try {
    expect(await view.findByText(/Could not load the household\. Check your connection and try again\./)).toBeTruthy();
  } finally { people.mockRestore(); }
});
