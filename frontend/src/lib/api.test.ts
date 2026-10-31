import { afterEach, expect, test } from "bun:test";
import { api } from "@/lib/api";

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

test("findRobot posts find_me with optional seconds", async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return Response.json({ id: "command-1" });
  }) as typeof fetch;
  await api.findRobot("robot/1", 8);
  expect(requests).toEqual([{ url: "/api/devices/robot%2F1/commands", body: { kind: "find_me", seconds: 8 } }]);
});
