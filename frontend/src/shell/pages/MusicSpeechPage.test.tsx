import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MusicSpeechPage } from "./MusicSpeechPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";

let originalFetch: typeof fetch;
let calls: Array<{ url: string; method: string; body: string }>;

beforeEach(() => {
  calls = [];
  originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, method: init?.method ?? "GET", body: String(init?.body ?? "") });
    if (url === "/api/voiceover/options") return Promise.resolve(Response.json({ voices: [{ id: "preset-a", label: "Preset A", kind: "preset", engine: "fish-audio-drama-3", tags: ["whispers"] }] }));
    if (url === "/api/music/speeches" && init?.method === "POST") return Promise.resolve(Response.json({ id: "speech-1" }));
    if (url === "/api/music/speeches") return Promise.resolve(Response.json([]));
    return Promise.resolve(Response.json({}));
  }) as typeof fetch;
});
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; });

describe("MusicSpeechPage", () => {
  test("submits the script, selected preset and delivery description", async () => {
    const view = renderWithQueryClient(<MusicSpeechPage />);
    fireEvent.change(await view.findByLabelText("Script"), { target: { value: "Welcome home." } });
    fireEvent.change(view.getByLabelText("Delivery"), { target: { value: "whisper softly" } });
    fireEvent.click(view.getByRole("button", { name: "Make speech" }));
    await waitFor(() => expect(calls.some((call) => call.url === "/api/music/speeches" && call.method === "POST")).toBe(true));
    expect(JSON.parse(calls.find((call) => call.url === "/api/music/speeches" && call.method === "POST")!.body)).toEqual({ script: "Welcome home.", voice: "preset-a", delivery: "whisper softly" });
  });
});
