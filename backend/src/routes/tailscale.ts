import { createRoute, z } from "@hono/zod-openapi";
import type { Context, Next } from "hono";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { isLoopbackPeer, isLocalHost, setupIsComplete, setupLocalRefusal } from "@/middleware/setupLocalOnly";
import { listActivePeople } from "@/lib/access";
import { getTailscaleStatus, turnOnTailscaleAccess } from "@/lib/tailscale";
import { getHouseholdSettingValue } from "@/lib/settings";
import { listHubEndpoints } from "@/lib/hubEndpoints";

export const tailscaleRoutes = apiRouter();
tailscaleRoutes.use("/status", async (c, next) => authorizeAway(c, next));
tailscaleRoutes.use("/enable", async (c, next) => authorizeAway(c, next));
async function authorizeAway(c: Context, next: Next) {
  // The local setup contract is sufficient before the owner exists.
  if (!setupIsComplete()) {
    if (!isLoopbackPeer(c)) return setupLocalRefusal(c, "peer");
    if (Array.from(c.req.raw.headers.keys()).some((name) => {
      const lower = name.toLowerCase();
      return lower === "forwarded" || lower === "x-real-ip" || lower === "cf-connecting-ip" || lower.startsWith("x-forwarded-");
    })) return setupLocalRefusal(c, "forwarded");
    if (!isLocalHost(c.req.header("host"))) return setupLocalRefusal(c, "host");
    return await next();
  }
  if (listActivePeople().some((person) => person.role === "owner")) return requireAuth(c, next);
  return await next();
}
const Status = z.object({ installed: z.boolean(), signedIn: z.boolean(), httpsEnabled: z.boolean(), machineName: z.string().nullable(), dnsName: z.string().nullable(), state: z.enum(["not_installed", "stopped", "running"]), ips: z.array(z.string()), enabled: z.boolean(), url: z.string().nullable() });

const statusRoute = createRoute({ method: "get", path: "/status", tags: ["Setup"], summary: "Tailscale setup status", middleware: [] as const, responses: { 200: { content: { "application/json": { schema: Status } }, description: "This hub's Tailscale state." }, ...errorResponses({ 401: "Not signed in", 403: "Only owner/admin may view away setup" }) } });
tailscaleRoutes.openapi(statusRoute, async (c) => {
  const actor = c.get("person");
  if (actor && actor.role !== "owner" && actor.role !== "admin") return c.json({ error: "Only the owner or an admin may view away access setup." }, 403);
  const status = await getTailscaleStatus();
  const endpoints = await listHubEndpoints();
  const endpoint = endpoints.find((item) => item.kind === "overlay");
  const enabled = getHouseholdSettingValue("network.tailnet_access") === true;
  return c.json({ installed: status.installed ?? false, signedIn: status.signedIn ?? false, httpsEnabled: status.httpsEnabled ?? false, machineName: status.machineName ?? null, dnsName: status.dnsName, ips: status.ips, state: status.state, enabled, url: enabled ? `https://${status.dnsName}` : endpoint?.url ?? null }, 200);
});

const enableRoute = createRoute({ method: "post", path: "/enable", tags: ["Setup"], summary: "Enable Home's Tailscale HTTPS address", middleware: [] as const, responses: { 200: { content: { "application/json": { schema: z.object({ url: z.string(), qrPayload: z.string() }) } }, description: "Away address and QR payload." }, ...errorResponses({ 400: "Tailscale is not ready", 401: "Not signed in", 403: "Only owner or admin may enable away access" }) } });
tailscaleRoutes.openapi(enableRoute, async (c) => {
  const actor = c.get("person");
  if (actor && actor.role !== "owner" && actor.role !== "admin") return c.json({ error: "Only the owner or an admin can enable away access." }, 403);
  try {
    const cert = await turnOnTailscaleAccess(actor);
    const url = `https://${cert.name}`;
    return c.json({ url, qrPayload: url }, 200);
  } catch (error) { return c.json({ error: error instanceof Error ? error.message : "Could not enable away access." }, 400); }
});
