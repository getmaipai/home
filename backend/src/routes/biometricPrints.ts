// FACE-01: enrollment is always hub-owned - see lib/biometricPrints.ts's
// own header for the full design. Reads/writes both require
// requireAuth; the actual self-or-MANAGEABLE_BY (list, delete) and
// never-a-child-for-themself (create) authorization lives in
// lib/biometricPrints.ts, the same split routes/relationships.ts
// already uses (route: who's signed in; lib: what they're allowed to do
// to whom). A code review (2026-09-28) found the list route skipping
// that split entirely - requireAuth alone let any signed-in person read
// anyone else's enrollment metadata - so every handler here now passes
// the actor through to its lib function rather than trusting
// requireAuth to be enough on its own.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { createBiometricPrint, listBiometricPrints, deleteBiometricPrint } from "@/lib/biometricPrints";

export const biometricPrintsRoutes = apiRouter();

function createStatusFor(status: number): 400 | 403 {
  return status === 403 ? 403 : 400;
}

function deleteStatusFor(status: number): 403 | 404 {
  return status === 404 ? 404 : 403;
}

function listStatusFor(status: number): 400 | 403 {
  return status === 403 ? 403 : 400;
}

const SummarySchema = z.object({
  id: z.string(),
  person_id: z.string(),
  modality: z.enum(["face", "voice"]),
  model_id: z.string(),
  model_sha256: z.string(),
  dim: z.number(),
  captured_by: z.string().nullable(),
  consent_at: z.string(),
  consented_by_person_id: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
  hlc: z.string(),
});

const listRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Biometric prints"],
  summary: "A person's enrolled biometric prints (metadata only, never the embedding)",
  middleware: [requireAuth] as const,
  request: { query: z.object({ personId: z.string() }) },
  responses: {
    200: { content: { "application/json": { schema: z.array(SummarySchema) } }, description: "One row per accepted enrollment sample." },
    ...errorResponses({ 400: "No such person", 401: "Not signed in", 403: "Not allowed to see this person's biometric prints" }),
  },
});
biometricPrintsRoutes.openapi(listRoute, (c) => {
  const actor = c.get("person");
  const { personId } = c.req.valid("query");
  const result = listBiometricPrints(actor, personId);
  if (!result.ok) return c.json({ error: result.error }, listStatusFor(result.status));
  return c.json(result.value, 200);
});

const createRoute_ = createRoute({
  method: "post",
  path: "/",
  tags: ["Biometric prints"],
  summary: "Enroll one biometric sample for a person, consented by the signed-in actor",
  middleware: [requireAuth] as const,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            person_id: z.string(),
            model_id: z.string(),
            embedding: z.array(z.number()).min(1),
            captured_by: z.string().nullable().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: { content: { "application/json": { schema: SummarySchema } }, description: "Enrolled. consent_at/consented_by_person_id are the signed-in actor's, right now - never client-supplied." },
    ...errorResponses({ 400: "Unknown model, wrong dimension, or no such person", 401: "Not signed in", 403: "Not allowed to consent for this person" }),
  },
});
biometricPrintsRoutes.openapi(createRoute_, (c) => {
  const actor = c.get("person");
  const result = createBiometricPrint(actor, c.req.valid("json"));
  if (!result.ok) return c.json({ error: result.error }, createStatusFor(result.status));
  return c.json(result.value, 201);
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Biometric prints"],
  summary: "Revoke one biometric sample",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("id", "print-a1b2c3") },
  responses: {
    200: { content: { "application/json": { schema: z.object({ success: z.literal(true) }) } }, description: "Tombstoned: the embedding is scrubbed, the row's metadata stays as evidence a consent once existed." },
    ...errorResponses({ 401: "Not signed in", 403: "Not allowed to revoke this print", 404: "No such biometric print" }),
  },
});
biometricPrintsRoutes.openapi(deleteRoute, (c) => {
  const actor = c.get("person");
  const { id } = c.req.valid("param");
  const result = deleteBiometricPrint(actor, id);
  if (!result.ok) return c.json({ error: result.error }, deleteStatusFor(result.status));
  return c.json(result.value, 200);
});
