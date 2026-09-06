// The setup wizard's API surface. Session F step 5 ships only the "trust
// this hub" piece (`GET /api/setup/ca`); the rest of the wizard's steps
// (household, owner, acknowledgment, hardware, packages, remote,
// emergency_kit, backup, done - the wave-2 contract's full
// `GET /api/setup/state`/`POST /api/setup/:step`) land with later steps
// that build the things each step actually configures.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { getHouseholdCaCertificate, ensureHouseholdLeaf } from "@/lib/householdCa";
import { getHubName } from "@/lib/hubIdentity";
import { listHubEndpoints } from "@/lib/hubEndpoints";
import { tryConsume } from "@/lib/rateLimiter";
import { getClientIp } from "@/lib/secretThrottle";

// A person on the household's own LAN hits this a handful of times while
// working through the trust step, never dozens of times a second - the
// same "a person's pace" budget CLAUDE.md's third-party-services section
// asks of every outbound integration, applied here to an unauthenticated
// inbound route instead. A code review (2026-09-06) found this route
// unthrottled despite spawning a `tailscale status` subprocess
// (getTailscaleStatus(), via listHubEndpoints()) on every single call -
// an unauthenticated caller could otherwise hammer the hub into spawning
// subprocesses as fast as it can accept connections.
const SETUP_CA_RATE_LIMIT = { capacity: 10, refillPerSecond: 0.5 };

export const setupRoutes = apiRouter();

// Public (unauthenticated) by design, the same reason GET /api/auth/profiles
// is: a household member trusting the hub's CA is exactly the step that
// has to happen BEFORE the browser will show anything else without a
// certificate warning, so it can't itself require a session cookie the
// browser doesn't trust yet to send.
const caRoute = createRoute({
  method: "get",
  path: "/ca",
  tags: ["Setup"],
  summary: "The household CA certificate to install and trust",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            certificate: z.string().openapi({ description: "PEM-encoded CA certificate. Never a private key." }),
            hubName: z.string(),
            installHint: z.object({
              darwin: z.string(),
              windows: z.string(),
              ios: z.string(),
              android: z.string(),
              linux: z.string(),
            }),
            qrPayload: z
              .string()
              .nullable()
              .openapi({
                description:
                  "What a QR code for another device on the LAN should encode - this same endpoint's URL, so scanning it fetches the certificate directly. Rendering the actual QR image is a frontend concern (E's kit); this only supplies the data to encode. Null when no reachable address was detected (no LAN interface up) - there's nothing a QR code from a second device could reach.",
              }),
          }),
        },
      },
      description: "The CA certificate (minted on first call) plus a per-platform install hint.",
    },
    ...errorResponses({ 429: "Too many requests from this address" }),
  },
});
setupRoutes.openapi(caRoute, async (c) => {
  const ip = getClientIp(c);
  if (!tryConsume(`setup-ca:${ip}`, SETUP_CA_RATE_LIMIT)) {
    return c.json({ error: "Too many requests. Wait a moment and try again." }, 429);
  }
  // Ensures a leaf certificate exists (and currently covers this hub's
  // detected addresses) at the same time a household is looking at the
  // trust step - the natural moment to mint both, not a separate,
  // easy-to-forget step.
  await ensureHouseholdLeaf();
  const endpoints = await listHubEndpoints();
  // Only a LAN-kind endpoint, never a fallback to `endpoints[0]` (a
  // second code review pass, 2026-09-06, caught that the first fix still
  // did this): a Tailscale or admin-added public row could sort ahead of
  // a LAN one, or be the only row at all, and would then get encoded into
  // a QR code whose entire purpose is "reachable from a second device on
  // THIS network" - a device on the physical LAN but off the tailnet
  // could scan a URL it can never reach. No LAN endpoint means nothing
  // reachable this way exists yet; null and "nothing to scan yet" is
  // honest, a non-LAN URL is not.
  const primary = endpoints.find((e) => e.kind === "lan");
  const qrPayload = primary ? `${primary.url}/api/setup/ca` : null;
  return c.json(
    {
      certificate: await getHouseholdCaCertificate(),
      hubName: getHubName(),
      installHint: {
        darwin: "Open the downloaded certificate, then in Keychain Access set it to \"Always Trust\" under System.",
        windows: "Open the downloaded certificate and install it into \"Trusted Root Certification Authorities\" for the local machine.",
        ios: "Install the profile in Settings, then turn it on under Settings > General > About > Certificate Trust Settings.",
        android: "Install it as a CA certificate under Settings > Security > Encryption & credentials.",
        linux: "Copy it into your distribution's CA trust store (e.g. /usr/local/share/ca-certificates/) and update it.",
      },
      qrPayload,
    },
    200,
  );
});
