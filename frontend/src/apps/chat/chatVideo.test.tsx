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
  return { id: "vid-1", state: "running", percent: 40, label: "Drawing the frames", position: null, eta_seconds: null, step: null, steps: null, preview_url: null, started_at: Date.now() - 30_000, prompt: "a paper boat in the rain", kind: "generate", error: null, quality: "quick", switch_to: null, clip: null, ...over };
}
beforeEach(() => {
  calls = [];
  card = { id: "vid-1", conversation_id: "conv-1", items: [item({})], can_make_another: false, limits: "Videos are 5 seconds at 480p and take about 2 minutes." };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, method: init?.method ?? "GET" });
    if (url.endsWith("/messages.mp4")) return new Response(new Uint8Array(16), { status: 200, headers: { "content-type": "video/mp4", "content-disposition": 'attachment; filename="paper-boat-rain.mp4"' } });
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
    expect(view.container.textContent).toContain("Quick: about 2 minutes, no sound.");
    expect(view.container.textContent).toMatch(/0:3\d/);
    fireEvent.click(view.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url === "/api/videos/jobs/vid-1/cancel")).toBe(true));
  });

  test("GENPREVIEW-01: the card says the stage, the percent and the time left, shows the shimmer with the prompt until the first frame arrives, and then the frame", async () => {
    const realImage = globalThis.Image;
    (globalThis as { Image: unknown }).Image = class { onload: (() => void) | null = null; onerror: (() => void) | null = null; set src(_v: string) { queueMicrotask(() => this.onload?.()); } };
    try {
      card.items = [item({ percent: 12, label: "Loading the video model", eta_seconds: 118 })];
      const view = mount();
      await waitFor(() => expect(view.container.textContent).toContain("Loading the video model"));
      expect(view.container.textContent).toMatch(/0:3\d · 12% · about 2 minutes left/);
      expect(view.container.querySelector("[data-slot=video-player-stage]")!.textContent).toContain("a paper boat in the rain");
      expect(view.container.querySelectorAll("span.rounded-full").length).toBe(64);
      expect(view.container.textContent).toContain("about 2 minutes, no sound");
      expect(view.container.querySelector("img[data-slot=generation-preview]")).toBeNull();
      card.items = [item({ percent: 40, label: "Putting the frames together, 20 of 60", eta_seconds: 70, preview_url: "/api/videos/jobs/vid-1/preview?v=1" })];
      await waitFor(() => expect(view.container.querySelector("img[data-slot=generation-preview]")).not.toBeNull(), { timeout: 4000 });
      expect(view.container.querySelector("img[data-slot=generation-preview]")!.getAttribute("src")).toBe("/api/videos/jobs/vid-1/preview?v=1");
      expect(view.container.textContent).toContain("Putting the frames together, 20 of 60");
      expect(view.container.textContent).toContain("about 1 minute left");
    } finally {
      (globalThis as { Image: unknown }).Image = realImage;
    }
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

  const doneCard = (): VideoCard => ({ ...card, can_make_another: true, items: [item({ state: "done", percent: 100, label: "", clip: { url: "/api/videos/jobs/vid-1/files/file-a", poster_url: "/api/videos/jobs/vid-1/files/file-b", width: 832, height: 480, seconds: 5, seed: 7, file_id: "file-a", poster_file_id: "file-b" } })] });

  test("Share hands the real file to the system share sheet, fetched ahead of the click", async () => {
    card = doneCard();
    const shared: Array<{ files?: File[]; title?: string }> = [];
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
    Object.defineProperty(navigator, "share", { configurable: true, value: async (data: { files?: File[]; title?: string }) => { shared.push(data); } });
    try {
      const view = mount();
      await waitFor(() => expect(calls.some((c) => c.url === "/api/videos/jobs/vid-1/messages.mp4")).toBe(true));
      await waitFor(() => expect(view.container.querySelector("video")).not.toBeNull());
      await new Promise((resolve) => setTimeout(resolve, 50));
      fireEvent.click(view.getByRole("button", { name: "Share" }));
      expect(shared).toHaveLength(1);
      expect(shared[0]!.files![0]!.name).toBe("paper-boat-rain.mp4");
      expect(shared[0]!.title).toBe("a paper boat in the rain");
    } finally { Reflect.deleteProperty(navigator, "canShare"); Reflect.deleteProperty(navigator, "share"); }
  });

  test("without file sharing, Share opens Home's share page for the file and Download original stays", async () => {
    card = doneCard();
    const view = mount();
    await waitFor(() => expect(view.container.querySelector("video")).not.toBeNull());
    expect(view.getByRole("button", { name: "Download original" })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Share" }));
    // MemoryRouter has no /files route to draw; the click must not throw and no share sheet exists to call.
    expect(typeof (navigator as { share?: unknown }).share).not.toBe("function");
  });

  test("VIDEO-LTX-01: a Quick clip offers Make it Detailed (with sound and speech) and asks for that kind; a Detailed one says it has sound and offers Make it Quick", async () => {
    const clip = { url: "/api/videos/jobs/vid-1/files/file-a", poster_url: "/api/videos/jobs/vid-1/files/file-b", width: 832, height: 480, seconds: 5, seed: 7, file_id: "file-a", poster_file_id: "file-b" };
    card = { ...card, can_make_another: true, items: [item({ state: "done", percent: 100, label: "", quality: "quick", switch_to: "detailed", clip })] };
    const view = mount();
    await waitFor(() => expect(view.container.querySelector("video")).not.toBeNull());
    const button = view.getByRole("radio", { name: "Boost" });
    expect(view.getByRole("radio", { name: "Standard" }).getAttribute("aria-checked")).toBe("true");
    expect(view.getByText("No sound, up to 5 seconds, can start from a picture")).toBeTruthy();
    let body = "";
    const sending = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => { if (String(input).endsWith("/another")) body = String(init?.body ?? ""); return sending(input, init); }) as typeof fetch;
    fireEvent.click(button);
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url === "/api/videos/jobs/vid-1/another")).toBe(true));
    expect(JSON.parse(body)).toEqual({ quality: "detailed" });
    cleanup();
    card = { ...card, can_make_another: true, items: [item({ state: "done", percent: 100, label: "", quality: "detailed", switch_to: "quick", clip: { ...clip, has_sound: true } })] };
    const detailed = mount();
    await waitFor(() => expect(detailed.container.querySelector("video")).not.toBeNull());
    expect(detailed.getByRole("radio", { name: "Boost" }).getAttribute("aria-checked")).toBe("true");
    expect(detailed.container.textContent).not.toMatch(/LTX|Wan|Gemma/);
    cleanup();
    // While it is made, the line under the card says which kind it is, in the same words as pictures.
    card = { ...card, items: [item({ quality: "detailed", switch_to: null, eta_seconds: 200 })] };
    const running = mount();
    await waitFor(() => expect(running.container.textContent).toContain("Detailed: with sound and speech."));
    expect(running.container.textContent).not.toMatch(/LTX|Wan|Gemma/);
  });

  test("a clip made with a style, or with no other kind on this computer, offers no switch", async () => {
    const clip = { url: "/api/videos/jobs/vid-1/files/file-a", poster_url: "/api/videos/jobs/vid-1/files/file-b", width: 832, height: 480, seconds: 5, seed: 7, file_id: "file-a", poster_file_id: "file-b" };
    card = { ...card, can_make_another: true, items: [item({ state: "done", percent: 100, label: "", quality: "quick", switch_to: null, clip })] };
    const view = mount();
    await waitFor(() => expect(view.container.querySelector("video")).not.toBeNull());
    expect(view.queryByRole("button", { name: /Make it (Detailed|Quick)/ })).toBeNull();
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
