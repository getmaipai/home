// Session F, step 6: Quick Connect (wave-2's F-to-E contract names these
// three routes exactly). lib/quickConnect.ts's own header has the full
// flow and why `code`/`poll_token` are two different secrets.
import { createRoute, z } from "@hono/zod-openapi";
import { eq, and, isNull } from "drizzle-orm";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { issueSession } from "@/lib/session";
import { issueDeviceToken } from "@/lib/deviceTokens";
import { createQuickConnect, approveQuickConnect, consumeQuickConnect, isQuickConnectPending } from "@/lib/quickConnect";
import { isTotpEnabled, verifyTotp } from "@/lib/totp";
import { db } from "@/db";
import { people } from "@/db/schema";

export const quickConnectRoutes = apiRouter();

const DEVICE_KINDS = ["robot", "pod", "tv", "phone", "desktop", "browser"] as const;

const createRouteDef = createRoute({
  method: "post",
  path: "/code",
  tags: ["Quick Connect"],
  summary: "Start a Quick Connect sign-in - show the code, then poll with poll_token",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            label: z.string().min(1).max(60).openapi({ description: "\"Living room TV\" - shown on the approving phone." }),
            kind: z.enum(DEVICE_KINDS).default("tv"),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            code: z.string().openapi({ description: "6 characters, no 0/O/1/I - read aloud and typed on an approving phone." }),
            poll_token: z.string().openapi({ description: "Known only to this device - present it back to /poll, never shown alongside the code." }),
          }),
        },
      },
      description: "A pending Quick Connect request, good for 5 minutes.",
    },
    ...errorResponses({ 429: "Too many Quick Connect requests right now" }),
  },
});
quickConnectRoutes.openapi(createRouteDef, (c) => {
  const { label, kind } = c.req.valid("json");
  const req = createQuickConnect(label, kind);
  if (!req) return c.json({ error: "Too many Quick Connect requests right now. Wait a moment and try again." }, 429);
  return c.json({ code: req.code, poll_token: req.pollToken }, 200);
});

const pollRoute = createRoute({
  method: "get",
  path: "/poll",
  tags: ["Quick Connect"],
  summary: "Poll a Quick Connect request - mints a session and device token once approved",
  request: {
    query: z.object({ poll_token: z.string().min(1).openapi({ param: { name: "poll_token", in: "query" } }) }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.discriminatedUnion("status", [
            z.object({ status: z.literal("pending") }),
            z.object({ status: z.literal("approved"), device_token: z.string(), expires_at: z.string() }),
            z.object({ status: z.literal("expired") }),
          ]),
        },
      },
      description: "\"pending\" while waiting, \"approved\" exactly once (a session cookie is also set for this address), \"expired\" for an unknown or timed-out poll_token.",
    },
  },
});
quickConnectRoutes.openapi(pollRoute, (c) => {
  const { poll_token } = c.req.valid("query");
  const approved = consumeQuickConnect(poll_token);
  // No TOTP check here by design: approveRoute below already required a
  // current code from the approver when they have TOTP enabled, before
  // this ever became consumable. This just redeems that already-2FA'd
  // approval.
  if (approved) {
    // Step 7: the approver could have been disabled (or deleted) in the
    // window between /approve and this poll picking the approval up -
    // the 5-minute Quick Connect TTL is long enough for that to matter,
    // unlike the near-instant device-redeem path. Treat it as expired
    // rather than minting a session and a fresh year-long device token
    // for a profile that should no longer be able to sign in anywhere.
    const person = db.select({ enabled: people.enabled }).from(people).where(and(eq(people.id, approved.personId), isNull(people.deletedAt))).get();
    if (!person || !person.enabled) return c.json({ status: "expired" as const }, 200);

    issueSession(c, approved.personId);
    const { token, expiresAt } = issueDeviceToken(approved.personId, approved.kind, approved.label);
    return c.json({ status: "approved" as const, device_token: token, expires_at: expiresAt }, 200);
  }
  if (isQuickConnectPending(poll_token)) return c.json({ status: "pending" as const }, 200);
  return c.json({ status: "expired" as const }, 200);
});

// A code review (2026-09-06) found the original version of this route
// minting a full session AND a 365-day device token for a brand-new
// device with no TOTP check anywhere in the flow, even for an owner/
// admin with TOTP enabled - unlike /verify-secret and /authenticate/
// verify, which both gate session issuance on it. Approving a device is
// exactly the kind of privileged, long-lived-credential-granting action
// TOTP exists to protect (arguably more so than an ordinary sign-in,
// since it hands out a token good for a year): if the approver has TOTP
// enabled, this now requires a real, current code as part of approving,
// not just their already-signed-in session. Once approved, the device's
// OWN redemption (POST /api/auth/devices/redeem) stays silent forever
// after - the standard "remembered device" shape every mainstream
// implementation uses, where the point of the persistent credential is
// exactly to not re-prompt for 2FA on every subsequent connection.
const approveRoute = createRoute({
  method: "post",
  path: "/approve",
  tags: ["Quick Connect"],
  summary: "Approve a Quick Connect code as the signed-in person",
  middleware: [requireAuth] as const,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            code: z.string().min(1),
            totpToken: z.string().min(6).max(6).optional().openapi({ description: "Required only when the approver has TOTP enabled." }),
          }),
        },
      },
    },
  },
  responses: {
    200: { content: { "application/json": { schema: z.object({ success: z.literal(true) }) } }, description: "Approved." },
    ...errorResponses({ 400: "Unknown, expired, or already-approved code", 401: "A current TOTP code is required to approve a new device" }),
  },
});
quickConnectRoutes.openapi(approveRoute, (c) => {
  const actor = c.get("person");
  const { code, totpToken } = c.req.valid("json");

  if (isTotpEnabled(actor.id)) {
    if (!totpToken || !verifyTotp(actor.id, totpToken)) {
      return c.json({ error: "A current TOTP code is required to approve a new device" }, 401);
    }
  }

  if (!approveQuickConnect(code, actor.id)) return c.json({ error: "That code is no longer valid" }, 400);
  return c.json({ success: true as const }, 200);
});
