// COMPANIONS-APP-01 (docs/design/companions-app-2026-10-21.md): the Companions app's data. A list of the companions the signed-in
// person may use, one companion in full, and "Set as my default" (which writes `persona.active_id` for the person through the one
// settings writer). A companion above the person's type is a 404, so its existence does not leak. Admins also get who uses each
// companion and which companion each robot has.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { isOwnerOrAdmin } from "@/lib/access";
import { companionDetail, companionAreaOn, listCompanionCards, mayUseCompanion, pickRefusal, robotAssignments } from "@/lib/companionsApp";
import { publishSettingsChanged } from "@/lib/deviceCommands";
import { setValue } from "@/lib/settings";
import { speakerAgeBand } from "@/lib/ageBand";
import { db } from "@/db";
import { people, settingsValues } from "@/db/schema";
import { isNull, eq, and } from "drizzle-orm";
import { listDevicesByKind } from "@/lib/devices";
import { getDeviceSettingValue } from "@/lib/settings";
import { companionFits, robotControlsOf, ROBOT_COMPANION_KEY } from "@/lib/robotCompanion";
import { PERSONAS, reloadPersonas } from "@/lib/persona";
import { createHouseholdCompanion, copyBundledCompanion, copyHouseholdCompanion, getHouseholdCompanion, updateHouseholdCompanion, deleteHouseholdCompanion, setHouseholdCompanionAudience, setHouseholdCompanionStatus, householdCompanionAuthorId } from "@/lib/householdCompanions";

export const companionsRoutes = apiRouter();

const Type = z.enum(["child", "teen", "adult"]);
const Card = z.object({
  id: z.string(), name: z.string(), type: Type, type_label: z.string(), tagline: z.string(), who_can_use: z.string(),
  dials: z.array(z.object({ label: z.string(), value: z.string() })), voice: z.string(), is_default: z.boolean(), is_household: z.boolean(), status: z.string(),
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
  return c.json({ allowed: companionAreaOn(person), companions: listCompanionCards(person, isOwnerOrAdmin(person)), robots: isOwnerOrAdmin(person) ? robotAssignments() : null }, 200);
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

const fields = z.object({
  name: z.string().min(1).optional(), display_name: z.string().min(1).optional(), pronouns: z.string().nullable().optional(), tagline: z.string().optional(), backstory: z.string().optional(), interests: z.array(z.string()).optional(),
  formality: z.enum(["casual", "neutral", "formal"]).optional(), complexity: z.enum(["simple", "standard", "advanced"]).optional(), engagement: z.enum(["brief", "balanced", "curious"]).optional(), filler_density: z.enum(["none", "light", "frequent"]).optional(),
  behavior: z.array(z.string()).optional(), examples: z.array(z.string()).optional(), examples_child: z.array(z.string()).optional(), examples_teen: z.array(z.string()).optional(), examples_adult: z.array(z.string()).optional(), voice_id: z.string().optional(), look_prompt: z.string().optional(),
});
function normalizedFields(value: z.infer<typeof fields>) { const { name, ...rest } = value; return { ...rest, ...(name ? { display_name: name } : {}) }; }
const idPath = idParamSchema("id", "hc-companion");
const fieldsJson = { content: { "application/json": { schema: fields } } };
function mayEdit(actor: import("@/types").PersonRow, id: string): boolean { return isOwnerOrAdmin(actor) || householdCompanionAuthorId(id) === actor.id; }
function liveUseCounts(id: string, targetAudience: "adult" | "teen" | "all") {
  const floor = targetAudience === "adult" ? "adult" : targetAudience === "teen" ? "teen" : "child";
  const robots = listDevicesByKind("robot").filter((device) => getDeviceSettingValue(device.id, ROBOT_COMPANION_KEY) === id && !companionFits(robotControlsOf(device.id), floor as "child" | "teen" | "adult")).length;
  const rows = db.select().from(people).where(isNull(people.deletedAt)).all() as import("@/types").PersonRow[];
  const peopleCount = rows.filter((person) => {
    const stored = db.select({ value: settingsValues.value }).from(settingsValues).where(and(eq(settingsValues.scope, `person:${person.id}`), eq(settingsValues.key, "persona.active_id"))).get();
    if (!stored) return false;
    try { if (JSON.parse(stored.value) !== id) return false; } catch { return false; }
    return !companionFits(speakerAgeBand(person, new Date()), floor as "child" | "teen" | "adult");
  }).length;
  return { robots, people: peopleCount };
}
function inUseSentence(kind: "robots" | "people", count: number): string { return `${count} ${kind} use this companion at a lower level. Change them first.`; }
function allUseCounts(id: string) {
  const robots = listDevicesByKind("robot").filter((device) => getDeviceSettingValue(device.id, ROBOT_COMPANION_KEY) === id).length;
  const rows = db.select().from(people).where(isNull(people.deletedAt)).all() as import("@/types").PersonRow[];
  const peopleCount = rows.filter((person) => {
    const stored = db.select({ value: settingsValues.value }).from(settingsValues).where(and(eq(settingsValues.scope, `person:${person.id}`), eq(settingsValues.key, "persona.active_id"))).get();
    try { return Boolean(stored && JSON.parse(stored.value) === id); } catch { return false; }
  }).length;
  return { robots, people: peopleCount };
}

const createCompanionRoute = createRoute({ method: "post", path: "/", tags: ["Companions"], summary: "Create a household companion draft", middleware: [requireAuth] as const,
  request: { body: fieldsJson }, responses: { 201: { content: { "application/json": { schema: z.object({ id: z.string() }) } }, description: "Draft created." }, ...errorResponses({ 400: "Invalid companion fields", 401: "Not signed in", 403: "Only adults can make a companion." }) } });
companionsRoutes.openapi(createCompanionRoute, (c) => {
  const actor = c.get("person"); if (speakerAgeBand(actor, new Date()) !== "adult" && !isOwnerOrAdmin(actor)) return c.json({ error: "Only adults can make a companion." }, 403);
  const result = createHouseholdCompanion(normalizedFields(c.req.valid("json")) as never, { display_name: actor.displayName, person_id: actor.id });
  if (!result.ok) return c.json({ error: result.error }, 400);
  return c.json({ id: result.value.id }, 201);
});

const copyRoute = createRoute({ method: "post", path: "/{id}/copy", tags: ["Companions"], summary: "Copy a companion into a household draft", middleware: [requireAuth] as const,
  request: { params: idPath }, responses: { 201: { content: { "application/json": { schema: z.object({ id: z.string() }) } }, description: "Draft copied." }, ...errorResponses({ 401: "Not signed in", 403: "Only adults can make a companion.", 404: "No such companion" }) } });
companionsRoutes.openapi(copyRoute, (c) => {
  const actor = c.get("person"); if (speakerAgeBand(actor, new Date()) !== "adult" && !isOwnerOrAdmin(actor)) return c.json({ error: "Only adults can make a companion." }, 403);
  const id = c.req.valid("param").id;
  const author = { display_name: actor.displayName, person_id: actor.id };
  const result = getHouseholdCompanion(id) ? copyHouseholdCompanion(id, author) : copyBundledCompanion(id, author);
  if (!result.ok) return c.json({ error: result.error }, 404);
  reloadPersonas(); return c.json({ id: result.value.id }, 201);
});

const editRoute = createRoute({ method: "get", path: "/{id}/edit", tags: ["Companions"], summary: "Read an editable household companion", middleware: [requireAuth] as const,
  request: { params: idPath }, responses: { 200: { content: { "application/json": { schema: z.any() } }, description: "Editable companion." }, ...errorResponses({ 401: "Not signed in", 404: "No companion you can edit" }) } });
companionsRoutes.openapi(editRoute, (c) => {
  const actor = c.get("person"), id = c.req.valid("param").id, manifest = getHouseholdCompanion(id);
  if (!manifest?.companion || !mayEdit(actor, id)) return c.json({ error: "No companion you can edit." }, 404);
  return c.json({ id, ...manifest.companion, name: manifest.companion.display_name, audience: manifest.companion.audience ?? "adult", status: manifest.companion.status ?? "ready", review: manifest.companion.review ?? null, can_edit: true, can_set_audience: isOwnerOrAdmin(actor) }, 200);
});

const updateRoute = createRoute({ method: "put", path: "/{id}", tags: ["Companions"], summary: "Edit a household companion", middleware: [requireAuth] as const,
  request: { params: idPath, body: fieldsJson }, responses: { 200: { content: { "application/json": { schema: z.object({ id: z.string() }) } }, description: "Saved." }, ...errorResponses({ 400: "Invalid companion fields", 401: "Not signed in", 403: "Not allowed to edit this companion", 404: "No such companion" }) } });
companionsRoutes.openapi(updateRoute, (c) => {
  const actor = c.get("person"), id = c.req.valid("param").id;
  if (PERSONAS.some((p) => p.id === id) && !getHouseholdCompanion(id)) return c.json({ error: "A bundled companion can't be changed. Make a copy to edit it." }, 403);
  if (!getHouseholdCompanion(id)) return c.json({ error: "That household companion could not be found." }, 404);
  if (!mayEdit(actor, id)) return c.json({ error: "Only the author or an admin can edit this companion." }, 403);
  const result = updateHouseholdCompanion(id, normalizedFields(c.req.valid("json")) as never); if (!result.ok) return c.json({ error: result.error }, 400);
  if (result.value.companion?.status === "ready") reloadPersonas(); return c.json({ id }, 200);
});

const audienceRoute = createRoute({ method: "put", path: "/{id}/audience", tags: ["Companions"], summary: "Set companion audience", middleware: [requireAuth] as const,
  request: { params: idPath, body: { content: { "application/json": { schema: z.object({ audience: z.enum(["adult", "teen", "all"]), confirmed: z.boolean().optional() }) } } } }, responses: { 200: { content: { "application/json": { schema: z.object({ id: z.string() }) } }, description: "Audience saved." }, ...errorResponses({ 400: "Review confirmation required", 403: "Admin only", 404: "No such household companion", 409: "Companion is in use" }) } });
companionsRoutes.openapi(audienceRoute, (c) => {
  const actor = c.get("person"), id = c.req.valid("param").id, body = c.req.valid("json");
  if (!isOwnerOrAdmin(actor)) return c.json({ error: "Only an admin can change a companion's audience." }, 403);
  if (!getHouseholdCompanion(id)) return c.json({ error: "That household companion could not be found." }, 404);
  if (body.audience === "all" && body.confirmed !== true) return c.json({ error: "Review the all ages checklist and confirm before making this companion available to everyone." }, 400);
  const uses = liveUseCounts(id, body.audience); if (uses.robots) return c.json({ error: inUseSentence("robots", uses.robots) }, 409); if (uses.people) return c.json({ error: inUseSentence("people", uses.people) }, 409);
  const result = setHouseholdCompanionAudience(id, body.audience, { display_name: actor.displayName }); if (!result.ok) return c.json({ error: result.error }, 400);
  reloadPersonas(); return c.json({ id }, 200);
});

const statusRoute = createRoute({ method: "put", path: "/{id}/status", tags: ["Companions"], summary: "Set companion status", middleware: [requireAuth] as const,
  request: { params: idPath, body: { content: { "application/json": { schema: z.object({ status: z.enum(["draft", "ready"]) }) } } } }, responses: { 200: { content: { "application/json": { schema: z.object({ id: z.string() }) } }, description: "Status saved." }, ...errorResponses({ 400: "Identity or Voice fields are missing", 403: "Only the author or an admin can change status", 404: "No such household companion" }) } });
companionsRoutes.openapi(statusRoute, (c) => {
  const actor = c.get("person"), id = c.req.valid("param").id, body = c.req.valid("json"), manifest = getHouseholdCompanion(id);
  if (!manifest?.companion) return c.json({ error: "That household companion could not be found." }, 404);
  if (!mayEdit(actor, id)) return c.json({ error: "Only the author or an admin can change this companion's status." }, 403);
  if (body.status === "ready" && (manifest.companion.examples?.length ?? 0) < 3) return c.json({ error: "Add at least 3 example lines before marking this companion ready." }, 400);
  const result = setHouseholdCompanionStatus(id, body.status); if (!result.ok) return c.json({ error: result.error }, 400);
  reloadPersonas(); return c.json({ id }, 200);
});

const deleteRoute = createRoute({ method: "delete", path: "/{id}", tags: ["Companions"], summary: "Delete a household companion", middleware: [requireAuth] as const,
  request: { params: idPath }, responses: { 204: { description: "Deleted." }, ...errorResponses({ 403: "Only the author or an admin can delete this companion", 404: "No such household companion", 409: "Companion is in use" }) } });
companionsRoutes.openapi(deleteRoute, (c) => {
  const actor = c.get("person"), id = c.req.valid("param").id;
  if (!getHouseholdCompanion(id)) return c.json({ error: "That household companion could not be found." }, 404);
  if (!mayEdit(actor, id)) return c.json({ error: "Only the author or an admin can delete this companion." }, 403);
  const uses = allUseCounts(id); if (uses.robots) return c.json({ error: `${uses.robots} robots use this companion. Change them first.` }, 409); if (uses.people) return c.json({ error: `${uses.people} people use this companion as their default. Change them first.` }, 409);
  if (!deleteHouseholdCompanion(id)) return c.json({ error: "The companion could not be deleted. Check the household data folder and try again." }, 400);
  reloadPersonas(); return c.body(null, 204);
});
