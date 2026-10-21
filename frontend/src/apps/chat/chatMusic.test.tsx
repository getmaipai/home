// MUSIC-GEN-04: the song card in chat. The turn names the job; the card polls Home and draws only the kit's MusicTrack:
// the stage line, clock and Stop while the song is made, then the kit Player in its audio layout with the lyrics, the
// version stepper, Use this version, Download and Share, or the plain failure line. The calls go to /api/music only.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MusicTrack } from "@maipai/ui/src/elements/music-track";
import { MusicToolRender, musicFileName, musicHint } from "@/apps/chat/chatToolUis";
import { musicEtaLabel } from "@/apps/chat/MusicCardView";
import { TOOL_BINDINGS } from "@/apps/chat/elementBindings";
import type { MusicCard } from "@/lib/musicApi";

afterEach(cleanup);
const realFetch = globalThis.fetch;
let calls: Array<{ url: string; method: string; body?: string }>;
let card: MusicCard;

const V1 = { id: "file-one", label: "Version 1", url: "/api/music/jobs/mus-1/files/file-one" };
const V2 = { id: "file-two", label: "Version 2", url: "/api/music/jobs/mus-2/files/file-two" };
function make(over: Partial<MusicCard>): MusicCard {
  return { id: "mus-1", state: "running", stage: "planning", stage_label: "Planning the song", progress: 0.25, eta_seconds: 40, position: null, error_line: null, cover_url: null, cover_versions: [], cover_pending: false, versions: [], current_id: null, length: "quick", cut: null, max_seconds: 240,
    title: "Pancakes", description: "a gentle folk song with an original voice", lyrics: "[Verse]\nMorning light\n[Chorus]\nPancakes rise", duration_s: 60, timed_lyrics: null, started_at: Date.now() - 30_000, ...over };
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
  test("music ETA is withheld until progress and elapsed time support an estimate", () => {
    const startedAt = 1_000_000;
    expect(musicEtaLabel(make({ progress: 0.02, started_at: startedAt }), startedAt + 27_000)).toBeUndefined();
    expect(musicEtaLabel(make({ progress: 0.5, started_at: startedAt }), startedAt + 60_000)).toBe("about 1 minute left");
    expect(musicEtaLabel(make({ state: "queued", progress: 0.5, started_at: startedAt }), startedAt + 60_000)).toBeUndefined();
    expect(musicEtaLabel(make({ stage: "waiting_memory", progress: 0.5, started_at: startedAt }), startedAt + 60_000)).toBeUndefined();
    expect(musicEtaLabel(make({ progress: 0.9, started_at: startedAt }), startedAt + 10_000)).toBe("about 5 seconds left");
  });

  test("a pending first fetch shows the queued song card without progress", () => {
    globalThis.fetch = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const view = mount();
    expect(cardOf(view)?.getAttribute("data-status")).toBe("queued");
    expect(view.getByRole("status").textContent).toContain("Waiting its turn");
    expect(view.container.textContent).toContain("Your song");
    expect(view.getByRole("progressbar").hasAttribute("aria-valuenow")).toBe(false);
    expect(view.container.textContent).not.toContain("%");
  });

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

  test("a longer retry shows its own stage while waiting for admission", async () => {
    card = make({ state: "queued", stage: "longer", stage_label: "Making it longer so every line fits", progress: 0 });
    const view = mount();
    await waitFor(() => expect(view.getByRole("status").textContent).toContain("Making it longer so every line fits"));
  });

  test("while the song is made it shows the stage, the percent, the time left and the clock, and Stop calls the stop route", async () => {
    const view = mount();
    await waitFor(() => expect(view.getByRole("status").textContent).toContain("Planning the song"));
    expect(cardOf(view)?.getAttribute("data-status")).toBe("generating");
    expect(view.container.textContent).toMatch(/0:3\d · 25% · about 2 minutes left/);
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

  test("a finished song shows its cover in the kit Player", async () => {
    card = done({ cover_url: "/api/covers/pancakes" });
    const view = mount();
    const poster = await view.findByRole("img", { name: "Cover art for Pancakes" });
    expect(poster.getAttribute("src")).toBe(card.cover_url);
  });

  test("Edit opens the three song actions and sends the typed song and cover prompts", async () => {
    card = done({ length: "quick" });
    const view = mount();
    await waitFor(() => expect(view.container.querySelector("audio")).not.toBeNull());
    fireEvent.click(view.getByRole("button", { name: "Edit" }));
    expect(view.getByRole("region", { name: "Edit song" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Make it full" })).toBeTruthy();
    fireEvent.change(view.getByLabelText("How should it change? For example: make it heavy metal"), { target: { value: "make it heavy metal" } });
    fireEvent.click(view.getAllByRole("button", { name: "Make" })[0]!);
    await waitFor(() => expect(calls.some((call) => call.url.endsWith("/revise") && call.body === JSON.stringify({ change: "make it heavy metal", file_id: V1.id }))).toBe(true));
    fireEvent.change(view.getByLabelText("Describe the new cover"), { target: { value: "a red guitar under stage lights" } });
    fireEvent.click(view.getAllByRole("button", { name: "Make" })[1]!);
    await waitFor(() => expect(calls.some((call) => call.url.endsWith("/cover") && call.body === JSON.stringify({ prompt: "a red guitar under stage lights" }))).toBe(true));
  });

  test("Edit shows a plain next step when a song change fails", async () => {
    card = done();
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, method: init?.method ?? "GET", ...(typeof init?.body === "string" ? { body: init.body } : {}) });
      if (url.includes("/revise")) return new Response(JSON.stringify({ error: "The music model is busy." }), { status: 503 });
      if (url.includes("/files/")) return new Response(new Uint8Array(16), { status: 200, headers: { "content-type": "audio/mp4" } });
      return new Response(JSON.stringify(card), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const view = mount();
    await waitFor(() => expect(view.container.querySelector("audio")).not.toBeNull());
    fireEvent.click(view.getByRole("button", { name: "Edit" }));
    fireEvent.change(view.getByLabelText("How should it change? For example: make it heavy metal"), { target: { value: "make it loud" } });
    fireEvent.click(view.getAllByRole("button", { name: "Make" })[0]!);
    expect(await view.findByRole("alert")).toHaveTextContent("The music model is busy. Check the request and try again.");
  });

  test("a finished song polls until its cover arrives, then stops", async () => {
    card = done({ cover_pending: true });
    const view = mount();
    await waitFor(() => expect(view.container.querySelector("audio")).not.toBeNull());
    card = done({ cover_url: "/api/covers/pancakes" });
    const poster = await view.findByRole("img", { name: "Cover art for Pancakes" }, { timeout: 3000 });
    expect(poster.getAttribute("src")).toBe(card.cover_url);
    const settled = calls.filter((c) => c.url === "/api/music/jobs/mus-1").length;
    expect(settled).toBeGreaterThanOrEqual(2);
    await new Promise((resolve) => setTimeout(resolve, 1300));
    expect(calls.filter((c) => c.url === "/api/music/jobs/mus-1").length).toBe(settled);
  });

  test("timed lyrics render as seek buttons in the Lyrics list", async () => {
    card = done({ timed_lyrics: [
      { t: 1, line: "Morning light", section: "Verse" },
      { t: 5, line: "Pancakes rise", section: "Chorus" },
    ] });
    const view = mount();
    await waitFor(() => expect(view.container.querySelector("audio")).not.toBeNull());
    fireEvent.click(view.getByRole("button", { name: "Lyrics" }));
    expect(await view.findByRole("button", { name: "Morning light" })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Pancakes rise" }));
    expect(view.container.querySelector("audio")!.currentTime).toBe(5);
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
    // Width comes from the kit's own prop; Home adds no shape override.
    const bare = render(<MusicTrack status="ready" title="Pancakes" src={V1.url} />);
    expect(cardOf(view)!.className).toContain("max-w-none");
    expect(cardOf(view)!.getAttribute("data-width")).toBe("full");
    expect(bare.container.querySelector("[data-slot=music-track]")!.className).toContain("max-w-xl");
  });
});

describe("Quick and Full songs on the card", () => {
  test("a quick song offers Make it full inside Edit and the button starts a full version", async () => {
    card = done();
    const view = mount();
    expect(await view.findByText(/Quick song/)).toBeTruthy();
    fireEvent.click(await view.findByRole("button", { name: "Edit" }));
    const button = await view.findByRole("button", { name: "Make it full" });
    fireEvent.click(button);
    await waitFor(() => expect(calls.some((c) => c.url === "/api/music/jobs/mus-1/length" && c.method === "POST" && c.body?.includes('"full"'))).toBe(true));
  });
  test("a full song does not offer a length change in Edit", async () => {
    card = done({ length: "full", duration_s: 180 });
    const view = mount();
    expect(await view.findByText(/Full song/)).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Edit" }));
    expect(view.queryByRole("button", { name: "Make it full" })).toBeNull();
    expect(view.queryByRole("button", { name: "Make it quick" })).toBeNull();
  });
});

test("song hints explain the hook, every part, and the computer ceiling", () => {
  expect(musicHint("quick")).toBe("Quick: the hook. Make it full to sing every part.");
  expect(musicHint("full")).toBe("Full: every part of the song.");
  expect(musicHint("full", "ceiling", 120)).toBe("Longer than this computer's longest song (2 minutes), so it sings the first parts that fit.");
});
