// Session F, step 6: "device tokens... so native clients survive a
// change of address" (platform plan, step 6 text) - this is the redeem
// step that makes that real. Not itself in wave-2's F-to-E route list
// (which names GET/DELETE /api/devices, Quick Connect, and passkeys),
// but load-bearing underneath all three: Quick Connect's poll and a
// native passkey sign-in both mint a device token, and this is the only
// place one is ever traded back in for a session. Public (unauthenticated)
// by design, same reason GET /api/setup/ca is - this IS the
// authentication, not a step that comes after it.
//
// Deliberately never re-checks TOTP, even for an owner/admin who has it
// enabled - a code review (2026-09-06) asked about this directly. TOTP
// is enforced once, at the moment a device is PAIRED (Quick Connect's
// /approve, which requires a current code when the approver has TOTP
// on) or a passkey/PIN sign-in completes; the device token that pairing
// produces is the standard "remembered device" credential every mainstream
// implementation uses (a signed-in phone app, a browser's "remember this
// device" cookie) specifically so a native client is NOT re-prompted for
// 2FA on every reconnect - that is the entire point of the token
// existing. A stolen token is a real risk like any long-lived credential,
// which is why every device is visible (GET /api/devices) and instantly
// revocable (DELETE /api/devices/:id), not why redemption should ask for
// a code no background process could ever supply.
import { createRoute, z } from "@hono/zod-openapi";
import { eq, and, isNull } from "drizzle-orm";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { issueSession } from "@/lib/session";
import { redeemDeviceToken } from "@/lib/deviceTokens";
import { db } from "@/db";
import { people } from "@/db/schema";

export const deviceAuthRoutes = apiRouter();

const redeemRoute = createRoute({
  method: "post",
  path: "/redeem",
  tags: ["Devices"],
  summary: "Trade a device token for a session cookie on this address",
  request: {
    body: { content: { "application/json": { schema: z.object({ token: z.string().min(1) }) } } },
  },
  responses: {
    200: { content: { "application/json": { schema: z.object({ success: z.literal(true) }) } }, description: "A session cookie is now set for this origin." },
    ...errorResponses({ 401: "Unknown or expired device token, or the profile is disabled" }),
  },
});
deviceAuthRoutes.openapi(redeemRoute, (c) => {
  const { token } = c.req.valid("json");
  const seenUrl = c.req.header("origin") ?? null;
  const redeemed = redeemDeviceToken(token, seenUrl);
  if (!redeemed) return c.json({ error: "Unknown or expired device token" }, 401);

  // Step 7: a valid, unexpired device token belonging to a now-disabled
  // or deleted person must not still work - the token surviving
  // memorializePerson()/deletePerson() (both revoke it directly) is not
  // the only way this state could arise: PATCH /api/people/:id can flip
  // enabled to false without touching this person's device tokens at
  // all, and this check is what makes that flip actually take effect
  // here too.
  const person = db.select({ enabled: people.enabled }).from(people).where(and(eq(people.id, redeemed.personId), isNull(people.deletedAt))).get();
  if (!person || !person.enabled) return c.json({ error: "Unknown or expired device token" }, 401);

  issueSession(c, redeemed.personId);
  return c.json({ success: true as const }, 200);
});
