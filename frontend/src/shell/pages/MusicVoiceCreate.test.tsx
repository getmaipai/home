// The Voiceover mode's state and results. The mode itself (chips, tags, the file slot, the button) is driven through the composer in
// MusicWorkspacePage.test.tsx; this file holds the voice helpers and the failure lines.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { ToastProvider } from "@maipai/ui/src/primitives/Toast";
import { MusicWorkspace } from "./MusicWorkspacePage";
import { VoiceResults, tagsOf, withTag, type VoiceOption } from "./MusicVoiceCreate";

let baseFetch: typeof fetch;
let available = true;
let postStatus = 200;
const voices: VoiceOption[] = [
  { id: "fish", label: "Recorded voice", kind: "preset", engine: "fish-audio-drama-3", tags: ["sighs", "whispers"] },
  { id: "plain", label: "Plain voice", kind: "preset", engine: "chatterbox-turbo", tags: [] },
];
beforeEach(() => {
  available = true; postStatus = 200; baseFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === "/api/voiceover/options") return Promise.resolve(Response.json({ voices }));
    if (url === "/api/health") return Promise.resolve(Response.json({ engines: { voice: available ? { availability: "ready" } : { kind: "failed", alive: false } } }));
    if (url === "/api/voiceover") return Promise.resolve(new Response(JSON.stringify({ error: "That script could not be spoken." }), { status: postStatus }));
    if (url === "/api/music/status") return Promise.resolve(Response.json({ can_make: true, engine_ready: true, limits: {}, tiers: ["standard"] }));
    return Promise.resolve(Response.json(url.endsWith("/sounds") || url.endsWith("/jobs") ? [] : {}));
  }) as typeof fetch;
});
afterEach(() => { cleanup(); globalThis.fetch = baseFetch; });

const open = () => renderWithQueryClient(<ToastProvider><MemoryRouter><MusicWorkspace adult search="?make=voice" /></MemoryRouter></ToastProvider>);
const field = (view: ReturnType<typeof open>) => view.container.querySelector('[data-slot="prompt-bar"] textarea') as HTMLTextAreaElement;
const primary = (view: ReturnType<typeof open>) => view.container.querySelector('[data-slot="prompt-bar"] button[type="submit"]') as HTMLButtonElement;

describe("the voice helpers", () => {
  test("tags are the picked voice's own, and a tag goes after the script with one space", () => {
    expect(tagsOf(voices, "fish")).toEqual(["sighs", "whispers"]);
    expect(tagsOf(voices, "plain")).toEqual([]);
    expect(tagsOf(voices, "missing")).toEqual(["sighs", "whispers"]);
    expect(withTag("", "sighs")).toBe("[sighs]");
    expect(withTag("Hello", "sighs")).toBe("Hello [sighs]");
    expect(withTag("Hello ", "sighs")).toBe("Hello [sighs]");
  });
  test("results show a player, who spoke and a Library link; a difference line only past half a second", () => {
    const view = render(<MemoryRouter><VoiceResults results={[
      { operation: "voiceover", value: { key: 1, file_id: "a", seconds: 3, engine: "fish-audio-drama-3", voice: "fish", kind: "preset" } },
      { operation: "change", value: { key: 2, file_id: "b", kind_of_source: "audio", seconds: 8, spoken_seconds: 7, source_seconds: 8, difference_seconds: -1, engine: "chatterbox-turbo", voice: "plain", kind: "preset" } },
    ]} /></MemoryRouter>);
    expect(view.getByText("Spoken by the recorded voice engine")).toBeTruthy();
    expect(view.getByText("The new voice is 1 seconds shorter, so the end is quiet.")).toBeTruthy();
    expect(view.getAllByRole("link", { name: "Open in Library" })).toHaveLength(2);
  });
});

describe("the Voiceover mode's failures", () => {
  test("a failed request shows one plain line and the button waits for words", async () => {
    postStatus = 422;
    const view = open();
    await waitFor(() => expect(primary(view).getAttribute("aria-label")).toBe("Make voiceover"));
    expect(primary(view).disabled).toBe(true);
    fireEvent.change(field(view), { target: { value: "Hello." } });
    await waitFor(() => expect(primary(view).disabled).toBe(false));
    fireEvent.click(primary(view));
    expect(await view.findByText("Home could not make that voiceover. Try again.")).toBeTruthy();
  });
  test("with the voice engine down the button is off and says Home can't speak", async () => {
    available = false;
    const view = open();
    fireEvent.change(field(view), { target: { value: "Hello." } });
    expect(await view.findByText("Home can't speak right now. Try again in a minute.")).toBeTruthy();
    expect(primary(view).disabled).toBe(true);
  });
});
