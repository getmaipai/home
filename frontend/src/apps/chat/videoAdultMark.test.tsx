// ADULT-LOCK-06 (docs/design/video-loras-2026-11-02.md 3.10): the clip's creator sees "Unmark as NSFW" only while the clip is locked and shown, with a confirm dialog
// in plain words and a fresh passcode; "Mark as NSFW" only when it is not locked; nobody else sees either, and a clip that turns locked becomes the lock tile.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { VideoToolRender } from "@/apps/chat/chatToolUis";
import { UNMARK_EXPLAINER } from "@/apps/chat/videoAdultMark";
import { WakeWordPersonContext } from "@/apps/chat/chatThreadContexts";
import type { VideoAdultState, VideoItem } from "@/lib/videosApi";

afterEach(cleanup);
const realFetch = globalThis.fetch;
let calls: Array<{ url: string; method: string; body?: string }>;
let adult: VideoAdultState | null;
let cardOverride: unknown = null;
let confirmStatus = 200;
let markStatus = 200;

const clip = { url: "/api/videos/jobs/vid-1/files/file-a", poster_url: "/api/videos/jobs/vid-1/files/file-b", width: 832, height: 480, seconds: 5, seed: 1, file_id: "file-a", poster_file_id: "file-b" };
const item = (): VideoItem => ({ id: "vid-1", state: "done", percent: 100, label: "", position: null, eta_seconds: null, step: null, steps: null, preview_url: null, started_at: Date.now() - 30_000, prompt: "a paper boat in the rain", kind: "generate", error: null, quality: "quick", switch_to: null, adult, clip });
const state = (over: Partial<VideoAdultState>): VideoAdultState => ({ made_audience: "adult-only", lock: "on", can_clear: true, can_mark: false, line: "Marked NSFW and locked. It opens only with your passcode, and people under 18 never see it.", history: [], ...over });

beforeEach(() => {
  calls = []; cardOverride = null; confirmStatus = 200; markStatus = 200;
  adult = state({});
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, method: init?.method ?? "GET", ...(typeof init?.body === "string" ? { body: init.body } : {}) });
    if (url.endsWith("/messages.mp4")) return new Response(new Uint8Array(16), { status: 200, headers: { "content-type": "video/mp4" } });
    if (url === "/api/adult-lock/confirm") return confirmStatus === 200 ? Response.json({ ticket: "ticket-1", expires_in: 30 }) : Response.json({ error: "Invalid PIN or password" }, { status: confirmStatus });
    if (url.endsWith("/adult-mark")) return markStatus === 200 ? Response.json({ made_audience: "adult-only", lock: "off" }) : Response.json({ error: "Change this on your own screen. Open Home on your own phone or computer and try again." }, { status: markStatus });
    return Response.json(cardOverride ?? { id: "vid-1", conversation_id: "conv-1", items: [item()], can_make_another: true, limits: "Videos take about 2 minutes." });
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Render = VideoToolRender as unknown as (props: { result: { id: string } }) => React.ReactElement;
  const me = { id: "p1", pinDigits: 4 } as never;
  return render(<QueryClientProvider client={client}><WakeWordPersonContext.Provider value={me}><MemoryRouter><Render result={{ id: "vid-1" }} /></MemoryRouter></WakeWordPersonContext.Provider></QueryClientProvider>);
}
const typeCode = (code: string) => fireEvent.change(document.querySelector<HTMLInputElement>('[data-slot="adult-lock-dialog"] input')!, { target: { value: code } });

describe("the creator's menu on a locked, shown clip", () => {
  test("shows the state in plain words and Unmark as NSFW, not Mark as NSFW; the dialog says what changes and asks for the passcode", async () => {
    const view = mount();
    await waitFor(() => expect(view.getByRole("button", { name: "Unmark as NSFW" })).toBeTruthy());
    expect(view.queryByRole("button", { name: "Mark as NSFW" })).toBeNull();
    expect(view.container.textContent).toContain("Marked NSFW and locked.");
    fireEvent.click(view.getByRole("button", { name: "Unmark as NSFW" }));
    await waitFor(() => expect(document.querySelector('[data-slot="adult-lock-dialog"]')).not.toBeNull());
    const dialog = document.querySelector('[data-slot="adult-lock-dialog"]')!.textContent!;
    expect(dialog).toContain("Remove the adult lock?");
    expect(dialog).toContain(UNMARK_EXPLAINER);
    expect(dialog).toContain("show with its title and thumbnail in your feeds and lists");
    expect(dialog).toContain("People under 18 still never see it");
    expect(UNMARK_EXPLAINER).not.toContain("—");
    // Nothing is sent until a passcode is typed.
    expect(calls.some((c) => c.url === "/api/adult-lock/confirm")).toBe(false);
  });

  test("a right passcode asks Home for a fresh ticket for this clip, then clears with it", async () => {
    const view = mount();
    await waitFor(() => expect(view.getByRole("button", { name: "Unmark as NSFW" })).toBeTruthy());
    fireEvent.click(view.getByRole("button", { name: "Unmark as NSFW" }));
    await waitFor(() => expect(document.querySelector('[data-slot="adult-lock-dialog"] input')).not.toBeNull());
    typeCode("1234");
    await waitFor(() => expect(calls.some((c) => c.url === "/api/videos/jobs/vid-1/adult-mark")).toBe(true));
    const confirm = calls.find((c) => c.url === "/api/adult-lock/confirm")!;
    expect(JSON.parse(confirm.body!)).toEqual({ secret: "1234", action: "unmark", item: "vid-1" });
    expect(JSON.parse(calls.find((c) => c.url === "/api/videos/jobs/vid-1/adult-mark")!.body!)).toEqual({ action: "clear", ticket: "ticket-1" });
    await waitFor(() => expect(document.querySelector('[data-slot="adult-lock-dialog"]')).toBeNull());
  });

  test("a wrong passcode is a plain line, no clear is sent and the dialog stays open", async () => {
    confirmStatus = 401;
    const view = mount();
    await waitFor(() => expect(view.getByRole("button", { name: "Unmark as NSFW" })).toBeTruthy());
    fireEvent.click(view.getByRole("button", { name: "Unmark as NSFW" }));
    await waitFor(() => expect(document.querySelector('[data-slot="adult-lock-dialog"] input')).not.toBeNull());
    typeCode("0000");
    await waitFor(() => expect(document.querySelector('[data-slot="adult-lock-error"]')?.textContent).toContain("was not right"));
    expect(calls.some((c) => c.url.endsWith("/adult-mark"))).toBe(false);
    expect(document.querySelector('[data-slot="adult-lock-dialog"]')).not.toBeNull();
  });
});

describe("a clip with the lock removed or never locked", () => {
  test("offers Mark as NSFW and no unmark, says the lock is removed, and marks with no passcode", async () => {
    adult = state({ lock: "off", can_clear: false, can_mark: true, line: "Marked NSFW, lock removed. It shows with its title and thumbnail in your feeds and lists. People under 18 never see it." });
    const view = mount();
    await waitFor(() => expect(view.getByRole("button", { name: "Mark as NSFW" })).toBeTruthy());
    expect(view.queryByRole("button", { name: "Unmark as NSFW" })).toBeNull();
    expect(view.container.textContent).toContain("lock removed");
    fireEvent.click(view.getByRole("button", { name: "Mark as NSFW" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/videos/jobs/vid-1/adult-mark")).toBe(true));
    expect(JSON.parse(calls.find((c) => c.url === "/api/videos/jobs/vid-1/adult-mark")!.body!)).toEqual({ action: "mark" });
    expect(calls.some((c) => c.url === "/api/adult-lock/confirm")).toBe(false);
  });

  test("a refused mark shows Home's plain line instead of nothing", async () => {
    adult = state({ lock: "off", can_clear: false, can_mark: true, line: "Marked NSFW, lock removed." });
    markStatus = 403;
    const view = mount();
    await waitFor(() => expect(view.getByRole("button", { name: "Mark as NSFW" })).toBeTruthy());
    fireEvent.click(view.getByRole("button", { name: "Mark as NSFW" }));
    await waitFor(() => expect(view.container.textContent).toContain("Change this on your own screen."));
  });

  test("a card the lock turned back into the one tile draws the tile and nothing else", async () => {
    cardOverride = { locked: true, making: false };
    const view = mount();
    await waitFor(() => expect(view.container.querySelector('[data-slot="lock-tile"]')).not.toBeNull());
    expect(view.container.textContent).not.toContain("paper boat");
    expect(view.queryByRole("button", { name: "Mark as NSFW" })).toBeNull();
  });
});

describe("nobody else sees the actions", () => {
  test("a card with no adult state (another person, a minor, a clip still being made) shows neither action", async () => {
    adult = null;
    const view = mount();
    await waitFor(() => expect(view.container.querySelector("video")).not.toBeNull());
    expect(view.queryByRole("button", { name: "Unmark as NSFW" })).toBeNull();
    expect(view.queryByRole("button", { name: "Mark as NSFW" })).toBeNull();
  });
});
