// RADIO-03: playing a saved station through the hub. A fake upstream (an injected fetch, no sockets) stands in for the station: the
// audio comes out without the in-band metadata, the song title is served from memory, every redirect hop is re-checked, a page that is
// not audio is refused, HLS says "not supported yet", a child plays only what a parent saved, and the stream caps hold.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { __setRadioStreamDepsForTests } from "@/routes/radioApp";
import { __resetRadioDirectoryForTests, rememberPreviewStations } from "@/lib/media/radioDirectory";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __resetRadioStreamsForTests, MAX_STREAMS_PER_HOME, openStationStream } from "@/lib/media/radioStream";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { child, owner, teen } from "./support/testAuth";
import { resetDb } from "./reset-db";

const BASE = "/api/plugins/music/radio";
const enc = new TextEncoder();
const audio = (n: number, seed: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + seed) & 0xff);
const A1 = audio(8192, 1), A2 = audio(8192, 2);
const META = (() => {
  const body = enc.encode("StreamTitle='Blue Hour - Cabin Trio';");
  const out = new Uint8Array(1 + Math.ceil(body.length / 16) * 16);
  out[0] = out.length >> 4;
  out.set(body, 1);
  return out;
})();
const concat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };
const ICY_STREAM = concat(A1, META, A2);

/** A body that delivers `bytes` in uneven chunks, then ends, and records whether the reader cancelled it. */
function body(bytes: Uint8Array, state: { cancelled: boolean }, endless = false): ReadableStream<Uint8Array> {
  let at = 0;
  return new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (at >= bytes.length) { if (!endless) ctrl.close(); return new Promise<void>(() => undefined); }
      ctrl.enqueue(bytes.subarray(at, at + 3000));
      at += 3000;
    },
    cancel() { state.cancelled = true; },
  });
}

interface Call { url: string; headers: Record<string, string>; init: RequestInit }
let calls: Call[];
let handler: (url: URL, call: number) => Response;
const publicDns = async () => ({ address: "93.184.216.34", family: 4 });
beforeEach(() => {
  resetDb();
  __resetRateLimiterForTests();
  __resetRadioStreamsForTests();
  __resetRadioDirectoryForTests();
  setHouseholdSettingValue("radio.directory.enabled", true);
  calls = [];
  handler = () => new Response(null, { status: 404 });
  __setRadioStreamDepsForTests({
    dnsLookup: publicDns,
    fetch: (async (input: URL | string, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(String(input));
      calls.push({ url: url.href, headers: (init?.headers ?? {}) as Record<string, string>, init: init ?? {} });
      return handler(url, calls.length);
    }) as typeof fetch,
  });
});
afterEach(() => { __setRadioStreamDepsForTests({}); __resetRadioStreamsForTests(); });

const icyResponse = (state = { cancelled: false }, extra: Record<string, string> = {}) =>
  new Response(body(ICY_STREAM, state), { status: 200, headers: { "content-type": "audio/mpeg", "icy-metaint": "8192", ...extra } });
const save = async (client: { post: (p: string, b: unknown) => Promise<Response> }, name: string, url: string, extra: Record<string, unknown> = {}) =>
  ((await (await client.post(`${BASE}/stations`, { name, url, ...extra })).json()) as { station: { id: string } }).station.id;

describe("the stream route", () => {
  test("an adult plays a saved station: audio without metadata, upstream asked for ICY, no cookie or referrer", async () => {
    handler = () => icyResponse();
    const { client } = await owner();
    const id = await save(client, "Cabin FM", "https://stream.example.com/cabin.mp3");
    const response = await client.get(`${BASE}/stream/${id}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(response.headers.get("icy-metaint")).toBeNull();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(concat(A1, A2));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers["Icy-MetaData"]).toBe("1");
    expect(Object.keys(calls[0]!.headers).map((key) => key.toLowerCase())).not.toContain("cookie");
    expect(calls[0]!.init.credentials).toBe("omit");
    expect(calls[0]!.init.referrerPolicy).toBe("no-referrer");
    expect(calls[0]!.init.redirect).toBe("manual");
  });

  test("the song title is served from memory while the stream is open, and gone after it closes", async () => {
    const state = { cancelled: false };
    handler = () => new Response(body(ICY_STREAM, state, true), { status: 200, headers: { "content-type": "audio/mpeg", "icy-metaint": "8192" } });
    const { client } = await owner();
    const id = await save(client, "Cabin FM", "https://stream.example.com/cabin.mp3");
    expect(((await (await client.get(`${BASE}/now/${id}`)).json()) as { title: string | null }).title).toBeNull();
    const response = await client.get(`${BASE}/stream/${id}`);
    const reader = response.body!.getReader();
    let got = 0;
    while (got < 16384) got += (await reader.read()).value!.length;
    expect(((await (await client.get(`${BASE}/now/${id}`)).json()) as { title: string | null }).title).toBe("Blue Hour - Cabin Trio");
    await reader.cancel();
    expect(state.cancelled).toBe(true);
    expect(((await (await client.get(`${BASE}/now/${id}`)).json()) as { title: string | null }).title).toBeNull();
  });

  test("a station without ICY plays as it is", async () => {
    handler = () => new Response(body(A1, { cancelled: false }), { status: 200, headers: { "content-type": "audio/aac" } });
    const { client } = await owner();
    const id = await save(client, "Plain", "https://stream.example.com/plain.aac");
    const response = await client.get(`${BASE}/stream/${id}`);
    expect(response.headers.get("content-type")).toBe("audio/aac");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(A1);
  });

  test("a teen plays their saved station", async () => {
    handler = () => icyResponse();
    const { client } = await owner();
    const teenClient = await teen(client);
    const id = await save(teenClient, "Cabin FM", "https://stream.example.com/cabin.mp3", { tags: ["jazz"] });
    expect((await teenClient.get(`${BASE}/stream/${id}`)).status).toBe(200);
  });

  test("a child plays what a parent saved and nothing else", async () => {
    handler = () => icyResponse();
    const { client } = await owner();
    const { client: childClient, row } = await child(client);
    const mine = await save(client, "Parent Jazz", "https://stream.example.com/parent.mp3");
    const forChild = await save(client, "Kids Tunes", "https://stream.example.com/kids.mp3", { for_person_id: row.id });
    expect((await childClient.get(`${BASE}/stream/${mine}`)).status).toBe(404);
    expect((await childClient.get(`${BASE}/now/${mine}`)).status).toBe(404);
    const ok = await childClient.get(`${BASE}/stream/${forChild}`);
    expect(ok.status).toBe(200);
    await ok.body!.cancel();
    expect(calls.map((call) => call.url)).toEqual(["https://stream.example.com/kids.mp3"]);
  });

  test("an adult cannot play a station saved for a child, and an unsaved id is 404 without any request", async () => {
    const { client } = await owner();
    const { row } = await child(client);
    const forChild = await save(client, "Kids Tunes", "https://stream.example.com/kids.mp3", { for_person_id: row.id });
    expect((await client.get(`${BASE}/stream/${forChild}`)).status).toBe(404);
    expect((await client.get(`${BASE}/stream/not-a-station`)).status).toBe(404);
    expect(calls).toEqual([]);
  });

  test("playing needs the person to be signed in", async () => {
    const { TestClient } = await import("./client");
    expect((await new TestClient().get(`${BASE}/stream/x`)).status).toBe(401);
  });

  test("an HLS station is served as a rewritten same-origin playlist (RADIO-06)", async () => {
    const { client } = await owner();
    const id = await save(client, "Hill HLS", "https://stream.example.com/hill.m3u8");
    handler = () => new Response("#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\nhttps://stream.example.com/seg1.ts\n", { status: 200, headers: { "content-type": "application/vnd.apple.mpegurl" } });
    const response = await client.get(`${BASE}/stream/${id}`);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("#EXTM3U");
    expect(body).toContain(`/hls/${id}/resource/`);
    expect(body).not.toContain("https://stream.example.com/seg1.ts");
  });

  test("a directory HLS preview rewrites its playlist and serves previewed segments", async () => {
    const { client } = await owner();
    const preview = { id: "dir-hls", name: "RTL", url: "https://stream.example.com/rtl.m3u8", favicon: null, tags: ["pop"], country_code: null, codec: "aac", bitrate_kbps: 128, hls: true };
    rememberPreviewStations("household", [preview]);
    handler = (url) => url.pathname.endsWith(".m3u8")
      ? new Response("#EXTM3U\n#EXTINF:4,\nhttps://stream.example.com/segment.ts\n", { status: 200, headers: { "content-type": "application/vnd.apple.mpegurl" } })
      : new Response(A1, { status: 200, headers: { "content-type": "video/mp2t" } });
    const playlist = await client.get(`${BASE}/preview/${preview.id}`);
    expect(playlist.status).toBe(200);
    const text = await playlist.text();
    expect(text).toContain(`/hls/${preview.id}/resource/`);
    expect(text).not.toContain("https://stream.example.com/segment.ts");
    const resourcePath = new URL(text.split("\n").at(-2)!, "http://home").pathname;
    const segment = await client.get(resourcePath);
    expect(segment.status).toBe(200);
    expect(new Uint8Array(await segment.arrayBuffer())).toEqual(A1);
    expect((await client.get(`${BASE}/preview/missing`)).status).toBe(404);
    const { client: childClient } = await child(client);
    expect((await childClient.get(`${BASE}/preview/${preview.id}`)).status).toBe(403);
  });

  test("a directory audio/mpeg preview still streams directly", async () => {
    handler = () => icyResponse();
    const { client } = await owner();
    const preview = { id: "dir-mp3", name: "Cabin", url: "https://stream.example.com/cabin.mp3", favicon: null, tags: ["jazz"], country_code: null, codec: "mp3", bitrate_kbps: 128, hls: false };
    rememberPreviewStations("household", [preview]);
    const response = await client.get(`${BASE}/preview/${preview.id}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    await response.body!.cancel();
  });

  test("a playlist content type is treated as HLS, and a web page is refused", async () => {
    const { client } = await owner();
    const id = await save(client, "Odd", "https://stream.example.com/odd");
    handler = () => new Response("#EXTM3U", { status: 200, headers: { "content-type": "application/vnd.apple.mpegurl" } });
    expect((await client.get(`${BASE}/stream/${id}`)).status).toBe(415);
    handler = () => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } });
    const page = await client.get(`${BASE}/stream/${id}`);
    expect(page.status).toBe(502);
    expect(((await page.json()) as { error: string }).error).toContain("not an audio stream");
    handler = () => new Response("nope", { status: 503, headers: { "content-type": "audio/mpeg" } });
    expect((await client.get(`${BASE}/stream/${id}`)).status).toBe(502);
  });
});

describe("the address guard on every hop", () => {
  test("a redirect to a private address is refused and never requested", async () => {
    handler = (url) => (url.hostname === "stream.example.com" ? new Response(null, { status: 302, headers: { location: "https://10.0.0.5/live.mp3" } }) : icyResponse());
    const { client } = await owner();
    const id = await save(client, "Cabin FM", "https://stream.example.com/cabin.mp3");
    const response = await client.get(`${BASE}/stream/${id}`);
    expect(response.status).toBe(422);
    expect(calls.map((call) => call.url)).toEqual(["https://stream.example.com/cabin.mp3"]);
  });

  test("a redirect to a name that resolves to a private address is refused", async () => {
    __setRadioStreamDepsForTests({ ...{ fetch: (async (input: URL) => { calls.push({ url: String(input), headers: {}, init: {} }); return calls.length === 1 ? new Response(null, { status: 301, headers: { location: "https://sneaky.example.net/a" } }) : icyResponse(); }) as unknown as typeof fetch }, dnsLookup: async (host) => (host === "sneaky.example.net" ? { address: "192.168.1.9", family: 4 } : { address: "93.184.216.34", family: 4 }) });
    const { client } = await owner();
    const id = await save(client, "Cabin FM", "https://stream.example.com/cabin.mp3");
    expect((await client.get(`${BASE}/stream/${id}`)).status).toBe(422);
    expect(calls).toHaveLength(1);
  });

  test("a redirect that leaves https for a station saved as https is refused", async () => {
    handler = () => new Response(null, { status: 302, headers: { location: "http://stream.example.com/cabin.mp3" } });
    const { client } = await owner();
    const id = await save(client, "Cabin FM", "https://stream.example.com/cabin.mp3");
    expect((await client.get(`${BASE}/stream/${id}`)).status).toBe(422);
    expect(calls).toHaveLength(1);
  });

  test("a directory station listed as http may play over http, and follows up to four redirects", async () => {
    const { setHouseholdSettingValue } = await import("@/lib/settings");
    setHouseholdSettingValue("radio.directory.enabled", true);
    let hops = 0;
    handler = () => (++hops <= 4 ? new Response(null, { status: 302, headers: { location: `http://stream.example.com/hop${hops}` } }) : icyResponse());
    const { client } = await owner();
    const id = await save(client, "Plain Http", "http://stream.example.com/live.mp3", { from: "directory" });
    const response = await client.get(`${BASE}/stream/${id}`);
    expect(response.status).toBe(200);
    await response.body!.cancel();
    expect(calls).toHaveLength(5);
  });

  test("a fifth redirect is one too many", async () => {
    handler = (_url, call) => new Response(null, { status: 302, headers: { location: `https://stream.example.com/hop${call}` } });
    const { client } = await owner();
    const id = await save(client, "Loop", "https://stream.example.com/loop");
    expect((await client.get(`${BASE}/stream/${id}`)).status).toBe(502);
    expect(calls).toHaveLength(5);
  });

  test("a station that does not answer in time gives a 504", async () => {
    __setRadioStreamDepsForTests({ dnsLookup: publicDns, connectTimeoutMs: 20, fetch: ((_url: URL, init: RequestInit) => new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)))) as unknown as typeof fetch });
    const { client } = await owner();
    const id = await save(client, "Slow", "https://stream.example.com/slow");
    expect((await client.get(`${BASE}/stream/${id}`)).status).toBe(504);
  });
});

describe("stream caps", () => {
  const station = (id: string) => ({ id, name: id, url: `https://${id}.example.com/s`, favicon: null, tags: [], country_code: null, codec: null, bitrate_kbps: null, hls: false, for_person_id: null, added_by_person_id: null });
  const deps = (state: { cancelled: boolean }) => ({ dnsLookup: publicDns, fetch: (async () => new Response(body(A1, state, true), { status: 200, headers: { "content-type": "audio/mpeg" } })) as unknown as typeof fetch });

  test("one station per person: a new play replaces the old stream", async () => {
    const first = { cancelled: false }, second = { cancelled: false };
    const one = await openStationStream("p1", station("a"), deps(first));
    expect(one.ok).toBe(true);
    const reader = (one as { response: Response }).response.body!.getReader();
    const two = await openStationStream("p1", station("b"), deps(second));
    expect(two.ok).toBe(true);
    expect(first.cancelled).toBe(true);
    await expect(reader.read()).resolves.toMatchObject({ done: true });
    await (two as { response: Response }).response.body!.cancel();
    expect(second.cancelled).toBe(true);
  });

  test("a home plays at most four at once, and a closed stream frees its place", async () => {
    const opened: Response[] = [];
    for (let i = 0; i < MAX_STREAMS_PER_HOME; i++) {
      const result = await openStationStream(`p${i}`, station(`s${i}`), deps({ cancelled: false }));
      expect(result.ok).toBe(true);
      opened.push((result as { response: Response }).response);
    }
    const refused = await openStationStream("p9", station("s9"), deps({ cancelled: false }));
    expect(refused).toMatchObject({ ok: false, status: 429 });
    // A person already playing may switch station when the home is full: their own stream is the one replaced.
    const swap = await openStationStream("p0", station("s0b"), deps({ cancelled: false }));
    expect(swap.ok).toBe(true);
    await opened[1]!.body!.cancel();
    const after = await openStationStream("p9", station("s9"), deps({ cancelled: false }));
    expect(after.ok).toBe(true);
  });

  test("the upstream is closed when the listener disconnects", async () => {
    const state = { cancelled: false };
    const abort = new AbortController();
    const result = await openStationStream("p1", station("a"), deps(state), abort.signal);
    expect(result.ok).toBe(true);
    abort.abort();
    await Bun.sleep(5);
    expect(state.cancelled).toBe(true);
  });
});
