import { afterEach, describe, expect, test } from "bun:test";
import { fetchAnswerImages, __setAnswerImageDnsLookupForTests, __resetAnswerImageFetchForTests } from "@/lib/answerImages/fetch";
import { ANSWER_IMAGES_MAX_CANDIDATES } from "@/lib/answerImages/gallery";
import { syntheticPhoto } from "./answerImagesFixture";

afterEach(() => { __setAnswerImageDnsLookupForTests(null); __resetAnswerImageFetchForTests(); });

describe("answer image fetch", () => {
  test("rejects a redirect to a private address before following it", async () => {
    let calls = 0;
    const fetcher = async () => { calls++; return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } }); };
    const result = await fetchAnswerImages([{ id: "one", url: "https://public.example/image" }], { fetch: fetcher as unknown as typeof fetch, dnsLookup: async () => ({ address: "93.184.216.34", family: 4 }) });
    expect(calls).toBe(1);
    expect(result.images).toHaveLength(0);
    expect(result.dropped_by_fetch?.ssrf).toBe(1);
  });

  test("checks every redirect hop and refuses a private target after three public hops", async () => {
    let calls = 0;
    const fetcher = async (request: string | URL | Request) => {
      calls++;
      const url = new URL(request.toString());
      if (url.hostname === "public.example") return new Response(null, { status: 302, headers: { location: "https://hop-one.example/one" } });
      if (url.hostname === "hop-one.example") return new Response(null, { status: 302, headers: { location: "https://hop-two.example/two" } });
      return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } });
    };
    const result = await fetchAnswerImages([{ id: "chain", url: "https://public.example/start" }], { fetch: fetcher as unknown as typeof fetch, dnsLookup: async () => ({ address: "93.184.216.34", family: 4 }) });
    expect(calls).toBe(3);
    expect(result.dropped_by_fetch.ssrf).toBe(1);
  });

  test("sends no cookie or referrer and identifies Home", async () => {
    let seen: Headers | undefined;
    const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
      seen = new Headers(init?.headers);
      return new Response(new Uint8Array([1]), { status: 200, headers: { "content-type": "image/png" } });
    };
    await fetchAnswerImages([{ id: "one", url: "https://other-public.example/image" }], { fetch: fetcher as unknown as typeof fetch, dnsLookup: async () => ({ address: "93.184.216.34", family: 4 }) });
    expect(seen?.has("cookie")).toBe(false);
    expect(seen?.has("referer")).toBe(false);
    expect(seen?.get("user-agent")).toMatch(/MaiPai-Home/i);
  });

  test("bounds candidate count, parallelism, bytes, and wall time", async () => {
    let active = 0, peak = 0, calls = 0;
    const fetcher = async () => {
      calls++; active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 25));
      active--;
      return new Response(new Uint8Array([1]), { status: 200, headers: { "content-type": "image/png" } });
    };
    await fetchAnswerImages(Array.from({ length: 20 }, (_, i) => ({ id: String(i), url: `https://h${i}.example/image` })), { fetch: fetcher as unknown as typeof fetch, dnsLookup: async () => ({ address: "93.184.216.34", family: 4 }) });
    expect(calls).toBeLessThanOrEqual(ANSWER_IMAGES_MAX_CANDIDATES);
    expect(peak).toBeLessThanOrEqual(4);
  });

  test("a 403 quiets that host and is never retried through the block", async () => {
    let calls = 0;
    const fetcher = async () => { calls++; return new Response(null, { status: 403 }); };
    const opts = { fetch: fetcher as unknown as typeof fetch, dnsLookup: async () => ({ address: "93.184.216.34", family: 4 }) };
    await fetchAnswerImages([{ id: "blocked", url: "https://blocked.example/picture" }], opts);
    await fetchAnswerImages([{ id: "blocked-again", url: "https://blocked.example/other" }], opts);
    expect(calls).toBe(1);
  });

  test("rejects a response whose declared size exceeds 8 MB", async () => {
    let calls = 0;
    const fetcher = async () => { calls++; return new Response(new Uint8Array(1), { status: 200, headers: { "content-type": "image/jpeg", "content-length": String(8 * 1024 * 1024 + 1) } }); };
    const result = await fetchAnswerImages([{ id: "large", url: "https://large.example/picture" }], { fetch: fetcher as unknown as typeof fetch, dnsLookup: async () => ({ address: "93.184.216.34", family: 4 }) });
    expect(calls).toBe(1);
    expect(result.images).toHaveLength(0);
  });

  test("cancels a streamed body as soon as it crosses 8 MB", async () => {
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1)); },
      cancel() { canceled = true; },
    });
    const fetcher = async () => new Response(body, { status: 200, headers: { "content-type": "image/jpeg" } });
    const result = await fetchAnswerImages([{ id: "stream-large", url: "https://stream-large.example/picture" }], { fetch: fetcher as unknown as typeof fetch, dnsLookup: async () => ({ address: "93.184.216.34", family: 4 }) });
    expect(canceled).toBe(true);
    expect(result.images).toHaveLength(0);
    expect(result.dropped_by_fetch.size_limit).toBe(1);
  });

  test("paces requests to the same host through the shared limiter", async () => {
    // ANSWER-IMG-02: one answer's set may share a host (upload.wikimedia.org
    // serves all of Commons), so the burst covers one set; a second set at
    // the same moment is held back until the bucket refills.
    let calls = 0;
    const fetcher = async () => { calls++; return new Response(new Uint8Array([1]), { status: 200, headers: { "content-type": "image/jpeg" } }); };
    const at = Date.now();
    const opts = { fetch: fetcher as unknown as typeof fetch, dnsLookup: async () => ({ address: "93.184.216.34", family: 4 }), now: () => at };
    const set = (tag: string) => Array.from({ length: ANSWER_IMAGES_MAX_CANDIDATES }, (_, i) => ({ id: `${tag}-${i}`, url: `https://paced.example/${tag}/${i}` }));
    await fetchAnswerImages(set("first"), opts);
    expect(calls).toBe(ANSWER_IMAGES_MAX_CANDIDATES);
    await fetchAnswerImages(set("second"), opts);
    expect(calls).toBe(ANSWER_IMAGES_MAX_CANDIDATES);
  });

  test("the whole candidate set stops at its 2.5 second deadline and retries one timeout", async () => {
    let calls = 0;
    const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
      calls++;
      return await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal as AbortSignal;
        signal.addEventListener("abort", () => reject(new Error("fixture timeout")), { once: true });
      });
    };
    const started = Date.now();
    const result = await fetchAnswerImages([{ id: "deadline", url: "https://deadline.example/picture" }], { fetch: fetcher as unknown as typeof fetch, dnsLookup: async () => ({ address: "93.184.216.34", family: 4 }) });
    expect(Date.now() - started).toBeLessThan(2_800);
    expect(calls).toBe(2);
    expect(result.images).toHaveLength(0);
  });

  // ANSWER-IMG-05, found on the real engine (2026-10-06): one Commons picture
  // that never answered held its group of four to the deadline, and then the
  // whole set was thrown away, so a koala answer showed nothing although
  // seven good pictures had arrived in the first second.
  test("a picture that never answers costs only itself, never the pictures that arrived in time", async () => {
    const photos = await Promise.all([2, 3, 4].map((seed) => syntheticPhoto(seed)));
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
      const host = new URL(url.toString()).hostname;
      if (host === "hang.example") {
        return await new Promise<Response>((_resolve, reject) => {
          (init?.signal as AbortSignal).addEventListener("abort", () => reject(new Error("fixture timeout")), { once: true });
        });
      }
      return new Response(photos[Number(host.replace(/\D/g, ""))]!, { status: 200, headers: { "content-type": "image/jpeg" } });
    };
    const sources = [{ id: "hang", url: "https://hang.example/picture" }, ...[0, 1, 2].map((i) => ({ id: `ok${i}`, url: `https://ok${i}.example/picture` }))];
    const started = Date.now();
    const result = await fetchAnswerImages(sources, { fetch: fetcher as unknown as typeof fetch, dnsLookup: async () => ({ address: "93.184.216.34", family: 4 }) });
    expect(Date.now() - started).toBeLessThan(2_800);
    expect(result.images.map((image) => image.id).sort()).toEqual(["ok0", "ok1", "ok2"]);
  });

  test("the set stops at the caller's deadline when that comes before its own", async () => {
    const fetcher = async (_url: string | URL | Request, init?: RequestInit) => await new Promise<Response>((_resolve, reject) => {
      (init?.signal as AbortSignal).addEventListener("abort", () => reject(new Error("fixture timeout")), { once: true });
    });
    const started = Date.now();
    const result = await fetchAnswerImages([{ id: "slow", url: "https://slow.example/picture" }], { fetch: fetcher as unknown as typeof fetch, dnsLookup: async () => ({ address: "93.184.216.34", family: 4 }), deadlineAt: started + 600 });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(result.images).toHaveLength(0);
  });
});
