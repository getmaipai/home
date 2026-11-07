// SPATIAL-05: "Spatial sound" in a finished clip's More menu (kit VideoPlayer actionItems). Visible for an adult's finished clip; disabled with its hint
// when the clip has no sound; absent for a person who may not edit; the Stack's line shows as the card's muted notice.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { VideoToolRender } from "@/apps/chat/chatToolUis";
import { SPATIAL_LABEL, SPATIAL_NO_SOUND_HINT, SPATIAL_SURROUND_LABEL, spatialActionItems } from "@/apps/chat/spatialSoundActions";
import type { VideoCard, VideoItem } from "@/lib/videosApi";

afterEach(cleanup);
const realFetch = globalThis.fetch;
let calls: Array<{ url: string; method: string; body: string | null }>;
let card: VideoCard;

function done(over: Partial<VideoItem> = {}, hasSound = true): VideoItem {
  return { id: "vid-1", state: "done", percent: 100, label: "", position: null, eta_seconds: null, step: null, steps: null, preview_url: null, started_at: Date.now() - 30_000, prompt: "a man talks on the left", kind: "generate", error: null, quality: "detailed", switch_to: null, clip: { url: "/api/videos/jobs/vid-1/files/file-a", poster_url: "/api/videos/jobs/vid-1/files/file-b", width: 832, height: 480, seconds: 5, seed: 7, file_id: "file-a", poster_file_id: "file-b", has_sound: hasSound }, ...over };
}
beforeEach(() => {
  calls = [];
  card = { id: "vid-1", conversation_id: "conv-1", items: [done()], can_make_another: true, can_edit: true, limits: "Videos are 5 seconds at 480p and take about 2 minutes." };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : null });
    if (url.endsWith("/messages.mp4")) return new Response(new Uint8Array(16), { status: 200, headers: { "content-type": "video/mp4" } });
    return new Response(JSON.stringify(card), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Render = VideoToolRender as unknown as (props: { result: { id: string } }) => React.ReactElement;
  return render(<QueryClientProvider client={client}><MemoryRouter><Render result={{ id: "vid-1" }} /></MemoryRouter></QueryClientProvider>);
}
async function openMore(view: ReturnType<typeof mount>) {
  await waitFor(() => expect(view.container.querySelector("video")).not.toBeNull());
  fireEvent.pointerDown(view.getByRole("button", { name: "More" }), { button: 0, ctrlKey: false, pointerType: "mouse" });
  return await waitFor(() => view.getByRole("menu"));
}

describe("the action items", () => {
  test("two entries, each disabled with the same reason when the clip has no sound or making is not ready, never hidden", () => {
    const run = () => undefined;
    const ready = spatialActionItems({ hasSound: true, makingReason: null, busy: false, onRun: run });
    expect(ready.map((entry) => entry.label)).toEqual([SPATIAL_LABEL, SPATIAL_SURROUND_LABEL]);
    expect(ready.every((entry) => entry.disabledReason === undefined && (entry.when ?? []).join() === "ready")).toBe(true);
    expect(spatialActionItems({ hasSound: false, makingReason: null, busy: false, onRun: run }).every((entry) => entry.disabledReason === SPATIAL_NO_SOUND_HINT)).toBe(true);
    expect(spatialActionItems({ hasSound: true, makingReason: "Pictures and video are not ready.", busy: false, onRun: run }).every((entry) => entry.disabledReason === "Pictures and video are not ready.")).toBe(true);
    expect(spatialActionItems({ hasSound: true, makingReason: null, busy: true, onRun: run }).every((entry) => Boolean(entry.disabledReason))).toBe(true);
  });
});

describe("the clip's More menu", () => {
  test("an adult's finished clip with sound offers Spatial sound and the 5.1 version, and each asks the route for it", async () => {
    const view = mount();
    const menu = await openMore(view);
    const plain = within(menu).getByRole("menuitem", { name: new RegExp(`^${SPATIAL_LABEL}$`) });
    const surround = within(menu).getByRole("menuitem", { name: SPATIAL_SURROUND_LABEL });
    expect(plain.getAttribute("aria-disabled")).not.toBe("true");
    fireEvent.click(plain);
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url === "/api/videos/jobs/vid-1/spatial-sound" && c.body === "{}")).toBe(true));
    const again = await openMore(view);
    fireEvent.click(within(again).getByRole("menuitem", { name: SPATIAL_SURROUND_LABEL }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/videos/jobs/vid-1/spatial-sound" && c.body === JSON.stringify({ surround: true }))).toBe(true));
    expect(surround).toBeTruthy();
  });

  test("a clip with no sound shows both entries disabled, with the hint under each", async () => {
    card = { ...card, items: [done({}, false)] };
    const view = mount();
    const menu = await openMore(view);
    const entries = within(menu).getAllByRole("menuitem").filter((entry) => /Spatial sound/.test(entry.textContent ?? ""));
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.getAttribute("aria-disabled") === "true" || entry.hasAttribute("data-disabled")).toBe(true);
      expect(entry.textContent).toContain(SPATIAL_NO_SOUND_HINT);
    }
  });

  test("a person who may not edit sees no Spatial sound at all", async () => {
    card = { ...card, can_edit: false };
    const view = mount();
    await waitFor(() => expect(view.container.querySelector("video")).not.toBeNull());
    expect(view.container.textContent).not.toContain("Spatial sound");
    expect(view.queryByRole("button", { name: "More" })).toBeNull();
  });

  test("a clip still being made offers nothing", async () => {
    card = { ...card, items: [{ ...done(), state: "running", percent: 40, label: "Drawing the frames", clip: null }] };
    const view = mount();
    await waitFor(() => expect(view.getByRole("status").textContent).toContain("Drawing the frames"));
    expect(view.container.textContent).not.toContain("Spatial sound");
  });

  test("the Stack's line under a spatial clip shows as the card's muted notice", async () => {
    card = { ...card, items: [done({ kind: "edit", note: "Nobody was found on screen, so the sound is unchanged." })] };
    const view = mount();
    await waitFor(() => expect(view.container.querySelector("[data-slot=video-player-notice]")?.textContent).toBe("Nobody was found on screen, so the sound is unchanged."));
  });
});
