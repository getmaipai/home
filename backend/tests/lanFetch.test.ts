import { describe, expect, test } from "bun:test";
import { createLanFetch } from "../src/lib/lanFetch";

const rejectedHosts = ["127.0.0.1", "169.254.169.254", "100.64.1.1", "example.com", "::1", "192.168.1.1.evil.com", "0.0.0.0", "224.0.0.1", "8.8.8.8"];

describe("createLanFetch", () => {
  test("rejects hosts outside RFC1918 IPv4", () => {
    for (const host of rejectedHosts) expect(() => createLanFetch({ host, port: 80 })).toThrow("This address is not on your home network.");
  });

  test("accepts RFC1918 hosts and builds the URL from host, port and path", async () => {
    for (const host of ["192.168.50.20", "10.1.2.3"]) {
      let requested = "";
      const lanFetch = createLanFetch({ host, port: 8123 }, { fetch: async (input) => { requested = String(input); return new Response("ok"); } });
      expect(await lanFetch("/api/" )).toEqual({ ok: true, status: 200, text: "ok", truncated: false });
      expect(requested).toBe(`http://${host}:8123/api/`);
    }
  });

  test("refuses URL-like and authority-like paths", async () => {
    const lanFetch = createLanFetch({ host: "192.168.50.20", port: 80 }, { fetch: async () => new Response("unexpected") });
    for (const path of ["https://example.com", "//example.com/path", "/@example.com"]) expect(await lanFetch(path)).toEqual({ ok: false, kind: "refused" });
  });

  test("does not follow redirects", async () => {
    const lanFetch = createLanFetch({ host: "10.1.2.3", port: 80 }, { fetch: async (_input, init) => {
      expect(init?.redirect).toBe("manual");
      return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/secret" } });
    } });
    expect(await lanFetch("/redirect")).toEqual({ ok: false, kind: "refused" });
  });

  test("caps response bytes and marks truncation", async () => {
    const lanFetch = createLanFetch({ host: "10.1.2.3", port: 80 }, { maxBytes: 5, fetch: async () => new Response("abcdefgh") });
    expect(await lanFetch("/large")).toEqual({ ok: true, status: 200, text: "abcde", truncated: true });
  });

  test("returns sanitized connect and timeout failures", async () => {
    const url = "http://192.168.50.20:8123/failure";
    const message = "socket failed for " + url;
    const connectFailure = createLanFetch({ host: "192.168.50.20", port: 8123 }, { fetch: async () => { throw new Error(message); } });
    const connectResult = await connectFailure("/failure");
    expect(connectResult).toEqual({ ok: false, kind: "unreachable" });
    expect(JSON.stringify(connectResult)).not.toContain(url);
    expect(JSON.stringify(connectResult)).not.toContain(message);

    const timeout = createLanFetch({ host: "192.168.50.20", port: 8123 }, { timeoutMs: 1, fetch: (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error(message)), { once: true });
    }) });
    const timeoutResult = await timeout("/failure");
    expect(timeoutResult).toEqual({ ok: false, kind: "timeout" });
    expect(JSON.stringify(timeoutResult)).not.toContain(url);
    expect(JSON.stringify(timeoutResult)).not.toContain(message);
  });
});
