import { z } from "zod";
import { instanceLanFetch, type ConnectorInstance, type InstanceDeps } from "@/lib/connectors/instances";

export type PlexFailure = "refused" | "timeout" | "unreachable" | "bad_response";
export type PlexResult = { ok: true; text: string } | { ok: false; kind: PlexFailure };
const titleSchema = z.object({ title: z.string().optional(), type: z.string().optional(), year: z.number().int().optional() });
const responseSchema = z.object({ MediaContainer: z.object({
  Directory: z.array(z.object({ title: z.string(), count: z.number().int().nonnegative().optional() }).passthrough()).optional(),
  Metadata: z.array(titleSchema.passthrough()).optional(),
  Hub: z.array(z.object({ Metadata: z.array(titleSchema.passthrough()).optional() }).passthrough()).optional(),
  size: z.number().int().nonnegative().optional(),
}).passthrough() });
export type PlexAction = "libraries" | "search" | "recent" | "now_playing" | "on_deck";
const label = (t: z.infer<typeof titleSchema>) => [t.title, t.type, t.year].filter((x) => x !== undefined).join(" · ");

export async function fetchPlex(instance: ConnectorInstance, action: PlexAction, query?: string, deps: InstanceDeps = {}): Promise<PlexResult> {
  const connection = instanceLanFetch(instance, deps);
  if (!connection.ok) return { ok: false, kind: "refused" };
  let path = "/library/sections";
  if (action === "search") path = `/hub/search?query=${encodeURIComponent(query ?? "")}`;
  else if (action === "recent") path = "/library/recentlyAdded";
  else if (action === "now_playing") path = "/status/sessions";
  else if (action === "on_deck") path = "/library/onDeck";
  const response = await connection.lanFetch(path, { method: "GET", headers: { Accept: "application/json", "X-Plex-Token": connection.token } });
  if (!response.ok) return response;
  if (response.status < 200 || response.status > 299 || response.truncated) return { ok: false, kind: "bad_response" };
  let json: unknown;
  try { json = JSON.parse(response.text); } catch { return { ok: false, kind: "bad_response" }; }
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) return { ok: false, kind: "bad_response" };
  const container = parsed.data.MediaContainer;
  if (action === "libraries") return { ok: true, text: (container.Directory ?? []).map((d) => `${d.title}: ${d.count ?? 0} items`).join("\n") || "No libraries." };
  const titles = action === "search" ? (container.Hub ?? []).flatMap((hub) => hub.Metadata ?? []) : container.Metadata ?? [];
  if (action === "now_playing") return { ok: true, text: `${container.size ?? titles.length} playing${titles.length ? `\n${titles.slice(0, 10).map((t) => label(t)).join("\n")}` : ""}` };
  return { ok: true, text: titles.slice(0, 10).map((t) => label(t)).filter(Boolean).join("\n") || "No titles found." };
}
