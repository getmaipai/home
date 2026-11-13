import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useMusicDj } from "@/shell/musicDj";
import type { PlayerVoiceover } from "@maipai/ui/src/primitives/Player";

afterEach(cleanup);
const realFetch = globalThis.fetch;
const createUrl = URL.createObjectURL;
const revokeUrl = URL.revokeObjectURL;
afterEach(() => { globalThis.fetch = realFetch; URL.createObjectURL = createUrl; URL.revokeObjectURL = revokeUrl; });

let voiceover: PlayerVoiceover | undefined;
function Probe({ id }: { id: string }) { voiceover = useMusicDj({ id, appId: "audio" })?.voiceover; return null; }
function mount() { return render(<Probe id="song-1" />); }

describe("useMusicDj", () => {
  test("loads a line as a blob URL and exposes it only for the matching item", async () => {
    const urls: string[] = [];
    URL.createObjectURL = mock(() => { urls.push("blob:dj-1"); return "blob:dj-1"; });
    URL.revokeObjectURL = mock(() => {});
    globalThis.fetch = mock((input: RequestInfo | URL) => String(input).includes("/dj/line")
      ? Promise.resolve(new Response(new Blob(["audio"]), { status: 200 }))
      : Promise.resolve(new Response(null, { status: 204 }))) as unknown as typeof fetch;
    mount();
    await waitFor(() => expect(voiceover?.src).toBe("blob:dj-1"));
    expect(urls).toHaveLength(1);
    expect(voiceover?.firstLyricS).toBeUndefined();
  });

  test("204 is silent and does not expose a voiceover", async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response(null, { status: 204 }))) as unknown as typeof fetch;
    mount();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(voiceover).toBeUndefined();
  });

  test("prepares lines for the next songs from up_next and never touches the queue route", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const chain: Record<string, string | undefined> = { "song-1": "song-2", "song-2": "song-3", "song-3": "song-4" };
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: String(init?.body ?? "") });
      if (url.includes("/data/item")) {
        const id = JSON.parse(String(init?.body)).id as string;
        const up = chain[id];
        return Promise.resolve(new Response(JSON.stringify({ id, ...(up ? { up_next: { id: up } } : {}) }), { status: 200, headers: { "content-type": "application/json" } }));
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as unknown as typeof fetch;
    mount();
    await waitFor(() => expect(calls.some((c) => c.url.includes("/dj/prepare"))).toBe(true));
    const prepare = calls.find((c) => c.url.includes("/dj/prepare"))!;
    expect(JSON.parse(prepare.body)).toEqual({ after: "song-1", next: ["song-2", "song-3"] });
    expect(calls.some((c) => c.url.includes("/music/queue"))).toBe(false);
  });

  test("a request failure is silent", async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error("offline"))) as unknown as typeof fetch;
    mount();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(voiceover).toBeUndefined();
  });
});
