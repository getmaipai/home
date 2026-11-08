import { toastError, spyOnToast } from "../../../tests/toastSpy";
import { afterEach, describe, expect, test, mock } from "bun:test";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { RemindersPage } from "@/apps/reminders/RemindersPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { MemoryRouter } from "react-router-dom";
import type { List as ListRecord } from "@maipai/spec/gen/ts/list.js";
import { WakeWordPersonContext } from "@/apps/chat/chatThreadContexts";
import type { Roster } from "@/lib/api";

spyOnToast();
afterEach(cleanup);

const stamp = "2026-10-29T12:00:00.000Z";
function list(kind: "shopping" | "todo" | "custom", items: Array<{ id: string; text: string; done: boolean }> = []): ListRecord {
  return { id: `list-${kind}123456`, scope: kind === "custom" ? "person" : "household", person: kind === "custom" ? "person-a" : null, kind, title: kind === "shopping" ? "Shopping List" : kind === "todo" ? "To-Do List" : "Personal", icon: null, items: items.map((item) => ({ ...item, due_at: null, created_at: stamp })), source: "hub", created_at: stamp, updated_at: stamp, deleted_at: null, hlc: "1:0:household1" };
}

function withLists() {
  let lists: ListRecord[] = [list("shopping", [{ id: "item-milk123", text: "Milk", done: false }, { id: "item-bread12", text: "Bread", done: true }]), list("todo"), list("custom")];
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.endsWith("/api/lists") && method === "GET") return Promise.resolve(Response.json(lists));
    if (url.endsWith("/api/coming-up")) return Promise.resolve(Response.json([]));
    if (url.endsWith("/api/lists") && method === "POST") {
      const body = JSON.parse(String(init?.body)) as { title: string; icon: NonNullable<ListRecord["icon"]> };
      const created: ListRecord = { ...list("custom"), id: "list-custom123", title: body.title, icon: body.icon, items: [] };
      lists = [...lists, created];
      return Promise.resolve(Response.json(created, { status: 201 }));
    }
    const listEdit = url.match(/\/api\/lists\/(list-[^/]+)$/);
    if (listEdit && method === "PATCH") {
      const body = JSON.parse(String(init?.body)) as { title?: string; icon?: NonNullable<ListRecord["icon"]> };
      lists = lists.map((row) => row.id === listEdit[1] ? { ...row, ...body } : row);
      return Promise.resolve(Response.json(lists.find((row) => row.id === listEdit[1])));
    }
    if (listEdit && method === "DELETE") {
      lists = lists.filter((row) => row.id !== listEdit[1]);
      return Promise.resolve(Response.json({ id: listEdit[1] }));
    }
    const add = url.match(/\/api\/lists\/(list-[^/]+)\/items$/);
    if (add && method === "POST") {
      const body = JSON.parse(String(init?.body)) as { text: string; parse_due?: boolean };
      const parsed = body.parse_due && body.text.includes("tomorrow at 5");
      const itemText = parsed ? body.text.replace(" tomorrow at 5", "") : body.text;
      lists = lists.map((row) => row.id === add[1] ? { ...row, items: [...row.items, { id: "item-added123", text: itemText, done: false, due_at: parsed ? "2026-10-30T17:00:00.000Z" : null, created_at: stamp }] } : row);
      return Promise.resolve(Response.json(lists.find((row) => row.id === add[1])));
    }
    const item = url.match(/\/api\/lists\/(list-[^/]+)\/items\/(item-[^/]+)$/);
    if (item && method === "PATCH") {
      const body = JSON.parse(String(init?.body)) as { done: boolean };
      lists = lists.map((row) => row.id === item[1] ? { ...row, items: row.items.map((entry) => entry.id === item[2] ? { ...entry, done: body.done } : entry) } : row);
      return Promise.resolve(Response.json(lists.find((row) => row.id === item[1])));
    }
    if (url.endsWith("/clear-done") && method === "POST") {
      const id = url.split("/").at(-2);
      lists = lists.map((row) => row.id === id ? { ...row, items: row.items.filter((entry) => !entry.done) } : row);
      return Promise.resolve(Response.json(lists.find((row) => row.id === id)));
    }
    throw new Error(`Unstubbed request: ${method} ${url}`);
  }) as unknown as typeof fetch;
  return () => { globalThis.fetch = original; };
}

describe("RemindersPage device schedules (HOUSE-04)", () => {
  function withSchedules(rows: Array<{ id: string; what: string; when: string; state: "active" | "paused"; note: string | null }>, others: number | null) {
    const restore = withLists();
    const base = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); const method = init?.method ?? "GET";
      if (url.endsWith("/api/house/schedules")) { calls.push("list"); return Promise.resolve(Response.json({ schedules: rows, others })); }
      const del = url.match(/\/api\/house\/schedules\/(.+)$/);
      if (del && method === "DELETE") { calls.push(`delete ${del[1]}`); rows = rows.filter((row) => row.id !== del[1]); return Promise.resolve(Response.json({ ok: true })); }
      return base(input, init);
    }) as unknown as typeof fetch;
    return { calls, restore: () => { globalThis.fetch = base; restore(); } };
  }
  const row = { id: "sched-porch0001", what: "Porch Lamp light turns on", when: "every day at 6:00 PM", state: "active" as const, note: null };
  const asRole = (role: string) => ({ id: "person-a", role }) as unknown as Roster;

  test("a devices response without a schedules field does not crash the page", async () => {
    const restore = withLists();
    const base = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/api/house/schedules")) return Promise.resolve(Response.json({}));
      return base(input, init);
    }) as unknown as typeof fetch;
    try {
      const view = renderWithQueryClient(<MemoryRouter><WakeWordPersonContext.Provider value={asRole("owner")}><RemindersPage /></WakeWordPersonContext.Provider></MemoryRouter>);
      expect(await view.findByRole("button", { name: /Device schedules/ })).toBeInTheDocument();
    } finally { globalThis.fetch = base; restore(); }
  });

  test("an adult sees their own schedules, an admin count, and can cancel one after confirming", async () => {
    const rig = withSchedules([row, { ...row, id: "sched-hall00002", what: "Hall light turns off", state: "paused", note: "Paused because you can no longer control the device." }], 2);
    try {
      const view = renderWithQueryClient(<MemoryRouter><WakeWordPersonContext.Provider value={asRole("owner")}><RemindersPage /></WakeWordPersonContext.Provider></MemoryRouter>);
      fireEvent.click(await view.findByRole("button", { name: /Device schedules/ }));
      expect(await view.findByText("Porch Lamp light turns on")).toBeInTheDocument();
      expect(view.getByText("Paused because you can no longer control the device.")).toBeInTheDocument();
      expect(view.getByText("2 schedules belong to other people.")).toBeInTheDocument();
      fireEvent.click(view.getByRole("button", { name: "Cancel schedule: Porch Lamp light turns on" }));
      fireEvent.click(await view.findByRole("button", { name: "Cancel schedule", hidden: false }));
      await waitFor(() => expect(rig.calls).toContain("delete sched-porch0001"));
    } finally { rig.restore(); }
  });

  test("a teen or child never sees the entry and never asks the server", async () => {
    const rig = withSchedules([row], null);
    try {
      for (const role of ["teen", "child"]) {
        const view = renderWithQueryClient(<MemoryRouter><WakeWordPersonContext.Provider value={asRole(role)}><RemindersPage /></WakeWordPersonContext.Provider></MemoryRouter>);
        await view.findByRole("button", { name: /Shopping/ });
        expect(view.queryByRole("button", { name: /Device schedules/ })).toBeNull();
        view.unmount();
      }
      expect(rig.calls).toEqual([]);
    } finally { rig.restore(); }
  });
});

describe("RemindersPage", () => {
  test("shows the two standing lists with counts, adds and ticks an item, and clears the composer", async () => {
    const restore = withLists();
    try {
      const view = renderWithQueryClient(<MemoryRouter><RemindersPage /></MemoryRouter>);
      expect(await view.findByRole("button", { name: /Shopping/ })).toHaveTextContent("1");
      expect(view.getByRole("button", { name: /To-do/ })).not.toHaveTextContent(/\d/);
      const composer = view.getByRole("textbox", { name: "Add an item" });
      fireEvent.change(composer, { target: { value: "Apples" } });
      fireEvent.submit(composer.closest("form")!);
      expect(await view.findByText("Apples")).toBeInTheDocument();
      await waitFor(() => expect(view.getByRole("textbox", { name: "Add an item" })).toHaveValue(""));
      fireEvent.click(view.getByRole("checkbox", { name: "Milk" }));
      await view.findByText("Done (2)");
      fireEvent.click(view.getByRole("button", { name: "Done (2)" }));
      expect(view.getByText("Milk").closest("[data-done='true']")).toBeTruthy();
    } finally { restore(); }
  });

  test("clears only completed Shopping items and exposes no list deletion to a child", async () => {
    const restore = withLists();
    try {
      const view = renderWithQueryClient(<MemoryRouter><RemindersPage /></MemoryRouter>);
      fireEvent.click(await view.findByRole("button", { name: /Clear done/ }));
      await waitFor(() => expect(view.queryByText("Bread")).toBeNull());
      expect(view.queryByRole("button", { name: /delete list/i })).toBeNull();
    } finally { restore(); }
  });

  test("starts on the list picker on a phone and opens the selected list as the next screen", async () => {
    const restore = withLists();
    try {
      const view = renderWithQueryClient(<MemoryRouter><RemindersPage /></MemoryRouter>);
      expect(await view.findByRole("heading", { name: "Lists" })).toBeInTheDocument();
      fireEvent.click(view.getByRole("button", { name: /Shopping/ }));
      expect(await view.findByRole("heading", { name: "Shopping" })).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  test("Today and Scheduled replace Coming up and show their own empty lists", async () => {
    const restore = withLists();
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/api/lists")) return Promise.resolve(Response.json([list("shopping"), list("todo")]));
      if (String(input).endsWith("/api/coming-up")) return Promise.resolve(Response.json([]));
      return original(input, init);
    }) as unknown as typeof fetch;
    try {
      const view = renderWithQueryClient(<MemoryRouter><RemindersPage /></MemoryRouter>);
      expect(await view.findByRole("button", { name: /Today/ })).not.toHaveTextContent(/\d/);
      expect(view.getByRole("button", { name: /Scheduled/ })).not.toHaveTextContent(/\d/);
      fireEvent.click(view.getByRole("button", { name: /Scheduled/ }));
      expect(await view.findByRole("heading", { name: "Scheduled" })).toBeInTheDocument();
    } finally { restore(); globalThis.fetch = original; }
  });

  test("quick add requests due parsing and shows the resulting due chip", async () => {
    const restore = withLists();
    try {
      const view = renderWithQueryClient(<MemoryRouter><RemindersPage /></MemoryRouter>);
      await view.findByRole("textbox", { name: "Add an item" });
      fireEvent.click(view.getByRole("button", { name: /To-do/ }));
      const todoComposer = view.getByRole("textbox", { name: "Add an item" });
      fireEvent.change(todoComposer, { target: { value: "milk tomorrow at 5" } });
      fireEvent.submit(todoComposer.closest("form")!);
      expect(await view.findByText("milk")).toBeInTheDocument();
      expect(view.getByText("milk").closest("li")?.querySelector("[data-due-chip='true']")).toBeTruthy();
    } finally {
      restore();
    }
  });

  test("create sheet creates a custom list, and the list menu renames and confirms deletion", async () => {
    const restore = withLists();
    try {
      const view = renderWithQueryClient(<WakeWordPersonContext.Provider value={{ role: "adult" } as Roster}><MemoryRouter><RemindersPage /></MemoryRouter></WakeWordPersonContext.Provider>);
      fireEvent.click(await view.findByRole("button", { name: "Create list" }));
      fireEvent.change(await view.findByLabelText("Name"), { target: { value: "Projects" } });
      fireEvent.click(view.getByRole("button", { name: "briefcase" }));
      fireEvent.click(view.getByRole("button", { name: "Create list" }));
      expect(await view.findByRole("heading", { name: "Projects" })).toBeInTheDocument();
      const openMenu = () => {
        const trigger = view.getByRole("button", { name: "List options" });
        act(() => {
          fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1 });
          fireEvent.click(trigger);
        });
      };
      openMenu();
      fireEvent.click(await view.findByRole("menuitem", { name: "Rename" }));
      const renameField = await view.findByLabelText("Name");
      fireEvent.change(renameField, { target: { value: "Planning" } });
      fireEvent.click(view.getByRole("button", { name: "Save" }));
      expect(await view.findByRole("heading", { name: "Planning" })).toBeInTheDocument();
      openMenu();
      fireEvent.click(await view.findByRole("menuitem", { name: "Delete" }));
      expect(await view.findByRole("alertdialog")).toHaveTextContent("Its 0 items go too.");
      fireEvent.click(view.getByRole("button", { name: "Delete list" }));
      await waitFor(() => expect(view.queryByRole("heading", { name: "Planning" })).toBeNull());
    } finally {
      restore();
    }
  });

  test("standing Shopping and To-do lists have no management menu", async () => {
    const restore = withLists();
    try {
      const view = renderWithQueryClient(<MemoryRouter><RemindersPage /></MemoryRouter>);
      await view.findByRole("heading", { name: "Shopping" });
      expect(view.queryByRole("button", { name: "List options" })).toBeNull();
      fireEvent.click(view.getByRole("button", { name: /To-do/ }));
      expect(await view.findByRole("heading", { name: "To-do" })).toBeInTheDocument();
      expect(view.queryByRole("button", { name: "List options" })).toBeNull();
    } finally {
      restore();
    }
  });

  test("column order, counts, header copy, and the empty state match the Lists screen", async () => {
    const restore = withLists();
    try {
      const view = renderWithQueryClient(<MemoryRouter><RemindersPage /></MemoryRouter>);
      const column = await view.findByLabelText("Reminder lists");
      const buttons = Array.from(column.querySelectorAll("button"));
      expect(buttons.map((button) => button.textContent?.replace(/\s+/g, " ").trim())).toEqual(["+", "Today", "Scheduled", "Shopping1", "To-do", "Personal"]);
      expect(await view.findByText("YOUR LIST")).toBeInTheDocument();
      expect(view.getByText("A few things to pick up")).toBeInTheDocument();
      expect(view.getByText(/2026|October|November/)).toBeInTheDocument();
      fireEvent.click(view.getByRole("button", { name: /Personal/ }));
      expect(await view.findByRole("heading", { name: "Personal" })).toBeInTheDocument();
      expect(view.getByText("Your own list")).toBeInTheDocument();
      expect(view.getByText("Nothing on the list yet")).toBeInTheDocument();
      expect(view.getByText("Add the first thing and we'll keep it here for you.")).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  test("Today and Scheduled contain due list items and pending reminder jobs", async () => {
    const original = globalThis.fetch;
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const todayAt = new Date(today.setHours(17, 0, 0, 0)).toISOString();
    const tomorrowAt = new Date(tomorrow.setHours(17, 0, 0, 0)).toISOString();
    const todo = {
      ...list("todo"),
      items: [{ id: "item-due123", text: "Due today", done: false, due_at: todayAt, created_at: stamp }],
    };
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/lists")) return Promise.resolve(Response.json([list("shopping"), todo]));
      if (url.endsWith("/api/coming-up")) return Promise.resolve(Response.json([
        { id: "job-today", kind: "reminder", text: "Reminder for today", at: todayAt },
        { id: "job-later", kind: "reminder", text: "Reminder scheduled", at: tomorrowAt },
      ]));
      throw new Error(`Unstubbed request: ${url}`);
    }) as unknown as typeof fetch;
    try {
      const view = renderWithQueryClient(<MemoryRouter><RemindersPage /></MemoryRouter>);
      expect(await view.findByRole("button", { name: /Today/ })).toHaveTextContent("2");
      expect(view.getByRole("button", { name: /Scheduled/ })).toHaveTextContent("3");
      fireEvent.click(view.getByRole("button", { name: /Today/ }));
      expect(await view.findByText("Reminder for today")).toBeInTheDocument();
      expect(view.getByText("Due today")).toBeInTheDocument();
      expect(view.queryByText("Reminder scheduled")).toBeNull();
      fireEvent.click(view.getByRole("button", { name: /Scheduled/ }));
      expect(await view.findByText("Reminder scheduled")).toBeInTheDocument();
      expect(view.getByText("Due today")).toBeInTheDocument();
    } finally {
      globalThis.fetch = original;
    }
  });

});

describe("RemindersPage failures", () => {
  function refuse(restore: () => void, match: (url: string, method: string) => boolean, message: string) {
    const working = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => match(String(input), init?.method ?? "GET")
      ? Promise.resolve(Response.json({ error: message }, { status: 500 }))
      : working(input, init)) as unknown as typeof fetch;
    return () => { globalThis.fetch = working; restore(); };
  }

  test("a refused add toasts and keeps the typed text in the box", async () => {
    const restore = refuse(withLists(), (url, method) => method === "POST" && url.endsWith("/items"), "Home could not add that item.");
    try {
      const view = renderWithQueryClient(<MemoryRouter><RemindersPage /></MemoryRouter>);
      const composer = await view.findByRole("textbox", { name: "Add an item" });
      fireEvent.change(composer, { target: { value: "Apples" } });
      fireEvent.submit(composer.closest("form")!);
      await waitFor(() => expect(toastError).toHaveBeenCalledWith("Home could not add that item. Check your connection and try again."));
      await waitFor(() => expect(view.getByRole("textbox", { name: "Add an item" })).toHaveValue("Apples"));
      expect(view.queryByText("Apples", { selector: "li *" })).toBeNull();
    } finally { restore(); }
  });

  test("a refused list delete toasts, keeps the dialog open and the list in place", async () => {
    const restore = refuse(withLists(), (url, method) => method === "DELETE" && /\/api\/lists\//.test(url), "Home could not delete that list.");
    try {
      const view = renderWithQueryClient(<WakeWordPersonContext.Provider value={{ role: "adult" } as Roster}><MemoryRouter><RemindersPage /></MemoryRouter></WakeWordPersonContext.Provider>);
      fireEvent.click(await view.findByRole("button", { name: /Personal/ }));
      await view.findByRole("heading", { name: "Personal" });
      const trigger = view.getByRole("button", { name: "List options" });
      act(() => { fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1 }); fireEvent.click(trigger); });
      fireEvent.click(await view.findByRole("menuitem", { name: "Delete" }));
      await view.findByRole("alertdialog");
      fireEvent.click(view.getByRole("button", { name: "Delete list" }));
      await waitFor(() => expect(toastError).toHaveBeenCalledWith("Home could not delete that list. Check your connection and try again."));
      expect(view.getByRole("alertdialog")).toBeInTheDocument();
      expect(view.getByRole("heading", { name: "Personal", hidden: true })).toBeInTheDocument();
      await waitFor(() => expect((view.getByRole("button", { name: "Delete list" }) as HTMLButtonElement).disabled).toBe(false));
    } finally { restore(); }
  });

  test("a failed load says what to do and offers Retry", async () => {
    const restore = refuse(withLists(), (url, method) => method === "GET" && url.endsWith("/api/lists"), "no");
    try {
      const view = renderWithQueryClient(<MemoryRouter><RemindersPage /></MemoryRouter>);
      expect(await view.findByText("Could not load reminders. Check your connection and try again.")).toBeInTheDocument();
      expect(view.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    } finally { restore(); }
  });
});
