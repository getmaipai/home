import { describe, expect, test } from "bun:test";
import { fetchKumaStatus } from "@/lib/uptime/kuma";
import { instanceLanFetch } from "@/lib/connectors/instances";
import { fakeKumaFetch, kumaBody, kumaInstance } from "./helpers";

const body = kumaBody([["Media", [[1, "Plex", 1, 1], [2, "Immich", 0, 0.5]]], ["Network", [[3, "Router", 2, 0.9876], [4, "Printer", 3, 1], [5, "Camera", 9, 1]]]]);

describe("fetchKumaStatus", () => {
  test("parses groups, last heartbeats and the 24 hour uptime", async () => {
    const { fetch } = fakeKumaFetch({ "192.168.1.20": body });
    const result = await fetchKumaStatus(kumaInstance("main", "Main", "192.168.1.20"), { fetch });
    expect(result).toEqual({ ok: true, monitors: [
      { name: "Plex", status: "up", uptime24h: 100, group: "Media" },
      { name: "Immich", status: "down", uptime24h: 50, group: "Media" },
      { name: "Router", status: "pending", uptime24h: 98.76, group: "Network" },
      { name: "Printer", status: "maintenance", uptime24h: 100, group: "Network" },
      { name: "Camera", status: "unknown", uptime24h: 100, group: "Network" },
    ] });
  });

  test("asks for exactly the two status page paths and sends no credential", async () => {
    const { fetch, requests } = fakeKumaFetch({ "192.168.1.20": body });
    await fetchKumaStatus(kumaInstance("main", "Main", "192.168.1.20"), { fetch });
    expect(requests.map((request) => new URL(request.url).pathname).sort()).toEqual(["/api/status-page/family", "/api/status-page/heartbeat/family"]);
    for (const request of requests) expect(request.headers.get("authorization")).toBeNull();
  });

  test("a slug outside the allowed shape is refused before any request", async () => {
    for (const slug of ["../admin", "Family", "a/b", "a?x=1", "-start", "x".repeat(65), "a b"]) {
      const { fetch, requests } = fakeKumaFetch({ "192.168.1.20": body });
      expect(await fetchKumaStatus(kumaInstance("main", "Main", "192.168.1.20", slug), { fetch })).toEqual({ ok: false, kind: "refused" });
      expect(requests).toHaveLength(0);
    }
  });

  test("no status page set is not_configured and makes no request", async () => {
    const { fetch, requests } = fakeKumaFetch({});
    expect(await fetchKumaStatus(kumaInstance("main", "Main", "192.168.1.20", null), { fetch })).toEqual({ ok: false, kind: "not_configured" });
    expect(requests).toHaveLength(0);
  });

  test("an unreachable Kuma, a bad status and a non-JSON body are plain failure kinds", async () => {
    const down = fakeKumaFetch({ "192.168.1.20": { down: true } });
    expect(await fetchKumaStatus(kumaInstance("main", "Main", "192.168.1.20"), { fetch: down.fetch })).toEqual({ ok: false, kind: "unreachable" });
    const notFound = fakeKumaFetch({ "192.168.1.20": { ...body, pageStatus: 404 } });
    expect(await fetchKumaStatus(kumaInstance("main", "Main", "192.168.1.20"), { fetch: notFound.fetch })).toEqual({ ok: false, kind: "bad_response" });
    const junk = fakeKumaFetch({ "192.168.1.20": { page: { publicGroupList: "nope" }, beats: {} } });
    expect(await fetchKumaStatus(kumaInstance("main", "Main", "192.168.1.20"), { fetch: junk.fetch })).toEqual({ ok: false, kind: "bad_response" });
  });

  test("an uptime_kuma instance needs no credential and the lanFetch sends no token", () => {
    const connection = instanceLanFetch(kumaInstance("main", "Main", "192.168.1.20"), { read: () => undefined });
    expect(connection).toMatchObject({ ok: true, token: "", host: "192.168.1.20", port: 3001 });
  });
});
