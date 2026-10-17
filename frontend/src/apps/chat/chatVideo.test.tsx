// VIDEO-GEN-06: the video card in chat. The turn names the job; the card polls Home and draws the kit's VideoPlayer:
// a progress card with the elapsed clock and Stop while the clip is made, then the clip with poster, loop and the
// actions, or a plain failure with Try again. The calls go to /api/videos only.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { VideoToolRender } from "@/apps/chat/chatToolUis";
import type { VideoCard, VideoItem } from "@/lib/videosApi";

afterEach(cleanup);
const realFetch = globalThis.fetch;
let calls: Array<{ url: string; method: string }>;
let card: VideoCard;

function item(over: Partial<VideoItem>): VideoItem {
  return { id: "vid-1", state: "running", percent: 40, label: "Drawing the frames", position: null, started_at: Date.now() - 30_000, prompt: "a paper boat in the rain", kind: "generate", error: null, clip: null, ...over };
}
beforeEach(() => {
  calls = [];
  card = { id: "vid-1", conversation_id: "conv-1", items: [item({})], can_make_another: false, limits: "Videos are 5 seconds at 480p and take about 2 minutes." };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, method: init?.method ?? "GET" });
    return new Response(JSON.stringify(card), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Render = VideoToolRender as unknown as (props: { result: { id: string } }) => React.ReactElement;
  return render(<QueryClientProvider client={client}><MemoryRouter><Render result={{ id: "vid-1" }} /></MemoryRouter></QueryClientProvider>);
}

describe("VideoToolRender", () => {
  test("while the clip is made it shows the step, the clock, the plain limits and Stop, and Stop calls the cancel route", async () => {
    const view = mount();
    await waitFor(() => expect(view.getByRole("status").textContent).toContain("Drawing the frames"));
    expect(view.container.textContent).toContain("Videos are 5 seconds at 480p and take about 2 minutes.");
    expect(view.container.textContent).toMatch(/0:3\d/);
    fireEvent.click(view.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url === "/api/videos/jobs/vid-1/cancel")).toBe(true));
  });

  test("a queued clip shows the busy line from the engine", async () => {
    card.items = [item({ state: "queued", label: "Home is busy making another picture or video. It will start in a minute.", position: 2 })];
    const view = mount();
    await waitFor(() => expect(view.getByRole("status").textContent).toContain("Place in line: 2"));
  });

  test("a finished clip plays in the kit player with its poster, loops, and offers Download, Share and Make another", async () => {
    card = { ...card, can_make_another: true, items: [item({ state: "done", percent: 100, label: "", clip: { url: "/api/videos/jobs/vid-1/files/file-a", poster_url: "/api/videos/jobs/vid-1/files/file-b", width: 832, height: 480, seconds: 5, seed: 7, file_id: "file-a", poster_file_id: "file-b" } })] };
    const view = mount();
    await waitFor(() => expect(view.container.querySelector("video")).not.toBeNull());
    const video = view.container.querySelector("video")!;
    expect(video.getAttribute("src")).toBe("/api/videos/jobs/vid-1/files/file-a");
    expect(video.getAttribute("poster")).toBe("/api/videos/jobs/vid-1/files/file-b");
    expect(video.loop).toBe(true);
    expect(view.getByRole("button", { name: "Download" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Share" })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Make another" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url === "/api/videos/jobs/vid-1/another")).toBe(true));
  });

  test("a failed clip shows the engine's plain line and Try again, never a player", async () => {
    card = { ...card, can_make_another: true, items: [item({ state: "failed", error: "I couldn't make that video. This computer doesn't have enough free memory for a video right now. Try again in a few minutes." })] };
    const view = mount();
    await waitFor(() => expect(view.getByRole("alert").textContent).toContain("I couldn't make that video."));
    expect(view.container.querySelector("video")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/videos/jobs/vid-1/another")).toBe(true));
  });
});
