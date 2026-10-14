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
