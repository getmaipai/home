// SOUNDS-FOLLOW-01: the takes of one sound request and Add to a song.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ToastProvider } from "@maipai/ui/src/primitives/Toast";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { AddSoundToSong, SoundTakes } from "./SoundExtras";
import type { MusicCard } from "@/lib/musicApi";

let baseFetch: typeof fetch;
let calls: Array<{ url: string; method: string; body: string }>;
let addStatus = 200;
const take = (index: number, saved = false) => ({ job_id: `mus-${index}`, index, total: 3, state: "done", file_id: `file-${index}`, src: `/api/files/file-${index}/content`, saved, loop: false, seconds: 3 });
beforeEach(() => {
  calls = []; addStatus = 200; baseFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, method: init?.method ?? "GET", body: String(init?.body ?? "") });
    if (url.startsWith("/api/music/sounds/takes/")) return Promise.resolve(Response.json([take(0), take(1), take(2)]));
    if (url.endsWith("/add-to-song")) return Promise.resolve(addStatus === 200 ? Response.json({ id: "mus-song" }) : Response.json({ error: "Pick a start time before the end of the song." }, { status: 422 }));
    return Promise.resolve(Response.json({ id: "x", deleted: 1, trash_until: null }));
  }) as typeof fetch;
});
afterEach(() => { cleanup(); globalThis.fetch = baseFetch; });
const songs = [{ id: "mus-song", title: "Neon Rain", state: "done" }] as unknown as MusicCard[];

describe("SoundTakes", () => {
  test("shows every take and Keep this one saves it and deletes the others", async () => {
    const view = renderWithQueryClient(<ToastProvider><SoundTakes group="snd-abc123def456" onChanged={() => {}} /></ToastProvider>);
    expect((await view.findAllByText("Take 1")).length).toBeGreaterThan(0);
    expect(view.getAllByText("Take 3").length).toBeGreaterThan(0);
    fireEvent.click(view.getAllByRole("button", { name: "Keep this one" })[1]!);
    await waitFor(() => expect(calls.filter(call => call.url.endsWith("/delete")).map(call => call.url).sort()).toEqual(["/api/music/jobs/mus-0/delete", "/api/music/jobs/mus-2/delete"]));
    expect(calls.some(call => call.url === "/api/music/sounds/mus-1/save" && call.method === "POST")).toBe(true);
  });
  test("Delete removes only that take", async () => {
    const view = renderWithQueryClient(<ToastProvider><SoundTakes group="snd-abc123def456" onChanged={() => {}} /></ToastProvider>);
    await view.findAllByText("Take 1");
    fireEvent.click(view.getAllByRole("button", { name: "Delete" })[2]!);
    await waitFor(() => expect(calls.filter(call => call.url.endsWith("/delete")).map(call => call.url)).toEqual(["/api/music/jobs/mus-2/delete"]));
  });
});

describe("AddSoundToSong", () => {
  test("says there is nothing to add to when no song is finished", async () => {
    const view = renderWithQueryClient(<ToastProvider><AddSoundToSong jobId="mus-9" open onOpenChange={() => {}} songs={[]} onAdded={() => {}} /></ToastProvider>);
    expect(await view.findByText("You have no finished songs yet. Make a song first, then add the sound to it.")).toBeTruthy();
  });
  test("keeps Add off until a song is chosen, and shows the plain refusal when Home says no", async () => {
    addStatus = 422;
    const view = renderWithQueryClient(<ToastProvider><AddSoundToSong jobId="mus-9" open onOpenChange={() => {}} songs={songs} onAdded={() => {}} /></ToastProvider>);
    const button = await view.findByRole("button", { name: "Add to the song" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(view.getByLabelText("Starts at (seconds)")).toBeTruthy();
  });
});
