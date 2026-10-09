import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireRole } from "@/middleware/auth";
import { getHubInstanceId } from "@/lib/hubIdentity";
import { getHouseholdSettingValue } from "@/lib/settings";
import { derivePairingLookup, getLinkCredentialStatus, getPairingPublicKey, issuePairingCode, scanHostKey, confirmHostKey, HostKeyConfirmError, revokeLinkKey } from "@/lib/stack/linkKeys";
import { stopEngineLink } from "@/lib/stack/link";
import { REMOTE_ENGINE_HOST_KEY, REMOTE_ENGINE_ADDRESS_ERROR } from "@/lib/remoteStackSettings";
import { isHouseholdNetworkHost } from "@maipai/core/src/net";
import { TRUST_PROXY } from "@/lib/trustProxy";
import { tryConsume } from "@/lib/rateLimiter";
import { setHouseholdSettingValue } from "@/lib/settings";
import { getConnInfo } from "hono/bun";
import { rebuildEngineLinkAfterPairing } from "@/lib/remoteStackSettings";

export const engineLinkRoutes = apiRouter();
const ErrorResponses = errorResponses({ 400: "Invalid request or pairing code", 401: "Not signed in", 403: "Admin access required" });
const PairCodeSchema = z.object({ code: z.string().regex(/^[A-Z2-7]{12}$/), expires_at: z.string() });
const PairPayloadSchema = z.object({ public_key: z.string(), household_id: z.string(), hmac: z.string() });
// PAIR-COPY-01: what both refusals say (starting a pairing, and the engine computer fetching it), in plain words
// that name the fix. One constant, so the two can never drift apart. The tests assert the https:// text.
export const PAIRING_NEEDS_HTTPS_MESSAGE =
  "Pairing only works when Home is opened at a secure address that starts with https://. This request came in through an address that starts with http://. Open Home through its https:// address, then try again. On the engine computer, give the pairing command the https:// address too.";

// ENGINES-AI-01: the two refusals the pairing wizard shows inline. Each says what is wrong and what to do.
export const ENGINE_ADDRESS_MISSING_MESSAGE =
  "Home does not have the engine computer's address and port yet. Enter its name or home network address and its secure connection port (usually 22) in Settings, Home settings, Engines and AI, then try again.";
export const ENGINE_SCAN_FAILED_MESSAGE =
  "Home could not read the engine computer's security key. Check that the engine computer is on, that it is on your home network, and that its secure connection port is right (usually 22), then try again.";

export function isSecurePairingRequest(protocol: string, forwardedProto: string | undefined, trustedProxy: boolean): boolean {
  const forwardedProtocol = trustedProxy ? forwardedProto?.split(",").at(-1)?.trim().toLowerCase() : undefined;
  return forwardedProtocol ? forwardedProtocol === "https" : protocol === "https:";
}

function isSecureRequest(c: { req: { header(name: string): string | undefined; url: string } }): boolean {
  const protocol = new URL(c.req.url).protocol;
  const forwardedProto = c.req.header("x-forwarded-proto");
  return isSecurePairingRequest(protocol, forwardedProto, TRUST_PROXY);
}

export function pairingSourceAddress(socketAddress: string | undefined, forwardedFor: string | undefined, trustedProxy: boolean): string | null {
  if (trustedProxy) {
    const rightmost = forwardedFor?.split(",").at(-1)?.trim();
    return rightmost || null;
  }
  return socketAddress?.trim() || null;
}

const issueRoute = createRoute({
  method: "post", path: "/pair", tags: ["Engine link"], summary: "Start engine computer pairing",
  middleware: [requireRole("owner", "admin")] as const,
  responses: { 200: { content: { "application/json": { schema: PairCodeSchema } }, description: "A short lived one-time code" }, ...ErrorResponses },
});
engineLinkRoutes.openapi(issueRoute, (c) => {
  if (!isSecureRequest(c)) return c.json({ error: PAIRING_NEEDS_HTTPS_MESSAGE }, 400);
  // ENGINES-AI-01: no "another computer first" gate. The pairing wizard picks the computer in its first step, and a
  // code can be issued at any time by an owner or admin over a secure address (the check above).
  return c.json(issuePairingCode(), 200);
});

const fetchRoute = createRoute({
  method: "get", path: "/pair/{lookup}", tags: ["Engine link"], summary: "Fetch pairing material using the derived lookup",
  request: { params: z.object({ lookup: z.string().regex(/^[\da-f]{32}$/i) }) },
  responses: { 200: { content: { "application/json": { schema: PairPayloadSchema } }, description: "Public key and code-keyed integrity check" }, 400: { description: "Code expired, exhausted, invalid or already used" } },
});
engineLinkRoutes.openapi(fetchRoute, async (c) => {
  if (!isSecureRequest(c)) return c.json({ error: PAIRING_NEEDS_HTTPS_MESSAGE }, 400);
  let socketAddress: string | undefined;
  try { socketAddress = getConnInfo(c).remote.address; } catch { socketAddress = undefined; }
  const source = pairingSourceAddress(socketAddress, c.req.header("x-forwarded-for"), TRUST_PROXY);
  if (!source) return c.json({ error: "Could not verify the connection source" }, 403);
  const allowTailnet = getHouseholdSettingValue("engines.stack.remote.allow_tailnet") === true;
  const sourceAllowed = await isHouseholdNetworkHost(source, { allowTailnet });
  if (!sourceAllowed) return c.json({ error: "Pairing is available only on the household network" }, 403);
  if (!tryConsume(`engine-pair:source:${source}`, { capacity: 5, refillPerSecond: 1 })) return c.json({ error: "Too many pairing attempts" }, 429);
  if (!tryConsume("engine-pair:global", { capacity: 30, refillPerSecond: 1 })) return c.json({ error: "Too many pairing attempts" }, 429);
  const payload = getPairingPublicKey(c.req.valid("param").lookup, getHubInstanceId());
  return payload ? c.json(payload, 200) : c.json({ error: "Pairing code is invalid or expired" }, 400);
});

const scanRoute = createRoute({
  method: "post", path: "/host-key/scan", tags: ["Engine link"], summary: "Read the engine computer's SSH host key",
  middleware: [requireRole("owner", "admin")] as const,
  responses: { 200: { content: { "application/json": { schema: z.object({ scanned: z.literal(true) }) } }, description: "The host key was read. The check code is never returned: the owner types the code printed on the engine computer into the confirm step." }, ...ErrorResponses },
});
engineLinkRoutes.openapi(scanRoute, async (c) => {
  const host = getHouseholdSettingValue(REMOTE_ENGINE_HOST_KEY);
  const port = Number(getHouseholdSettingValue("engines.stack.remote.ssh_port") ?? 22);
  if (typeof host !== "string" || !host.trim() || !Number.isInteger(port) || port < 1 || port > 65535) return c.json({ error: ENGINE_ADDRESS_MISSING_MESSAGE }, 400);
  const allowTailnet = getHouseholdSettingValue("engines.stack.remote.allow_tailnet") === true;
  if (!(await isHouseholdNetworkHost(host, { allowTailnet }))) return c.json({ error: REMOTE_ENGINE_ADDRESS_ERROR }, 400);
  try { await scanHostKey(host, port); return c.json({ scanned: true as const }, 200); }
  catch { return c.json({ error: ENGINE_SCAN_FAILED_MESSAGE }, 400); }
});

const confirmRoute = createRoute({
  method: "post", path: "/host-key/confirm", tags: ["Engine link"], summary: "Pin the SSH host key after the owner types the engine computer's check code",
  middleware: [requireRole("owner", "admin")] as const,
  request: { body: { content: { "application/json": { schema: z.object({ check_code: z.string().min(1).max(32) }) } } } },
  responses: { 200: { content: { "application/json": { schema: z.object({ paired: z.boolean() }) } }, description: "Host key pinned" }, ...ErrorResponses, 429: { description: "Too many wrong check codes; start pairing again" } },
});
engineLinkRoutes.openapi(confirmRoute, (c) => {
  try { confirmHostKey(c.req.valid("json").check_code); rebuildEngineLinkAfterPairing(); return c.json({ paired: getLinkCredentialStatus().paired }, 200); }
  catch (error) {
    if (error instanceof HostKeyConfirmError && error.locked) return c.json({ error: "Too many wrong check codes. Start pairing again." }, 429);
    if (error instanceof HostKeyConfirmError && error.reason === "expired") return c.json({ error: "Pairing expired. Start pairing again." }, 400);
    if (error instanceof HostKeyConfirmError && error.reason === "not_scanned") return c.json({ error: "Select Check the engine computer first." }, 400);
    if (error instanceof HostKeyConfirmError && error.reason === "already_pinned") return c.json({ error: "An engine computer is already paired. Revoke the link key first." }, 400);
    return c.json({ error: "The check code did not match the engine computer" }, 400);
  }
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
engineLinkRoutes.openapi(revokeRoute, (c) => { stopEngineLink(); revokeLinkKey(); setHouseholdSettingValue("engines.stack.where", "this_computer"); return c.json({ paired: false as const }, 200); });
