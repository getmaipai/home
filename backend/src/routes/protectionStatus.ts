import { and, count, eq, isNull } from "drizzle-orm";
import { createRoute, z } from "@hono/zod-openapi";
import { db } from "@/db";
import { people, personCredentials } from "@/db/schema";
import { dataDir } from "@/lib/paths";
import { dataDirectoryOwnerOnly, diskEncryptionState, keyFileInsideData, swapEncryptionState } from "@/lib/protectionStatus";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { MIN_SECRET_LENGTH } from "@/lib/validation";
import { requestUsesHttps } from "@/lib/trustProxy";
import { requireRole } from "@/middleware/auth";

export const protectionStatusRoutes = apiRouter();

const CheckState = z.enum(["on", "off", "unknown"]);
const ProtectionResponse = z.object({
  diskEncryption: CheckState,
  swapEncryption: CheckState,
  https: z.boolean(),
  dataDirectoryOwnerOnly: CheckState,
  keyFileInsideData: z.boolean(),
  profilesWithoutPasscode: z.number().int().nonnegative(),
  minimumPasscodeLength: z.number().int().positive(),
});

const route = createRoute({
  method: "get",
  path: "/protection",
  tags: ["Status"],
  summary: "Read machine protection checks",
  middleware: [requireRole("owner", "admin")] as const,
  responses: {
    200: { content: { "application/json": { schema: ProtectionResponse } }, description: "Machine protection checks and aggregate credential counts." },
    ...errorResponses({ 401: "Not signed in", 403: "Owner/admin only" }),
  },
});

export type ProtectionStatusRoute = typeof route;

protectionStatusRoutes.openapi(route, (c) => {
  const missing = db.select({ value: count() })
    .from(people)
    .leftJoin(personCredentials, eq(people.id, personCredentials.personId))
    .where(and(isNull(people.deletedAt), isNull(personCredentials.secretHash)))
    .get()?.value ?? 0;

  return c.json({
    diskEncryption: diskEncryptionState(process.platform),
    swapEncryption: swapEncryptionState(process.platform),
    https: requestUsesHttps(c.req.url, c.req.header("x-forwarded-proto")),
    dataDirectoryOwnerOnly: dataDirectoryOwnerOnly(dataDir, process.platform),
    keyFileInsideData: keyFileInsideData(dataDir),
    profilesWithoutPasscode: missing,
    minimumPasscodeLength: MIN_SECRET_LENGTH,
  }, 200);
});
