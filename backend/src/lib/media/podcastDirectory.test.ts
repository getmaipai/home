import { beforeEach, describe, expect, test } from "bun:test";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { directoryAllowed, searchDirectory, topShows, __resetDirectoryForTests, type DirectoryDeps } from "@/lib/media/podcastDirectory";

const SEARCH = { results: [
  { collectionId: 1, collectionName: "Cabin Radio", artistName: "Sage", feedUrl: "https://feeds.example.com/cabin.xml", artworkUrl600: "https://img.example.com/c.jpg", primaryGenreName: "Comedy", collectionExplicitness: "notExplicit" },
  { collectionId: 2, collectionName: "No Feed", artistName: "X" },
  { collectionId: 3, collectionName: "Loud", artistName: "Y", feedUrl: "http://feeds.example.com/loud.xml", collectionExplicitness: "explicit" },
] };
const CHARTS = { feed: { results: [{ id: "10", name: "Top One", artistName: "A", artworkUrl100: "https://img.example.com/1.jpg" }, { id: "11", name: "Top Two", artistName: "B" }] } };
const LOOKUP = { results: [{ collectionId: 10, feedUrl: "https://feeds.example.com/one.xml" }, { collectionId: 11, feedUrl: "https://feeds.example.com/two.xml" }] };

let urls: string[];
const deps = (answer: (url: string) => unknown, status = 200): DirectoryDeps => ({
  fetch: (async (url: string) => { urls.push(url); return new Response(JSON.stringify(answer(url)), { status }); }) as unknown as typeof fetch,
  nowMs: () => 1_000_000,
});
beforeEach(() => { urls = []; __resetDirectoryForTests(); __resetRateLimiterForTests(); });

describe("who may use the directory", () => {
  const person = (band: "adult" | "teen" | "child") => ({ band });
  test("off for everyone until the household switch is on", () => {
    for (const band of ["adult", "teen", "child"] as const) expect(directoryAllowed(person(band), { enabled: false, teens: true })).toBe(false);
  });
  test("adults when on", () => expect(directoryAllowed(person("adult"), { enabled: true, teens: false })).toBe(true));
  test("teens only with the teen switch", () => {
    expect(directoryAllowed(person("teen"), { enabled: true, teens: false })).toBe(false);
    expect(directoryAllowed(person("teen"), { enabled: true, teens: true })).toBe(true);
  });
  test("a child never, whatever the switches say", () => expect(directoryAllowed(person("child"), { enabled: true, teens: true })).toBe(false));
});

describe("search", () => {
  test("shapes iTunes results, drops rows without a feed, upgrades http feeds to https, flags explicit", async () => {
    const out = await searchDirectory("cabin", deps(() => SEARCH));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.shows).toEqual([
      { id: "1", title: "Cabin Radio", author: "Sage", feed_url: "https://feeds.example.com/cabin.xml", art: "https://img.example.com/c.jpg", genre: "Comedy", explicit: false },
      { id: "3", title: "Loud", author: "Y", feed_url: "https://feeds.example.com/loud.xml", art: null, genre: null, explicit: true },
    ]);
    expect(new URL(urls[0]!).host).toBe("itunes.apple.com");
    expect(new URL(urls[0]!).searchParams.get("term")).toBe("cabin");
    expect(new URL(urls[0]!).searchParams.get("media")).toBe("podcast");
  });
  test("an empty or very short search makes no request", async () => {
    const out = await searchDirectory("  ", deps(() => SEARCH));
    expect(out).toEqual({ ok: true, shows: [] });
    expect(urls).toEqual([]);
  });
  test("a refusal from the directory says what to do and pauses further requests", async () => {
    const first = await searchDirectory("cabin", deps(() => ({}), 429));
    expect(first).toEqual({ ok: false, status: 502, error: "The podcast directory did not answer. Try again in a few minutes." });
    const second = await searchDirectory("cabin", deps(() => SEARCH));
    expect(second.ok).toBe(false);
    expect(urls.length).toBe(1);
  });
  test("a network failure is the same plain error", async () => {
    const out = await searchDirectory("cabin", { fetch: (async () => { throw new Error("down"); }) as unknown as typeof fetch, nowMs: () => 1 });
    expect(out.ok).toBe(false);
  });
  test("the request budget is a person's pace, not a flood", async () => {
    let refused = 0;
    for (let i = 0; i < 12; i++) {
      const out = await searchDirectory(`term ${i}`, deps(() => SEARCH));
      if (!out.ok) refused += 1;
    }
    expect(refused).toBeGreaterThan(0);
  });
});

describe("charts", () => {
  test("reads the top list then looks up the feed addresses in one request", async () => {
    const out = await topShows(deps((url) => (url.includes("rss.marketingtools.apple.com") ? CHARTS : LOOKUP)));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.shows.map((s) => [s.title, s.feed_url])).toEqual([["Top One", "https://feeds.example.com/one.xml"], ["Top Two", "https://feeds.example.com/two.xml"]]);
    expect(urls.length).toBe(2);
    expect(new URL(urls[1]!).searchParams.get("id")).toBe("10,11");
  });
});

describe("cover art", () => {
  const { artAddressOk, artProxyAddress, fetchDirectoryArt, smallArt } = require("@/lib/media/podcastDirectory") as typeof import("@/lib/media/podcastDirectory");
  const png = new Uint8Array([137, 80, 78, 71]);
  const art = (body: Uint8Array, type = "image/png", status = 200): DirectoryDeps => ({ fetch: (async () => new Response(body, { status, headers: { "content-type": type } })) as unknown as typeof fetch, nowMs: () => 1 });
  test("only https pictures on Apple's image host", () => {
    expect(artAddressOk("https://is1-ssl.mzstatic.com/image/a.jpg")).toBe(true);
    for (const bad of ["http://is1-ssl.mzstatic.com/a.jpg", "https://evil.example.com/a.jpg", "https://mzstatic.com.evil.example/a.jpg", "https://user:pw@a.mzstatic.com/a.jpg", "not a url", "file:///etc/passwd"]) expect(artAddressOk(bad)).toBe(false);
  });
  test("a list tile asks for the small size, through Home's own address", () => {
    expect(smallArt("https://is1-ssl.mzstatic.com/image/x/600x600bb.jpg")).toBe("https://is1-ssl.mzstatic.com/image/x/200x200bb.jpg");
    expect(artProxyAddress("https://is1-ssl.mzstatic.com/image/x/600x600bb.jpg")).toStartWith("/api/plugins/podcasts/directory/art?u=");
    expect(artProxyAddress(null)).toBeNull();
  });
  test("a picture is returned, a wrong type, empty body or oversize body is not", async () => {
    const ok = "https://is1-ssl.mzstatic.com/a.png";
    expect((await fetchDirectoryArt(ok, art(png)))?.type).toBe("image/png");
    expect(await fetchDirectoryArt(ok, art(png, "image/svg+xml"))).toBeNull();
    expect(await fetchDirectoryArt(ok, art(png, "text/html"))).toBeNull();
    expect(await fetchDirectoryArt(ok, art(new Uint8Array(0)))).toBeNull();
    expect(await fetchDirectoryArt(ok, art(new Uint8Array(1024 * 1024 + 1)))).toBeNull();
    expect(await fetchDirectoryArt(ok, art(png, "image/png", 404))).toBeNull();
  });
  test("an address off Apple's host makes no request", async () => {
    let calls = 0;
    const deps2: DirectoryDeps = { fetch: (async () => { calls += 1; return new Response(png); }) as unknown as typeof fetch, nowMs: () => 1 };
    expect(await fetchDirectoryArt("https://evil.example.com/a.png", deps2)).toBeNull();
    expect(calls).toBe(0);
  });
});
