// MUSIC-GEN-04: the song card in chat. The turn names the job; the card polls Home and draws only the kit's MusicTrack:
// the stage line, clock and Stop while the song is made, then the kit Player in its audio layout with the lyrics, the
// version stepper, Use this version, Download and Share, or the plain failure line. The calls go to /api/music only.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MusicTrack } from "@maipai/ui/src/elements/music-track";
import { MusicToolRender } from "@/apps/chat/chatToolUis";
import { musicFileName, musicHint } from "@/apps/chat/chatToolUis";
import { TOOL_BINDINGS } from "@/apps/chat/elementBindings";
import type { MusicCard } from "@/lib/musicApi";
import type { Roster } from "@/lib/api";
import { WakeWordPersonContext } from "@/apps/chat/chatThreadContexts";

afterEach(cleanup);
const realFetch = globalThis.fetch;
let calls: Array<{ url: string; method: string; body?: string }>;
let card: MusicCard;

const V1 = { id: "file-one", label: "Version 1", url: "/api/music/jobs/mus-1/files/file-one" };
const V2 = { id: "file-two", label: "Version 2", url: "/api/music/jobs/mus-2/files/file-two" };
function make(over: Partial<MusicCard>): MusicCard {
  return { id: "mus-1", task: "text2music", state: "running", stage: "planning", stage_label: "Planning", stages: [{ id: "queued", label: "Queued" }, { id: "model", label: "Loading" }, { id: "planning", label: "Planning" }, { id: "making", label: "Making" }, { id: "mixing", label: "Mixing" }, { id: "finishing", label: "Finishing" }], stage_index: 2, quality: "quick", boost_offered: false, progress: 0.25, eta_seconds: 40, position: null, error_line: null, cover_url: null, cover_versions: [], cover_pending: false, versions: [], current_id: null, length: "quick", cut: null, max_seconds: 240,
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
  test("a pending first fetch shows the queued song card without progress", () => {
    globalThis.fetch = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const view = mount();
    expect(cardOf(view)?.getAttribute("data-status")).toBe("queued");
    expect(view.getByRole("status").textContent).toContain("Waiting for memory, your song starts when there is room");
    expect(view.container.textContent).toContain("Your song");
    expect(view.queryByRole("progressbar")).toBeNull();
    expect(view.container.textContent).not.toContain("25%");
  });

  test("the song part is bound once to the kit song card, beside the music-lookup spec sheet", () => {
    const song = TOOL_BINDINGS.filter((binding) => binding.toolName === "song");
    expect(song).toHaveLength(1);
    expect(song[0]).toMatchObject({ element: "music-track", render: MusicToolRender });
    expect(TOOL_BINDINGS.find((binding) => binding.toolName === "music")?.element).toBe("spec-sheet");
  });

  test("queued shows the busy line's place in line and the title", async () => {
    card = make({ state: "queued", stage: "queued", stage_label: "Home is busy making another picture, video or song. It will start in a minute.", position: 2 });
    const view = mount();
    await waitFor(() => expect(view.getByRole("status").textContent).toBe("Waiting for memory, your song starts when there is room. You are number 2 in line."));
    expect(cardOf(view)?.getAttribute("data-status")).toBe("queued");
    expect(view.container.textContent).toContain("Pancakes");
  });

  test("a longer retry shows its own stage while waiting for admission", async () => {
    card = make({ state: "queued", stage: "longer", stage_label: "Making it longer so every line fits", progress: 0 });
    const view = mount();
    await waitFor(() => expect(view.container.textContent).toContain("Making it longer so every line fits"));
    expect(view.getByRole("status").textContent).toContain("Step 3 of 6 · Planning");
  });

  test("while the song is made it shows the stage, the percent, the time left and the clock, and Stop calls the stop route", async () => {
    const view = mount();
    await waitFor(() => expect(view.getByRole("status").textContent).toContain("Step 3 of 6 · Planning"));
    expect(cardOf(view)?.getAttribute("data-status")).toBe("generating");
    expect(view.container.textContent).toMatch(/25% · 0:3\d · about 40 seconds left/);
    expect(view.container.textContent).toContain("a gentle folk song with an original voice, 1:00");
    expect(view.container.textContent).toContain("Planning");
    fireEvent.click(view.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/music/jobs/mus-1")).toBe(true));
  });

  test("generating card marks the current stage and hides time left when ETA is unknown", async () => {
    card = make({ stage_index: 3, stage: "making", stage_label: "Making", eta_seconds: null });
    const view = mount();
    await waitFor(() => expect(view.getByRole("status").textContent).toContain("Step 4 of 6 · Making"));
    expect(view.container.querySelector('[aria-current="step"]')?.textContent).toContain("Making");
    expect(view.container.textContent).not.toContain("seconds left");
    expect(view.container.textContent).not.toContain("minute left");
  });

  test("waiting for memory keeps the calm kit status and never shows an error", async () => {
    card = make({ state: "queued", stage: "queued", stage_label: "Home is busy making another picture, video or song. It will start in a minute.", progress: 0, eta_seconds: null });
    const view = mount();
    await waitFor(() => expect(view.getByRole("status").textContent).toBe("Waiting for memory, your song starts when there is room"));
    expect(view.queryByRole("alert")).toBeNull();
    expect(cardOf(view)?.getAttribute("data-status")).toBe("queued");
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

  test("a finished song with no cover URL uses the kit's music fallback tile", async () => {
    card = done({ cover_url: null, cover_versions: [], cover_pending: false });
    const view = mount();
    await waitFor(() => expect(view.container.querySelector("audio")).not.toBeNull());
    expect(view.container.querySelector('[data-slot="safe-image-fallback"][data-kind="music"]')).toBeTruthy();
    expect(view.container.querySelector("img")).toBeNull();
  });

  test("Edit opens the three song actions and sends the typed song and cover prompts", async () => {
    card = done({ length: "quick" });
    const view = mount();
    await waitFor(() => expect(view.container.querySelector("audio")).not.toBeNull());
    const edit = view.getByRole("button", { name: "Edit" });
    if (edit.getAttribute("aria-expanded") !== "true") fireEvent.click(edit);
    expect(view.getByRole("dialog", { name: "Edit song" })).toBeTruthy();
    for (const label of ["Remix", "New cover", "Full song", "Stems"]) expect(view.getByRole("tab", { name: label })).toBeTruthy();
    expect(view.getByText("Describe a song change to enable Remix.")).toBeTruthy();
    fireEvent.change(view.getByLabelText("How should it change? For example: heavy metal"), { target: { value: "make it heavy metal" } });
    fireEvent.click(view.getByRole("button", { name: "Remix" }));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith("/revise") && call.body === JSON.stringify({ change: "make it heavy metal", file_id: V1.id }))).toBe(true));
    const editButton = view.getByRole("button", { name: "Edit" });
    if (editButton.getAttribute("aria-expanded") !== "true") fireEvent.click(editButton);
    fireEvent.keyDown(view.getByRole("tab", { name: "Remix" }), { key: "ArrowRight" });
    await waitFor(() => expect(view.getByRole("tab", { name: "New cover" }).getAttribute("aria-selected")).toBe("true"));
    await waitFor(() => expect(view.getByLabelText("Describe the new cover")).toBeTruthy());
    fireEvent.change(view.getByLabelText("Describe the new cover"), { target: { value: "a red guitar under stage lights" } });
    fireEvent.click(view.getByRole("button", { name: "Make new cover" }));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith("/cover") && call.body === JSON.stringify({ prompt: "a red guitar under stage lights" }))).toBe(true));
  });

  test("the Stems mode submits the shown version and a done stems card steps through its four tracks", async () => {
    card = done();
    const view = mount();
    await waitFor(() => expect(view.container.querySelector("audio")).not.toBeNull());
    fireEvent.click(view.getByRole("button", { name: "Edit" }));
    fireEvent.keyDown(view.getByRole("tab", { name: "Full song" }), { key: "ArrowRight" });
    await waitFor(() => expect(view.getByRole("tab", { name: "Stems" }).getAttribute("aria-selected")).toBe("true"));
    fireEvent.click(view.getByRole("button", { name: "Split into stems" }));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith("/stems") && call.body === JSON.stringify({ file_id: V1.id }))).toBe(true));
    cleanup();
    card = done({ task: "stems", title: "Pancakes (vocals)", current_id: "audio-0", versions: ["Vocals", "Drums", "Bass", "Other"].map((label, index) => ({ id: `audio-${index}`, label, url: `/audio-${index}` })) });
    const result = mount();
    await waitFor(() => expect(result.container.querySelector("audio")).not.toBeNull());
    expect(result.container.textContent).toContain("Track 1 of 4");
    expect(result.container.textContent).toContain("Pancakes (vocals)");
    expect(result.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(result.queryByRole("button", { name: /use this version/i })).toBeNull();
    fireEvent.click(result.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(result.container.textContent).toContain("Track 2 of 4"));
    expect(result.container.textContent).toContain("Pancakes (drums)");
    expect(result.container.textContent).not.toContain("Pancakes (vocals)");
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
    fireEvent.change(view.getByLabelText("How should it change? For example: heavy metal"), { target: { value: "make it loud" } });
    fireEvent.click(view.getByRole("button", { name: "Remix" }));
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
    Object.defineProperty(view.container.querySelector("audio"), "duration", { configurable: true, value: 10 });
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

describe("Standard and Boost songs on the card (TIER-HOME-03)", () => {
  const openQuality = async () => {
    const view = mount();
    fireEvent.click(await view.findByRole("button", { name: "Edit" }));
    for (const from of ["Remix", "New cover", "Full song"]) fireEvent.keyDown(view.getByRole("tab", { name: from }), { key: "ArrowRight" });
    await waitFor(() => expect(view.getByRole("tab", { name: "Quality" }).getAttribute("aria-selected")).toBe("true"));
    return view;
  };
  test("a Standard song with Boost offered shows the segment and Boost asks for a Boost version", async () => {
    card = done({ boost_offered: true });
    const view = await openQuality();
    expect(view.getByRole("radio", { name: /Standard/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(view.getByRole("radio", { name: /Boost/ }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/music/jobs/mus-1/quality" && c.method === "POST" && c.body?.includes('"boost"'))).toBe(true));
  });
  test("no Quality tab when Boost is not offered, and no Max choice ever", async () => {
    card = done({ boost_offered: false });
    const view = mount();
    fireEvent.click(await view.findByRole("button", { name: "Edit" }));
    expect(view.queryByRole("tab", { name: "Quality" })).toBeNull();
  });
});

describe("Quick and Full songs on the card", () => {
  test("a quick song offers Full song inside Edit and the button starts a full version", async () => {
    card = done();
    const view = mount();
    expect(await view.findByText(/Quick song/)).toBeTruthy();
    fireEvent.click(await view.findByRole("button", { name: "Edit" }));
    fireEvent.keyDown(view.getByRole("tab", { name: "Remix" }), { key: "ArrowRight" });
    fireEvent.keyDown(view.getByRole("tab", { name: "New cover" }), { key: "ArrowRight" });
    await waitFor(() => expect(view.getByRole("tab", { name: "Full song" }).getAttribute("aria-selected")).toBe("true"));
    await waitFor(() => expect(view.getByRole("button", { name: "Full song" })).toBeTruthy());
    expect(view.getByText("Sings every verse")).toBeTruthy();
    const button = await view.findByRole("button", { name: "Full song" });
    fireEvent.click(button);
    await waitFor(() => expect(calls.some((c) => c.url === "/api/music/jobs/mus-1/length" && c.method === "POST" && c.body?.includes('"full"'))).toBe(true));
  });
  test("a full song offers Quick song in Edit and starts a quick version", async () => {
    card = done({ length: "full", duration_s: 180 });
    const view = mount();
    expect(await view.findByText(/Full song/)).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Edit" }));
    expect(view.getByRole("tab", { name: "Full song" })).toBeTruthy();
    fireEvent.keyDown(view.getByRole("tab", { name: "Remix" }), { key: "ArrowRight" });
    fireEvent.keyDown(view.getByRole("tab", { name: "New cover" }), { key: "ArrowRight" });
    await waitFor(() => expect(view.getByRole("tab", { name: "Full song" }).getAttribute("aria-selected")).toBe("true"));
    fireEvent.click(view.getByRole("button", { name: "Quick song" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/music/jobs/mus-1/length" && c.method === "POST" && c.body?.includes('"quick"'))).toBe(true));
  });
});

test("song hints explain the hook, every part, and the computer ceiling", () => {
  expect(musicHint("quick")).toBe("Quick: the hook. Choose Full song to sing every verse.");
  expect(musicHint("full")).toBe("Full: every part of the song.");
  expect(musicHint("full", "ceiling", 120)).toBe("Longer than this computer's longest song (2 minutes), so it sings the first parts that fit.");
});

// The byline under the song card: the kit creation header in its byline form, read from the song's Library file.
describe("SongByline under the song card", () => {
  const ME = { id: "person-adult123", display_name: "Riff", avatar_seed: "person-adult123", role: "adult" } as Roster;
  const FILE = { id: "file-one", owner_person_id: "person-adult123", kind: "audio", name: "Pancakes.m4a", media_type: "audio/mp4", size: 16, created_at: "2026-10-20T12:00:00.000Z", retention: "kept" };

  function routed(file: { status: number; body: unknown } = { status: 200, body: FILE }) {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, method: init?.method ?? "GET", ...(typeof init?.body === "string" ? { body: init.body } : {}) });
      if (url.endsWith("/api/files/file-one")) return new Response(JSON.stringify(file.body), { status: file.status, headers: { "content-type": "application/json" } });
      if (url.endsWith("/api/files/file-one/shares")) return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
      if (url.endsWith("/api/people")) return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
      if (url.includes("/files/")) return new Response(new Uint8Array(16), { status: 200, headers: { "content-type": "audio/mp4" } });
      return new Response(JSON.stringify(card), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
  }

  function mountAsMe() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Render = MusicToolRender as unknown as (props: { result: { id: string } }) => React.ReactElement;
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <WakeWordPersonContext.Provider value={ME}>
            <Render result={{ id: "mus-1" }} />
          </WakeWordPersonContext.Provider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  test("a done song I made, kept private, shows the byline with its Made date and the Private chip", async () => {
    routed();
    card = done();
    const view = mountAsMe();
    expect(await view.findByRole("button", { name: "Private, manage sharing" })).toBeTruthy();
    expect(view.container.textContent).toContain("Made");
    expect(calls.some((c) => c.url === "/api/files/file-one/shares")).toBe(true);
  });

  test("a song that is still running shows no byline and fetches no Library file", async () => {
    routed();
    card = make({});
    const view = mountAsMe();
    await waitFor(() => expect(cardOf(view)?.getAttribute("data-status")).toBe("generating"));
    expect(view.queryByRole("button", { name: "Private, manage sharing" })).toBeNull();
    expect(view.container.textContent).not.toContain("Made");
    expect(calls.some((c) => c.url.endsWith("/api/files/file-one"))).toBe(false);
  });

  test("a failed Library file read shows no byline and no error line", async () => {
    routed({ status: 500, body: { error: "boom" } });
    card = done();
    const view = mountAsMe();
    await waitFor(() => expect(view.container.querySelector("audio")).not.toBeNull());
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/api/files/file-one"))).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(view.queryByRole("button", { name: "Private, manage sharing" })).toBeNull();
    expect(view.container.textContent).not.toContain("Made");
    expect(view.queryByRole("alert")).toBeNull();
  });
});
