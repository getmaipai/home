// AUDIT-DUP-NET-01: the one guarded outbound GET behind the feed poller, podcast Save, radio streams and playlists, and the answer and news pictures.
import { beforeEach, describe, expect, test } from "bun:test";
import { SsrfBlockedError, type DnsLookup } from "@maipai/core/src/ssrfGuard";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { GuardedStop, guardedGet, RateLimited, RedirectLimitError, type GuardedGetOptions } from "@/lib/outbound";

beforeEach(() => __resetRateLimiterForTests());

const PRIVATE_HOSTS = new Set(["intranet.example", "metadata.example"]);
const dnsLookup: DnsLookup = async (host) => (PRIVATE_HOSTS.has(host) ? { address: "10.0.0.5", family: 4 } : { address: "93.184.216.34", family: 4 });

/** A fetcher that answers from a script of `url -> Response` and records each URL asked. */
function scripted(routes: Record<string, () => Response>) {
  const asked: string[] = [];
  const headersSeen: Array<Record<string, string>> = [];
  const fetcher = (async (input: string | URL, init: RequestInit) => {
    const url = String(input);
    asked.push(url);
    headersSeen.push({ ...(init.headers as Record<string, string>) });
    const route = routes[url];
    return route ? route() : new Response("missing", { status: 404 });
  }) as unknown as typeof fetch;
  return { fetcher, asked, headersSeen };
}
const redirect = (to: string, status = 302) => () => new Response(null, { status, headers: { location: to } });
const ok = (body = "ok") => () => new Response(body, { status: 200 });
const base = (fetcher: typeof fetch, extra: Partial<GuardedGetOptions> = {}): GuardedGetOptions => ({
  schemePolicy: "https", bucket: null, redirectCap: 3, signal: new AbortController().signal, fetch: fetcher, dnsLookup, ...extra,
});

describe("guardedGet scheme rules", () => {
  test("https policy: an http address, a data address and an address with credentials are refused before any request", async () => {
    const { fetcher, asked } = scripted({});
    for (const address of ["http://news.example/a", "ftp://news.example/a", "https://user:pass@news.example/a"]) {
      await expect(guardedGet(address, base(fetcher))).rejects.toBeInstanceOf(SsrfBlockedError);
    }
    expect(asked).toEqual([]);
  });

  test("https policy: a redirect from https to http is refused at that hop", async () => {
    const { fetcher, asked } = scripted({ "https://news.example/a": redirect("http://news.example/b") });
    await expect(guardedGet("https://news.example/a", base(fetcher))).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(asked).toEqual(["https://news.example/a"]);
  });

  test("http-after-http (radio): an http station may use http hops, an https station never drops to http", async () => {
    const station = scripted({ "http://radio.example/s": redirect("http://cdn.example/s"), "http://cdn.example/s": redirect("https://secure.example/s"), "https://secure.example/s": ok("audio") });
    const res = await guardedGet("http://radio.example/s", base(station.fetcher, { schemePolicy: "http-after-http", redirectCap: 4 }));
    expect(await res.text()).toBe("audio");
    expect(station.asked).toEqual(["http://radio.example/s", "http://cdn.example/s", "https://secure.example/s"]);

    const secure = scripted({ "https://radio.example/s": redirect("http://cdn.example/s") });
    await expect(guardedGet("https://radio.example/s", base(secure.fetcher, { schemePolicy: "http-after-http" }))).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(secure.asked).toEqual(["https://radio.example/s"]);
  });

  test("web policy (pictures): http and https are both fine on any hop, other schemes are not", async () => {
    const { fetcher, asked } = scripted({ "http://pics.example/a.jpg": redirect("https://cdn.example/a.jpg"), "https://cdn.example/a.jpg": ok("pixels") });
    expect(await (await guardedGet("http://pics.example/a.jpg", base(fetcher, { schemePolicy: "web" }))).text()).toBe("pixels");
    expect(asked).toHaveLength(2);
    await expect(guardedGet("file:///etc/passwd", base(fetcher, { schemePolicy: "web" }))).rejects.toBeInstanceOf(SsrfBlockedError);
  });
});

describe("guardedGet address guard", () => {
  test("a private first address is refused before any request", async () => {
    const { fetcher, asked } = scripted({});
    await expect(guardedGet("https://intranet.example/a", base(fetcher))).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(asked).toEqual([]);
  });

  test("a redirect to a private host is refused at every hop, however deep", async () => {
    const { fetcher, asked } = scripted({
      "https://a.example/1": redirect("https://b.example/2"),
      "https://b.example/2": redirect("https://metadata.example/latest"),
      "https://metadata.example/latest": ok("secret"),
    });
    await expect(guardedGet("https://a.example/1", base(fetcher))).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(asked).toEqual(["https://a.example/1", "https://b.example/2"]);
  });
});

describe("guardedGet redirects", () => {
  test("the cap is exact: cap redirects are followed, one more throws RedirectLimitError", async () => {
    const chain = (length: number) => Object.fromEntries(Array.from({ length }, (_, i) => [`https://h${i}.example/`, i === length - 1 ? ok("end") : redirect(`https://h${i + 1}.example/`)]));
    const within = scripted(chain(4)); // 3 redirects then the answer
    expect(await (await guardedGet("https://h0.example/", base(within.fetcher, { redirectCap: 3 }))).text()).toBe("end");
    const beyond = scripted(chain(5)); // 4 redirects
    await expect(guardedGet("https://h0.example/", base(beyond.fetcher, { redirectCap: 3, redirectMessage: "Too many." }))).rejects.toThrow("Too many.");
    await expect(guardedGet("https://h0.example/", base(beyond.fetcher, { redirectCap: 3 }))).rejects.toBeInstanceOf(RedirectLimitError);
  });

  test("a redirect with no next address is the same error, and a 304 is an answer not a redirect", async () => {
    const none = scripted({ "https://a.example/": () => new Response(null, { status: 302 }) });
    await expect(guardedGet("https://a.example/", base(none.fetcher))).rejects.toBeInstanceOf(RedirectLimitError);
    const notModified = scripted({ "https://a.example/": () => new Response(null, { status: 304, headers: { location: "https://b.example/" } }) });
    expect((await guardedGet("https://a.example/", base(notModified.fetcher))).status).toBe(304);
  });

  test("a relative Location is resolved against the hop's address", async () => {
    const { fetcher, asked } = scripted({ "https://a.example/x/y": redirect("/z"), "https://a.example/z": ok() });
    await guardedGet("https://a.example/x/y", base(fetcher));
    expect(asked).toEqual(["https://a.example/x/y", "https://a.example/z"]);
  });
});

describe("guardedGet pacing", () => {
  const bucket = { prefix: "test-feed", capacity: 1, refillPerSecond: 0.001 };

  test("the per-host bucket paces a host across calls and names the failure RateLimited", async () => {
    const { fetcher, asked } = scripted({ "https://a.example/1": ok(), "https://a.example/2": ok(), "https://b.example/1": ok() });
    await guardedGet("https://a.example/1", base(fetcher, { bucket, now: () => 0 }));
    await expect(guardedGet("https://a.example/2", base(fetcher, { bucket, now: () => 0 }))).rejects.toBeInstanceOf(RateLimited);
    await guardedGet("https://b.example/1", base(fetcher, { bucket, now: () => 0 }));
    expect(asked).toEqual(["https://a.example/1", "https://b.example/1"]);
  });

  test("a host is paid once per call even when a redirect returns to it", async () => {
    const { fetcher } = scripted({ "https://a.example/1": redirect("https://b.example/"), "https://b.example/": redirect("https://a.example/2"), "https://a.example/2": ok() });
    expect((await guardedGet("https://a.example/1", base(fetcher, { bucket: { ...bucket, capacity: 2 }, now: () => 0 }))).status).toBe(200);
  });

  test("a caller-shared set of paced hosts lets a retry skip paying again", async () => {
    const { fetcher } = scripted({ "https://a.example/": ok() });
    const pacedHosts = new Set<string>();
    await guardedGet("https://a.example/", base(fetcher, { bucket, pacedHosts, now: () => 0 }));
    expect((await guardedGet("https://a.example/", base(fetcher, { bucket, pacedHosts, now: () => 0 }))).status).toBe(200);
  });

  test("no bucket: the caller paces the host itself", async () => {
    const { fetcher } = scripted({ "https://a.example/": ok() });
    for (let i = 0; i < 5; i++) await guardedGet("https://a.example/", base(fetcher));
  });
});

describe("guardedGet request and caller rules", () => {
  test("the request carries the honest agent, the accept type and extra headers, and no cookies", async () => {
    const { fetcher, headersSeen } = scripted({ "https://a.example/": ok() });
    await guardedGet("https://a.example/", base(fetcher, { accept: "audio/*", headers: { "Icy-MetaData": "1" } }));
    expect(headersSeen[0]).toMatchObject({ Accept: "audio/*", "Icy-MetaData": "1" });
    expect(headersSeen[0]!["User-Agent"]).toContain("MaiPai-Home");
    expect(Object.keys(headersSeen[0]!).map((k) => k.toLowerCase())).not.toContain("cookie");
  });

  test("conditional headers go to the first host only and are dropped when a redirect leaves it", async () => {
    const { fetcher, headersSeen } = scripted({ "https://a.example/": redirect("https://b.example/"), "https://b.example/": ok() });
    await guardedGet("https://a.example/", base(fetcher, { conditional: { etag: '"v1"', lastModified: "Sat, 01 Nov 2026 00:00:00 GMT" } }));
    expect(headersSeen[0]).toMatchObject({ "If-None-Match": '"v1"', "If-Modified-Since": "Sat, 01 Nov 2026 00:00:00 GMT" });
    expect(headersSeen[1]!["If-None-Match"]).toBeUndefined();
    expect(headersSeen[1]!["If-Modified-Since"]).toBeUndefined();
  });

  test("beforeHop false stops before the request is sent; afterResponse may stop on any answer", async () => {
    const quiet = scripted({ "https://a.example/": ok() });
    await expect(guardedGet("https://a.example/", base(quiet.fetcher, { beforeHop: () => false }))).rejects.toBeInstanceOf(GuardedStop);
    expect(quiet.asked).toEqual([]);
    const limited = scripted({ "https://a.example/": () => new Response(null, { status: 429 }) });
    await expect(guardedGet("https://a.example/", base(limited.fetcher, { afterResponse: (answer) => { if (answer.status === 429) throw new GuardedStop(); } }))).rejects.toBeInstanceOf(GuardedStop);
  });

  test("a caller transport (send) replaces the fetch but not the guard", async () => {
    const sent: string[] = [];
    const send = async (url: URL) => { sent.push(url.href); return url.hostname === "a.example" ? new Response(null, { status: 301, headers: { location: "https://intranet.example/x" } }) : new Response("no"); };
    await expect(guardedGet("https://a.example/", base(globalThis.fetch, { send }))).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(sent).toEqual(["https://a.example/"]);
  });
});
