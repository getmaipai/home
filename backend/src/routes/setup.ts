// The setup wizard's API surface. Session F step 5 shipped the "trust
// this hub" piece (`GET /api/setup/ca`); step 11 adds `POST /api/setup/
// hardware` (install.sh's own minimums check, and the wizard's hardware
// step's data source). The rest (household, owner, acknowledgment,
// packages, remote, emergency_kit, backup, done - the wave-2 contract's
// full `GET /api/setup/state`/`POST /api/setup/:step`) still land with
// later steps that build the things each one actually configures.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { getHouseholdCaCertificate, ensureHouseholdLeaf } from "@/lib/householdCa";
import { getHubName } from "@/lib/hubIdentity";
import { listHubEndpoints } from "@/lib/hubEndpoints";
import { tryConsume } from "@/lib/rateLimiter";
import { getClientIp } from "@/lib/secretThrottle";
import { detectHardware } from "@/lib/hardware";
import { recommend } from "@/lib/modelCatalog";

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

// Same "a person's pace" reasoning as the CA route above: unauthenticated
// (setup happens before a household exists) but bounded, since detecting
// CUDA devices spawns an nvidia-smi subprocess.
const SETUP_HARDWARE_RATE_LIMIT = { capacity: 10, refillPerSecond: 0.5 };

const hardwareRoute = createRoute({
  method: "post",
  path: "/hardware",
  tags: ["Setup"],
  summary: "Detected hardware and whether a chat model fits it",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            platform: z.string(),
            arch: z.string(),
            totalRamGb: z.number(),
            cpuCount: z.number(),
            isAppleSilicon: z.boolean(),
            cudaDevices: z.array(z.object({ name: z.string(), vramGb: z.number() })),
            chatFit: z.object({
              // false on a CPU-only, non-Apple-Silicon box: hardware.ts's
              // primaryBudgetBytes() has no chat-inference sizing model for
              // that case yet (returns 0, "no automatic recommendation
              // possible" by its own doc comment) - reporting a confident
              // pass/fail off a budget of 0 would be a false "meets
              // minimums" or a false "doesn't", neither of which is true;
              // "not determined" is the honest answer until CPU inference
              // is sized.
              determined: z.boolean(),
              meetsMinimum: z.boolean().nullable(),
              bestFit: z.object({ id: z.string(), label: z.string() }).nullable(),
            }),
          }),
        },
      },
      description: "Real detected hardware plus whether any implemented chat-role model fits it.",
    },
    ...errorResponses({ 429: "Too many requests from this address" }),
  },
});
setupRoutes.openapi(hardwareRoute, async (c) => {
  const ip = getClientIp(c);
  if (!tryConsume(`setup-hardware:${ip}`, SETUP_HARDWARE_RATE_LIMIT)) {
    return c.json({ error: "Too many requests. Wait a moment and try again." }, 429);
  }
  const hw = await detectHardware();
  const fits = recommend("chat", hw);
  const determined = hw.isAppleSilicon || hw.cudaDevices.length > 0;
  const best = fits.find((f) => f.model.implemented && f.fits) ?? null;
  return c.json(
    {
      platform: hw.platform,
      arch: hw.arch,
      totalRamGb: hw.totalRamGb,
      cpuCount: hw.cpuCount,
      isAppleSilicon: hw.isAppleSilicon,
      cudaDevices: hw.cudaDevices.map((d) => ({ name: d.name, vramGb: Math.round(d.vramBytes / 1_073_741_824) })),
      chatFit: {
        determined,
        meetsMinimum: determined ? best !== null : null,
        bestFit: best ? { id: best.model.id, label: best.model.label } : null,
      },
    },
    200,
  );
});
