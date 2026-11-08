import type { ConnectorInstance } from "@/lib/connectors/instances";
export function immichInstance(instance = "main", address = "http://192.168.1.20:2283"): ConnectorInstance { return { type: "immich", instance, label: `Immich ${instance}`, address, credentialRef: `immich.${instance}.api_key`, options: {}, virtual: false }; }
export function fixtureImmichFetch(options: { status?: number; headers?: Record<string, string>; wrongHost?: boolean; wrongKey?: boolean } = {}) {
  const requests: Array<{ method: string; path: string; host: string }> = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input.toString()); const method = init?.method ?? "GET";
    requests.push({ method, path: url.pathname, host: url.host });
    if (options.wrongHost && url.hostname !== "192.168.1.20") throw new Error("wrong host");
    if (options.wrongKey && new Headers(init?.headers).get("x-api-key") !== "test-key") return new Response("unauthorized", { status: 401 });
    if (options.status !== undefined) return new Response(null, { status: options.status, headers: options.headers });
    const bodies: Record<string, unknown> = {
      "/api/search/smart": { assets: { count: 1, total: 1, items: [{ originalFileName: "Secret Photo.jpg" }] }, albums: { count: 0, total: 0, items: [] } },
      "/api/albums": [{ id: "a", albumName: "Family", assetCount: 4 }],
      "/api/albums/a": { id: "a", albumName: "Family", assetCount: 4 },
      "/api/server/statistics": { photos: 4, videos: 2, usage: 1000 },
      "/api/people": { people: [{ name: "Jesse" }], total: 1, hidden: 0 },
    };
    return new Response(JSON.stringify(bodies[url.pathname] ?? {}), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetch, requests };
}
