import { afterEach, expect, test } from "bun:test";
import { api, ApiError, requestJson } from "@/lib/api";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("cancelTurn sends heard_chars only when given", async () => {
  const requests: RequestInit[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(init ?? {});
    return new Response(JSON.stringify({ cancelled: true }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  await api.cancelTurn("turn-without-length");
  await api.cancelTurn("turn-with-length", 37);

  expect(requests[0]?.body).toBeUndefined();
  expect(requests[1]?.body).toBe(JSON.stringify({ heard_chars: 37 }));
});

test("searchWebResults asks the Web tab's own route with the query encoded, and returns rows and the reason as sent", async () => {
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(JSON.stringify({ results: [], note: "Web search is off for this household." }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const answer = await api.searchWebResults("how to brew tea");

  expect(urls).toEqual(["/api/search/web-results?q=how%20to%20brew%20tea"]);
  expect(answer).toEqual({ results: [], note: "Web search is off for this household." });
});

test("requestJson returns the same 401 ApiError path as request", async () => {
  globalThis.fetch = (async () => Response.json({ error: "Sign in again" }, { status: 401 })) as unknown as typeof fetch;
  let error: unknown;
  try {
    await requestJson("/api/test");
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ status: 401, message: "Sign in again" });
});
