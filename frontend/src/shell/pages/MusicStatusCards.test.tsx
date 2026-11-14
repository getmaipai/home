// ACTIVITY-PAGE-01: in Music's Your songs, a song that waits, is being made or did not finish is the kit status card, fed by the song's own job record.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ToastProvider } from "@maipai/ui/src/primitives/Toast";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { MusicWorkspace } from "./MusicWorkspacePage";
import type { MusicCard } from "@/lib/musicApi";

let baseFetch: typeof fetch;
const card = (over: Partial<MusicCard>) => ({ id: "m", title: "Song", state: "done", progress: 1, versions: [], current_id: null, stage_label: null, position: null, eta_seconds: null, error_line: null, task: "text2music", ...over }) as unknown as MusicCard;
const jobs = [
  card({ id: "m-run", title: "Rainy porch song", state: "running", progress: 0.3, stage_label: "Singing the verse" }),
  card({ id: "m-wait", title: "Lullaby", state: "queued", progress: 0, position: 2 }),
  card({ id: "m-fail", title: "Night bus", state: "failed", progress: 0, error_line: "The song took longer than expected. Try again." }),
  card({ id: "m-done", title: "Neon Rain", state: "done" }),
];
beforeEach(() => {
  baseFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.startsWith("/api/music/jobs")) return Promise.resolve(Response.json(jobs));
    if (url.startsWith("/api/music/status")) return Promise.resolve(Response.json({ can_make: true, engine_ready: true, limits: {} }));
    if (url === "/api/music/sounds") return Promise.resolve(Response.json([]));
    return Promise.resolve(Response.json({}));
  }) as typeof fetch;
});
afterEach(() => { cleanup(); globalThis.fetch = baseFetch; });

describe("Your songs status cards", () => {
  test("waiting, making and failed songs wear the status card with the state word and the next step; a finished one stays a tile", async () => {
    const view = renderWithQueryClient(<ToastProvider><MemoryRouter><MusicWorkspace adult search="" /></MemoryRouter></ToastProvider>);
    await waitFor(() => expect(view.getByText("Rainy porch song")).toBeTruthy());
    const kinds = Array.from(document.querySelectorAll("[data-status-kind]")).map((node) => node.getAttribute("data-status-kind"));
    expect(kinds).toEqual(["progress", "waiting", "problem"]);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Making now");
    expect(text).not.toContain("Singing the verse");
    expect(text).toContain("30%");
    expect(text.match(/Still being made\./g)).toHaveLength(2);
    expect(text).toContain("Could not finish");
    expect(text).not.toContain("The song took longer than expected. Try again.");
    expect(text).toContain("This song could not be made. Open it to try again.");
    expect(view.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(view.getAllByText("Neon Rain").length).toBeGreaterThan(0);
    expect(document.querySelectorAll("[data-status-kind=done]")).toHaveLength(0);
  });

  test("a making song with no figure still gets a short line", async () => {
    jobs[0] = card({ id: "m-run", title: "Rainy porch song", state: "running", progress: 0, stage_label: "Getting ready" });
    const view = renderWithQueryClient(<ToastProvider><MemoryRouter><MusicWorkspace adult search="" /></MemoryRouter></ToastProvider>);
    await waitFor(() => expect(view.getByText("Rainy porch song")).toBeTruthy());
    expect(document.body.textContent).toContain("Still being made.");
    fireEvent.click(view.getAllByRole("button", { name: "Open" })[0]!);
  });
});
