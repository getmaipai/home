// ADULT-LOCK-03b and -05: the page's side of the lock (lib/adultLock.ts): the in-memory proof, blob sources, the fetch choke point, the flag-flip watch.
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { ADULT_PROOF_HEADER, trackAdultElement, adultBlobUrl, adultResponse, forgetOpenIds, getAdultProof, installAdultFetch, isAdultBlobUrl, onAdultFlip, revokeAdultBlobs, setAdultProof, unloadAdultElements } from "@/lib/adultLock";

const originalFetch = globalThis.fetch;
const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;
let seen: Array<{ url: string; proof: string | null }> = [];
let revoked: string[] = [];
let n = 0;

beforeEach(() => {
  seen = []; revoked = []; n = 0;
  setAdultProof(null); revokeAdultBlobs(); forgetOpenIds(); unloadAdultElements();
  URL.createObjectURL = (() => `blob:test/${++n}`) as typeof URL.createObjectURL;
  URL.revokeObjectURL = ((url: string) => { revoked.push(url); }) as typeof URL.revokeObjectURL;
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    seen.push({ url, proof: new Headers(init?.headers).get(ADULT_PROOF_HEADER) });
    return Promise.resolve(new Response("bytes"));
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch; URL.createObjectURL = realCreate; URL.revokeObjectURL = realRevoke;
  setAdultProof(null); revokeAdultBlobs();
});

describe("blob sources", () => {
  test("an adult-only row's picture and clip become blob URLs fetched with the proof; an open row is left alone", async () => {
    setAdultProof("p1");
    const rows = [
      { id: "a", adult_only: true, src: "/api/files/a/content", still: "/api/files/a/thumb", title: "kept" },
      { id: "b", src: "/api/files/b/content", thumbnail: "/api/files/b/thumb" },
    ];
    await adultResponse(rows);
    expect(rows[0]!.src).toStartWith("blob:test/");
    expect(rows[0]!.still).toStartWith("blob:test/");
    expect(rows[1]!.src).toBe("/api/files/b/content");
    expect(seen.map((s) => s.url).sort()).toEqual(["/api/files/a/content", "/api/files/a/thumb"]);
    expect(seen.every((s) => s.proof === "p1")).toBe(true);
    expect(isAdultBlobUrl(rows[0]!.src as string)).toBe(true);
  });

  test("VIDEO-STUDIO-07: a Studio clip row's pieces, lanes down, are read by their own flags; an open piece in an adult-only row is left alone", async () => {
    setAdultProof("p1");
    const rows = [{ id: "c", adult_only: true, poster: "/api/videos/jobs/j/files/p", lanes: [{ id: "video", pieces: [{ id: "clip-1", adult_only: true, src: "/api/videos/jobs/j/files/c", poster: "/api/videos/jobs/j/files/p" }, { id: "clip-2", src: "/api/open/c2" }] }] }];
    await adultResponse(rows);
    const pieces = (rows[0]!.lanes[0] as { pieces: Array<{ src: string; poster?: string }> }).pieces;
    expect(rows[0]!.poster).toStartWith("blob:test/");
    expect(pieces[0]!.src).toStartWith("blob:test/");
    expect(pieces[0]!.poster).toStartWith("blob:test/");
    expect(pieces[1]!.src).toBe("/api/open/c2");
    expect(seen.every((s) => s.proof === "p1")).toBe(true);
  });

  test("without a proof nothing is fetched into a blob", async () => {
    const rows = [{ id: "a", adult_only: true, src: "/api/files/a/content" }];
    await adultResponse(rows);
    expect(rows[0]!.src).toBe("/api/files/a/content");
    expect(seen).toEqual([]);
  });

  test("a refused picture (404) becomes null, never the raw address", async () => {
    setAdultProof("p1");
    globalThis.fetch = (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch;
    const rows = [{ id: "a", adult_only: true, src: "/api/files/a/content" }];
    await adultResponse(rows);
    expect(rows[0]!.src).toBeNull();
  });

  test("the same path is fetched once, and relock revokes every URL made", async () => {
    setAdultProof("p1");
    const first = await adultBlobUrl("/api/files/a/content");
    expect(await adultBlobUrl("/api/files/a/content")).toBe(first);
    await adultBlobUrl("/api/files/b/content");
    expect(seen.length).toBe(2);
    revokeAdultBlobs();
    expect(revoked.sort()).toEqual(["blob:test/1", "blob:test/2"]);
    expect(isAdultBlobUrl(first)).toBe(false);
  });

  test("a clip that finishes loading after the relock is dropped and revoked", async () => {
    setAdultProof("p1");
    const pending = adultBlobUrl("/api/files/a/content");
    setAdultProof(null);
    expect(await pending).toBeNull();
  });

  test("a picture drawn from one of our URLs is emptied on relock; any other picture is left", async () => {
    setAdultProof("p1");
    const url = (await adultBlobUrl("/api/files/a/thumb"))!;
    const ours = document.createElement("img"); ours.setAttribute("src", url);
    const other = document.createElement("img"); other.setAttribute("src", "/api/files/z/thumb");
    document.body.append(ours, other);
    unloadAdultElements();
    expect(ours.hasAttribute("src")).toBe(false);
    expect(other.getAttribute("src")).toBe("/api/files/z/thumb");
    ours.remove(); other.remove();
  });

  test("unloadAdultElements stops, empties and reloads only an element playing one of our URLs", async () => {
    setAdultProof("p1");
    const url = (await adultBlobUrl("/api/files/a/content"))!;
    const ours = document.createElement("video"); ours.setAttribute("src", url);
    const other = document.createElement("video"); other.setAttribute("src", "/api/files/z/content");
    document.body.append(ours, other);
    expect(unloadAdultElements()).toBe(1);
    expect(ours.hasAttribute("src")).toBe(false);
    expect(other.getAttribute("src")).toBe("/api/files/z/content");
    ours.remove(); other.remove();
  });
});

test("an element already removed from the page is still unloaded when it was tracked", async () => {
  setAdultProof("p1");
  const url = (await adultBlobUrl("/api/files/a/content"))!;
  const gone = document.createElement("video"); gone.setAttribute("src", url);
  trackAdultElement(gone);
  expect(unloadAdultElements()).toBe(1);
  expect(gone.hasAttribute("src")).toBe(false);
});

describe("a flag that flips on", () => {
  test("a row seen open and then adult-only is reported once", async () => {
    const heard: string[] = [];
    const off = onAdultFlip((id) => heard.push(id));
    await adultResponse([{ id: "x", title: "open" }]);
    await adultResponse([{ id: "x", adult_only: true }]);
    await adultResponse([{ id: "x", adult_only: true }]);
    off();
    expect(heard).toEqual(["x"]);
  });

  test("a row that was always adult-only (an unmark the other way, a first sight) is not a flip", async () => {
    const heard: string[] = [];
    const off = onAdultFlip((id) => heard.push(id));
    await adultResponse([{ id: "y", adult_only: true }]);
    off();
    expect(heard).toEqual([]);
  });
});

describe("the fetch choke point", () => {
  test("while unlocked every same-origin API call carries the proof; other addresses and a locked page carry none", async () => {
    const restore = installAdultFetch();
    try {
      await fetch("/api/plugins/video/data/recipes", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      expect(seen.at(-1)!.proof).toBeNull();
      setAdultProof("p9");
      await fetch("/api/plugins/video/data/recipes", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      expect(seen.at(-1)!.proof).toBe("p9");
      await fetch("https://example.com/api/x");
      expect(seen.at(-1)!.proof).toBeNull();
      await fetch(new Request("http://localhost/api/files/1/content"));
    } finally { restore(); }
    expect(globalThis.fetch).not.toBe(undefined);
  });

  test("a page-data answer's adult rows come back as blob URLs, and the proof is in no storage or cookie", async () => {
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      seen.push({ url, proof: new Headers(init?.headers).get(ADULT_PROOF_HEADER) });
      return Promise.resolve(url.startsWith("/api/plugins/") ? Response.json([{ id: "a", adult_only: true, src: "/api/files/a/content" }]) : new Response("bytes"));
    }) as unknown as typeof fetch;
    const restore = installAdultFetch();
    try {
      setAdultProof("p-secret");
      const rows = await (await fetch("/api/plugins/video/data/recipes", { method: "POST", body: "{}" })).json() as Array<{ src: string }>;
      expect(rows[0]!.src).toStartWith("blob:test/");
      expect(getAdultProof()).toBe("p-secret");
      for (const text of [JSON.stringify({ ...window.localStorage }), JSON.stringify({ ...window.sessionStorage }), document.cookie, window.location.href]) expect(text.includes("p-secret")).toBe(false);
    } finally { restore(); }
  });

  test("two installs share one wrapper and the original comes back only after both restore", () => {
    const before = globalThis.fetch;
    const one = installAdultFetch();
    const wrapped = globalThis.fetch;
    const two = installAdultFetch();
    expect(globalThis.fetch).toBe(wrapped);
    one();
    expect(globalThis.fetch).toBe(wrapped);
    two();
    expect(globalThis.fetch).toBe(before);
  });

  test("a rewritten body drops the stale length and encoding headers", async () => {
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      return Promise.resolve(url.startsWith("/api/plugins/")
        ? new Response(JSON.stringify([{ id: "a", adult_only: true, src: "/api/files/a/content" }]), { headers: { "content-type": "application/json", "content-length": "5", "content-encoding": "gzip" } })
        : new Response("bytes"));
    }) as unknown as typeof fetch;
    const restore = installAdultFetch();
    try {
      setAdultProof("p");
      const res = await fetch("/api/plugins/video/data/recipes", { method: "POST", body: "{}" });
      expect(res.headers.get("content-length")).toBeNull();
      expect(res.headers.get("content-encoding")).toBeNull();
      expect(((await res.json()) as Array<{ src: string }>)[0]!.src).toStartWith("blob:test/");
    } finally { restore(); }
  });

  test("restoring puts the original fetch back", () => {
    const before = globalThis.fetch;
    const restore = installAdultFetch();
    expect(globalThis.fetch).not.toBe(before);
    restore();
    expect(globalThis.fetch).toBe(before);
  });
});
