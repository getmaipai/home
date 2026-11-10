// MEDIA-PARITY-02: Save for offline keeps or removes the song's copy through the existing offline mechanism and reports the list to the hub.
import { afterEach, beforeEach, expect, mock, test } from "bun:test";

const kept: Array<{ kind: string; id: string }> = [];
const keepCalls: unknown[] = [];
let keepResult: { ok: true } | { ok: false; code: string; message: string } = { ok: true };
import { offlineIdOf, reportKeptSongs, toggleKeptSong, type KeptDeps } from "@/shell/media/keptTracks";
const deps = {
  listKept: async () => kept,
  keepOnDevice: async (item: { kind: string; id: string }) => { keepCalls.push(item); if (keepResult.ok) kept.push(item); return keepResult; },
  removeFromDevice: async (item: { kind: string; id: string }) => { const at = kept.findIndex((entry) => entry.id === item.id); if (at >= 0) kept.splice(at, 1); },
} as unknown as KeptDeps;

const realFetch = globalThis.fetch;
let posted: Array<{ url: string; body: unknown }> = [];
beforeEach(() => {
  kept.length = 0; keepCalls.length = 0; posted = []; keepResult = { ok: true };
  globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => { posted.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null }); return Promise.resolve(Response.json({ ok: true, count: 0 })); }) as unknown as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

test("only an offline: id is a Save for offline ask", () => {
  expect(offlineIdOf("offline:media-a")).toBe("media-a");
  expect(offlineIdOf("offline:")).toBeNull();
  expect(offlineIdOf("media-a")).toBeNull();
  expect(offlineIdOf("story")).toBeNull();
});

test("saving keeps the copy, tells the hub, and the next press removes it", async () => {
  expect(await toggleKeptSong("media-a", deps)).toMatch(/Saved on this device/);
  expect(keepCalls).toEqual([{ kind: "media", id: "media-a" }]);
  expect(posted.at(-1)).toEqual({ url: "/api/plugins/music/offline", body: { ids: ["media-a"] } });
  expect(await toggleKeptSong("media-a", deps)).toMatch(/Removed from this device/);
  expect(posted.at(-1)!.body).toEqual({ ids: [] });
});

test("a refusal (Safari, no room, no permission) is shown in the message's own words and nothing is reported", async () => {
  keepResult = { ok: false, code: "useGo", message: "Use the MaiPai Go app to keep this on your phone." };
  expect(await toggleKeptSong("media-a", deps)).toBe("Use the MaiPai Go app to keep this on your phone.");
  expect(posted).toEqual([]);
});

test("the report is quiet when the hub cannot be reached", async () => {
  globalThis.fetch = mock(() => Promise.reject(new Error("offline"))) as unknown as typeof fetch;
  await reportKeptSongs(deps);
});
