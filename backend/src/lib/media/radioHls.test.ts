import { afterEach, describe, expect, test } from "bun:test";
import { __resetRadioStreamsForTests, claimRadioSlot } from "./radioStream";
import { decodeHlsResource, openHlsResource } from "./radioHls";
import type { SavedStation } from "./radio";

const station: SavedStation = { id: "station-1", name: "Fixture", url: "https://fixture.example/live.m3u8", favicon: null, tags: [], country_code: "US", codec: "HLS", bitrate_kbps: null, hls: true, for_person_id: "person-1", added_by_person_id: "person-1" };
function fixture(): { origin: string; requests: string[]; fetcher: (input: string | URL | Request) => Promise<Response> } {
  const requests: string[] = [];
  const origin = "https://fixture.example";
  const fetcher = async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input)); requests.push(url.pathname);
    if (url.pathname === "/live.m3u8") return new Response("#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:1,\na.ts\n#EXTINF:1,\nb.ts\n#EXT-X-ENDLIST\n", { headers: { "content-type": "application/vnd.apple.mpegurl" } });
    if (url.pathname === "/a.ts" || url.pathname === "/b.ts") return new Response(new Uint8Array([0x47, 0x40, 0, 0]), { headers: { "content-type": "video/mp2t" } });
    return new Response(null, { status: 404 });
  };
  return { origin, requests, fetcher };
}
const depsFor = (source: ReturnType<typeof fixture>) => ({ fetch: source.fetcher as typeof fetch, dnsLookup: async () => ({ address: "93.184.216.34", family: 4 }) });
afterEach(() => { __resetRadioStreamsForTests(); });

describe("radio HLS proxy", () => {
  test("rewrites a playlist's two segment URIs through the same-origin route and serves segments", async () => {
    const source = fixture();
    const deps = depsFor(source);
    const playlist = await openHlsResource("p1", { ...station, url: `${source.origin}/live.m3u8` }, `${source.origin}/live.m3u8`, deps);
    expect(playlist.ok).toBe(true);
    if (!playlist.ok) return;
    const body = await playlist.response.text();
    expect(body.match(/\/hls\/station-1\/resource\//g)).toHaveLength(2);
    const tokens = [...body.matchAll(/\/hls\/station-1\/resource\/([^\n]+)/g)].map((match) => match[1]!);
    expect(tokens.map((token) => decodeHlsResource(token))).toEqual([`${source.origin}/a.ts`, `${source.origin}/b.ts`]);
    for (const token of tokens) {
      const opened = await openHlsResource("p1", station, decodeHlsResource(token)!, deps);
      expect(opened.ok).toBe(true);
      if (opened.ok) expect(new Uint8Array(await opened.response.arrayBuffer())).toEqual(new Uint8Array([0x47, 0x40, 0, 0]));
    }
    expect(source.requests).toEqual(["/live.m3u8", "/a.ts", "/b.ts"]);
  });

  test("refuses a private segment address before making a request", async () => {
    const result = await openHlsResource("p1", station, "http://private-fixture.example:8770/private.ts", { fetch: fetch as typeof globalThis.fetch, dnsLookup: async () => ({ address: "127.0.0.1", family: 4 }) });
    expect(result).toMatchObject({ ok: false, status: 422 });
  });

  test("shares the four-stream home cap with ordinary radio", async () => {
    const leases: Array<() => void> = [];
    for (let i = 0; i < 4; i++) {
      const lease = claimRadioSlot(`p${i}`, `s${i}`, (release) => leases.push(release));
      expect(typeof lease).toBe("function");
    }
    const capped = claimRadioSlot("p4", "s4", () => {});
    expect(capped).toMatchObject({ ok: false, status: 429 });
    leases.forEach((release) => release());
  });
});
