import { describe, expect, it } from "bun:test";
import { houseLanFetch } from "@/lib/house/connection";

function configured(baseUrl: string, token = "secret-token", fetch?: (input: string, init: RequestInit) => Promise<Response>) {
  return houseLanFetch({
    read: key => key === "home.base_url" ? baseUrl : token,
    ...(fetch ? { fetch } : {}),
  });
}

describe("houseLanFetch", () => {
  it("reports an unset URL", () => {
    const result = configured("");
    expect(result).toMatchObject({ ok: false, reason: "not_set" });
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });

  it("reports an empty token", () => {
    const result = configured("http://192.168.1.20:8123", "");
    expect(result).toMatchObject({ ok: false, reason: "no_token" });
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });

  it.each([
    "http://homeassistant.local:8123",
    "https://192.168.1.20:8123",
    "http://192.168.1.20:8123/api",
    "http://user:pw@192.168.1.20:8123",
    "http://8.8.8.8:8123",
    "http://127.0.0.1:8123",
    "http://192.168.1.20:8123?token=secret-token",
    "http://192.168.1.20:8123/#fragment",
  ])("rejects %s", baseUrl => {
    const result = configured(baseUrl);
    expect(result).toMatchObject({ ok: false, reason: "bad_address" });
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });

  it.each([
    ["http://192.168.1.20", 8123],
    ["http://192.168.1.20:8123/", 8123],
    ["http://192.168.1.20:8124", 8124],
  ])("allows %s with port %i", async (baseUrl, port) => {
    let requested = "";
    const result = configured(baseUrl, "secret-token", async input => {
      requested = input;
      return new Response("ok");
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.token).toBe("secret-token");
    await result.lanFetch("/api/");
    expect(requested).toBe(`http://192.168.1.20:${port}/api/`);
    expect(JSON.stringify({ ok: result.ok, message: "" })).not.toContain(result.token);
  });

  it("an explicit :80 is kept and a missing port means 8123", () => {
    const seen: string[] = [];
    const mk = (url: string) => houseLanFetch({ read: (k) => (k === "home.base_url" ? url : "t"), fetch: async (u) => { seen.push(u); return new Response("ok"); } });
    return (async () => {
      const a = mk("http://192.168.1.20:80"); if (!a.ok) throw new Error("not ok"); await a.lanFetch("/api/");
      const b = mk("http://192.168.1.20"); if (!b.ok) throw new Error("not ok"); await b.lanFetch("/api/");
      expect(seen).toEqual(["http://192.168.1.20:80/api/", "http://192.168.1.20:8123/api/"]);
    })();
  });
});
