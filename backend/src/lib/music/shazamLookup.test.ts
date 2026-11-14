import { beforeEach, describe, expect, test } from "bun:test";
import { RateLimiter } from "./identifyCore";
import { __resetShazamForTests, lookupShazam, parseShazam, SHAZAM_USER_AGENT, type ShazamOptions } from "./shazamLookup";
import type { Signature } from "./shazamSignature";

const signature: Signature = { sampleRate: 16000, samples: 192000, bands: [[{ pass: 1, magnitude: 2, bin: 3 }], [], [], []] };
const fixture = { track: { title: "Song", subtitle: "Artist", sections: [{ metadata: [{ title: "Album", text: "Record" }, { title: "Released", text: "1972" }] }] } };
const options = (over: ShazamOptions = {}): ShazamOptions => ({ now: () => 1000, limiter: new RateLimiter(20, () => 1000), uuid: () => "uuid", ...over });

beforeEach(() => __resetShazamForTests());

describe("Shazam lookup", () => {
  test("sends a signature, neutral location and UTC, never raw audio", async () => {
    let request: RequestInit | undefined;
    const fetch = (async (_url: string | URL | Request, init?: RequestInit) => { request = init; return Response.json(fixture); }) as unknown as typeof globalThis.fetch;
    const out = await lookupShazam(signature, options({ fetch }));
    expect(out.kind).toBe("ok");
    const body = JSON.parse(String(request?.body));
    expect(body.signature.uri).toStartWith("data:audio/vnd.shazam.sig;base64,");
    expect(body.geolocation).toEqual({ altitude: 0, latitude: 0, longitude: 0 });
    expect(body.timezone).toBe("UTC");
    expect(String(request?.body)).not.toContain("raw audio");
    expect(new Headers(request?.headers).get("User-Agent")).toBe(SHAZAM_USER_AGENT);
    expect(SHAZAM_USER_AGENT).toBe("MaiPai-Home");
  });
  test("429 starts a quiet period and prevents the next fetch", async () => {
    let calls = 0;
    const fetch = (async () => { calls++; return new Response("", { status: 429 }); }) as unknown as typeof globalThis.fetch;
    expect((await lookupShazam(signature, options({ fetch }))).kind).toBe("rate_limited");
    expect((await lookupShazam(signature, options({ fetch }))).kind).toBe("rate_limited");
    expect(calls).toBe(1);
  });
  test("5xx, rejecting fetch and an aborted signal fail", async () => {
    const fail = async () => new Response("", { status: 503 });
    expect(await lookupShazam(signature, options({ fetch: fail as unknown as typeof globalThis.fetch }))).toEqual({ kind: "failed" });
    expect(await lookupShazam(signature, options({ fetch: (async () => { throw new Error("offline"); }) as unknown as typeof globalThis.fetch }))).toEqual({ kind: "failed" });
    const controller = new AbortController(); controller.abort();
    let calls = 0;
    expect(await lookupShazam(signature, options({ signal: controller.signal, fetch: (async () => { calls++; return Response.json(fixture); }) as unknown as typeof globalThis.fetch }))).toEqual({ kind: "failed" });
    expect(calls).toBe(0);
  });
  test("parses album and release year and ignores a response without a track", () => {
    expect(parseShazam(fixture)).toMatchObject({ title: "Song", artist: "Artist", album: "Record", year: 1972, source: "shazam" });
    expect(parseShazam({ result: {} })).toBeNull();
  });
});
