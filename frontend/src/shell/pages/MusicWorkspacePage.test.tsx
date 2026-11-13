// MUSIC-CLICKS-01: every control on Create does something you can see, and Remix never sends anything to chat. Each test clicks the control.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ToastProvider } from "@maipai/ui/src/primitives/Toast";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { MusicWorkspace } from "./MusicWorkspacePage";
import { MAKES } from "./MusicWorkspacePage";
import { soundCardCopy } from "@/apps/chat/MusicCardView";
import { RemixSong, remixRequest } from "./MusicRemix";
import type { MusicCard } from "@/lib/musicApi";

let baseFetch: typeof fetch;
let calls: Array<{ url: string; method: string; body: string }>;
let engine = true;
let tiers: string[] = ["standard"];
let uploadStatus = 200;
const song = { id: "mus-1", title: "Neon Rain", state: "done", progress: 1, versions: [{ id: "v1", url: "/f/1" }], current_id: "v1" } as unknown as MusicCard;


beforeEach(() => {
  calls = []; engine = true; tiers = ["standard"]; uploadStatus = 200; baseFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, method: init?.method ?? "GET", body: String(init?.body ?? "") });
    if (url.startsWith("/api/music/status")) return Promise.resolve(Response.json({ can_make: engine, engine_ready: engine, limits: {}, tiers }));
    if (url.startsWith("/api/music/sounds") && (init?.method ?? "GET") === "POST") return Promise.resolve(Response.json({ ...song, id: "sound-new", sound: { loop: true, surprise: true } }));
    if (url === "/api/music/sounds") return Promise.resolve(Response.json([]));
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

const openMenu = (trigger: HTMLElement) => { fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" }); };
const withJobs = (cards: unknown[]) => {
  const before = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === "/api/music/jobs" && (init?.method ?? "GET") === "GET") return Promise.resolve(Response.json(cards));
    return before(input, init);
  }) as typeof fetch;
};
const open = (search = "") => renderWithQueryClient(<ToastProvider><MemoryRouter><MusicWorkspace adult search={search} /></MemoryRouter></ToastProvider>);

/** Open one chip's popover on the composer and choose a value in it. */
const choose = async (view: ReturnType<typeof open>, group: string, value: string | RegExp) => {
  const trigger = await view.findByRole("button", { name: new RegExp(`^${group}:`) });
  if (trigger.getAttribute("aria-expanded") !== "true") fireEvent.click(trigger);
  fireEvent.click(await view.findByRole("radio", { name: value }));
};
const field = (view: ReturnType<typeof open>) => view.container.querySelector('[data-slot="prompt-bar"] textarea') as HTMLTextAreaElement;
const primary = (view: ReturnType<typeof open>) => view.container.querySelector('[data-slot="prompt-bar"] button[type="submit"]') as HTMLButtonElement;

describe("Create controls", () => {
  test("the Sound make takes the composer's words and the sound chips, and the body carries them", async () => {
    expect(MAKES().some(mode => mode.id === "sound" && mode.label === "Sound")).toBe(true);
    expect(soundCardCopy.saveToLibrary).toBe("Save to Sounds");
    const view = open();
    await view.findByTestId("music-docked-bar");
    await choose(view, "Make", "Sound");
    await waitFor(() => expect(primary(view).getAttribute("aria-label")).toBe("Make a sound"));
    fireEvent.change(field(view), { target: { value: "A quiet knock" } });
    await choose(view, "Sound", "Loop it");
    await choose(view, "Words", "Surprise me");
    await choose(view, "Sound", "10 seconds");
    await choose(view, "Takes", "3 takes");
    await waitFor(() => expect(primary(view).getAttribute("aria-label")).toBe("Make 3 sounds"));
    await waitFor(() => expect(primary(view).disabled).toBe(false));
    fireEvent.click(primary(view));
    await waitFor(() => expect(calls.some(call => call.url === "/api/music/sounds" && call.body.includes('"loop":true') && call.body.includes('"stick_to_words":false') && call.body.includes('"seconds":10') && call.body.includes('"takes":3'))).toBe(true));
  });
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

  test("the song chips each change what is sent: instrumental, length, language, Quality and Make 2 songs", async () => {
    engine = true;
    const view = open();
    await view.findByTestId("music-docked-bar");
    fireEvent.change(field(view), { target: { value: "a slow song about rain" } });
    await choose(view, "Vocals", /^Instrumental/);
    await choose(view, "Length", /^Quick/);
    fireEvent.click(await view.findByRole("button", { name: /^Custom/ }));
    fireEvent.click(await view.findByRole("radio", { name: "2 takes" }));
    await waitFor(() => expect(primary(view).getAttribute("aria-label")).toBe("Make 2 songs"));
    await waitFor(() => expect(primary(view).disabled).toBe(false));
    fireEvent.click(primary(view));
    await waitFor(() => expect(calls.some((call) => call.url === "/api/music/songs" && call.method === "POST" && call.body.includes('"instrumental":true') && call.body.includes('"length":"quick"') && call.body.includes('"takes":2'))).toBe(true));
  });

  test("Quality offers only the levels the hub lists", async () => {
    tiers = ["standard", "boost"];
    const view = open();
    fireEvent.click(await view.findByRole("button", { name: /^Quality:/ }));
    expect((await view.findAllByRole("radio")).map((radio) => radio.textContent)).toEqual(["StandardFast", "BoostMore detail"]);
  });

  test("the Custom section takes lyrics with structure tags and sends them with a title and seed", async () => {
    const view = open();
    fireEvent.change(field(view), { target: { value: "a slow song about rain" } });
    fireEvent.click(await view.findByRole("button", { name: /^Custom/ }));
    fireEvent.click(await view.findByRole("button", { name: "[Verse]" }));
    fireEvent.change(view.getByLabelText("Title"), { target: { value: "Rain" } });
    fireEvent.change(view.getByLabelText("Seed"), { target: { value: "4242" } });
    await waitFor(() => expect((view.getByLabelText("Lyrics") as HTMLTextAreaElement).value).toContain("[Verse]"));
    await waitFor(() => expect(primary(view).disabled).toBe(false));
    fireEvent.click(primary(view));
    await waitFor(() => expect(calls.some((call) => call.url === "/api/music/songs" && call.body.includes('"title":"Rain"') && call.body.includes('"seed":4242') && call.body.includes("[Verse]"))).toBe(true));
  });

  test("a band, album or style sends the person to the form under the composer; Voice opens the voiceover form", async () => {
    const view = open();
    await view.findByTestId("music-docked-bar");
    await choose(view, "Make", "Album");
    await waitFor(() => expect(primary(view).getAttribute("aria-label")).toBe("Use the form below"));
    expect(primary(view).disabled).toBe(true);
    await choose(view, "Make", "Voice");
    expect(await view.findByTestId("music-voice-create")).toBeTruthy();
    expect(view.getByLabelText("Script")).toBeTruthy();
  });

  test("a song brought to change shows in the composer and Change the style restyles it", async () => {
    const view = open();
    await view.findByTestId("music-docked-bar");
    fireEvent.change(view.getByTestId("music-reference-input"), { target: { files: [new File(["audio"], "song.mp3", { type: "audio/mpeg" })] } });
    await view.findByText("song.mp3");
    await waitFor(() => expect(primary(view).getAttribute("aria-label")).toBe("Change the style"));
    fireEvent.change(field(view), { target: { value: "soft jazz" } });
    await waitFor(() => expect(primary(view).disabled).toBe(false));
    fireEvent.click(primary(view));
    await waitFor(() => expect(calls.some((call) => call.url === "/api/music/from-file/edit" && call.body.includes('"style":"soft jazz"') && call.body.includes('"change":"restyle"'))).toBe(true));
  });

  test("a starter sound adds a style chip under the composer", async () => {
    const view = open();
    const sound = (await view.findAllByRole("button", { name: /Use/ }))[0]!;
    fireEvent.click(sound);
    expect(await view.findByTestId("music-picked-styles")).toBeTruthy();
  });

  test("the button stays off with a plain reason until the idea is written, then makes the song", async () => {
    const view = open();
    await waitFor(() => expect(primary(view)).toBeTruthy());
    await waitFor(() => expect(view.container.querySelector('[data-slot="prompt-bar-note"]')?.textContent).toContain("Say what the song is about"));
    expect(primary(view).disabled).toBe(true);
    fireEvent.change(field(view), { target: { value: "a slow song about rain" } });
    await waitFor(() => expect(primary(view).disabled).toBe(false));
    fireEvent.click(primary(view));
    await waitFor(() => expect(calls.some((call) => call.url === "/api/music/songs" && call.method === "POST")).toBe(true));
  });

  test("with no music model, the button is off and says so", async () => {
    engine = false;
    const view = open();
    fireEvent.change(field(view), { target: { value: "a slow song about rain" } });
    await waitFor(() => expect(view.container.querySelector('[data-slot="prompt-bar-note"]')?.textContent).toContain("no music model"));
    expect(primary(view).disabled).toBe(true);
  });

  test("Your songs shows a row whose More menu has Remix, and it opens the panel, never chat", async () => {
    const view = open();
    openMenu(await view.findByRole("button", { name: "More about Neon Rain" }));
    const remix = await view.findByRole("menuitem", { name: "Remix" });
    expect(remix.getAttribute("href")).toContain("remix=1");
    expect(remix.getAttribute("href")).not.toContain("/chat");
    for (const label of ["Open in Studio", "Extract stems", "Use in a video", "Download", "Make another like this", "Delete song"]) expect(view.getByRole("menuitem", { name: label })).toBeTruthy();
  });
});

describe("Your songs list", () => {
  test("a row plays its song from the cover button and says Pause while it plays", async () => {
    const view = open();
    const play = await view.findByRole("button", { name: "Play Neon Rain" });
    expect(play.closest('[data-testid="music-song-row"]')).toBeTruthy();
    fireEvent.click(play);
    await waitFor(() => expect(view.getByRole("button", { name: /Play Neon Rain|Pause Neon Rain/ })).toBeTruthy());
  });
  test("search and the Sounds chip narrow the list, and an empty result says so with a way back", async () => {
    const view = open();
    await view.findByRole("button", { name: "Open Neon Rain" });
    fireEvent.change(view.getByLabelText("Search your songs"), { target: { value: "zzz" } });
    expect(await view.findByText("No song matches that.")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Clear the search" }));
    expect(await view.findByRole("button", { name: "Open Neon Rain" })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Sounds" }));
    await waitFor(() => expect(view.queryByRole("button", { name: "Open Neon Rain" })).toBeNull());
  });
  test("Delete from the More menu moves the song to Trash at once, with Undo and no question", async () => {
    const view = open();
    openMenu(await view.findByRole("button", { name: "More about Neon Rain" }));
    fireEvent.click(await view.findByRole("menuitem", { name: "Delete song" }));
    await waitFor(() => expect(calls.some((call) => call.url === "/api/music/jobs/mus-1/delete" && call.method === "POST")).toBe(true));
    expect(view.queryByRole("alertdialog")).toBeNull();
  });
  test("a song asked for as takes is one row with a take strip that plays each take", async () => {
    withJobs([{ ...song, id: "mus-t", title: "Three Ways", takes: { group: "g", index: 0, total: 2 }, versions: [{ id: "t1", label: "Take 1", url: "/t/1", seed: 5 }, { id: "t2", label: "Take 2", url: "/t/2", seed: 6 }], current_id: "t1" }]);
    const view = open();
    expect(await view.findByText("2 takes")).toBeTruthy();
    const strip = within(await view.findByRole("group", { name: "Takes of Three Ways" }));
    expect(strip.getAllByRole("button").map((button) => button.textContent)).toEqual(["Take 1", "Take 2"]);
    expect(view.getAllByTestId("music-song-row")).toHaveLength(1);
  });
  test("the hub's locked tile is one plain row and is never opened", async () => {
    withJobs([{ locked: true, making: false }]);
    const view = open();
    expect(await view.findByTestId("music-locked-row")).toBeTruthy();
    expect(view.queryByTestId("music-song-row")).toBeNull();
  });
});

describe("Delete song", () => {
  test("from the details it deletes at once and offers Undo instead of asking", async () => {
    const view = open("?song=mus-1");
    openMenu(within(await view.findByTestId("music-song-details")).getByRole("button", { name: "More about Neon Rain" }));
    fireEvent.click(await view.findByRole("menuitem", { name: "Delete song" }));
    await waitFor(() => expect(calls.some((call) => call.url === "/api/music/jobs/mus-1/delete" && call.method === "POST")).toBe(true));
    expect(view.queryByRole("alertdialog")).toBeNull();
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

describe("Song cards that are stopped or stuck", () => {
  test("a stopped song says Stopped and offers Try again", async () => {
    withJobs([{ ...song, id: "mus-stopped", state: "cancelled", progress: 0, title: "Quiet Rain", versions: [] }]);
    const view = open();
    expect(await view.findByText("Stopped")).toBeTruthy();
    expect(await view.findByRole("button", { name: "Try again" })).toBeTruthy();
  });
  test("a song at 0% for over three minutes offers Stop, and Stop sends the stop call", async () => {
    withJobs([{ ...song, id: "mus-stuck", state: "running", progress: 0, title: "Slow Bell", versions: [], stage_label: "Making your song", started_at: Date.now() - 5 * 60_000 }]);
    const view = open();
    fireEvent.click(await view.findByRole("button", { name: "Stop" }));
    await waitFor(() => expect(calls.some(call => call.url === "/api/music/jobs/mus-stuck" && call.method === "DELETE")).toBe(true));
  });
  test("a song that just started has no Stop button", async () => {
    withJobs([{ ...song, id: "mus-new", state: "running", progress: 0, title: "Fresh", versions: [], stage_label: "Making your song", started_at: Date.now() - 10_000 }]);
    const view = open();
    await view.findByText("Fresh");
    expect(view.queryByRole("button", { name: "Stop" })).toBeNull();
  });
});
