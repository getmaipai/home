// AGENT-SVC-01: read-only client for an Uptime Kuma instance's public status page.
// Only two path shapes are ever requested, both built from the instance's own status page slug:
//   /api/status-page/<slug>             groups and monitors (id, name)
//   /api/status-page/heartbeat/<slug>   last beats per monitor id and the 24 hour uptime
// No credential is sent. The size cap and the private-address check belong to lanFetch.
import { z } from "zod";
import { instanceLanFetch, type ConnectorInstance, type InstanceDeps } from "@/lib/connectors/instances";

export type KumaStatus = "up" | "down" | "pending" | "maintenance" | "unknown";
export type KumaMonitor = { name: string; status: KumaStatus; /** Percent, 0 to 100, two decimals; null when Kuma sent none. */ uptime24h: number | null; group: string | null };
export type KumaFailureKind = "not_configured" | "unreachable" | "refused" | "timeout" | "bad_response";
export type KumaResult = { ok: true; monitors: KumaMonitor[] } | { ok: false; kind: KumaFailureKind };

/** A status page slug: lower case letters, digits, hyphen and underscore. Nothing else is ever put in a path. */
export const KUMA_SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const PageSchema = z.object({
  publicGroupList: z.array(z.object({
    name: z.string().optional(),
    monitorList: z.array(z.object({ id: z.number(), name: z.string() })).optional(),
  })).optional(),
});
const BeatsSchema = z.object({
  heartbeatList: z.record(z.string(), z.array(z.object({ status: z.number() }))).optional(),
  uptimeList: z.record(z.string(), z.number()).optional(),
});

function statusOf(code: number | undefined): KumaStatus {
  return code === 1 ? "up" : code === 0 ? "down" : code === 2 ? "pending" : code === 3 ? "maintenance" : "unknown";
}

async function getJson(lanFetch: (path: string) => Promise<import("@/lib/lanFetch").LanFetchResult>, path: string): Promise<{ ok: true; value: unknown } | { ok: false; kind: KumaFailureKind }> {
  const response = await lanFetch(path);
  if (!response.ok) return { ok: false, kind: response.kind };
  if (response.status < 200 || response.status > 299 || response.truncated) return { ok: false, kind: "bad_response" };
  try { return { ok: true, value: JSON.parse(response.text) }; } catch { return { ok: false, kind: "bad_response" }; }
}

export async function fetchKumaStatus(instance: ConnectorInstance, deps: InstanceDeps = {}): Promise<KumaResult> {
  const slug = instance.options["status_page"];
  if (slug === undefined || slug.trim() === "") return { ok: false, kind: "not_configured" };
  if (!KUMA_SLUG.test(slug)) return { ok: false, kind: "refused" };
  const connection = instanceLanFetch(instance, deps);
  if (!connection.ok) return { ok: false, kind: "not_configured" };

  const [pageRaw, beatsRaw] = await Promise.all([
    getJson(connection.lanFetch, `/api/status-page/${slug}`),
    getJson(connection.lanFetch, `/api/status-page/heartbeat/${slug}`),
  ]);
  if (!pageRaw.ok) return pageRaw;
  if (!beatsRaw.ok) return beatsRaw;
  const page = PageSchema.safeParse(pageRaw.value);
  const beats = BeatsSchema.safeParse(beatsRaw.value);
  if (!page.success || !beats.success) return { ok: false, kind: "bad_response" };

  const monitors: KumaMonitor[] = [];
  for (const group of page.data.publicGroupList ?? []) {
    for (const monitor of group.monitorList ?? []) {
      const list = beats.data.heartbeatList?.[String(monitor.id)] ?? [];
      const uptime = beats.data.uptimeList?.[`${monitor.id}_24`];
      monitors.push({
        name: monitor.name,
        status: statusOf(list.at(-1)?.status),
        uptime24h: uptime === undefined ? null : Math.round(uptime * 10000) / 100,
        group: group.name !== undefined && group.name !== "" ? group.name : null,
      });
    }
  }
  return { ok: true, monitors };
}
