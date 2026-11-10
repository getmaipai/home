// Arrange Home: show, hide, reorder and reset the person's Home cards.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { ArrangeHome, moveCard } from "@/shell/pages/dashboard/ArrangeHome";
import { renderWithQueryClient } from "../../../../tests/renderWithQueryClient";
import type { ArrangeCard } from "@/lib/api";

afterEach(() => cleanup());

const card = (id: string, over: Partial<ArrangeCard> = {}): ArrangeCard => ({ package: id, id: "x", key: `${id}/x`, title: id.toUpperCase(), size: "card", refresh_s: 60, hidden: false, ...over });

function mockApi(initial: ArrangeCard[]) {
  const original = globalThis.fetch;
  const puts: Array<{ order: string[]; hidden: string[] }> = [];
  let cards = initial;
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
    if (url.includes("/api/widgets/home/arrange")) {
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { order: string[]; hidden: string[] };
        puts.push(body);
        const byKey = new Map(initial.map((c) => [c.key, c]));
        cards = (body.order.length ? body.order : initial.map((c) => c.key)).map((key) => ({ ...byKey.get(key)!, hidden: body.hidden.includes(key) }));
      }
      return Promise.resolve(Response.json({ cards }));
    }
    return Promise.resolve(Response.json({}));
  }) as unknown as typeof fetch;
  return { puts, restore: () => { globalThis.fetch = original; } };
}

const open = async () => {
  renderWithQueryClient(<ArrangeHome />);
  fireEvent.click(within(document.body).getByTestId("home-arrange-open"));
  await waitFor(() => expect(within(document.body).getByTestId("home-arrange-list")).toBeTruthy());
};

describe("moveCard", () => {
  test("swaps neighbours and leaves the ends alone", () => {
    const list = [card("a"), card("b"), card("c")];
    expect(moveCard(list, 0, 1).map((c) => c.title)).toEqual(["B", "A", "C"]);
    expect(moveCard(list, 0, -1)).toBe(list);
    expect(moveCard(list, 2, 1)).toBe(list);
  });
});

describe("Arrange Home sheet", () => {
  test("lists the cards and saves a hide at once", async () => {
    const api = mockApi([card("a"), card("b")]);
    await open();
    await waitFor(() => expect(within(document.body).getAllByTestId("home-arrange-row").length).toBe(2));
    fireEvent.click(within(document.body).getByRole("switch", { name: "Show B on Home" }));
    await waitFor(() => expect(api.puts).toEqual([{ order: ["a/x", "b/x"], hidden: ["b/x"] }]));
    await waitFor(() => expect(within(document.body).getByRole("switch", { name: "Show B on Home" }).getAttribute("aria-checked")).toBe("false"));
    api.restore();
  });

  test("move down saves the new order; the ends cannot move past the list", async () => {
    const api = mockApi([card("a"), card("b")]);
    await open();
    await waitFor(() => expect(within(document.body).getAllByTestId("home-arrange-row").length).toBe(2));
    expect((within(document.body).getByRole("button", { name: "Move A up" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(document.body).getByRole("button", { name: "Move B down" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(document.body).getByRole("button", { name: "Move A down" }));
    await waitFor(() => expect(api.puts).toEqual([{ order: ["b/x", "a/x"], hidden: [] }]));
    await waitFor(() => expect(within(document.body).getAllByTestId("home-arrange-row")[0]!.textContent).toContain("B"));
    api.restore();
  });

  test("the shown highlight stays first", async () => {
    const api = mockApi([card("h", { hero: true }), card("b")]);
    await open();
    await waitFor(() => expect(within(document.body).getAllByTestId("home-arrange-row").length).toBe(2));
    expect((within(document.body).getByRole("button", { name: "Move H down" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(document.body).getByRole("button", { name: "Move B up" }) as HTMLButtonElement).disabled).toBe(true);
    api.restore();
  });

  test("Reset to default sends empty lists", async () => {
    const api = mockApi([card("a", { hidden: true }), card("b")]);
    await open();
    await waitFor(() => expect(within(document.body).getAllByTestId("home-arrange-row").length).toBe(2));
    fireEvent.click(within(document.body).getByTestId("home-arrange-reset"));
    await waitFor(() => expect(api.puts).toEqual([{ order: [], hidden: [] }]));
    api.restore();
  });

  test("no cards shows a plain empty state", async () => {
    const api = mockApi([]);
    await open();
    await waitFor(() => expect(within(document.body).getByTestId("home-arrange-empty")).toBeTruthy());
    api.restore();
  });

  test("a failed save shows a status card, not a raw error", async () => {
    const api = mockApi([card("a")]);
    const ok = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => init?.method === "PUT" ? Promise.resolve(Response.json({ error: "no" }, { status: 400 })) : (ok as typeof fetch)(input, init)) as unknown as typeof fetch;
    await open();
    await waitFor(() => expect(within(document.body).getAllByTestId("home-arrange-row").length).toBe(1));
    fireEvent.click(within(document.body).getByRole("switch", { name: "Show A on Home" }));
    await waitFor(() => expect(within(document.body).getByText("Your change was not saved")).toBeTruthy());
    api.restore();
  });
});
