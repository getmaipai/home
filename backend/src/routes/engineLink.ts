import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireRole } from "@/middleware/auth";
import { getHubInstanceId } from "@/lib/hubIdentity";
import { getHouseholdSettingValue } from "@/lib/settings";
import { getLinkCredentialStatus, getPairingPublicKey, issuePairingCode, scanHostKey, confirmHostKey, revokeLinkKey } from "@/lib/stack/linkKeys";
import { stopEngineLink } from "@/lib/stack/link";
import { REMOTE_ENGINE_HOST_KEY } from "@/lib/remoteStackSettings";
import { isHouseholdNetworkHost } from "@maipai/core/src/net";
import { TRUST_PROXY } from "@/lib/trustProxy";

export const engineLinkRoutes = apiRouter();
const ErrorResponses = errorResponses({ 400: "Invalid request or pairing code", 401: "Not signed in", 403: "Admin access required" });
const PairCodeSchema = z.object({ code: z.string().regex(/^[A-Z2-7]{12}$/), expires_at: z.string() });
const PairPayloadSchema = z.object({ public_key: z.string(), household_id: z.string(), hmac: z.string() });
function isSecureRequest(c: { req: { header(name: string): string | undefined; url: string } }): boolean {
  const forwardedProtocol = TRUST_PROXY ? c.req.header("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase() : undefined;
  return forwardedProtocol ? forwardedProtocol === "https" : new URL(c.req.url).protocol === "https:";
}

const issueRoute = createRoute({
  method: "post", path: "/pair", tags: ["Engine link"], summary: "Start engine computer pairing",
  middleware: [requireRole("owner", "admin")] as const,
  responses: { 200: { content: { "application/json": { schema: PairCodeSchema } }, description: "A short lived one-time code" }, ...ErrorResponses },
});
engineLinkRoutes.openapi(issueRoute, (c) => {
  if (!isSecureRequest(c)) return c.json({ error: "Pairing requires a secure Home connection" }, 400);
  if (getHouseholdSettingValue("engines.stack.where") !== "another_computer") return c.json({ error: "Choose another computer for the AI engines first" }, 400);
  return c.json(issuePairingCode(), 200);
});

const fetchRoute = createRoute({
  method: "get", path: "/pair/{code}", tags: ["Engine link"], summary: "Fetch pairing material using its one-time code",
  request: { params: z.object({ code: z.string().regex(/^[A-Z2-7]{12}$/) }) },
  responses: { 200: { content: { "application/json": { schema: PairPayloadSchema } }, description: "Public key and code-keyed integrity check" }, 400: { description: "Code expired, exhausted, invalid or already used" } },
});
engineLinkRoutes.openapi(fetchRoute, (c) => {
  if (!isSecureRequest(c)) return c.json({ error: "Pairing requires a secure Home connection" }, 400);
  const payload = getPairingPublicKey(c.req.valid("param").code, getHubInstanceId());
  return payload ? c.json(payload, 200) : c.json({ error: "Pairing code is invalid or expired" }, 400);
});

const scanRoute = createRoute({
  method: "post", path: "/host-key/scan", tags: ["Engine link"], summary: "Read the engine computer's SSH host key",
  middleware: [requireRole("owner", "admin")] as const,
  responses: { 200: { content: { "application/json": { schema: z.object({ check_code: z.string() }) } }, description: "Check code to compare with the engine computer" }, ...ErrorResponses },
});
engineLinkRoutes.openapi(scanRoute, async (c) => {
  const host = getHouseholdSettingValue(REMOTE_ENGINE_HOST_KEY);
  const port = Number(getHouseholdSettingValue("engines.stack.remote.ssh_port") ?? 22);
  if (typeof host !== "string" || !host.trim() || !Number.isInteger(port) || port < 1 || port > 65535) return c.json({ error: "Set a valid engine computer address and port first" }, 400);
  const allowTailnet = getHouseholdSettingValue("engines.stack.remote.allow_tailnet") === true;
  if (!(await isHouseholdNetworkHost(host, { allowTailnet }))) return c.json({ error: "That address is outside your home network" }, 400);
  try { return c.json(scanHostKey(host, port), 200); }
  catch { return c.json({ error: "Could not read the engine computer's SSH host key" }, 400); }
});

const confirmRoute = createRoute({
  method: "post", path: "/host-key/confirm", tags: ["Engine link"], summary: "Pin the confirmed SSH host key",
  middleware: [requireRole("owner", "admin")] as const,
  request: { body: { content: { "application/json": { schema: z.object({ check_code: z.string().length(12) }) } } } },
  responses: { 200: { content: { "application/json": { schema: z.object({ paired: z.boolean() }) } }, description: "Host key pinned" }, ...ErrorResponses },
});
engineLinkRoutes.openapi(confirmRoute, (c) => {
  try { confirmHostKey(c.req.valid("json").check_code); return c.json({ paired: getLinkCredentialStatus().paired }, 200); }
  catch { return c.json({ error: "The check code did not match the scanned host key" }, 400); }
});

const statusRoute = createRoute({
  method: "get", path: "/credentials", tags: ["Engine link"], summary: "Show engine link credential status",
  middleware: [requireRole("owner", "admin")] as const,
  responses: { 200: { content: { "application/json": { schema: z.object({ paired: z.boolean() }) } }, description: "Credential presence only" }, ...ErrorResponses },
});
engineLinkRoutes.openapi(statusRoute, (c) => c.json(getLinkCredentialStatus(), 200));

const revokeRoute = createRoute({
  method: "delete", path: "/credentials", tags: ["Engine link"], summary: "Revoke the engine link key and host pin",
  middleware: [requireRole("owner", "admin")] as const,
  responses: { 200: { content: { "application/json": { schema: z.object({ paired: z.literal(false) }) } }, description: "Link credentials deleted" }, ...ErrorResponses },
});
engineLinkRoutes.openapi(revokeRoute, (c) => { stopEngineLink(); revokeLinkKey(); return c.json({ paired: false as const }, 200); });
