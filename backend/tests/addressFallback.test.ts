// A host with a broken IPv6 route and a working IPv4 address is still reached (the live hub lost BBC and Verge pictures, 2026-10-28).
import { describe, expect, test } from "bun:test";
import { SsrfBlockedError, type PinnedRequest } from "@maipai/core/src/ssrfGuard";
import { fetchTryingEachAddress, ipv4First, type ResolvedAddress } from "@/lib/addressFallback";

const V6 = { address: "2001:db8::1", family: 6 };
const V4 = { address: "192.0.2.10", family: 4 };
const V4B = { address: "192.0.2.11", family: 4 };
const unreachable = () => Object.assign(new Error("connect EHOSTUNREACH"), { code: "EHOSTUNREACH" });

function server(behaviour: Record<string, "ok" | "unreachable" | "hang" | "refused-500">) {
  const tried: string[] = [];
  const request: PinnedRequest = async (_url, target, options) => {
    tried.push(target.address);
    const what = behaviour[target.address];
    if (what === "ok") return new Response("picture", { status: 200 });
    if (what === "refused-500") return new Response("broken", { status: 500 });
    if (what === "hang") return new Promise<Response>((_, reject) => options.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true }));
    throw unreachable();
  };
  return { tried, request };
}
const lookupOf = (list: ResolvedAddress[]) => async () => list;

describe("trying each resolved address", () => {
  test("an unreachable IPv6 address listed first is skipped: IPv4 is tried first and answers", async () => {
    const { tried, request } = server({ [V6.address]: "unreachable", [V4.address]: "ok" });
    const response = await fetchTryingEachAddress("https://pictures.example.com/a.jpg", {}, { lookupAll: lookupOf([V6, V4]), request });
    expect(response.status).toBe(200);
    expect(tried).toEqual([V4.address]);
  });

  test("a failed connection moves on to the next address, IPv6 included", async () => {
    const { tried, request } = server({ [V4.address]: "unreachable", [V6.address]: "ok" });
    const families: number[] = [];
    const response = await fetchTryingEachAddress("https://pictures.example.com/a.jpg", {}, { lookupAll: lookupOf([V6, V4]), request, onAttempt: (f) => families.push(f) });
    expect(response.status).toBe(200);
    expect(tried).toEqual([V4.address, V6.address]);
    expect(families).toEqual([4, 6]);
  });

  test("an address that never answers is given up after the attempt time, then the next is tried", async () => {
    const { tried, request } = server({ [V4.address]: "hang", [V4B.address]: "ok" });
    const response = await fetchTryingEachAddress("https://pictures.example.com/a.jpg", {}, { lookupAll: lookupOf([V4, V4B]), request, attemptMs: 30 });
    expect(response.status).toBe(200);
    expect(tried).toEqual([V4.address, V4B.address]);
  });

  test("an HTTP answer, even an error, is final: the next address is not asked", async () => {
    const { tried, request } = server({ [V4.address]: "refused-500", [V4B.address]: "ok" });
    expect((await fetchTryingEachAddress("https://pictures.example.com/a.jpg", {}, { lookupAll: lookupOf([V4, V4B]), request })).status).toBe(500);
    expect(tried).toEqual([V4.address]);
  });

  test("a private address is an SSRF block and stays final, even with a public address left", async () => {
    const { tried, request } = server({ [V4.address]: "ok" });
    await expect(fetchTryingEachAddress("https://pictures.example.com/a.jpg", {}, { lookupAll: lookupOf([{ address: "10.0.0.5", family: 4 }, V4]), request })).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(tried).toEqual([]);
  });

  test("when every address fails the last error is thrown, and the caller's abort stops at once", async () => {
    const { tried, request } = server({});
    await expect(fetchTryingEachAddress("https://pictures.example.com/a.jpg", {}, { lookupAll: lookupOf([V6, V4]), request })).rejects.toMatchObject({ code: "EHOSTUNREACH" });
    expect(tried).toEqual([V4.address, V6.address]);
    const controller = new AbortController(); controller.abort(new Error("caller gave up"));
    const second = server({ [V4.address]: "hang", [V4B.address]: "ok" });
    await expect(fetchTryingEachAddress("https://pictures.example.com/a.jpg", { signal: controller.signal }, { lookupAll: lookupOf([V4, V4B]), request: second.request })).rejects.toBeDefined();
    expect(second.tried).not.toContain(V4B.address);
  });

  test("ipv4First keeps the resolver's order within a family and drops repeats", () => {
    expect(ipv4First([V6, V4, V4B, V4]).map((a) => a.address)).toEqual([V4.address, V4B.address, V6.address]);
  });
});
