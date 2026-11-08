import { describe, expect, test } from "bun:test";
import { plexInstance } from "./helpers";
import { plexAllowed, plexToolSpec, runPlexTool, PLEX_ACTIONS } from "@/lib/plex/tool";

const actor = { id: "owner", role: "owner" as const };
function fixture(body: unknown, status = 200) {
  const requests: Array<{ url: string; method: string; token: string | null }> = [];
  const fetch = async (url: string, init: RequestInit) => {
    requests.push({ url, method: String(init.method), token: new Headers(init.headers).get("X-Plex-Token") });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { requests, fetch };
}
async function run(action: typeof PLEX_ACTIONS[number], payload: unknown, instances = [plexInstance("main", "Den")]) {
  const f = fixture(payload); const audit: unknown[] = [];
  const out = await runPlexTool({ actor, band: "adult", args: { action, ...(action === "search" ? { query: "Film" } : {}) }, callId: "c", deps: { instances: () => instances, lanDeps: { fetch: f.fetch, read: () => "secret-token" }, audit: (row) => audit.push(row) } });
  return { out, ...f, audit };
}

describe("Plex tool", () => {
  test("reads all five actions with GET only, token header and bounded projections", async () => {
    const examples = [
      ["libraries", { MediaContainer: { Directory: [{ key: "1", title: "Movies", type: "movie", count: 3, path: "/secret" }] } }],
      ["search", { MediaContainer: { Hub: [{ Metadata: [{ title: "Film", type: "movie", year: 2020, key: "/x", thumb: "/x" }] }] } }],
      ["recent", { MediaContainer: { Metadata: [{ title: "Film", type: "movie", year: 2020 }] } }],
      ["now_playing", { MediaContainer: { Metadata: [{ title: "Film", User: { title: "PRIVATE_USER" }, Player: { title: "PRIVATE_DEVICE", address: "PRIVATE_IP" } }] } }],
      ["on_deck", { MediaContainer: { Metadata: [{ title: "Film", type: "movie", year: 2020 }] } }],
    ] as const;
    for (const [action, body] of examples) {
      const result = await run(action, body);
      expect(result.out.status).toBe("succeeded"); expect(result.requests.every((r) => r.method === "GET")).toBe(true);
      expect(result.requests.every((r) => new URL(r.url).hostname === "192.168.1.20")).toBe(true);
      expect(result.requests.every((r) => new URL(r.url).port === "32400")).toBe(true);
      expect(result.requests.every((r) => r.token === "secret-token")).toBe(true);
      expect(result.requests.every((r) => !r.url.includes("secret-token"))).toBe(true);
      expect(result.out.result?.reply?.text).not.toMatch(/PRIVATE_USER|PRIVATE_DEVICE|PRIVATE_IP|\/secret/);
    }
  });
  test("refuses redirects, invalid target and missing or wrong credentials with kind only", async () => {
    const redirect = await runPlexTool({ actor, band: "adult", args: { action: "libraries" }, callId: "c", deps: { instances: () => [plexInstance("main", "Den")], lanDeps: { read: () => "secret-token", fetch: async () => new Response(null, { status: 302, headers: { location: "http://example.com" } }) }, audit: () => {} } });
    expect(redirect.userMessage).toContain("refused"); expect(redirect.userMessage).not.toContain("example.com");
    const bad = await runPlexTool({ actor, band: "adult", args: { action: "libraries" }, callId: "c", deps: { instances: () => [plexInstance("main", "Den", "http://192.0.2.10:32400")], lanDeps: { read: () => "secret-token" }, audit: () => {} } });
    expect(bad.userMessage).toContain("refused");
    const noToken = await runPlexTool({ actor, band: "adult", args: { action: "libraries" }, callId: "c", deps: { instances: () => [plexInstance("main", "Den")], lanDeps: { read: () => "" }, audit: () => {} } });
    expect(noToken.userMessage).toContain("refused");
  });
  test("rejects supplied URL and audits only action/result, offers adult written turns only", async () => {
    const f = fixture({ MediaContainer: { Directory: [] } }); const audit: unknown[] = [];
    const bad = await runPlexTool({ actor, band: "adult", args: { action: "search", query: "ok", url: "http://evil" }, callId: "c", deps: { instances: () => [plexInstance("main", "Private Den")], lanDeps: { read: () => "secret-token", fetch: f.fetch }, audit: (row) => audit.push(row) } });
    expect(bad.failureKind).toBe("bad_arguments"); expect(f.requests).toHaveLength(0);
    expect(plexToolSpec([plexInstance("main", "Main")]).args).not.toHaveProperty("properties.instance");
    expect(plexToolSpec([plexInstance("main", "Main"), plexInstance("lab", "Lab")]).args).toHaveProperty("properties.instance");
    expect(plexAllowed({ actor, band: "adult", surfaceClass: "written", spoken: false, bare: false }, { instances: () => [plexInstance("main", "Main")] })).toBe(true);
    expect(plexAllowed({ actor, band: "teen", surfaceClass: "written", spoken: false, bare: false }, { instances: () => [plexInstance("main", "Main")] })).toBe(false);
    const auditText = JSON.stringify(audit); expect(auditText).not.toContain("Private Den"); expect(auditText).not.toContain("main"); expect(auditText).not.toContain("ok");
  });
});

test("instance credential reference, two-server labels, and conditional privacy row", async () => {
  const { db } = await import("@/db");
  const { integrations } = await import("@/db/schema");
  const { resetDb } = await import("../reset-db");
  const { privacyConnections } = await import("@/lib/privacy");
  resetDb();
  const stamp = "2026-11-08T00:00:00.000Z";
  db.insert(integrations).values({ id: "plex-main", type: "plex", instance: "main", label: "Den", address: "http://192.168.1.20:32400", credentialRef: "secret.main", options: "{}", enabled: true, deletedAt: null, provenance: "admin", createdAt: stamp, updatedAt: stamp, hlc: "1:0:testnode" }).run();
  const row = privacyConnections().find((item) => item.id === "platform:plex");
  expect(row?.destination).toBe("your own Plex server on your LAN");
  expect(row?.what).toContain("never sends anything to plex.tv");
  expect(row?.what).toContain("does not read who is watching");
  const f = fixture({ MediaContainer: { Directory: [{ title: "Library", count: 2 }] } });
  const outcome = await runPlexTool({ actor, band: "adult", args: { action: "libraries" }, callId: "c", deps: { instances: () => [plexInstance("main", "Den"), plexInstance("lab", "Studio", "http://192.168.1.21:32400")], lanDeps: { read: (key) => key === "plex.main.token" ? "token-main" : key === "plex.lab.token" ? "token-lab" : undefined, fetch: f.fetch }, audit: () => {} } });
  expect(outcome.result?.reply?.text).toContain("Den:");
  expect(outcome.result?.reply?.text).toContain("Studio:");
  expect(f.requests.map((r) => new URL(r.url).hostname).sort()).toEqual(["192.168.1.20", "192.168.1.21"]);
  expect(f.requests.map((r) => r.token).sort()).toEqual(["token-lab", "token-main"]);
});
