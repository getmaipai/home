import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { HousePage } from "./HousePage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";

const originalFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; });
const room = { id: "kitchen", name: "Kitchen", entities: [
  { id: "light.kitchen", name: "Kitchen light", kind: "light", on: false, brightness: 45, swatch: null, unavailable: false, sensitive: false, canControl: true },
  { id: "switch.fan", name: "Fan", kind: "fan", on: true, brightness: null, swatch: null, unavailable: false, sensitive: false, canControl: true },
  { id: "scene.dinner", name: "Dinner", kind: "scene", on: false, brightness: null, swatch: null, unavailable: false, sensitive: false, canControl: true },
  { id: "lock.back", name: "Back lock", kind: "lock", on: false, locked: false, brightness: null, swatch: null, unavailable: false, sensitive: true, canControl: true },
] };
function fixture({ rooms = [room], status, fail = false, unavailable = false }: { rooms?: typeof room[]; status?: string; fail?: boolean; unavailable?: boolean } = {}) {
  const writes: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)); writes.push({ url, body });
      if (fail) return Response.json({ ok: false, kind: "unreachable" });
      return Response.json({ ok: true, state: "on", undoId: "undo-1" });
    }
    return Response.json({ rooms: unavailable ? [{ ...room, entities: [{ ...room.entities[0]!, unavailable: true, canControl: false }] }] : rooms, ...(status ? { status } : {}) });
  }) as typeof fetch;
  return writes;
}

test("renders the right tile per kind and room counts", async () => {
  const data = structuredClone(room); data.entities[0]!.on = true;
  fixture({ rooms: [data] }); const view = renderWithQueryClient(<HousePage />);
  await waitFor(() => expect(view.getByText((_, node) => node?.textContent === "2 of 4 on")).toBeTruthy());
  expect(view.getByRole("switch", { name: "Kitchen light" })).toBeTruthy();
  expect(view.getByRole("switch", { name: "Fan" })).toBeTruthy();
  expect(view.getByRole("button", { name: "Dinner" })).toBeTruthy();
  expect(view.getByRole("button", { name: "Confirm" })).toBeTruthy();
});

test("light toggle posts turn_on and shows pending optimistically", async () => {
  let release!: (response: Response) => void;
  const writes: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") { writes.push({ url: String(input), body: JSON.parse(String(init.body)) }); return new Promise<Response>((resolve) => { release = resolve; }); }
    return Response.json({ rooms: [room] });
  }) as typeof fetch;
  const view = renderWithQueryClient(<HousePage />);
  const toggle = await view.findByRole("switch", { name: "Kitchen light" });
  fireEvent.click(toggle);
  await waitFor(() => expect(view.getByText("Updating…")).toBeTruthy());
  expect(writes[0]?.body).toEqual({ entity: "light.kitchen", action: "turn_on" });
  release(Response.json({ ok: true, state: "on" }));
});

test("failed action rolls back and shows room feedback", async () => {
  fixture({ fail: true }); const view = renderWithQueryClient(<HousePage />);
  fireEvent.click(await view.findByRole("switch", { name: "Kitchen light" }));
  await waitFor(() => expect(view.getByText("The Kitchen light did not respond. Try again.")).toBeTruthy());
  expect(view.getByText((_, node) => node?.textContent === "1 of 4 on")).toBeTruthy();
});

test("shows not configured and unreachable states", async () => {
  fixture({ status: "not_configured" });
  expect(await renderWithQueryClient(<HousePage />).findByText(/Home Assistant is not set up yet/)).toBeTruthy();
  cleanup(); fixture({ status: "unreachable" });
  expect(await renderWithQueryClient(<HousePage />).findByText("Home Assistant did not answer. Check that it is on, then reload.")).toBeTruthy();
});

test("unavailable entities render disabled controls", async () => {
  fixture({ unavailable: true }); const view = renderWithQueryClient(<HousePage />);
  const toggle = await view.findByRole("switch", { name: "Kitchen light" });
  expect(toggle).toBeDisabled();
});

// AUDIT-DUP-FE-01: rooms that fail to load show the kit AsyncState's error with a Try again that asks again.
test("rooms that fail to load say so and Try again loads them", async () => {
  let ok = false;
  globalThis.fetch = (async () => (ok ? Response.json({ rooms: [room] }) : Response.json({ error: "Nothing answered." }, { status: 500 }))) as unknown as typeof fetch;
  const view = renderWithQueryClient(<HousePage />);
  expect(await view.findByText("Home could not load rooms. Try again.")).toBeTruthy();
  ok = true;
  fireEvent.click(view.getByRole("button", { name: "Try again" }));
  expect(await view.findByRole("switch", { name: "Kitchen light" })).toBeTruthy();
});
