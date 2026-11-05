// MUSIC-CLICKS-01: every control on Create does something you can see, and Remix never sends anything to chat. Each test clicks the control.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ToastProvider } from "@maipai/ui/src/primitives/Toast";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { MusicWorkspace } from "./MusicWorkspacePage";
import { RemixSong, remixRequest } from "./MusicRemix";
import type { MusicCard } from "@/lib/musicApi";

let baseFetch: typeof fetch;
let calls: Array<{ url: string; method: string; body: string }>;
let engine = true;
let uploadStatus = 200;
const song = { id: "mus-1", title: "Neon Rain", state: "done", progress: 1, versions: [{ id: "v1", url: "/f/1" }], current_id: "v1" } as unknown as MusicCard;

beforeEach(() => {
  calls = []; engine = true; uploadStatus = 200; baseFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, method: init?.method ?? "GET", body: String(init?.body ?? "") });
    if (url.startsWith("/api/music/status")) return Promise.resolve(Response.json({ can_make: engine, engine_ready: engine, limits: {} }));
    if (url === "/api/library/upload") return Promise.resolve(new Response(JSON.stringify(uploadStatus === 200 ? { id: "file-audio", name: "song.mp3", kind: "audio", media_type: "audio/mpeg", size_bytes: 5, duplicate: false } : { error: "plain upload refusal" }), { status: uploadStatus === 200 ? 201 : uploadStatus }));
    if (url === "/api/music/from-file/edit") return Promise.resolve(Response.json({ ...song, id: "mus-upload-edit" }));
    if (url.startsWith("/api/music/songs")) return Promise.resolve(Response.json({ ...song, id: "mus-new" }));
    if (url.includes("/revise")) return Promise.resolve(Response.json({ ...song, id: "mus-rev" }));
    if (url.endsWith("/delete")) return Promise.resolve(Response.json({ deleted: 1, trash_until: null }));
    if (url.startsWith("/api/music/jobs/mus-1")) return Promise.resolve(Response.json(song));
    if (url.startsWith("/api/music/jobs")) return Promise.resolve(Response.json([song]));
    return Promise.resolve(Response.json({}));
  }) as typeof fetch;
});
afterEach(() => { cleanup(); globalThis.fetch = baseFetch; });

const open = (search = "") => renderWithQueryClient(<ToastProvider><MemoryRouter><MusicWorkspace adult search={search} /></MemoryRouter></ToastProvider>);

describe("Create controls", () => {
  test("adult Edit surface uploads a Library file and offers the supported actions", async () => {
    const view = open("?song=mus-1");
    const input = view.container.querySelector('[data-testid="bring-song"] input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File(["audio"], "song.mp3", { type: "audio/mpeg" })] } });
    await view.findByText("song.mp3");
    expect(view.getByLabelText("How should it sound?")).toBeTruthy();
    expect(view.getByRole("button", { name: "Change the style" }).hasAttribute("disabled")).toBe(true);
    for (const label of ["Change the style", "Remove the vocals", "Split into stems"]) expect(view.getByRole("button", { name: label })).toBeTruthy();
    fireEvent.change(view.getByLabelText("How should it sound?"), { target: { value: "soft jazz" } });
    fireEvent.click(view.getByRole("button", { name: "Change the style" }));
    await waitFor(() => expect(calls.some((call) => call.url === "/api/library/upload" && call.method === "POST")).toBe(true));
    await waitFor(() => expect(calls.some((call) => call.url === "/api/music/from-file/edit" && call.body.includes('"style":"soft jazz"'))).toBe(true));
    fireEvent.click(view.getByRole("button", { name: "Remove the vocals" }));
    await waitFor(() => expect(calls.some((call) => call.url === "/api/music/from-file/edit" && call.body.includes('"parts":{"drop":["vocals"]}'))).toBe(true));
  });

  test("rejects upload errors with a plain supported-file line", async () => {
    uploadStatus = 422;
    const view = open("?song=mus-1");
    fireEvent.change(view.container.querySelector('[data-testid="bring-song"] input[type="file"]')!, { target: { files: [new File(["bad"], "song.txt", { type: "text/plain" })] } });
    expect(await view.findByText("Add one audio file under 40 MB: mp3, m4a, wav, aac, ogg or flac.")).toBeTruthy();
    expect(view.queryByText("plain upload refusal")).toBeNull();
  });

  test("mode, lyrics, instrumental, length and styles chips each change state", async () => {
    const view = open();
    const bar = within(await view.findByTestId("music-docked-bar"));
    for (const name of ["Lyrics", "Instrumental", "Quick", "Full"]) {
      const chip = bar.getByRole("button", { name });
      fireEvent.click(chip);
      await waitFor(() => expect(bar.getByRole("button", { name }).getAttribute("aria-pressed")).toBe("true"));
    }
    fireEvent.click(bar.getByRole("button", { name: "Styles" }));
    const panel = within(await view.findByTestId("music-styles-panel"));
    fireEvent.click(panel.getAllByRole("button")[0]!);
    await waitFor(() => expect(bar.getByRole("button", { name: "Styles (1)" })).toBeTruthy());
    fireEvent.click(bar.getByRole("button", { name: "Album" }));
    await waitFor(() => expect(bar.getByRole("button", { name: "Album" }).getAttribute("aria-pressed")).toBe("true"));
  });

  test("a starter sound adds a style and opens the styles panel", async () => {
    const view = open();
    const sound = (await view.findAllByRole("button", { name: /Use/ }))[0]!;
    fireEvent.click(sound);
    expect(await view.findByTestId("music-styles-panel")).toBeTruthy();
    expect(view.getByRole("button", { name: "Styles (1)" })).toBeTruthy();
  });

  test("Generate stays off with a plain reason until the idea is written, then makes the song", async () => {
    const view = open();
    const generate = await view.findByRole("button", { name: "Generate" }) as HTMLButtonElement;
    await waitFor(() => expect(view.getByTestId("music-hint").textContent).toContain("Say what the song is about"));
    expect(generate.getAttribute("aria-disabled")).toBe("true");
    fireEvent.change(view.getByLabelText("Describe your song"), { target: { value: "a slow song about rain" } });
    await waitFor(() => expect((view.getByRole("button", { name: "Generate" }) as HTMLButtonElement).getAttribute("aria-disabled")).toBe("false"));
    fireEvent.click(view.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(calls.some((call) => call.url === "/api/music/songs" && call.method === "POST")).toBe(true));
  });

  test("with no music model, Generate is off and says so", async () => {
    engine = false;
    const view = open();
    fireEvent.change(await view.findByLabelText("Describe your song"), { target: { value: "a slow song about rain" } });
    expect(await view.findByTestId("music-no-engine")).toBeTruthy();
    expect(view.getByRole("button", { name: "Generate" }).getAttribute("aria-disabled")).toBe("true");
  });

  test("Your songs shows a tile with a Remix action that opens the panel, never chat", async () => {
    const view = open();
    const remix = await view.findByRole("link", { name: "Remix" });
    expect(remix.getAttribute("href")).toContain("remix=1");
    expect(remix.getAttribute("href")).not.toContain("/chat");
  });
});

describe("Delete song", () => {
  test("asks in a modal dialog first, and only the confirm button deletes", async () => {
    const view = open("?song=mus-1");
    fireEvent.click(await view.findByRole("button", { name: "Delete song" }));
    const dialog = await view.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Neon Rain");
    expect(calls.some((call) => call.url.endsWith("/delete"))).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep it" }));
    await waitFor(() => expect(view.queryByRole("alertdialog")).toBeNull());
    expect(calls.some((call) => call.url.endsWith("/delete"))).toBe(false);
    fireEvent.click(view.getByRole("button", { name: "Delete song" }));
    fireEvent.click(within(await view.findByRole("alertdialog")).getByRole("button", { name: "Delete song" }));
    await waitFor(() => expect(calls.some((call) => call.url === "/api/music/jobs/mus-1/delete" && call.method === "POST")).toBe(true));
  });
});

describe("Remix panel", () => {
  test("builds the request, shows it for review, and only the confirm button sends it", async () => {
    let closed = false;
    const view = renderWithQueryClient(<ToastProvider><RemixSong card={song} onClose={() => { closed = true; }} /></ToastProvider>);
    expect((view.getByRole("button", { name: "Review the remix" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(view.getByLabelText("Style"), { target: { value: "slower, acoustic" } });
    fireEvent.click(view.getByRole("button", { name: "Female voice" }));
    fireEvent.click(view.getByRole("button", { name: "Review the remix" }));
    expect((await view.findByTestId("music-remix-review")).textContent).toContain("slower, acoustic");
    expect(calls.some((call) => call.url.includes("/revise"))).toBe(false);
    fireEvent.click(view.getByRole("button", { name: "Make the remix" }));
    await waitFor(() => expect(calls.some((call) => call.url.includes("/api/music/jobs/mus-1/revise") && call.method === "POST")).toBe(true));
    await waitFor(() => expect(closed).toBe(true));
  });

  test("remixRequest is empty until something is filled in", () => {
    expect(remixRequest({ style: "", lyrics: "", tempo: "", voice: "" })).toBe("");
    expect(remixRequest({ style: "jazz", lyrics: "", tempo: "90", voice: "" })).toContain("90 BPM");
  });
});
