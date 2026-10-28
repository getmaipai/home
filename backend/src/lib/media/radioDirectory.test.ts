import { beforeEach, describe, expect, test } from "bun:test";
import { __resetRateLimiterForTests as resetBuckets } from "@/lib/rateLimiter";
import { __resetRadioDirectoryForTests, findStations, radioDirectoryAllowed, stationOf } from "@/lib/media/radioDirectory";

const row = { stationuuid: "abc-1", name: " Cabin FM ", url_resolved: "https://stream.example.com/live.mp3", favicon: "http://img.example.com/a.png", tags: "Jazz, Blues ,,", countrycode: "us", codec: "MP3", bitrate: 128, hls: 0 };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => { __resetRadioDirectoryForTests(); resetBuckets(); });

describe("radioDirectoryAllowed", () => {
  test("switch off blocks everyone", () => expect(radioDirectoryAllowed({ band: "adult" }, false)).toBe(false));
  test("adults and teens with the switch on, never children", () => {
    expect(radioDirectoryAllowed({ band: "adult" }, true)).toBe(true);
    expect(radioDirectoryAllowed({ band: "teen" }, true)).toBe(true);
    expect(radioDirectoryAllowed({ band: "child" }, true)).toBe(false);
  });
});

describe("stationOf", () => {
  test("cleans the row", () => {
    expect(stationOf(row)).toEqual({ id: "abc-1", name: "Cabin FM", url: "https://stream.example.com/live.mp3", favicon: "https://img.example.com/a.png", tags: ["jazz", "blues"], country_code: "US", codec: "mp3", bitrate_kbps: 128, hls: false });
  });
  test("flags HLS and rejects rows without an address or name", () => {
    expect(stationOf({ ...row, url_resolved: "https://x.example.com/p.m3u8" })?.hls).toBe(true);
    expect(stationOf({ ...row, url_resolved: "", url: "" })).toBeNull();
    expect(stationOf({ ...row, name: "" })).toBeNull();
  });
});

describe("findStations", () => {
  test("popular lists stations from the first mirror", async () => {
    const seen: string[] = [];
    const out = await findStations({ kind: "popular" }, { fetch: (async (url: string) => { seen.push(url); return reply([row]); }) as unknown as typeof fetch });
    expect(out.ok && out.stations.map((s) => s.name)).toEqual(["Cabin FM"]);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("/json/stations/topclick/");
  });
  test("search sends the exact country code and nothing else about the household", async () => {
    let url = "";
    await findStations({ kind: "search", name: "jazz", country: "de" }, { fetch: (async (u: string) => { url = u; return reply([]); }) as unknown as typeof fetch });
    expect(url).toContain("countrycode=DE");
    expect(url).toContain("countrycodeexact=true");
    expect(url).toContain("name=jazz");
  });
  test("an empty search makes no request", async () => {
    let calls = 0;
    const out = await findStations({ kind: "search" }, { fetch: (async () => { calls += 1; return reply([]); }) as unknown as typeof fetch });
    expect(out).toEqual({ ok: true, stations: [] });
    expect(calls).toBe(0);
  });
  test("a refusing mirror is skipped", async () => {
    let calls = 0;
    const out = await findStations({ kind: "popular" }, { fetch: (async () => { calls += 1; return calls === 1 ? reply({}, 503) : reply([row]); }) as unknown as typeof fetch });
    expect(out.ok).toBe(true);
    expect(calls).toBe(2);
  });
  test("every mirror refusing pauses the directory for an hour", async () => {
    let calls = 0;
    const fail = (async () => { calls += 1; return reply({}, 500); }) as unknown as typeof fetch;
    const t0 = 1_000_000;
    expect((await findStations({ kind: "popular" }, { fetch: fail, nowMs: () => t0 })).ok).toBe(false);
    expect(calls).toBe(3);
    expect((await findStations({ kind: "popular" }, { fetch: fail, nowMs: () => t0 + 1000 })).ok).toBe(false);
    expect(calls).toBe(3);
  });
});
