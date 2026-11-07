// A fake Home Assistant for the schedule tests: the automation config API, the state list and the reload service, served
// through the lanFetch fetch seam (no port is bound). It records every request so a test can scan what Home sent.
export type FakeRequest = { method: string; path: string; body: string };

export function fakeHa() {
  const automations = new Map<string, Record<string, unknown>>();
  // Automations the household made by hand: Home must never touch these.
  const manual = new Set(["manual_morning_lights", "abc123"]);
  const requests: FakeRequest[] = [];
  const state = { failWrites: false, failStates: false, truncateTemplate: false, timeZone: "America/New_York" as string | null, writeThenTimeout: false };

  const fetch = async (input: string, init: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? init.body : "";
    requests.push({ method, path: url.pathname, body });
    if (new Headers(init.headers).get("authorization") !== "Bearer fake-ha-token") return new Response("{}", { status: 401 });
    const config = /^\/api\/config\/automation\/config\/(.+)$/.exec(url.pathname);
    if (config) {
      const id = config[1]!;
      if (method === "POST") {
        if (state.failWrites) return new Response("{}", { status: 500 });
        automations.set(id, JSON.parse(body) as Record<string, unknown>);
        // Home Assistant finished the write but the answer never came back.
        if (state.writeThenTimeout) throw new Error("socket timeout");
        return Response.json({ result: "ok" });
      }
      if (method === "DELETE") {
        if (!automations.delete(id)) return new Response("{}", { status: 404 });
        return Response.json({ result: "ok" });
      }
      if (method === "GET") return automations.has(id) ? Response.json(automations.get(id)) : new Response("{}", { status: 404 });
    }
    if (url.pathname === "/api/template" && method === "POST") {
      if (state.failStates) return new Response("{}", { status: 500 });
      if (state.truncateTemplate) return new Response("[\"maipai_");
      // What the fixed template returns: the ids of the maipai_ automations only.
      return Response.json([...automations.keys()].filter((id) => id.startsWith("maipai_")));
    }
    if (url.pathname === "/api/config" && method === "GET") return state.timeZone === null ? new Response("{}", { status: 500 }) : Response.json({ time_zone: state.timeZone });
    if (url.pathname === "/api/services/automation/reload" && method === "POST") return Response.json([]);
    return new Response("{}", { status: 404 });
  };

  return { automations, manual, requests, state, fetch };
}

export const HOUSE_SETTINGS = (key: string): unknown => ({ "home.base_url": "http://192.168.1.20:8123", "home.access_token": "fake-ha-token" } as Record<string, string>)[key];
