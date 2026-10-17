// MUSIC-GEN-04: the song card in chat. The turn names the job; the card polls Home and draws only the kit's MusicTrack:
// the stage line, clock and Stop while the song is made, then the kit Player in its audio layout with the lyrics, the
// version stepper, Use this version, Download and Share, or the plain failure line. The calls go to /api/music only.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MusicTrack } from "@maipai/ui/src/elements/music-track";
import { MusicToolRender, musicFileName } from "@/apps/chat/chatToolUis";
import { TOOL_BINDINGS } from "@/apps/chat/elementBindings";
import type { MusicCard } from "@/lib/musicApi";

afterEach(cleanup);
const realFetch = globalThis.fetch;
let calls: Array<{ url: string; method: string; body?: string }>;
let card: MusicCard;

const V1 = { id: "file-one", label: "Version 1", url: "/api/music/jobs/mus-1/files/file-one" };
const V2 = { id: "file-two", label: "Version 2", url: "/api/music/jobs/mus-2/files/file-two" };
function make(over: Partial<MusicCard>): MusicCard {
  return { id: "mus-1", state: "running", stage: "planning", stage_label: "Planning the song", progress: 0.25, eta_seconds: 40, position: null, error_line: null, versions: [], current_id: null,
    title: "Pancakes", description: "a gentle folk song with an original voice", lyrics: "[Verse]\nMorning light\n[Chorus]\nPancakes rise", duration_s: 60, started_at: Date.now() - 30_000, ...over };
}
const done = (over: Partial<MusicCard> = {}): MusicCard => make({ state: "done", stage: "ready", stage_label: "", progress: 1, eta_seconds: 0, versions: [V1], current_id: V1.id, ...over });
beforeEach(() => {
  calls = []; card = make({});
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, method: init?.method ?? "GET", ...(typeof init?.body === "string" ? { body: init.body } : {}) });
    if (url.includes("/files/")) return new Response(new Uint8Array(16), { status: 200, headers: { "content-type": "audio/mp4" } });
    return new Response(JSON.stringify(card), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Render = MusicToolRender as unknown as (props: { result: { id: string } }) => React.ReactElement;
  return render(<QueryClientProvider client={client}><MemoryRouter><Render result={{ id: "mus-1" }} /></MemoryRouter></QueryClientProvider>);
}
const cardOf = (view: ReturnType<typeof mount>) => view.container.querySelector("[data-slot=music-track]");

describe("MusicToolRender", () => {
  test("the song part is bound once to the kit song card, beside the music-lookup spec sheet", () => {
    const song = TOOL_BINDINGS.filter((binding) => binding.toolName === "song");
    expect(song).toHaveLength(1);
    expect(song[0]).toMatchObject({ element: "music-track", render: MusicToolRender });
    expect(TOOL_BINDINGS.find((binding) => binding.toolName === "music")?.element).toBe("spec-sheet");
  });

  test("queued shows the busy line's place in line and the title", async () => {
    card = make({ state: "queued", stage_label: "Home is busy making another picture, video or song. It will start in a minute.", position: 2 });
    const view = mount();
    await waitFor(() => expect(view.getByRole("status").textContent).toContain("Place in line: 2"));
    expect(cardOf(view)?.getAttribute("data-status")).toBe("queued");
    expect(view.container.textContent).toContain("Pancakes");
  });

  test("while the song is made it shows the stage, the percent, the time left and the clock, and Stop calls the stop route", async () => {
    const view = mount();
    await waitFor(() => expect(view.getByRole("status").textContent).toContain("Planning the song"));
    expect(cardOf(view)?.getAttribute("data-status")).toBe("generating");
    expect(view.container.textContent).toMatch(/0:3\d · 25% · about 40 seconds left/);
    expect(view.container.textContent).toContain("a gentle folk song with an original voice, 1:00");
    fireEvent.click(view.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/music/jobs/mus-1")).toBe(true));
  });

  test("a finished song plays in the kit player (audio layout) with its title, lyrics behind a disclosure, Download named from the title, and no Save to Music or Make another", async () => {
    card = done();
    const view = mount();
    await waitFor(() => expect(cardOf(view)?.getAttribute("data-status")).toBe("ready"));
    await waitFor(() => expect(view.container.querySelector("audio")).not.toBeNull());
    expect(view.container.querySelector("audio")!.getAttribute("src")).toBe(V1.url);
    expect(view.container.textContent).toContain("Pancakes");
    expect(view.getByRole("button", { name: "Download" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Share" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "Save to Music" })).toBeNull();
    expect(view.queryByRole("button", { name: "Make another" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Lyrics" }));
    await waitFor(() => expect(view.container.textContent).toContain("Morning light"));
    expect(musicFileName("Pancakes: the \"sunny\" song/1")).toBe("Pancakes the sunny song 1.m4a");
    expect(musicFileName(null)).toBe("song.m4a");
  });

  test("an instrumental has no lyrics disclosure", async () => {
    card = done({ lyrics: "[Instrumental]" });
    const view = mount();
    await waitFor(() => expect(view.container.querySelector("audio")).not.toBeNull());
    expect(view.queryByRole("button", { name: "Lyrics" })).toBeNull();
  });

  test("versions: Previous and Next switch what is shown, and Use this version calls the route and refetches", async () => {
    card = done({ versions: [V1, V2], current_id: V2.id });
    const view = mount();
    await waitFor(() => expect(view.container.querySelector("audio")?.getAttribute("src")).toBe(V2.url));
    expect(view.container.textContent).toContain("Version 2 of 2");
    expect(view.queryByRole("button", { name: "Use this version" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Previous" }));
    await waitFor(() => expect(view.container.querySelector("audio")?.getAttribute("src")).toBe(V1.url));
    expect(view.container.textContent).toContain("Version 1 of 2");
    card = done({ versions: [V1, V2], current_id: V1.id });
    fireEvent.click(view.getByRole("button", { name: "Use this version" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url === "/api/music/jobs/mus-1/use" && c.body === JSON.stringify({ file_id: V1.id }))).toBe(true));
    // The route is followed by a refetch of the card, and the chosen version stays on show.
    await waitFor(() => expect(calls.map((c, i) => (c.method === "GET" && c.url === "/api/music/jobs/mus-1" ? i : -1)).reduce((a, b) => Math.max(a, b), -1)).toBeGreaterThan(calls.findIndex((c) => c.method === "POST")));
    expect(view.container.querySelector("audio")?.getAttribute("src")).toBe(V1.url);
    expect(view.container.textContent).toContain("Version 1 of 2");
  });

  test("Share hands the real song file to the system share sheet, fetched ahead of the click", async () => {
    card = done();
    const shared: Array<{ files?: File[]; title?: string }> = [];
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
    Object.defineProperty(navigator, "share", { configurable: true, value: async (data: { files?: File[]; title?: string }) => { shared.push(data); } });
    try {
      const view = mount();
      await waitFor(() => expect(calls.some((c) => c.url === V1.url)).toBe(true));
      await waitFor(() => expect(view.container.querySelector("audio")).not.toBeNull());
      await new Promise((resolve) => setTimeout(resolve, 50));
      fireEvent.click(view.getByRole("button", { name: "Share" }));
      expect(shared).toHaveLength(1);
      expect(shared[0]!.files![0]!.name).toBe("Pancakes.m4a");
      expect(shared[0]!.files![0]!.type).toBe("audio/mp4");
      expect(shared[0]!.title).toBe("Pancakes");
    } finally { Reflect.deleteProperty(navigator, "canShare"); Reflect.deleteProperty(navigator, "share"); }
  });

  test("a failed song shows the plain line and no player or retry", async () => {
    card = make({ state: "failed", error_line: "I couldn't make that song. Paused: this computer is low on memory. Close big apps, or try again in a few minutes." });
    const view = mount();
    await waitFor(() => expect(view.getByRole("alert").textContent).toContain("I couldn't make that song."));
    expect(view.container.querySelector("audio")).toBeNull();
    expect(view.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  test("a stopped song says so", async () => {
    card = make({ state: "cancelled" });
    const view = mount();
    await waitFor(() => expect(view.container.textContent).toContain("Stopped. Nothing was kept."));
  });

  test("polling stops once the song is settled, and keeps going while it is made", async () => {
    card = done();
    const view = mount();
    await waitFor(() => expect(view.container.querySelector("audio")).not.toBeNull());
    const settled = calls.filter((c) => c.url === "/api/music/jobs/mus-1").length;
    await new Promise((resolve) => setTimeout(resolve, 1300));
    expect(calls.filter((c) => c.url === "/api/music/jobs/mus-1").length).toBe(settled);
    cleanup();
    calls = []; card = make({});
    const live = mount();
    await waitFor(() => expect(live.getByRole("status")).toBeTruthy());
    await waitFor(() => expect(calls.filter((c) => c.url === "/api/music/jobs/mus-1").length).toBeGreaterThanOrEqual(2), { timeout: 3000 });
  });

  test("MusicTrack gets no className, no wrapper and no Home-drawn box", async () => {
    card = done();
    const view = mount();
    await waitFor(() => expect(cardOf(view)).not.toBeNull());
    expect(view.container.firstElementChild).toBe(cardOf(view));
    // Same classes as the kit Element rendered bare: Home added none.
    const bare = render(<MusicTrack status="ready" title="Pancakes" src={V1.url} />);
    expect(cardOf(view)!.className).toBe(bare.container.querySelector("[data-slot=music-track]")!.className);
  });
});
