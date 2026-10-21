// COMPANIONS-APP-01 (docs/design/companions-app-2026-10-21.md): the Companions app's data. A list of the companions the signed-in
// person may use, one companion in full, and "Set as my default" (which writes `persona.active_id` for the person through the one
// settings writer). A companion above the person's type is a 404, so its existence does not leak. Admins also get who uses each
// companion and which companion each robot has.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { isOwnerOrAdmin } from "@/lib/access";
import { PERSONAS } from "@/lib/persona";
import { companionDetail, companionAreaOn, listCompanionCards, mayUseCompanion, pickRefusal, robotAssignments } from "@/lib/companionsApp";
import { publishSettingsChanged } from "@/lib/deviceCommands";
import { setValue } from "@/lib/settings";

export const companionsRoutes = apiRouter();

const Type = z.enum(["child", "teen", "adult"]);
const Card = z.object({
  id: z.string(), name: z.string(), type: Type, type_label: z.string(), tagline: z.string(), who_can_use: z.string(),
  dials: z.array(z.object({ label: z.string(), value: z.string() })), voice: z.string(), is_default: z.boolean(),
});
const Detail = Card.extend({
  about: z.string(), pronouns: z.string().nullable(), interests: z.array(z.string()), examples: z.array(z.string()),
  voice_value: z.string().describe("The voice id the page previews through /api/voice/voices/{id}/preview."), voice_is_own: z.boolean(), voice_setting: z.string().nullable(),
  used_by: z.object({ people: z.array(z.object({ id: z.string(), name: z.string() })), robots: z.array(z.object({ id: z.string(), name: z.string() })) }).nullable(),
});

const listRoute = createRoute({
  method: "get", path: "/", tags: ["Companions"], summary: "The companions I may use, and for an admin which companion each robot has",
  middleware: [requireAuth] as const,
  responses: {
    200: { content: { "application/json": { schema: z.object({
      allowed: z.boolean().describe("False when an owner or admin turned companions off for this person."),
      companions: z.array(Card),
      robots: z.array(z.object({ id: z.string(), name: z.string(), controls: Type, companion_id: z.string(), companion_name: z.string().nullable() })).nullable(),
    }) } }, description: "My companions. The robots list is for owners and admins only." },
    ...errorResponses({ 401: "Not signed in" }),
  },
});
companionsRoutes.openapi(listRoute, (c) => {
  const person = c.get("person");
  return c.json({ allowed: companionAreaOn(person), companions: listCompanionCards(person), robots: isOwnerOrAdmin(person) ? robotAssignments() : null }, 200);
});

const detailRoute = createRoute({
  method: "get", path: "/{id}", tags: ["Companions"], summary: "One companion in full",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("id", "lively-teen") },
  responses: {
    200: { content: { "application/json": { schema: Detail } }, description: "The companion." },
    ...errorResponses({ 401: "Not signed in", 404: "No such companion for this person" }),
  },
});
companionsRoutes.openapi(detailRoute, (c) => {
  const person = c.get("person");
  const persona = PERSONAS.find((candidate) => candidate.id === c.req.valid("param").id);
  if (!persona || !mayUseCompanion(person, persona)) return c.json({ error: "No such companion" }, 404);
  return c.json(companionDetail(person, persona, isOwnerOrAdmin(person)), 200);
});

const defaultRoute = createRoute({
  method: "put", path: "/{id}/default", tags: ["Companions"], summary: "Set this companion as my default",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("id", "lively-teen") },
  responses: {
    200: { content: { "application/json": { schema: z.object({ default_id: z.string() }) } }, description: "Saved." },
    ...errorResponses({ 401: "Not signed in", 403: "Companions are off, or this one is not for this person", 404: "No such companion" }),
  },
});
companionsRoutes.openapi(defaultRoute, (c) => {
  const person = c.get("person");
  const persona = PERSONAS.find((candidate) => candidate.id === c.req.valid("param").id);
  if (!persona) return c.json({ error: "No such companion" }, 404);
  const refusal = pickRefusal(person, persona);
  if (refusal) return c.json({ error: refusal }, 403);
  const result = setValue(person, `person:${person.id}`, "persona.active_id", persona.id);
  if (!result.ok) return c.json({ error: result.error }, 403);
  publishSettingsChanged(`person:${person.id}`, "persona.active_id", persona.id);
  return c.json({ default_id: persona.id }, 200);
});
