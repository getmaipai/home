import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { createElement } from "react";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { MusicLibraryColumn } from "./MusicLibraryColumn";

let baseFetch: typeof fetch;
let dataCalls: Array<Record<string, unknown>>;
const entries = [
  { id: "song-1", title: "Amber Skies", channel: "Marlow", thumbnail: null, route: "play", kind_label: "Song", pin_key: "track:song-1", is_song: true },
  { id: "album-1", title: "Blue Hour", channel: "Nova", thumbnail: null, route: "album", kind_label: "Album", pin_key: "album:album-1", is_song: false },
];
function Where() { const location = useLocation(); return createElement("output", { "data-testid": "where" }, location.pathname); }

beforeEach(() => {
  dataCalls = [];
  baseFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === "/api/plugins/audio/data/songs") {
      dataCalls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Promise.resolve(Response.json(entries));
    }
    if (url === "/api/plugins/audio/pin") return Promise.resolve(Response.json({ key: "track:song-1", on: true }));
    return Promise.resolve(Response.json({}));
  }) as typeof fetch;
});
afterEach(() => { cleanup(); globalThis.fetch = baseFetch; });

function open() {
  return renderWithQueryClient(<MemoryRouter initialEntries={["/apps/audio"]}><MusicLibraryColumn pageId="index" /><Where /></MemoryRouter>);
}

describe("Music library column", () => {
  test("filters one canonical library query and sends sort choices through the existing setting path", async () => {
    const view = open();
    await view.findAllByRole("button", { name: /Amber Skies/ });
    fireEvent.click(view.getByRole("button", { name: "Albums" }));
    await waitFor(() => expect(dataCalls.some((call) => call.kind === "albums")).toBe(true));
    fireEvent.pointerDown(view.getByRole("button", { name: "Recently played" }), { button: 0, ctrlKey: false, pointerType: "mouse" });
    fireEvent.click(view.getByRole("menuitem", { name: "Name" }));
    await waitFor(() => expect(dataCalls.some((call) => call.sort === "az")).toBe(true));
  });

  test("slash opens the filter, arrows move the row focus, and Enter opens the focused item", async () => {
    const view = open();
    const first = (await view.findAllByRole("button", { name: /Amber Skies/ }))[0]!;
    fireEvent.keyDown(window, { key: "/" });
    expect(await view.findByRole("searchbox", { name: "Search in your library" })).toBeTruthy();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    const second = (await view.findAllByRole("button", { name: /Blue Hour/ }))[0]!;
    second.focus();
    fireEvent.keyDown(second, { key: "Enter" });
    await waitFor(() => expect(view.getByTestId("where").textContent).toBe("/apps/audio/album"));
  });
});
