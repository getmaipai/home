// AUDIT-DUP-NET-01: the one Stack HTTP helper behind the pictures, videos, music, components and recorded-speech clients.
import { afterEach, describe, expect, test } from "bun:test";
import { createStackHttp, STACK_TEST_BASE } from "@/lib/stack/http";
import { __setPicturesFetchForTests, getGenerationJob, StackPicturesError } from "@/lib/pictures/stack";
import { __setVideosFetchForTests, StackVideoError, getVideoJob } from "@/lib/videos/stack";
import { __setMusicFetchForTests, getMusicJob, StackMusicError } from "@/lib/music/stack";
import { __setComponentsFetchForTests, listStackComponents, StackComponentError } from "@/lib/stackComponents";

class TestError extends Error { constructor(readonly status: number, readonly code: string, message: string, readonly job?: string) { super(message); } }
const make = () => createStackHttp({ makeError: (s, c, m, j) => new TestError(s, c, m, j), noStackMessage: "no stack here", unreachableMessage: "not answering", timeoutMs: 50 });

afterEach(() => { __setPicturesFetchForTests(null); __setVideosFetchForTests(null); __setMusicFetchForTests(null); __setComponentsFetchForTests(null); });

describe("createStackHttp", () => {
  test("a test fetch is called on the test base and counts as configured", async () => {
    const http = make();
    let seen = "";
    http.__setFetchForTests((async (url: string) => { seen = url; return new Response("{}"); }) as never);
    expect(http.hasTestFetch()).toBe(true);
    await http.request("/v1/x");
    expect(seen).toBe(`${STACK_TEST_BASE}/v1/x`);
    http.__setFetchForTests(null);
    expect(http.hasTestFetch()).toBe(false);
  });

  test("a fetch that throws is the unreachable error, never the raw one", async () => {
    const http = make();
    http.__setFetchForTests((async () => { throw new Error("ECONNREFUSED 127.0.0.1"); }) as never);
    const error = await http.request("/v1/x").catch((e) => e) as TestError;
    expect(error).toBeInstanceOf(TestError);
    expect([error.status, error.code, error.message]).toEqual([503, "unreachable", "not answering"]);
  });

  test("a call that outlasts its timeout is unreachable, and a caller signal also cancels", async () => {
    const http = make();
    http.__setFetchForTests(((_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new Error("aborted"))))) as never);
    expect(((await http.request("/slow").catch((e) => e)) as TestError).code).toBe("unreachable");
    const controller = new AbortController();
    const pending = http.request("/slow", { signal: controller.signal, timeoutMs: 10_000 }).catch((e) => e);
    controller.abort();
    expect(((await pending) as TestError).code).toBe("unreachable");
  });

  test("failure reads the Stack's body: code, sentence and job, with the fallback and describe hooks", async () => {
    const http = make();
    const seen: Array<[string | null, string]> = [];
    const error = await http.failure(Response.json({ error: "Out of room", code: "memory", job: "j1" }, { status: 503 }), { fallback: "x", describe: (code, text) => `[${code}] ${text}`, onFailure: (c, m) => seen.push([c, m]) }).catch((e) => e) as TestError;
    expect([error.status, error.code, error.message, error.job]).toEqual([503, "memory", "[memory] Out of room", "j1"]);
    expect(seen).toEqual([["memory", "[memory] Out of room"]]);
    const plain = await http.failure(new Response("<html>", { status: 502 }), { fallback: (status) => `answered ${status}` }).catch((e) => e) as TestError;
    expect([plain.status, plain.code, plain.message, plain.job]).toEqual([502, "http_502", "answered 502", undefined]);
  });
});

describe("the five clients keep their own errors and test seams", () => {
  test("pictures: a refusal is a StackPicturesError with the Stack's code and job", async () => {
    __setPicturesFetchForTests((async () => Response.json({ error: "No room", code: "busy", job: "p9" }, { status: 503 })) as never);
    const error = await getGenerationJob("p9").catch((e) => e);
    expect(error).toBeInstanceOf(StackPicturesError);
    expect([error.status, error.code, error.job]).toEqual([503, "busy", "p9"]);
  });

  test("videos: an unreachable Stack is a StackVideoError with the plain sentence", async () => {
    __setVideosFetchForTests((async () => { throw new Error("down"); }) as never);
    const error = await getVideoJob("v1").catch((e) => e);
    expect(error).toBeInstanceOf(StackVideoError);
    expect([error.status, error.code, error.message]).toEqual([503, "unreachable", "Videos are not ready yet. Try again in a few minutes."]);
  });

  test("music: a failure carries the code alone", async () => {
    __setMusicFetchForTests((async () => Response.json({ code: "too_long", error: "raw text" }, { status: 422 })) as never);
    const error = await getMusicJob("m1").catch((e) => e);
    expect(error).toBeInstanceOf(StackMusicError);
    expect([error.status, error.code]).toEqual([422, "too_long"]);
  });

  test("components: the Stack's sentence passes through, and a bodiless answer says what happened", async () => {
    __setComponentsFetchForTests((async () => Response.json({ error: "Install the part first.", code: "not_installed" }, { status: 409 })) as never);
    const error = await listStackComponents().catch((e) => e);
    expect(error).toBeInstanceOf(StackComponentError);
    expect([error.status, error.code, error.message]).toEqual([409, "not_installed", "Install the part first."]);
    __setComponentsFetchForTests((async () => new Response("", { status: 500 })) as never);
    expect((await listStackComponents().catch((e) => e)).message).toBe("The engine answered 500. Try again in a moment.");
  });
});
