import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { VoiceCreate } from "./MusicVoiceCreate";

let baseFetch: typeof fetch;
let calls: Array<{ url: string; method: string; body: string }>;
let available = true;
let postStatus = 200;
let changeStatus = 200;
const voices = [
  { id: "fish", label: "Recorded voice", kind: "preset", engine: "fish-audio-drama-3", tags: ["sighs", "whispers"] },
  { id: "chat", label: "Standard voice", kind: "preset", engine: "chatterbox-turbo", tags: ["laughs"] },
  { id: "plain", label: "Plain voice", kind: "preset", engine: "chatterbox-turbo", tags: [] },
];

beforeEach(() => {
  calls = []; available = true; postStatus = 200; changeStatus = 200; baseFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, method: init?.method ?? "GET", body: String(init?.body ?? "") });
    if (url === "/api/voiceover/options") return Promise.resolve(Response.json({ voices }));
    if (url === "/api/health") return Promise.resolve(Response.json({ engines: { voice: available ? { availability: "ready" } : { kind: "failed", alive: false } } }));
    if (url === "/api/voiceover") return Promise.resolve(new Response(JSON.stringify(postStatus === 200 ? { file_id: "voice-file", seconds: 4.2, engine: "fish-audio-drama-3", voice: "fish", kind: "preset" } : { error: "That script could not be spoken." }), { status: postStatus }));
    if (url === "/api/library/upload") return Promise.resolve(Response.json({ id: "source-file", name: "clip.mp4" }));
    if (url === "/api/voiceover/change") return Promise.resolve(new Response(JSON.stringify(changeStatus === 200 ? { file_id: "changed-file", kind_of_source: "video", seconds: 8, spoken_seconds: 9.2, source_seconds: 8, difference_seconds: 1.2, engine: "fish-audio-drama-3", voice: "fish", kind: "preset" } : { error: "That file could not be changed." }), { status: changeStatus }));
    return Promise.resolve(Response.json({}));
  }) as typeof fetch;
});
afterEach(() => { cleanup(); globalThis.fetch = baseFetch; });

const render = () => renderWithQueryClient(<MemoryRouter><VoiceCreate /></MemoryRouter>);

describe("Voice Create", () => {
  test("loads options and shows only the picked voice's tags; a chip inserts its tag", async () => {
    const view = render();
    const select = await view.findByRole("combobox", { name: "Voice" });
    expect(await view.findByRole("button", { name: "[sighs]" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "[laughs]" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "[sighs]" }));
    expect((view.getByLabelText("Script") as HTMLTextAreaElement).value).toBe("[sighs]");
    fireEvent.click(select);
    fireEvent.click(await view.findByRole("option", { name: "Standard voice" }));
    await waitFor(() => expect(view.getByRole("button", { name: "[laughs]" })).toBeTruthy());
    expect(view.queryByRole("button", { name: "[sighs]" })).toBeNull();
    expect((view.getByLabelText("Script") as HTMLTextAreaElement).value).toBe("[sighs]");
  });

  test("posts the script and voice, then shows the player, engine and Library link", async () => {
    const view = render();
    fireEvent.change(await view.findByLabelText("Script"), { target: { value: "Hello there." } });
    fireEvent.click(view.getByRole("button", { name: "Make voiceover" }));
    await waitFor(() => expect(calls.some((call) => call.url === "/api/voiceover" && call.method === "POST" && call.body === JSON.stringify({ script: "Hello there.", voice: "fish" }))).toBe(true));
    await waitFor(() => expect(view.container.querySelector('[data-slot="player"]')).toBeTruthy());
    expect(view.getByText("Spoken by the recorded voice engine")).toBeTruthy();
    expect(view.getByRole("link", { name: "Open in Library" }).getAttribute("href")).toBe("/files?file=voice-file");
  });

  test("shows the API error line and disables Make for an empty script", async () => {
    postStatus = 422;
    const view = render();
    const button = await view.findByRole("button", { name: "Make voiceover" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(await view.findByLabelText("Script"), { target: { value: "Hello." } });
    fireEvent.click(button);
    expect(await view.findByRole("alert")).toHaveTextContent("Home could not make that voiceover. Try again.");
  });

  test("a voice with no tags has no chip row", async () => {
    const view = render();
    fireEvent.click(await view.findByRole("combobox", { name: "Voice" }));
    fireEvent.click(await view.findByRole("option", { name: "Plain voice" }));
    await waitFor(() => expect(view.queryByRole("group", { name: "Voice tags" })).toBeNull());
  });

  test("shows the voice unavailable reason and disables Make when voice is down", async () => {
    available = false;
    const view = render();
    fireEvent.change(await view.findByLabelText("Script"), { target: { value: "Hello." } });
    expect(await view.findByText("Home can't speak right now. Try again in a minute.")).toBeTruthy();
    expect((view.getByRole("button", { name: "Make voiceover" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("switch shows both modes and has no Translate option", async () => {
    const view = render();
    expect(await view.findByRole("radio", { name: "Voiceover" })).toBeTruthy();
    expect(view.getByRole("radio", { name: "Change voice" })).toBeTruthy();
    expect(view.queryByText("Translate")).toBeNull();
    fireEvent.click(view.getByRole("radio", { name: "Change voice" }));
    expect(await view.findByText("Choose an audio or video file or drop it here")).toBeTruthy();
    expect(view.queryByRole("group", { name: "Voice tags" })).toBeNull();
  });

  test("uploads then posts file id and voice, and shows video result and duration line", async () => {
    const view = render();
    fireEvent.click(await view.findByRole("radio", { name: "Change voice" }));
    const picker = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(picker, { target: { files: [new File(["clip"], "clip.mp4", { type: "video/mp4" })] } });
    expect(await view.findByText("clip.mp4")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Change voice" }));
    await waitFor(() => expect(calls.some((call) => call.url === "/api/voiceover/change" && call.method === "POST" && call.body === JSON.stringify({ file_id: "source-file", voice: "fish" }))).toBe(true));
    expect(await view.findByText("The new voice is 1 seconds longer than the video, so the end was cut.")).toBeTruthy();
    expect(view.container.querySelector("video[controls]")).toBeTruthy();
    expect(view.getByText("Spoken by the recorded voice engine")).toBeTruthy();
  });

  test("shows change error and disables action before choosing a file", async () => {
    changeStatus = 422;
    const view = render();
    fireEvent.click(await view.findByRole("radio", { name: "Change voice" }));
    const button = view.getByRole("button", { name: "Change voice" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const picker = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(picker, { target: { files: [new File(["clip"], "clip.mp4", { type: "video/mp4" })] } });
    await view.findByText("clip.mp4");
    fireEvent.click(button);
    expect(await view.findByRole("alert")).toHaveTextContent("Home could not change that voice. Try again.");
  });
});
