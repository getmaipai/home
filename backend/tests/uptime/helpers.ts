import type { ConnectorInstance } from "@/lib/connectors/instances";

export function kumaInstance(instance: string, label: string, host: string, statusPage: string | null = "family"): ConnectorInstance {
  return { type: "uptime_kuma", instance, label, address: `http://${host}:3001`, credentialRef: "", options: statusPage === null ? {} : { status_page: statusPage }, virtual: false };
}

export type FakeKuma = { page?: unknown; beats?: unknown; pageStatus?: number; beatsStatus?: number; down?: boolean; slug?: string };

/** A fake Kuma per host: answers only the two status page paths, records every request. */
export function fakeKumaFetch(hosts: Record<string, FakeKuma>) {
  const requests: Array<{ url: string; headers: Headers }> = [];
  const fetch = async (input: string, init: RequestInit): Promise<Response> => {
    const url = new URL(input);
    requests.push({ url: input, headers: new Headers(init.headers) });
    const kuma = hosts[url.hostname];
    if (!kuma || kuma.down) throw new Error("connection refused");
    const slug = kuma.slug ?? "family";
    if (url.pathname === `/api/status-page/${slug}`) return new Response(JSON.stringify(kuma.page ?? {}), { status: kuma.pageStatus ?? 200 });
    if (url.pathname === `/api/status-page/heartbeat/${slug}`) return new Response(JSON.stringify(kuma.beats ?? {}), { status: kuma.beatsStatus ?? 200 });
    return new Response("{}", { status: 404 });
  };
  return { fetch, requests };
}

/** groups: [name, [[id, monitor name, last beat status, 24h uptime fraction]]] */
export function kumaBody(groups: Array<[string, Array<[number, string, number, number]>]>): { page: unknown; beats: unknown } {
  return {
    page: { config: {}, publicGroupList: groups.map(([name, monitors], index) => ({ id: index + 1, name, monitorList: monitors.map(([id, monitor]) => ({ id, name: monitor })) })) },
    beats: {
      heartbeatList: Object.fromEntries(groups.flatMap(([, monitors]) => monitors.map(([id, , status]) => [String(id), [{ status: 1 }, { status }]]))),
      uptimeList: Object.fromEntries(groups.flatMap(([, monitors]) => monitors.map(([id, , , uptime]) => [`${id}_24`, uptime]))),
    },
  };
}
