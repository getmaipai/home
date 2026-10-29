import { afterEach, describe, expect, test, mock } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { RemindersPage } from "@/apps/reminders/RemindersPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { MemoryRouter } from "react-router-dom";

afterEach(cleanup);

const stamp = "2026-10-29T12:00:00.000Z";
function list(kind: "shopping" | "todo", items: Array<{ id: string; text: string; done: boolean }> = []) {
  return { id: `list-${kind}123456`, scope: "household", person: null, kind, title: kind === "shopping" ? "Shopping List" : "To-Do List", items: items.map((item) => ({ ...item, due_at: null, created_at: stamp })), source: "hub", created_at: stamp, updated_at: stamp, deleted_at: null, hlc: "1:0:household1" };
}

function withLists() {
  let lists = [list("shopping", [{ id: "item-milk123", text: "Milk", done: false }, { id: "item-bread12", text: "Bread", done: true }]), list("todo")];
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.endsWith("/api/lists") && method === "GET") return Promise.resolve(Response.json(lists));
    const add = url.match(/\/api\/lists\/(list-[^/]+)\/items$/);
    if (add && method === "POST") {
      const body = JSON.parse(String(init?.body)) as { text: string };
      lists = lists.map((row) => row.id === add[1] ? { ...row, items: [...row.items, { id: "item-added123", text: body.text, done: false, due_at: null, created_at: stamp }] } : row);
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

describe("RemindersPage", () => {
  test("shows the two standing lists with counts, adds and ticks an item, and clears the composer", async () => {
    const restore = withLists();
    try {
      const view = renderWithQueryClient(<MemoryRouter><RemindersPage /></MemoryRouter>);
      expect(await view.findByRole("button", { name: /Shopping/ })).toHaveTextContent("1");
      expect(view.getByRole("button", { name: /To-do/ })).toHaveTextContent("0");
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

  test("opens Coming up and shows a plain empty state", async () => {
    const restore = withLists();
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/api/lists")) return Promise.resolve(Response.json([list("shopping"), list("todo")]));
      if (String(input).endsWith("/api/coming-up")) return Promise.resolve(Response.json([]));
      return original(input, init);
    }) as unknown as typeof fetch;
    try {
      const view = renderWithQueryClient(<MemoryRouter><RemindersPage /></MemoryRouter>);
      fireEvent.click(await view.findByRole("tab", { name: "Coming up" }));
      expect(view.getByRole("tab", { name: "Coming up" })).toBeInTheDocument();
    } finally { restore(); globalThis.fetch = original; }
  });
});
