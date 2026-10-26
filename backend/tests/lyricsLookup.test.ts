import { describe, expect, test } from "bun:test";
import { lrclibUrl, lookupLyrics, parseSyncedLyrics, type LyricsQuery } from "@/lib/media/lyricsLookup";

const Q: LyricsQuery = { title: "T", artist: "A" };

function makeFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const doFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { doFetch, calls };
}

describe("lrclibUrl", () => {
  test("builds the base url without optional params", () => {
    expect(lrclibUrl({ title: "Bohemian Rhapsody", artist: "Queen" })).toBe(
      "https://lrclib.net/api/get?track_name=Bohemian+Rhapsody&artist_name=Queen",
    );
  });

  test("adds album_name and rounded duration when present", () => {
    expect(lrclibUrl({ title: "T", artist: "A", album: "A Night at the Opera", durationS: 245.4 })).toBe(
      "https://lrclib.net/api/get?track_name=T&artist_name=A&album_name=A+Night+at+the+Opera&duration=245",
    );
  });

  test("omits empty album and non-positive duration", () => {
    expect(lrclibUrl({ title: "T", artist: "A", album: "", durationS: 0 })).toBe(
      "https://lrclib.net/api/get?track_name=T&artist_name=A",
    );
  });

  test("encodes a & in the title", () => {
    expect(lrclibUrl({ title: "A & B", artist: "X" })).toBe("https://lrclib.net/api/get?track_name=A+%26+B&artist_name=X");
  });
});

describe("parseSyncedLyrics", () => {
  test("turns stamped lines into timed lines in sorted order", () => {
    expect(parseSyncedLyrics("[01:23.45] some words\n[00:05.00] early\n")).toEqual([
      { t: 5, line: "early" },
      { t: 83.45, line: "some words" },
    ]);
  });

  test("a line with two stamps yields one entry per stamp", () => {
    expect(parseSyncedLyrics("[00:10.00][01:00.50] chorus\n")).toEqual([
      { t: 10, line: "chorus" },
      { t: 60.5, line: "chorus" },
    ]);
  });

  test("skips lines without a valid stamp and keeps a stamped blank line", () => {
    expect(parseSyncedLyrics("[ar:Someone]\n[00:00.00]\nno stamp here\n")).toEqual([{ t: 0, line: "" }]);
  });

  test("sorts out-of-order input by time", () => {
    expect(parseSyncedLyrics("[02:00.00] second\n[00:30.00] first\n")).toEqual([
      { t: 30, line: "first" },
      { t: 120, line: "second" },
    ]);
  });
});

describe("lookupLyrics", () => {
  test("200 with both fields returns a hit with trimmed plain text and timed lines", async () => {
    const { doFetch } = makeFetch(200, { plainLyrics: "  hello world \n", syncedLyrics: "[01:23.45] some words" });
    await expect(lookupLyrics(Q, { fetch: doFetch })).resolves.toEqual({
      outcome: "hit",
      text: "hello world",
      timed: [{ t: 83.45, line: "some words" }],
    });
  });

  test("200 with only plainLyrics returns a hit without timed", async () => {
    const { doFetch } = makeFetch(200, { plainLyrics: "just plain" });
    await expect(lookupLyrics(Q, { fetch: doFetch })).resolves.toEqual({ outcome: "hit", text: "just plain" });
  });

  test("200 with only syncedLyrics returns a hit built from the stamped lines", async () => {
    const { doFetch } = makeFetch(200, { syncedLyrics: "[00:01.00] a\n[00:02.00] b" });
    await expect(lookupLyrics(Q, { fetch: doFetch })).resolves.toEqual({
      outcome: "hit",
      text: "a\nb",
      timed: [
        { t: 1, line: "a" },
        { t: 2, line: "b" },
      ],
    });
  });

  test("200 with neither field is a miss", async () => {
    const { doFetch } = makeFetch(200, { plainLyrics: "", syncedLyrics: "" });
    await expect(lookupLyrics(Q, { fetch: doFetch })).resolves.toEqual({ outcome: "miss" });
  });

  test("404 is a miss", async () => {
    const { doFetch } = makeFetch(404, null);
    await expect(lookupLyrics(Q, { fetch: doFetch })).resolves.toEqual({ outcome: "miss" });
  });

  test("429 and 503 are refused", async () => {
    for (const status of [429, 503]) {
      const { doFetch } = makeFetch(status, null);
      await expect(lookupLyrics(Q, { fetch: doFetch })).resolves.toEqual({ outcome: "refused" });
    }
  });

  test("a thrown fetch is refused", async () => {
    const doFetch = (async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    await expect(lookupLyrics(Q, { fetch: doFetch })).resolves.toEqual({ outcome: "refused" });
  });

  test("the request carries credentials omit, the right headers and no cookie", async () => {
    const { doFetch, calls } = makeFetch(200, { plainLyrics: "x" });
    await lookupLyrics(Q, { fetch: doFetch });
    expect(calls[0]?.url).toBe("https://lrclib.net/api/get?track_name=T&artist_name=A");
    expect(calls[0]?.init.credentials).toBe("omit");
    expect(calls[0]?.init.referrerPolicy).toBe("no-referrer");
    const headers = calls[0]?.init.headers as Record<string, string> | undefined;
    expect(headers?.["User-Agent"]).toBe("MaiPai-Home");
    expect(headers?.["Accept"]).toBe("application/json");
    expect(headers?.["Cookie"]).toBeUndefined();
  });
});
