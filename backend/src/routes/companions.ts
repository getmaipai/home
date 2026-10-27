// COMPANIONS-APP-01 (docs/design/companions-app-2026-10-21.md): the Companions app's data. A list of the companions the signed-in
// person may use, one companion in full, and "Set as my default" (which writes `persona.active_id` for the person through the one
// settings writer). A companion above the person's type is a 404, so its existence does not leak. Admins also get who uses each
// companion and which companion each robot has.
import { createRoute, z } from "@hono/zod-openapi";
import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { isOwnerOrAdmin } from "@/lib/access";
import { companionDetail, companionAreaOn, canCreateCompanion, currentCompanionId, listCompanionCards, discoverCompanionCards, heldCompanionIds, mayUseCompanion, pickRefusal, robotAssignments } from "@/lib/companionsApp";
import { publishSettingsChanged } from "@/lib/deviceCommands";
import { getPersonSettingValue, setValue } from "@/lib/settings";
import { speakerAgeBand } from "@/lib/ageBand";
import { db } from "@/db";
import { people, settingsValues, jobs, projects, conversations, pictureJobs, videoJobs, musicJobs } from "@/db/schema";
import { isNull, eq, and, sql } from "drizzle-orm";
import { listDevicesByKind } from "@/lib/devices";
import { getDeviceSettingValue } from "@/lib/settings";
import { companionFits, companionFloor, robotControlsOf, ROBOT_COMPANION_KEY } from "@/lib/robotCompanion";
import { PERSONAS, reloadPersonas, resolvePersona } from "@/lib/persona";
import { loadManifestOnly } from "@/lib/plugins";
import { resolvePackageDir } from "@/lib/packageResolve";
import { createHouseholdCompanion, copyBundledCompanion, copyHouseholdCompanion, getHouseholdCompanion, updateHouseholdCompanion, deleteHouseholdCompanion, setHouseholdCompanionAudience, setHouseholdCompanionStatus, householdCompanionAuthorId } from "@/lib/householdCompanions";
import { addVersion, approveSheet, deleteVersion, readLook, setRest, setSheetCard, setSheetKey, unapproveSheet, versionOriginalPath, versionPath, normalizePicture, uploadLabel } from "@/lib/companionLook";
import { LOOK_EDIT_PROMPT_LINE, LOOK_JOB_BUSY_LINE, LOOK_PROMPT_REQUIRED_LINE, activeLookJob, canGenerateLook, cancelLookJob, pollLookJob, startLookEdit, startLookGeneration, startLookSheet } from "@/lib/companionLookJobs";
import { fileTypeFromBuffer } from "file-type";
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, rmSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { editToolsStatus } from "@/lib/imageEdit";
import { getStackClient } from "@/lib/stackEngine";
import { StackError } from "@/lib/stack/errors";
import media from "@maipai/spec/vocab/companion-media.json";
import { readStates, addTake, deleteTake, setMotion, takePath, bestTake, finishTake, companionStateJob, companionHasFinishingJob, deleteStates, clearApprovedStates, saveStates, swapInAnimation } from "@/lib/companionStates";
import { householdCompanionFolder, setHouseholdCompanionAnimation } from "@/lib/householdCompanions";
import { activeTakeRun, cancelTakeRun, companionHasTakeRun, publicTakeRun, startStateTakes, takeRunFor, TAKE_NO_ORIGINAL_LINE } from "@/lib/companionTakes";
import { clipPromptPack, picturePromptPack } from "@/lib/companionPromptPack";
import { portraitPath, readRetainedPortrait, retainCompanionPortrait } from "@/lib/companionPortrait";
import { checkFinishedAssets, type FinishedAsset } from "@/lib/pictures/finishedCheck";
import { checkCompanionArt, collectLiveAssets } from "@/lib/companionArtCheck";
import { extractKeyframes } from "@/lib/pictures/keyframes";

export const companionsRoutes = apiRouter();

const Type = z.enum(["child", "teen", "adult"]);
const Card = z.object({
  id: z.string(), name: z.string(), type: Type, type_label: z.string(), tagline: z.string(), who_can_use: z.string(),
  dials: z.array(z.object({ label: z.string(), value: z.string() })), voice: z.string(), is_default: z.boolean(), is_household: z.boolean(), portrait: z.string().nullable(), status: z.string(), chats: z.number(), can_edit: z.boolean(), can_copy: z.boolean(), task_count: z.number(), chat_count: z.number(), working_count: z.number(), waiting_count: z.number(), latest_activity: z.string().nullable(),
});
const Detail = Card.extend({
  about: z.string(), pronouns: z.string().nullable(), interests: z.array(z.string()), examples: z.array(z.string()),
  voice_value: z.string().describe("The voice id the page previews through /api/voice/voices/{id}/preview."), voice_is_own: z.boolean(), voice_setting: z.string().nullable(),
  used_by: z.object({ people: z.array(z.object({ id: z.string(), name: z.string() })), robots: z.array(z.object({ id: z.string(), name: z.string() })) }).nullable(),
});

function companionCounts(personId: string, companionId: string) {
  const homeJobs = db.select().from(jobs).where(and(eq(jobs.forPerson, personId), eq(jobs.companionId, companionId))).all();
  const projectRows = db.select().from(projects).where(and(eq(projects.person, personId), sql`json_extract(${projects.provenance}, '$.companion_id') = ${companionId}`)).all();
  const mediaJobs = [
    ...db.select().from(pictureJobs).where(and(eq(pictureJobs.personId, personId), eq(pictureJobs.companionId, companionId))).all(),
    ...db.select().from(videoJobs).where(and(eq(videoJobs.personId, personId), eq(videoJobs.companionId, companionId))).all(),
    ...db.select().from(musicJobs).where(and(eq(musicJobs.personId, personId), eq(musicJobs.companionId, companionId))).all(),
  ];
  const chats = db.select().from(conversations).where(and(eq(conversations.personId, personId), eq(conversations.companionId, companionId))).all();
  const tasks = [...homeJobs.map((row) => ({ title: row.title, state: row.state, at: row.updatedAt })), ...projectRows.map((row) => ({ title: row.title, state: row.state, at: row.updatedAt })), ...mediaJobs.map((row) => ({ title: "Made media", state: row.state, at: row.updatedAt }))];
  const active = homeJobs.filter((row) => (row.state === "running" || row.state === "queued") && !row.waitingReason).length + projectRows.filter((row) => row.state === "running").length + mediaJobs.filter((row) => row.state === "running" || row.state === "queued").length;
  const waiting = homeJobs.filter((row) => needsYou(row.state, row.waitingReason)).length + projectRows.filter((row) => row.state === "waiting").length + mediaJobs.filter((row) => needsYou(row.state, null)).length;
  const latest = [...tasks.map((row) => ({ title: row.title, at: row.at })), ...chats.map((row) => ({ title: row.title || "Chat", at: row.updatedAt }))].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  return { task_count: tasks.length, chat_count: chats.length, working_count: active, waiting_count: waiting, latest_activity: latest?.title ?? null };
}

function needsYou(state: string, waitingReason: string | null): boolean {
  return state === "waiting" || Boolean(waitingReason) || state === "needs_you";
}

const listRoute = createRoute({
  method: "get", path: "/", tags: ["Companions"], summary: "The companions I may use, and for an admin which companion each robot has",
  middleware: [requireAuth] as const,
  responses: {
    200: { content: { "application/json": { schema: z.object({
      allowed: z.boolean().describe("False when an owner or admin turned companions off for this person."), can_create: z.boolean(), can_discover: z.boolean(), default_id: z.string(),
      companions: z.array(Card),
      discover: z.array(Card),
      robots: z.array(z.object({ id: z.string(), name: z.string(), controls: Type, companion_id: z.string(), companion_name: z.string().nullable() })).nullable(),
    }) } }, description: "My companions. The robots list is for owners and admins only." },
    ...errorResponses({ 401: "Not signed in" }),
  },
});
companionsRoutes.openapi(listRoute, (c) => {
  const person = c.get("person");
  const admin = isOwnerOrAdmin(person);
  const decorate = (card: ReturnType<typeof listCompanionCards>[number]) => ({ ...card, ...companionCounts(person.id, card.id), can_edit: card.is_household && mayEdit(person, card.id), can_copy: canCreateCompanion(person, admin) });
  return c.json({ allowed: companionAreaOn(person), can_create: canCreateCompanion(person, admin), can_discover: speakerAgeBand(person, new Date()) !== "child", default_id: currentCompanionId(person), companions: listCompanionCards(person, admin).map(decorate), discover: discoverCompanionCards(person).map(decorate), robots: admin ? robotAssignments() : null }, 200);
});

const setMembershipRoute = (action: "add" | "remove") => {
  const route = createRoute({ method: "post", path: `/{id}/${action}`, tags: ["Companions"], summary: `${action === "add" ? "Add companion to" : "Remove companion from"} my Yours set`,
    middleware: [requireAuth] as const, request: { params: idParamSchema("id", "lively-teen") },
    responses: { 200: { content: { "application/json": { schema: z.object({ companions: z.array(z.string()) }) } }, description: "Updated the signed-in person's companion set." }, 400: { content: { "application/json": { schema: z.object({ error: z.string() }) } }, description: "The requested set change is not allowed." }, ...errorResponses({ 401: "Not signed in", 403: "This action is unavailable for this person", 404: "No such companion" }) },
  });
  companionsRoutes.openapi(route, (c) => {
    const person = c.get("person"), id = c.req.valid("param").id;
    if (speakerAgeBand(person, new Date()) === "child") return c.json({ error: "A parent or admin manages your companions. Ask them to update your set." }, 403);
    const persona = PERSONAS.find((candidate) => candidate.id === id);
    if (!persona || !mayUseCompanion(person, persona)) return c.json({ error: "That companion is not available to you. Choose another from Discover." }, 403);
    const current = heldCompanionIds(person);
    if (action === "remove" && currentCompanionId(person) === id) return c.json({ error: "Make another companion your default first." }, 400);
    const next = action === "add" ? [...new Set([...current, id])] : current.filter((entry) => entry !== id);
    const result = setValue(person, `person:${person.id}`, "companions.enabled", next);
    if (!result.ok) return c.json({ error: result.error }, 403);
    publishSettingsChanged(`person:${person.id}`, "companions.enabled", next);
    return c.json({ companions: next }, 200);
  });
};
setMembershipRoute("add");
setMembershipRoute("remove");

const AvatarState = z.object({ loop: z.boolean(), urls: z.object({ h264: z.string().nullable(), av1: z.string().nullable(), still: z.string() }) });
const avatarRoute = createRoute({
  method: "get", path: "/avatar", tags: ["Companions"], summary: "Read the signed-in person's active video avatar",
  middleware: [requireAuth] as const,
  request: { query: z.object({ companion: z.string().optional().describe("A companion id to read instead of the person's own pick (the chat's pick).") }) },
  responses: {
    200: { content: { "application/json": { schema: z.object({ avatar: z.object({ id: z.string(), name: z.string(), key: z.string(), version: z.string(), portrait: z.string().nullable().optional(), states: z.record(z.string(), AvatarState) }).nullable() }) } }, description: "The usable active companion's approved animation, or null when it has none." },
    304: { description: "The animation has not changed." },
    ...errorResponses({ 401: "Not signed in" }),
  },
});
companionsRoutes.openapi(avatarRoute, (c) => {
  const person = c.get("person"), asked = c.req.valid("query").companion, persona = resolvePersona(asked ?? getPersonSettingValue(person, "persona.active_id"));
  if (!mayUseCompanion(person, persona)) return c.json({ avatar: null }, 200);
  const household = getHouseholdCompanion(persona.id), loaded = household ? null : loadManifestOnly(persona.id), manifest = household ?? (loaded?.ok ? loaded.value : null);
  const animation = manifest?.companion?.animation;
  if (!animation || (manifest.companion?.status && manifest.companion.status !== "ready") || !animation.states.idle) return c.json({ avatar: null }, 200);
  const version = createHash("sha256").update(JSON.stringify(animation)).digest("hex").slice(0, 12);
  const etag = `"${version}"`;
  const headers = { "cache-control": "private, max-age=0, must-revalidate", etag };
  if (matchesEtag(c.req.header("if-none-match"), etag)) return new Response(null, { status: 304, headers });
  const folder = householdCompanionFolder(persona.id) ?? resolvePackageDir(persona.id);
  const states = Object.fromEntries((Object.entries(animation.states) as Array<[string, { h264?: string; av1?: string; still: string; loop: boolean }]>).map(([state, files]) => [state, {
    loop: files.loop,
    urls: {
      h264: files.h264 ? `/api/companions/${encodeURIComponent(persona.id)}/animation/${encodeURIComponent(files.h264)}` : null,
      av1: files.av1 ? `/api/companions/${encodeURIComponent(persona.id)}/animation/${encodeURIComponent(files.av1)}` : null,
      still: `/api/companions/${encodeURIComponent(persona.id)}/animation/${encodeURIComponent(files.still)}`,
    },
  }]));
  const portrait = animation.sheet?.rest ? `/api/companions/${encodeURIComponent(persona.id)}/animation/${encodeURIComponent(animation.sheet.rest)}` : null;
  return c.json({ avatar: { id: persona.id, name: manifest?.companion?.display_name ?? persona.display_name, key: animation.key, version, portrait, states } }, 200, headers);
});

const animationParams = z.object({ id: z.string().min(1).max(80), file: z.string().min(1).max(80) });
const animationFileRoute = createRoute({
  method: "get", path: "/{id}/animation/{file}", tags: ["Companions"], summary: "Read an approved companion animation file",
  middleware: [requireAuth] as const,
  request: { params: animationParams },
  responses: {
    200: { description: "Animation file." }, 206: { description: "Requested byte range." }, 304: { description: "The animation file has not changed." },
    ...errorResponses({ 401: "Not signed in", 404: "That animation file could not be found for this person. Check the companion and file name." }),
  },
});
companionsRoutes.openapi(animationFileRoute, (c) => {
  const { id, file } = c.req.valid("param"), actor = c.get("person"), household = getHouseholdCompanion(id), loaded = household ? null : loadManifestOnly(id), manifest = household ?? (loaded?.ok ? loaded.value : null), animation = manifest?.companion?.animation;
  const persona = PERSONAS.find((candidate) => candidate.id === id);
  const editor = Boolean(manifest?.companion && (isOwnerOrAdmin(actor) || householdCompanionAuthorId(id) === actor.id));
  const ready = !manifest?.companion?.status || manifest.companion.status === "ready";
  if (!animation || (!editor && (!persona || !ready || !mayUseCompanion(actor, persona)))) return c.json({ error: "That animation file could not be found for this person. Check the companion and file name." }, 404);
  const validFile = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._-]{0,63}(?:\.mp4|\.png)$/.test(file);
  const listed = [animation.sheet?.rest, ...Object.values(animation.states).flatMap((state) => [state.h264, state.av1, state.still])].filter((name): name is string => typeof name === "string");
  if (!validFile || !listed.includes(file)) return c.json({ error: "That animation file could not be found for this person. Check the companion and file name." }, 404);
  const root = householdCompanionFolder(id) ?? (loaded?.ok ? resolvePackageDir(id) : null);
  if (!root) return c.json({ error: "That animation file could not be found for this person. Check the companion and file name." }, 404);
  const path = join(root, "animation", file);
  if (!existsSync(path)) return c.json({ error: "That animation file could not be found for this person. Check the companion and file name." }, 404);
  const metadata = statSync(path), bytes = readFileSync(path), etag = `"${metadata.size}-${metadata.mtimeMs}"`;
  if (matchesEtag(c.req.header("if-none-match"), etag)) return new Response(null, { status: 304, headers: { etag, "cache-control": "private, max-age=0, must-revalidate" } });
  return rangeResponse(bytes, file.endsWith(".png") ? "image/png" : "video/mp4", c.req.header("range"), { etag, cacheControl: "private, max-age=0, must-revalidate" });
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
  const detail = companionDetail(person, persona, isOwnerOrAdmin(person));
  return c.json({ ...detail, ...companionCounts(person.id, detail.id), can_edit: detail.is_household && mayEdit(person, detail.id), can_copy: speakerAgeBand(person, new Date()) === "adult" || isOwnerOrAdmin(person) }, 200);
});

const activityRow = z.object({ id: z.string(), kind: z.string(), title: z.string(), state: z.string(), created_at: z.string(), updated_at: z.string(), conversation_id: z.string().nullable().optional(), placement: z.enum(["chat", "side"]).optional(), waiting_reason: z.string().nullable().optional(), progress: z.string().max(200).nullable().optional(), result_ref: z.string().nullable().optional(), needs_you: z.boolean().optional() });
const activityRoute = createRoute({ method: "get", path: "/{id}/activity", tags: ["Companions"], summary: "Read my recent work for one companion", middleware: [requireAuth] as const,
  request: { params: idParamSchema("id", "lively-teen") },
  responses: { 200: { content: { "application/json": { schema: z.object({ activity: z.array(activityRow) }) } }, description: "The signed-in person's recent jobs and projects for this companion, newest first, up to 50." }, ...errorResponses({ 401: "Not signed in", 404: "No such companion for this person" }) },
});
companionsRoutes.openapi(activityRoute, (c) => {
  const person = c.get("person"), id = c.req.valid("param").id, persona = PERSONAS.find((candidate) => candidate.id === id);
  if (!persona || !mayUseCompanion(person, persona)) return c.json({ error: "No such companion" }, 404);
  const ownJobs = db.select().from(jobs).where(and(eq(jobs.forPerson, person.id), eq(jobs.companionId, id))).all().map((row) => ({ id: row.id, kind: row.kind, title: row.title, state: row.state, created_at: row.createdAt, updated_at: row.updatedAt, conversation_id: row.conversationId, waiting_reason: row.waitingReason, progress: typeof row.progress === "string" ? row.progress.trim().slice(0, 200) : null, result_ref: row.resultRef, needs_you: needsYou(row.state, row.waitingReason) }));
  const ownProjects = db.select().from(projects).where(and(eq(projects.person, person.id), sql`json_extract(${projects.provenance}, '$.companion_id') = ${id}`)).all().map((row) => ({ id: row.id, kind: row.type, title: row.title, state: row.state, created_at: row.createdAt, updated_at: row.updatedAt, conversation_id: null, waiting_reason: null, progress: null, result_ref: null, needs_you: needsYou(row.state, null) }));
  const ownPictures = db.select().from(pictureJobs).where(and(eq(pictureJobs.personId, person.id), eq(pictureJobs.companionId, id))).all().map((row) => ({ id: row.id, kind: "picture", title: "Made a picture", state: row.state, created_at: row.createdAt, updated_at: row.updatedAt, conversation_id: row.conversationId, waiting_reason: null, progress: row.phase?.trim().slice(0, 200) ?? null, result_ref: row.id, needs_you: needsYou(row.state, null) }));
  const ownVideos = db.select().from(videoJobs).where(and(eq(videoJobs.personId, person.id), eq(videoJobs.companionId, id))).all().map((row) => ({ id: row.id, kind: "video", title: "Made a video", state: row.state, created_at: row.createdAt, updated_at: row.updatedAt, conversation_id: row.conversationId, waiting_reason: null, progress: row.phase?.trim().slice(0, 200) ?? null, result_ref: row.id, needs_you: needsYou(row.state, null) }));
  const ownSongs = db.select().from(musicJobs).where(and(eq(musicJobs.personId, person.id), eq(musicJobs.companionId, id))).all().map((row) => ({ id: row.id, kind: "music", title: "Made a song", state: row.state, created_at: row.createdAt, updated_at: row.updatedAt, conversation_id: row.conversationId, waiting_reason: null, progress: row.stage?.trim().slice(0, 200) ?? null, result_ref: row.id, needs_you: needsYou(row.state, null) }));
  const ownChats = db.select().from(conversations).where(and(eq(conversations.personId, person.id), eq(conversations.companionId, id))).all().filter((row) => row.status !== "deleted").map((row) => ({ id: row.id, kind: "chat", title: row.title || "Conversation", state: "done", created_at: row.createdAt, updated_at: row.updatedAt, conversation_id: row.id, placement: row.placement as "chat" | "side", waiting_reason: null, progress: null, result_ref: null, needs_you: false }));
  const activity = [...ownJobs, ...ownProjects, ...ownPictures, ...ownVideos, ...ownSongs, ...ownChats].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)).slice(0, 50);
  return c.json({ activity }, 200);
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
  name: z.string().optional(), display_name: z.string().optional(), pronouns: z.string().nullable().optional(), tagline: z.string().optional(), backstory: z.string().optional(), interests: z.array(z.string()).optional(),
  formality: z.enum(["casual", "neutral", "formal"]).optional(), complexity: z.enum(["simple", "standard", "advanced"]).optional(), engagement: z.enum(["brief", "balanced", "curious"]).optional(), filler_density: z.enum(["none", "light", "frequent"]).optional(),
  behavior: z.array(z.string()).optional(), examples: z.array(z.string()).optional(), examples_child: z.array(z.string()).optional(), examples_teen: z.array(z.string()).optional(), examples_adult: z.array(z.string()).optional(), voice_id: z.string().optional(), look_prompt: z.string().optional(),
});
function normalizedFields(value: z.infer<typeof fields>) {
  const { name, ...rest } = value;
  const normalized: Record<string, unknown> = {};
  for (const [field, raw] of Object.entries(rest)) {
    if (typeof raw === "string") { const trimmed = raw.trim(); if (trimmed) normalized[field] = trimmed; }
    else if (Array.isArray(raw)) { const items = raw.map((item) => typeof item === "string" ? item.trim() : item).filter((item) => item !== ""); if (items.length) normalized[field] = items; }
    else if (raw !== null && raw !== undefined) normalized[field] = raw;
  }
  const rawName = name ?? value.display_name;
  if (typeof rawName === "string") normalized.display_name = rawName.trim();
  return normalized;
}
const idPath = idParamSchema("id", "hc-companion");
const fieldsJson = { content: { "application/json": { schema: fields } } };
const companionValidationError = { content: { "application/json": { schema: z.object({ error: z.string(), fields: z.record(z.string(), z.string()).optional() }) } }, description: "Companion fields are invalid." };
function mayEdit(actor: import("@/types").PersonRow, id: string): boolean { return isOwnerOrAdmin(actor) || householdCompanionAuthorId(id) === actor.id; }
const bundledLookLine = "A bundled companion can't be changed. Make a copy to edit it.";
function lookAccess(actor: import("@/types").PersonRow, id: string): { status: 403 | 404; error: string } | null {
  if (!getHouseholdCompanion(id)) {
    if (PERSONAS.some((persona) => persona.id === id)) return { status: 403, error: bundledLookLine };
    return { status: 404, error: "That household companion could not be found." };
  }
  if (!mayEdit(actor, id)) return { status: 403, error: "Only the author or an admin can change this companion's pictures." };
  return null;
}
const lookIdParam = z.object({ id: z.string().min(1).max(80).openapi({ param: { name: "id", in: "path" } }) });
const lookVersionParam = z.object({ id: z.string().min(1).max(80), versionId: z.string().min(1).max(80).openapi({ param: { name: "versionId", in: "path" } }) });
const SheetResponse = z.object({ views: z.object({ left: z.object({ version_id: z.string(), url: z.string() }).nullable(), right: z.object({ version_id: z.string(), url: z.string() }).nullable(), mouth: z.object({ version_id: z.string(), url: z.string() }).nullable() }), card: z.object({ text: z.string(), colours: z.array(z.string()), species: z.string() }).nullable(), key: z.enum([media.key.default, media.key.alternate]), state: z.enum(["empty", "making", "needs_review", "approved"]), approved_by: z.string().nullable(), approved_at: z.string().nullable() });
const LookResponse = z.object({ versions: z.array(z.object({ id: z.string(), label: z.string(), source: z.enum(["upload", "generated", "edit"]), width: z.number().int(), height: z.number().int(), created_at: z.string(), from: z.string().nullable(), url: z.string() })), rest: z.string().nullable(), key: z.enum([media.key.default, media.key.alternate]), sheet: SheetResponse.nullable(), ready_for_video: z.boolean(), start_ready: z.boolean(), start_reason: z.string().optional(), can_generate: z.boolean(), generate_reason: z.string().optional() });
const PromptPackResponse = z.object({ title: z.string(), prompt: z.string(), negative_prompt: z.string(), text: z.string() });
const lookPromptRoute = createRoute({ method: "get", path: "/{id}/look/prompt", tags: ["Companions"], summary: "Get a copyable prompt for a companion picture", middleware: [requireAuth] as const,
  request: { params: lookIdParam }, responses: { 200: { content: { "application/json": { schema: PromptPackResponse } }, description: "A picture prompt and its full generation specification." }, ...errorResponses({ 401: "Not signed in", 403: "Only the author or an admin can read this companion's pictures", 404: "No household companion" }) } });
companionsRoutes.openapi(lookPromptRoute, (c) => {
  const id = c.req.valid("param").id, denied = lookAccess(c.get("person"), id); if (denied) return c.json({ error: denied.error }, denied.status);
  const manifest = getHouseholdCompanion(id);
  if (!manifest?.companion) return c.json({ error: "That household companion could not be found." }, 404);
  return c.json(picturePromptPack(manifest.companion, readLook(id)), 200);
});

const statePromptParams = z.object({ id: z.string().min(1).max(80), state: z.string().min(1).max(80) });
const statePromptRoute = createRoute({ method: "get", path: "/{id}/states/{state}/prompt", tags: ["Companions"], summary: "Get a copyable prompt for a companion clip", middleware: [requireAuth] as const,
  request: { params: statePromptParams }, responses: { 200: { content: { "application/json": { schema: PromptPackResponse } }, description: "A clip prompt and its full generation specification." }, ...errorResponses({ 401: "Not signed in", 403: "Only the author or an admin can read this companion's clips", 404: "No household companion or state" }) } });
companionsRoutes.openapi(statePromptRoute, (c) => {
  const { id, state } = c.req.valid("param"), denied = lookAccess(c.get("person"), id); if (denied) return c.json({ error: denied.error }, denied.status);
  if (!media.states.some((row) => row.id === state)) return c.json({ error: "That companion state could not be found." }, 404);
  const manifest = getHouseholdCompanion(id);
  if (!manifest?.companion) return c.json({ error: "That household companion could not be found." }, 404);
  const look = readLook(id), stored = readStates(id).states[state];
  return c.json(clipPromptPack(manifest.companion, look, state, stored?.motion ?? undefined), 200);
});
const lookRoute = createRoute({ method: "get", path: "/{id}/look", tags: ["Companions"], summary: "Read a household companion's look pictures", middleware: [requireAuth] as const,
  request: { params: lookIdParam }, responses: { 200: { content: { "application/json": { schema: LookResponse } }, description: "Picture versions and the approved starting picture." }, ...errorResponses({ 401: "Not signed in", 403: "Only the author or an admin can read this companion's pictures", 404: "No household companion" }) } });
companionsRoutes.openapi(lookRoute, async (c) => {
  const id = c.req.valid("param").id, denied = lookAccess(c.get("person"), id); if (denied) return c.json({ error: denied.error }, denied.status);
  const look = readLook(id);
  const generation = await canGenerateLook(c.get("person"), id);
  const viewUrl = (versionId: string | null) => versionId ? { version_id: versionId, url: `/api/companions/${encodeURIComponent(id)}/look/${versionId}/image` } : null;
  const sheet = look.sheet ? { ...look.sheet, views: { left: viewUrl(look.sheet.views.left), right: viewUrl(look.sheet.views.right), mouth: viewUrl(look.sheet.views.mouth) } } : null;
  const startReady = Boolean(look.rest && versionOriginalPath(id, look.rest));
  return c.json({ versions: look.versions.map(({ id: versionId, label, source, width, height, created_at, from }) => ({ id: versionId, label, source, width, height, created_at, from: from ?? null, url: `/api/companions/${encodeURIComponent(id)}/look/${versionId}/image` })), rest: look.rest, key: look.key, sheet, ready_for_video: look.sheet?.state === "approved", start_ready: startReady, ...(!startReady ? { start_reason: TAKE_NO_ORIGINAL_LINE } : {}), ...generation }, 200);
});

const lookGenerateBody = z.object({ prompt: z.string().max(600).optional(), count: z.number().int().min(1).max(4).default(4) });
const lookJobResponse = z.object({ job: z.string() });
const sheetStartRoute = createRoute({ method: "post", path: "/{id}/look/sheet", tags: ["Companions"], summary: "Make character sheet references", middleware: [requireAuth] as const,
  request: { params: lookIdParam }, responses: { 202: { content: { "application/json": { schema: z.object({ job: z.string(), card_source: z.enum(["model", "look_prompt"]) }) } }, description: "Character sheet job started." }, ...errorResponses({ 400: "Choose a rest picture and write a look prompt first", 403: "Only an allowed editor can make this sheet", 404: "No household companion", 409: "A picture is already being made for this companion", 422: "The picture request cannot be used", 503: "Picture creation is not set up" }) } });
companionsRoutes.openapi(sheetStartRoute, async (c) => {
  const { id } = c.req.valid("param"), actor = c.get("person"), denied = lookAccess(actor, id); if (denied) return c.json({ error: denied.error }, denied.status); ensurePublishedRecord(id);
  try { const wasApproved = readLook(id).sheet?.state === "approved"; const result = await startLookSheet({ actor, companionId: id, lookPrompt: getHouseholdCompanion(id)?.companion?.look_prompt ?? "" }); if (wasApproved) clearStateApprovals(id); return c.json({ ...result, ...(wasApproved ? { note: "The character sheet was reset, so every approved clip was unapproved." } : {}) }, 202); }
  catch (error) { const status = (error as { status?: number }).status ?? 503; return c.json({ error: error instanceof Error ? error.message : "The character sheet could not be started. Try again." }, status as 400 | 403 | 409 | 422 | 503); }
});
const sheetCardRoute = createRoute({ method: "put", path: "/{id}/look/sheet/card", tags: ["Companions"], summary: "Edit character description card", middleware: [requireAuth] as const,
  request: {
    params: lookIdParam,
    body: { content: { "application/json": { schema: z.object({ text: z.string().min(20, "Describe the character in a sentence or two so every video starts from the same words.").max(600, "Keep the description to 600 characters or fewer."), species: z.string().max(60, "Keep the species name to 60 characters or fewer.").optional() }) } } },
  },
  responses: { 200: { content: { "application/json": { schema: z.object({ card: z.any() }) } }, description: "Card saved." }, ...errorResponses({ 400: "Write a description of at least 20 characters", 403: "Only the author or an admin can edit this companion's card", 404: "No household companion or sheet" }) } });
companionsRoutes.openapi(sheetCardRoute, (c) => { const { id } = c.req.valid("param"), denied = lookAccess(c.get("person"), id); if (denied) return c.json({ error: denied.error }, denied.status); ensurePublishedRecord(id); const body = c.req.valid("json"); try { const priorSheet = readLook(id).sheet, prior = priorSheet?.card; setSheetCard(id, body); const reset = priorSheet?.state === "approved" || JSON.stringify(prior) !== JSON.stringify(readLook(id).sheet?.card); if (reset) clearStateApprovals(id); return c.json({ card: readLook(id).sheet?.card, ...(reset ? { note: "The character sheet changed, so every approved clip was unapproved." } : {}) }, 200); } catch (error) { return c.json({ error: error instanceof Error ? error.message : "The card could not be saved. Try again." }, 400); } });
const sheetKeyRoute = createRoute({ method: "put", path: "/{id}/look/sheet/key", tags: ["Companions"], summary: "Set character sheet key colour", middleware: [requireAuth] as const,
  request: {
    params: lookIdParam,
    body: { content: { "application/json": { schema: z.object({ key: z.enum([media.key.default, media.key.alternate], { error: "Choose #00FF00 or #FF00FF as the key colour." }) }) } } },
  },
  responses: { 200: { content: { "application/json": { schema: z.object({ key: z.string() }) } }, description: "Key colour saved." }, ...errorResponses({ 400: "Choose one of the two key colours", 403: "Only the author or an admin can edit this companion's key", 404: "No household companion or sheet" }) } });
companionsRoutes.openapi(sheetKeyRoute, (c) => { const { id } = c.req.valid("param"), denied = lookAccess(c.get("person"), id); if (denied) return c.json({ error: denied.error }, denied.status); ensurePublishedRecord(id); try { const priorSheet = readLook(id).sheet, old = priorSheet?.key, key = c.req.valid("json").key as "#00FF00" | "#FF00FF"; setSheetKey(id, key); const reset = old !== key || priorSheet?.state === "approved"; if (reset) clearStateApprovals(id); return c.json({ key, ...(reset ? { note: "The key colour changed, so every approved clip was unapproved." } : {}) }, 200); } catch (error) { return c.json({ error: error instanceof Error ? error.message : "The key colour could not be saved. Try again." }, 400); } });
const sheetApprovalRoute = createRoute({ method: "post", path: "/{id}/look/sheet/approve", tags: ["Companions"], summary: "Approve character sheet", middleware: [requireAuth] as const, request: { params: lookIdParam }, responses: { 200: { content: { "application/json": { schema: z.object({ sheet: z.any() }) } }, description: "Sheet approved." }, ...errorResponses({ 400: "A rest picture and description card are required", 403: "Only the author or an admin can approve this sheet", 404: "No household companion" }) } });
companionsRoutes.openapi(sheetApprovalRoute, (c) => { const { id } = c.req.valid("param"), actor = c.get("person"), denied = lookAccess(actor, id); if (denied) return c.json({ error: denied.error }, denied.status); try { return c.json({ sheet: approveSheet(id, actor.displayName) }, 200); } catch (error) { return c.json({ error: error instanceof Error ? error.message : "The sheet could not be approved. Add the missing details and try again." }, 400); } });
const sheetUnapproveRoute = createRoute({ method: "post", path: "/{id}/look/sheet/unapprove", tags: ["Companions"], summary: "Return character sheet to review", middleware: [requireAuth] as const, request: { params: lookIdParam }, responses: { 200: { content: { "application/json": { schema: z.object({ sheet: z.any() }) } }, description: "Sheet returned to review." }, ...errorResponses({ 400: "No character sheet to review", 403: "Only the author or an admin can edit this sheet", 404: "No household companion" }) } });
companionsRoutes.openapi(sheetUnapproveRoute, (c) => { const { id } = c.req.valid("param"), denied = lookAccess(c.get("person"), id); if (denied) return c.json({ error: denied.error }, denied.status); ensurePublishedRecord(id); try { const sheet = unapproveSheet(id); clearStateApprovals(id); return c.json({ sheet, note: "The character sheet was unapproved, so every approved clip was unapproved." }, 200); } catch (error) { return c.json({ error: error instanceof Error ? error.message : "The sheet could not be returned to review. Try again." }, 400); } });
const lookGenerateRoute = createRoute({ method: "post", path: "/{id}/look/generate", tags: ["Companions"], summary: "Generate companion look picture candidates", middleware: [requireAuth] as const,
  request: { params: lookIdParam, body: { content: { "application/json": { schema: lookGenerateBody } } } },
  responses: { 202: { content: { "application/json": { schema: lookJobResponse } }, description: "Picture generation started." }, ...errorResponses({ 400: "Write a look prompt first", 401: "Not signed in", 403: "Only an allowed editor can generate this companion's pictures", 404: "No household companion", 409: "A picture is already being made for this companion", 422: "The prompt cannot be used for a picture", 503: "Picture creation is not set up" }) } });
companionsRoutes.openapi(lookGenerateRoute, async (c) => {
  const { id } = c.req.valid("param"), denied = lookAccess(c.get("person"), id); if (denied) return c.json({ error: denied.error }, denied.status);
  const body = c.req.valid("json"), lookPrompt = getHouseholdCompanion(id)?.companion?.look_prompt?.trim() ?? "";
  const prompt = body.prompt?.trim() || lookPrompt;
  if (!prompt) return c.json({ error: LOOK_PROMPT_REQUIRED_LINE }, 400);
  try { const job = await startLookGeneration({ actor: c.get("person"), companionId: id, lookPrompt, prompt: body.prompt, count: body.count }); return c.json({ job }, 202); }
  catch (error) { const status = (error as { status?: number }).status ?? 503; return c.json({ error: error instanceof Error ? error.message : "The picture could not be started. Try again." }, status as 400 | 403 | 409 | 422 | 503); }
});

const lookEditBody = z.object({ version_id: z.string().regex(/^v-[0-9]+$/), instruction: z.string().min(1).max(300) });
const lookEditRoute = createRoute({ method: "post", path: "/{id}/look/edit", tags: ["Companions"], summary: "Edit a companion look picture with words", middleware: [requireAuth] as const,
  request: { params: lookIdParam, body: { content: { "application/json": { schema: lookEditBody } } } },
  responses: { 202: { content: { "application/json": { schema: lookJobResponse } }, description: "Picture edit started." }, ...errorResponses({ 400: "Describe a change in 1 to 300 characters", 401: "Not signed in", 403: "Only an allowed editor can change this companion's pictures", 404: "No household companion or picture", 409: "A picture is already being made for this companion", 422: "The instruction cannot be used to edit this picture", 503: "Picture creation is not set up" }) } });
companionsRoutes.openapi(lookEditRoute, async (c) => {
  const { id } = c.req.valid("param"), denied = lookAccess(c.get("person"), id); if (denied) return c.json({ error: denied.error }, denied.status);
  const body = c.req.valid("json");
  try { const job = await startLookEdit({ actor: c.get("person"), companionId: id, versionId: body.version_id, instruction: body.instruction }); return c.json({ job }, 202); }
  catch (error) { const status = (error as { status?: number }).status ?? 503; return c.json({ error: error instanceof Error ? error.message : LOOK_EDIT_PROMPT_LINE }, status as 400 | 403 | 404 | 409 | 422 | 503); }
});

const lookJobParam = z.object({ id: z.string().min(1).max(80), job: z.string().min(1).max(160).openapi({ param: { name: "job", in: "path" } }) });
const lookJobState = z.object({ state: z.enum(["queued", "running", "done", "failed", "cancelled"]), percent: z.number().int(), label: z.string(), versions: z.array(z.object({ id: z.string(), url: z.string(), label: z.string() })), error: z.string().nullable() });
const pollLookRoute = createRoute({ method: "get", path: "/{id}/look/jobs/{job}", tags: ["Companions"], summary: "Read companion look picture job progress", middleware: [requireAuth] as const,
  request: { params: lookJobParam }, responses: { 200: { content: { "application/json": { schema: lookJobState } }, description: "Job state and any saved look versions." }, ...errorResponses({ 401: "Not signed in", 403: "Only the author or an admin can read this companion's pictures", 404: "No such companion or job" }) } });
companionsRoutes.openapi(pollLookRoute, async (c) => {
  const { id, job } = c.req.valid("param"), denied = lookAccess(c.get("person"), id); if (denied) return c.json({ error: denied.error }, denied.status);
  const result = await pollLookJob(job, c.get("person"), id);
  return result ? c.json(result, 200) : c.json({ error: "That picture job could not be found. Start it again." }, 404);
});

const cancelLookRoute = createRoute({ method: "delete", path: "/{id}/look/jobs/{job}", tags: ["Companions"], summary: "Stop companion look picture generation", middleware: [requireAuth] as const,
  request: { params: lookJobParam }, responses: { 204: { description: "Picture job stopped." }, ...errorResponses({ 401: "Not signed in", 403: "Only the author or an admin can stop this companion's pictures", 404: "No such companion or job" }) } });
companionsRoutes.openapi(cancelLookRoute, async (c) => {
  const { id, job } = c.req.valid("param"), denied = lookAccess(c.get("person"), id); if (denied) return c.json({ error: denied.error }, denied.status);
  return await cancelLookJob(job, c.get("person"), id) ? c.body(null, 204) : c.json({ error: "That picture job could not be found. Start it again." }, 404);
});

const lookImageRoute = createRoute({ method: "get", path: "/{id}/look/{versionId}/image", tags: ["Companions"], summary: "Read a companion look PNG", middleware: [requireAuth] as const,
  request: { params: lookVersionParam }, responses: { 200: { content: { "image/png": { schema: z.string().openapi({ format: "binary" }) } }, description: "The PNG picture." }, ...errorResponses({ 401: "Not signed in", 403: "Only the author or an admin can read this companion's pictures", 404: "No such picture" }) } });
companionsRoutes.openapi(lookImageRoute, (c) => {
  const { id, versionId } = c.req.valid("param"), denied = lookAccess(c.get("person"), id); if (denied) return c.json({ error: denied.error }, denied.status);
  const path = versionPath(id, versionId);
  if (!path || !readLook(id).versions.some((item) => item.id === versionId)) return c.json({ error: "That picture could not be found." }, 404);
  try { return new Response(readFileSync(path), { headers: { "content-type": "image/png", "cache-control": "private, max-age=0, must-revalidate" } }); }
  catch { return c.json({ error: "That picture could not be found." }, 404); }
});

const portraitParams = z.object({ companionId: z.string().min(1).max(80), versionId: z.string().regex(/^v-[0-9]+$/) });
const portraitRoute = createRoute({ method: "get", path: "/portraits/{companionId}/{versionId}", tags: ["Companions"], summary: "Read a retained companion portrait", middleware: [requireAuth] as const,
  request: { params: portraitParams }, responses: { 200: { content: { "image/webp": { schema: z.string().openapi({ format: "binary" }) } }, description: "The retained WebP portrait." }, ...errorResponses({ 401: "Not signed in", 403: "This companion is not available to this person", 404: "That portrait could not be found. Check the companion and version." }) } });
companionsRoutes.openapi(portraitRoute, async (c) => {
  const { companionId, versionId } = c.req.valid("param"), actor = c.get("person");
  const knownPersona = PERSONAS.find((candidate) => candidate.id === companionId);
  const storedCompanion = getHouseholdCompanion(companionId);
  const persona = knownPersona ?? (storedCompanion?.companion ? resolvePersona(companionId) : null);
  const householdAudience = storedCompanion?.companion?.audience;
  if ((persona && !mayUseCompanion(actor, persona)) || (storedCompanion?.companion && (!companionAreaOn(actor) || !companionFits(speakerAgeBand(actor, new Date()), companionFloor(householdAudience ?? "adult"))))) return c.json({ error: "That portrait could not be found. Check the companion and version." }, 404);
  // A draft is not published to the household: only its author or an admin may see its portrait.
  if (storedCompanion?.companion?.status === "draft" && statesAccess(actor, companionId)) return c.json({ error: "That portrait could not be found. Check the companion and version." }, 404);
  const path = portraitPath(companionId, versionId);
  let bytes = readRetainedPortrait(companionId, versionId);
  if (!bytes && storedCompanion?.companion && readLook(companionId).versions.some((version) => version.id === versionId)) {
    await retainCompanionPortrait(companionId, versionId);
    bytes = readRetainedPortrait(companionId, versionId);
  }
  if (!path || !bytes) return c.json({ error: "That portrait could not be found. Check the companion and version." }, 404);
  return new Response(bytes, { headers: { "content-type": "image/webp", "cache-control": "private, max-age=31536000, immutable" } });
});

async function removePictureBackground(actor: import("@/types").PersonRow, bytes: Uint8Array): Promise<Uint8Array> {
  const status = await editToolsStatus(actor);
  if (!status.tools.remove_background.enabled) throw new Error(status.tools.remove_background.reason ?? status.note ?? "The background remover isn't available yet. Check the editing tools, then try again.");
  const form = new FormData(); form.append("image", new File([new Uint8Array(bytes)], "picture", { type: (await fileTypeFromBuffer(bytes))?.mime ?? "image/png" })); form.append("operation", "remove_background"); form.append("timeout_ms", "2500");
  try {
    const reply = await getStackClient().imageEdit(form);
    if (reply.kind === "done") return new Uint8Array(Buffer.from(reply.item.b64_json, "base64"));
    const until = Date.now() + 60_000;
    while (Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const job = await getStackClient().job(reply.job);
      if (job.state === "failed") throw new Error(job.reason ?? "The background remover could not finish. Try another picture.");
      if (job.state === "cancelled") throw new Error("The background removal was cancelled. Add the picture again to retry.");
      if (job.state === "done") return await getStackClient().imageEditResult(reply.job);
    }
    throw new Error("The background remover took too long. Try a smaller picture.");
  } catch (error) {
    if (error instanceof Error && !(error instanceof StackError)) throw error;
    if (error instanceof StackError && (error.kind === "unreachable" || error.kind === "offline")) throw new Error("The editing tools aren't running. Check that the engine on this computer is running, then try again.");
    if (error instanceof StackError && error.kind === "timeout") throw new Error("The background remover took too long. Try a smaller picture.");
    throw new Error("The background remover could not finish. Check the editing tools and try again.");
  }
}
const uploadRoute = createRoute({ method: "post", path: "/{id}/look/upload", tags: ["Companions"], summary: "Add a look picture by upload", middleware: [requireAuth] as const,
  request: { params: lookIdParam, body: { content: { "multipart/form-data": { schema: z.object({ image: z.any() }) } } } },
  responses: { 201: { content: { "application/json": { schema: z.object({ id: z.string() }) } }, description: "Picture added." }, ...errorResponses({ 400: "Picture or required confirmations are invalid", 401: "Not signed in", 403: "Only the author or an admin can change this companion's pictures", 404: "No household companion", 413: "Picture exceeds the upload size limit", 422: "The picture did not pass the age check", 503: "Background removal is unavailable" }) } });
companionsRoutes.openapi(uploadRoute, async (c) => {
  const { id } = c.req.valid("param"), denied = lookAccess(c.get("person"), id); if (denied) return c.json({ error: denied.error }, denied.status);
  try {
    const form = await c.req.parseBody(), file = form.image;
    if (!(file instanceof File)) return c.json({ error: "Choose a PNG, JPEG or WebP picture to upload." }, 400);
    if (file.size > media.image.max_upload_bytes) return c.json({ error: "That picture is over 20 MB. Choose a smaller PNG, JPEG or WebP picture." }, 413);
    const bytes = new Uint8Array(await file.arrayBuffer()), detected = await fileTypeFromBuffer(bytes);
    if (!detected || !["image/png", "image/jpeg", "image/webp"].includes(detected.mime)) return c.json({ error: "Use a PNG, JPEG or WebP picture." }, 400);
    const png = await normalizePicture(bytes, { removeBackground: (image) => removePictureBackground(c.get("person"), image) });
    const checked = await checkCompanionArt(id, c.get("person"), [{ label: "That picture", bytes }]);
    if (!checked.ok) return c.json({ error: checked.reasons.join(" ") }, 422);
    const version = addVersion(id, png, { source: "upload", label: uploadLabel(file.name), width: media.image.size, height: media.image.size, from: null });
    return c.json({ id: version.id }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "That picture could not be added. Try again.";
    return c.json({ error: message }, /background remover|editing tools/i.test(message) ? 503 : 400);
  }
});

const restRoute = createRoute({ method: "put", path: "/{id}/look/rest", tags: ["Companions"], summary: "Set the approved starting picture", middleware: [requireAuth] as const,
  request: { params: lookIdParam, body: { content: { "application/json": { schema: z.object({ version_id: z.string() }) } } } }, responses: { 200: { content: { "application/json": { schema: z.object({ rest: z.string(), sheet_reset: z.boolean() }) } }, description: "Starting picture saved; sheet_reset says whether the previous sheet was cleared." }, ...errorResponses({ 400: "Invalid version", 401: "Not signed in", 403: "Only the author or an admin can change this companion's pictures", 404: "No such picture" }) } });
companionsRoutes.openapi(restRoute, (c) => {
  const { id } = c.req.valid("param"), denied = lookAccess(c.get("person"), id); if (denied) return c.json({ error: denied.error }, denied.status);
  const versionId = c.req.valid("json").version_id;
  ensurePublishedRecord(id);
  const prior = readLook(id).rest;
  if (!setRest(id, versionId)) return c.json({ error: "That picture could not be found. Choose one of this companion's pictures." }, 404);
  const reset = prior !== versionId; if (reset) { clearStateApprovals(id); }
  return c.json({ rest: versionId, sheet_reset: reset, ...(reset ? { note: "The starting picture changed, so every approved clip was unapproved." } : {}) }, 200);
});

const deleteLookVersionRoute = createRoute({ method: "delete", path: "/{id}/look/{versionId}", tags: ["Companions"], summary: "Delete a look picture", middleware: [requireAuth] as const,
  request: { params: lookVersionParam }, responses: { 204: { description: "Picture deleted." }, ...errorResponses({ 401: "Not signed in", 403: "Only the author or an admin can change this companion's pictures", 404: "No such picture", 409: "Choose another approved starting picture first" }) } });
companionsRoutes.openapi(deleteLookVersionRoute, (c) => {
  const { id, versionId } = c.req.valid("param"), denied = lookAccess(c.get("person"), id); if (denied) return c.json({ error: denied.error }, denied.status);
  try { if (!deleteVersion(id, versionId)) return c.json({ error: "That picture could not be found." }, 404); return c.body(null, 204); }
  catch (error) { if (error instanceof Error && error.message === "That picture is the approved starting picture. Pick another one first.") return c.json({ error: error.message }, 409); return c.json({ error: "That picture could not be deleted. Try again." }, 400); }
});
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
function clearStateApprovals(id: string): void { ensurePublishedRecord(id); clearApprovedStates(id); }
const CompanionStateId = z.enum(media.states.map((row) => row.id) as [string, ...string[]]);
const statesParams = z.object({ id: z.string().min(1).max(80), state: CompanionStateId.optional(), take: z.string().min(1).max(80).optional(), file: z.string().min(1).max(80).optional() });
function rangeResponse(bytes: Uint8Array, type: string, range?: string, options: { etag?: string; cacheControl?: string } = {}): Response {
  const size = bytes.length;
  let start = 0, end = size - 1, status: 200 | 206 = 200;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    if (match[1]) start = Number(match[1]);
    if (match[2]) end = Number(match[2]);
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    end = Math.min(end, size - 1);
    status = 206;
  }
  return new Response(bytes.subarray(start, end + 1), { status, headers: {
    "content-type": type, "accept-ranges": "bytes", "cache-control": options.cacheControl ?? "private, max-age=0, must-revalidate",
    ...(options.etag ? { etag: options.etag } : {}),
    ...(status === 206 ? { "content-range": `bytes ${start}-${end}/${size}` } : {}),
  } });
}
function matchesEtag(header: string | undefined, etag: string): boolean {
  return Boolean(header?.split(/\s*,\s*/).some((value) => value === "*" || value.replace(/^W\//, "") === etag));
}
function statesAccess(actor: import("@/types").PersonRow, id: string) { if (!getHouseholdCompanion(id)) return lookAccess(actor, id); return mayEdit(actor, id) ? null : { status: 403 as const, error: "Only the author or an admin can edit this companion." }; }
function buildAnimationManifest(id: string, states: Record<string, string>, by: string) {
  const look = readLook(id), stateRows = readStates(id), root = householdCompanionFolder(id)!;
  if (look.sheet?.state !== "approved" || !look.rest || !look.sheet.card) throw new Error("Approve the character sheet and choose its starting picture first.");
  const built: Record<string, { h264: string; av1?: string; still: string; loop: boolean }> = {};
  for (const [state, takeId] of Object.entries(states)) {
    const h264 = takePath(id, state, takeId, "clip.h264.mp4")!, still = takePath(id, state, takeId, "still.png")!, av1 = takePath(id, state, takeId, "clip.av1.mp4")!;
    if (!existsSync(h264) || !existsSync(still)) throw new Error("An approved clip file is missing. Replace or approve that clip again.");
    built[state] = { h264: `${state}.h264.mp4`, ...(existsSync(av1) ? { av1: `${state}.av1.mp4` } : {}), still: `${state}.png`, loop: media.states.find((row) => row.id === state)?.kind === "loop" };
  }
  return { kind: "video" as const, spec_version: media.version, key: look.sheet.key, sheet: { rest: "rest.png", card: "card.json" }, states: built, provenance: { approved_by: by, approved_at: new Date().toISOString() } };
}
function publishedView(id: string, states: ReturnType<typeof readStates>) {
  const live = getHouseholdCompanion(id)?.companion?.animation;
  if (!states.published && live) {
    const draft = Object.fromEntries(Object.entries(states.states).filter(([, row]) => row?.approved).map(([state, row]) => [state, row!.approved!]));
    states.published = { at: live.provenance?.approved_at ?? "1970-01-01T00:00:00.000Z", by: live.provenance?.approved_by ?? "", rest: readLook(id).rest ?? "", states: Object.fromEntries(Object.keys(live.states).map((state) => [state, draft[state] ?? null])) };
    // Saved at once: the live animation and the draft agree right now, and the draft is about to change.
    saveStates(id, states);
  }
  return states.published ?? null;
}
/** Before any draft change: an old companion that is live but has no published record gets one now, so later draft edits show as changes. */
function ensurePublishedRecord(id: string): void { publishedView(id, readStates(id)); }
const onlyTakes = (map: Record<string, string | null>): Record<string, string> => Object.fromEntries(Object.entries(map).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
function appearanceStatus(id: string) {
  const states = readStates(id), published = publishedView(id, states), draft = Object.fromEntries(Object.entries(states.states).filter(([, row]) => row?.approved).map(([state, row]) => [state, row!.approved!]));
  const look = readLook(id), manifest = getHouseholdCompanion(id), portraitChanged = Boolean(published && published.rest !== (look.rest ?? ""));
  const changed = JSON.stringify(Object.entries(draft).sort()) !== JSON.stringify(Object.entries(onlyTakes(published?.states ?? {})).sort()) || portraitChanged;
  const reasons: string[] = [];
  if (look.sheet?.state !== "approved") reasons.push("Approve the character sheet first.");
  if (!states.states.idle?.approved) reasons.push("Approve the idle clip first.");
  if (!changed) reasons.push("Make and approve a change before publishing.");
  if (companionHasFinishingJob(id)) reasons.push("Wait for the clip to finish before publishing.");
  const allStates = new Set([...Object.keys(draft), ...Object.keys(published?.states ?? {})]);
  return { has_changes: changed, can_publish: reasons.length === 0, reasons, published: published ? { at: published.at, by: published.by, states: published.states } : null, states: [...allStates].map((state) => ({ state, assigned_take: draft[state] ?? null, approved: Boolean(draft[state]), published_take: published?.states[state] ?? null, changed: (draft[state] ?? null) !== (published?.states[state] ?? null) })), portrait_changed: portraitChanged, manifest };
}
const appearanceRoute = createRoute({ method: "get", path: "/{id}/appearance", tags: ["Companions"], summary: "Read companion appearance draft and published status", middleware: [requireAuth] as const, request: { params: lookIdParam }, responses: { 200: { content: { "application/json": { schema: z.object({ has_changes: z.boolean(), can_publish: z.boolean(), reasons: z.array(z.string()), published: z.object({ at: z.string(), by: z.string(), states: z.record(z.string(), z.string().nullable()) }).nullable(), states: z.array(z.object({ state: z.string(), assigned_take: z.string().nullable(), approved: z.boolean(), published_take: z.string().nullable(), changed: z.boolean() })), portrait_changed: z.boolean() }) } }, description: "Draft and published appearance status." }, ...errorResponses({ 403: "Only the author or an admin can read this companion", 404: "No household companion" }) } });
companionsRoutes.openapi(appearanceRoute, (c) => { const { id } = c.req.valid("param"), denied = statesAccess(c.get("person"), id); if (denied) return c.json({ error: denied.error }, denied.status); const { manifest: _manifest, ...status } = appearanceStatus(id); return c.json(status, 200); });
type AppearanceAsset = FinishedAsset;
async function collectDraftAssets(id: string, stateMap: Record<string, string>): Promise<AppearanceAsset[]> {
  const look = readLook(id), assets: AppearanceAsset[] = [], add = (label: string, path: string) => { try { assets.push({ label, bytes: new Uint8Array(readFileSync(path)) }); } catch { assets.push({ label }); } };
  add("The starting picture", join(householdCompanionFolder(id)!, "look", `${look.rest}.png`));
  for (const view of Object.values(look.sheet?.views ?? {})) if (view) add("A character sheet view", versionPath(id, view)!);
  for (const [state, takeId] of Object.entries(stateMap)) { const still = takePath(id, state, takeId, "still.png")!, clip = takePath(id, state, takeId, "clip.h264.mp4")!; add(`The ${state} still`, still); const take = readStates(id).states[state]?.takes.find((row) => row.id === takeId); let frames: Uint8Array[] | null = null; try { frames = await extractKeyframes(new Uint8Array(readFileSync(clip)), take?.report?.seconds ?? null); } catch {} if (!frames) assets.push({ label: `The ${state} clip frames` }); else frames.forEach((bytes) => assets.push({ label: `The ${state} clip frames`, bytes })); }
  return assets;
}
async function checkAssets(assets: AppearanceAsset[], audience: "adult" | "teen" | "all", cache: NonNullable<ReturnType<typeof readStates>["checks"]>) {
  const result = await checkFinishedAssets({ assets, lane: audience === "all" ? "child" : audience, adultOnly: audience === "adult", kind: "video", cache });
  return result.reasons;
}
const publishRoute = createRoute({ method: "post", path: "/{id}/appearance/publish", tags: ["Companions"], summary: "Publish the approved companion appearance", middleware: [requireAuth] as const, request: { params: lookIdParam }, responses: { 200: { content: { "application/json": { schema: z.object({ published: z.boolean() }) } }, description: "Appearance published." }, ...errorResponses({ 403: "Only the author or an admin can publish this companion", 404: "No household companion", 409: "Appearance is not ready to publish", 422: "Appearance checks need attention" }) } });
companionsRoutes.openapi(publishRoute, async (c) => {
  const { id } = c.req.valid("param"), actor = c.get("person"), denied = statesAccess(actor, id); if (denied) return c.json({ error: denied.error }, denied.status);
  const status = appearanceStatus(id), { manifest: _manifest, ...safeStatus } = status; let all = readStates(id);
  if (!safeStatus.can_publish) return c.json({ error: safeStatus.reasons[0] ?? "The appearance is not ready to publish. Fix the listed issue and try again." }, 409);
  const draft = Object.fromEntries(Object.entries(all.states).filter(([, row]) => row?.approved).map(([state, row]) => [state, row!.approved!]));
  all.checks ??= {}; const audience = getHouseholdCompanion(id)?.companion?.audience ?? "adult", restAtStart = readLook(id).rest, reasons = await checkAssets(await collectDraftAssets(id, draft), audience, all.checks);
  // The checks can take minutes. Re-read what they were run against; keep only the checks we gained and never write back a stale record.
  const fresh = readStates(id); fresh.checks = { ...(fresh.checks ?? {}), ...all.checks };
  if (reasons.length) { saveStates(id, fresh); return c.json({ error: reasons.join(" "), reasons }, 422); }
  const freshDraft = Object.fromEntries(Object.entries(fresh.states).filter(([, row]) => row?.approved).map(([state, row]) => [state, row!.approved!])), currentAudience = getHouseholdCompanion(id)?.companion?.audience ?? "adult";
  if (JSON.stringify(Object.entries(freshDraft).sort()) !== JSON.stringify(Object.entries(draft).sort()) || readLook(id).rest !== restAtStart || currentAudience !== audience) { saveStates(id, fresh); return c.json({ error: "The artwork or the audience changed while it was being checked. Nothing was published. Try Publish again." }, 409); }
  all = fresh;
  const root = householdCompanionFolder(id)!, next = join(root, "animation.next"), look = readLook(id), animation = buildAnimationManifest(id, draft, actor.displayName), previousPublished = all.published;
  try {
    rmSync(next, { recursive: true, force: true }); mkdirSync(next, { recursive: true });
    copyFileSync(versionPath(id, look.rest!)!, join(next, "rest.png")); writeFileSync(join(next, "card.json"), JSON.stringify({ text: look.sheet!.card!.text, species: look.sheet!.card!.species, colours: look.sheet!.card!.colours }, null, 2));
    for (const [state, takeId] of Object.entries(draft)) { copyFileSync(takePath(id, state, takeId, "clip.h264.mp4")!, join(next, `${state}.h264.mp4`)); copyFileSync(takePath(id, state, takeId, "still.png")!, join(next, `${state}.png`)); const av1 = takePath(id, state, takeId, "clip.av1.mp4")!; if (existsSync(av1)) copyFileSync(av1, join(next, `${state}.av1.mp4`)); }
    if (!animation.states.idle) throw new Error("Publish needs an approved idle clip. Approve it and try again.");
    try {
      swapInAnimation(root, () => { const result = setHouseholdCompanionAnimation(id, animation as never); if (!result.ok) throw new Error(result.error); all.published = { at: new Date().toISOString(), by: actor.displayName, rest: look.rest!, states: draft }; saveStates(id, all); });
    } catch (error) { setHouseholdCompanionAnimation(id, status.manifest?.companion?.animation ?? null); const restore = readStates(id); if (previousPublished) restore.published = previousPublished; else delete restore.published; saveStates(id, restore); throw error; }
  } catch (error) { rmSync(next, { recursive: true, force: true }); return c.json({ error: error instanceof Error ? error.message : "The appearance could not be published. Try again." }, 422); }
  return c.json({ published: true }, 200);
});
const statesRoute = createRoute({ method: "get", path: "/{id}/states", tags: ["Companions"], summary: "Read companion video states", middleware: [requireAuth] as const, request: { params: statesParams }, responses: { 200: { content: { "application/json": { schema: z.any() } }, description: "State, take and approval data." }, ...errorResponses({ 401: "Not signed in", 403: "Only the author or an admin can read this companion", 404: "No household companion" }) } });
companionsRoutes.openapi(statesRoute, (c) => { const { id } = c.req.valid("param"), denied = statesAccess(c.get("person"), id); if (denied) return c.json({ error: denied.error }, denied.status); const stored = readStates(id), look = readLook(id), startReady = Boolean(look.rest && versionOriginalPath(id, look.rest)), run = activeTakeRun(id), states = media.states.map((v) => { const row = stored.states[v.id], takes = row?.takes ?? [], best = bestTake(takes), urls = (take: string) => ({ h264: `/api/companions/${encodeURIComponent(id)}/states/${v.id}/${take}/clip.h264.mp4`, av1: `/api/companions/${encodeURIComponent(id)}/states/${v.id}/${take}/clip.av1.mp4`, still: `/api/companions/${encodeURIComponent(id)}/states/${v.id}/${take}/still.png` }); const approved = row?.approved ? takes.find((t) => t.id === row.approved) : null; return { id: v.id, label: v.id.split("_").map((x) => x[0]!.toUpperCase() + x.slice(1)).join(" "), kind: v.kind, required: v.required, when_it_plays: v.driven_by, default_motion: v.motion, motion: row?.motion ?? v.motion, approved: approved ? { take_id: approved.id, approved_by: row?.approved_by, approved_at: row?.approved_at, urls: urls(approved.id) } : null, takes: takes.map((t) => ({ id: t.id, label: t.label, source: t.source, created_at: t.created_at, ok: t.report?.ok ?? null, reasons: t.report?.reasons ?? [], seconds: t.report?.seconds ?? null, bytes: t.report?.bytes ?? null, colour_distance: t.report?.colour_distance ?? null, area_ratio: t.report?.area_ratio ?? null, ...(t.report?.colour_match ? { colour_match: t.report.colour_match } : {}), ...(t.report?.settle_skipped_frames !== undefined ? { settle_skipped_frames: t.report.settle_skipped_frames } : {}), urls: urls(t.id), is_best: best?.id === t.id })), busy: run?.states.includes(v.id) === true || takes.some((t) => companionStateJob(id, t.id)?.state === "running") }; }); const approved = states.filter((v) => v.approved).length; return c.json({ sheet_ready: look.sheet?.state === "approved", start_ready: startReady, ...(!startReady ? { start_reason: TAKE_NO_ORIGINAL_LINE } : {}), key: look.sheet?.key ?? look.key, states, run: run ? { job: run.id, label: run.label, percent: run.percent } : null, counts: { approved, total: 12, required_missing: states.filter((v) => v.required && !v.approved).map((v) => v.id) } }, 200); });

const generateOneParams = z.object({ id: z.string().min(1).max(80), state: CompanionStateId });
const generateOneBody = z.object({ count: z.number().int().min(1).max(4).default(4), motion: z.string().min(1).max(200).optional() });
const generateAllBody = z.object({ count: z.number().int().min(1).max(4).default(2), required_only: z.boolean().default(false) });
const runResponse = z.object({ job: z.string() });
const startFailure409 = { description: "A clip run is busy, the character sheet is not approved, or the rest picture has no Stack original.", content: { "application/json": { schema: z.object({ error: z.string(), code: z.literal("no_original").optional() }) } } };
const generateOneRoute = createRoute({ method: "post", path: "/{id}/states/{state}/generate", tags: ["Companions"], summary: "Generate candidate clips for one companion state", middleware: [requireAuth] as const, request: { params: generateOneParams, body: { content: { "application/json": { schema: generateOneBody } } } }, responses: { 202: { content: { "application/json": { schema: runResponse } }, description: "Clip run started." }, ...errorResponses({ 400: "Invalid count or motion", 403: "Only an allowed editor can make clips", 404: "No household companion", 409: "Approve the character sheet, choose a Stack-made rest picture, or wait for the active clip run", 422: "The clip prompt cannot be used", 503: "Video model is not ready" }), 409: startFailure409 } });
companionsRoutes.openapi(generateOneRoute, async (c) => { const p = c.req.valid("param"), actor = c.get("person"), denied = statesAccess(actor, p.id); if (denied) return c.json({ error: denied.error }, denied.status); if (!mayEdit(actor, p.id)) return c.json({ error: "Only the author or an admin can edit this companion." }, 403); try { const job = await startStateTakes({ actor, companionId: p.id, states: [p.state], count: c.req.valid("json").count, motion: c.req.valid("json").motion }); return c.json({ job }, 202); } catch (error) { const status = (error as { status?: number }).status ?? 503; return c.json({ error: error instanceof Error ? error.message : "The clip run could not start. Check the video engine and try again.", ...((error as { code?: string })?.code === "no_original" ? { code: "no_original" as const } : {}) }, status as 403 | 409 | 422 | 503); } });

const generateAllRoute = createRoute({ method: "post", path: "/{id}/states/generate", tags: ["Companions"], summary: "Generate candidate clips for missing companion states", middleware: [requireAuth] as const, request: { params: lookIdParam, body: { content: { "application/json": { schema: generateAllBody } } } }, responses: { 202: { content: { "application/json": { schema: runResponse } }, description: "Clip queue started." }, ...errorResponses({ 403: "Only an allowed editor can make clips", 404: "No household companion", 409: "Choose a Stack-made rest picture, approve the character sheet, or wait for the active clip run", 422: "A clip prompt cannot be used", 503: "Video model is not ready" }), 409: startFailure409 } });
companionsRoutes.openapi(generateAllRoute, async (c) => { const { id } = c.req.valid("param"), actor = c.get("person"), denied = statesAccess(actor, id); if (denied) return c.json({ error: denied.error }, denied.status); if (!mayEdit(actor, id)) return c.json({ error: "Only the author or an admin can edit this companion." }, 403); const body = c.req.valid("json"), stored = readStates(id), selected = media.states.filter((row) => (!body.required_only || row.required) && !stored.states[row.id]?.approved).map((row) => row.id); if (!selected.length) return c.json({ error: "Every selected state already has an approved clip." }, 409); try { const job = await startStateTakes({ actor, companionId: id, states: selected, count: body.count }); return c.json({ job }, 202); } catch (error) { const status = (error as { status?: number }).status ?? 503; return c.json({ error: error instanceof Error ? error.message : "The clip queue could not start. Check the video engine and try again.", ...((error as { code?: string })?.code === "no_original" ? { code: "no_original" as const } : {}) }, status as 403 | 409 | 422 | 503); } });

const runJobParams = z.object({ id: z.string().min(1).max(80), job: z.string().min(1).max(160).openapi({ param: { name: "job", in: "path" } }) });
const runJobResponse = z.object({ state: z.enum(["queued", "running", "done", "failed", "cancelled"]), label: z.string(), percent: z.number().int(), current: z.object({ state: z.string(), take: z.number().int(), index: z.number().int(), of: z.number().int() }).nullable(), takes_made: z.number().int(), error: z.string().nullable() });
const pollRunRoute = createRoute({ method: "get", path: "/{id}/states/jobs/run/{job}", tags: ["Companions"], summary: "Read companion clip generation progress", middleware: [requireAuth] as const, request: { params: runJobParams }, responses: { 200: { content: { "application/json": { schema: runJobResponse } }, description: "Clip run progress." }, ...errorResponses({ 403: "Only the author or an admin can read this companion", 404: "No such clip run" }) } });
companionsRoutes.openapi(pollRunRoute, (c) => { const p = c.req.valid("param"), denied = statesAccess(c.get("person"), p.id); if (denied) return c.json({ error: denied.error }, denied.status); const run = takeRunFor(p.job, c.get("person"), p.id); return run ? c.json(publicTakeRun(run), 200) : c.json({ error: "That clip run could not be found. Start it again." }, 404); });
const cancelRunRoute = createRoute({ method: "delete", path: "/{id}/states/jobs/run/{job}", tags: ["Companions"], summary: "Stop companion clip generation", middleware: [requireAuth] as const, request: { params: runJobParams }, responses: { 204: { description: "Clip run stopped." }, ...errorResponses({ 403: "Only the author or an admin can stop this companion", 404: "No such clip run" }) } });
companionsRoutes.openapi(cancelRunRoute, async (c) => { const p = c.req.valid("param"), denied = statesAccess(c.get("person"), p.id); if (denied) return c.json({ error: denied.error }, denied.status); return await cancelTakeRun(p.job, c.get("person"), p.id) ? c.body(null, 204) : c.json({ error: "That clip run could not be found. Start it again." }, 404); });
const stateFileRoute = createRoute({ method: "get", path: "/{id}/states/{state}/{take}/{file}", tags: ["Companions"], summary: "Read a companion clip file", middleware: [requireAuth] as const, request: { params: statesParams.extend({ state: CompanionStateId, take: z.string(), file: z.string() }) }, responses: { 200: { description: "Clip file." }, 206: { description: "Requested byte range." }, ...errorResponses({ 401: "Not signed in", 403: "Only the author or an admin can read this companion", 404: "No such clip file" }) } });
companionsRoutes.openapi(stateFileRoute, (c) => { const p = c.req.valid("param"), denied = statesAccess(c.get("person"), p.id); if (denied) return c.json({ error: denied.error }, denied.status); const path = takePath(p.id, p.state, p.take, p.file); if (!path || !existsSync(path)) return c.json({ error: "That clip file could not be found." }, 404); const type = p.file.endsWith(".png") ? "image/png" : p.file.endsWith(".json") ? "application/json" : p.file === "source.mov" ? "video/quicktime" : p.file === "source.webm" ? "video/webm" : "video/mp4"; return rangeResponse(readFileSync(path), type, c.req.header("range")); });
const motionRoute = createRoute({ method: "put", path: "/{id}/states/{state}/motion", tags: ["Companions"], summary: "Set a state motion sentence", middleware: [requireAuth] as const, request: { params: statesParams, body: { content: { "application/json": { schema: z.object({ motion: z.string().min(1).max(200).nullable() }) } } } }, responses: { 200: { content: { "application/json": { schema: z.object({ ok: z.boolean() }) } }, description: "Motion saved." }, ...errorResponses({ 400: "Invalid state or motion", 403: "Only the author or an admin can edit this companion", 404: "No household companion" }) } });
companionsRoutes.openapi(motionRoute, (c) => { const p = c.req.valid("param"), denied = statesAccess(c.get("person"), p.id); if (denied) return c.json({ error: denied.error }, denied.status); try { setMotion(p.id, p.state!, c.req.valid("json").motion); return c.json({ ok: true }, 200); } catch (e) { return c.json({ error: e instanceof Error ? e.message : "The motion could not be saved." }, 400); } });
const uploadStateRoute = createRoute({ method: "post", path: "/{id}/states/{state}/upload", tags: ["Companions"], summary: "Upload a clip for a companion state", middleware: [requireAuth] as const, request: { params: statesParams, body: { content: { "multipart/form-data": { schema: z.any() } } } }, responses: { 202: { content: { "application/json": { schema: z.object({ take_id: z.string() }) } }, description: "Clip finishing started." }, ...errorResponses({ 400: "Invalid video or confirmation", 403: "Only the author or an admin can edit this companion", 404: "No household companion", 409: "A clip is already being made or finished", 413: "Video is over the upload size limit" }) } });
companionsRoutes.openapi(uploadStateRoute, async (c) => { const p = c.req.valid("param"), denied = statesAccess(c.get("person"), p.id); if (denied) return c.json({ error: denied.error }, denied.status); try { const form = await c.req.parseBody(), file = form.video; if (!(file instanceof File)) return c.json({ error: "Choose an MP4, MOV or WebM video to upload." }, 400); if (file.size > media.upload_video.max_bytes) return c.json({ error: "That video is over 30 MB. Choose a smaller MP4, MOV or WebM video." }, 413); const bytes = new Uint8Array(await file.arrayBuffer()), detected = await fileTypeFromBuffer(bytes); if (!detected || !media.upload_video.types.includes(detected.mime as never)) return c.json({ error: "Use an MP4, MOV or WebM video." }, 400); if (form.has_alpha !== undefined && form.has_alpha !== "true" && form.has_alpha !== "false") return c.json({ error: "Choose true or false for whether the clip has transparency." }, 400); if (companionHasTakeRun(p.id)) return c.json({ error: "A clip is already being made for this companion. Wait for it or stop it." }, 409); if (companionHasFinishingJob(p.id)) return c.json({ error: "A clip is already being finished for this companion. Wait for it." }, 409); const look = readLook(p.id); if (look.sheet?.state !== "approved" || !look.rest || !look.sheet.card) return c.json({ error: "Approve the character sheet first, so every clip starts from the same character." }, 409); const take = addTake(p.id, p.state!, { source: "upload", label: file.name || "Uploaded clip" }); const ext = detected.mime === "video/quicktime" ? "mov" : detected.mime === "video/webm" ? "webm" : "mp4", dest = takePath(p.id, p.state!, take.id, ext === "mp4" ? "source.mp4" : `source.${ext}`)!; writeFileSync(dest, bytes); void finishTake(p.id, p.state!, take.id, { alpha: form.has_alpha === "true", actor: c.get("person") }).catch(() => {}); return c.json({ take_id: take.id }, 202); } catch (e) { const message = e instanceof Error ? e.message : "The video could not be uploaded. Try again."; return c.json({ error: message }, /12 clips/.test(message) ? 409 : 400); } });
const stateJobRoute = createRoute({ method: "get", path: "/{id}/states/jobs/{take}", tags: ["Companions"], summary: "Read companion clip finishing progress", middleware: [requireAuth] as const, request: { params: statesParams.extend({ take: z.string() }) }, responses: { 200: { content: { "application/json": { schema: z.any() } }, description: "Job progress." }, ...errorResponses({ 403: "Only the author or an admin can read this companion", 404: "No such finishing job" }) } });
companionsRoutes.openapi(stateJobRoute, (c) => { const p = c.req.valid("param"), denied = statesAccess(c.get("person"), p.id); if (denied) return c.json({ error: denied.error }, denied.status); const job = companionStateJob(p.id, p.take!); if (!job) return c.json({ error: "That clip job could not be found." }, 404); return c.json({ state: job.state, label: job.label, ...(job.report ? { report: job.report } : {}), ...(job.failure ? { failure: job.failure } : {}) }, 200); });
const approveStateRoute = createRoute({ method: "put", path: "/{id}/states/{state}/approve", tags: ["Companions"], summary: "Approve a companion state clip", middleware: [requireAuth] as const, request: { params: statesParams, body: { content: { "application/json": { schema: z.object({ take_id: z.string(), force: z.boolean().optional() }) } } } }, responses: { 200: { content: { "application/json": { schema: z.object({ approved: z.string() }).passthrough() } }, description: "Clip approved." }, ...errorResponses({ 400: "Clip is not finished", 403: "Only the author or an admin can edit this companion", 404: "No such take", 409: "Clip needs force approval or idle approval first" }) } });
companionsRoutes.openapi(approveStateRoute, (c) => { const p = c.req.valid("param"), denied = statesAccess(c.get("person"), p.id); if (denied) return c.json({ error: denied.error }, denied.status); ensurePublishedRecord(p.id); try { const state = p.state!, body = c.req.valid("json"), all = readStates(p.id), row = all.states[state], take = row?.takes.find((t) => t.id === body.take_id); if (!take?.report) return c.json({ error: "That clip is not finished yet. Wait for finishing to complete." }, 400); if (!take.report.ok && !body.force) return c.json({ error: `This clip missed a quality check: ${(take.report.reasons[0] ?? "quality check failed").replace(/\.+$/, "")}. Approve it anyway?`, code: "needs_force" }, 409); if (state !== "idle" && !all.states.idle?.approved) return c.json({ error: "Approve the idle clip first." }, 409); row!.approved = take.id; row!.approved_by = c.get("person").displayName; row!.approved_at = new Date().toISOString(); saveStates(p.id, all); return c.json({ approved: take.id }, 200); } catch (e) { return c.json({ error: e instanceof Error ? e.message : "The clip could not be approved." }, 400); } });
const unapproveStateRoute = createRoute({ method: "delete", path: "/{id}/states/{state}/approve", tags: ["Companions"], summary: "Remove companion state clip approval", middleware: [requireAuth] as const, request: { params: statesParams }, responses: { 200: { content: { "application/json": { schema: z.object({ ok: z.boolean() }).passthrough() } }, description: "Approval removed." }, ...errorResponses({ 403: "Only the author or an admin can edit this companion", 404: "No household companion" }) } });
companionsRoutes.openapi(unapproveStateRoute, (c) => { const p = c.req.valid("param"), denied = statesAccess(c.get("person"), p.id); if (denied) return c.json({ error: denied.error }, denied.status); ensurePublishedRecord(p.id); const state = p.state!, all = readStates(p.id); if (!all.states[state]?.approved) return c.json({ ok: true }, 200); const note = state === "idle" ? "Without the idle clip the others cannot play, so their approvals were removed too." : undefined; if (state === "idle") for (const value of Object.values(all.states)) { if (!value) continue; value.approved = null; value.approved_by = null; value.approved_at = null; } else { all.states[state]!.approved = null; all.states[state]!.approved_by = null; all.states[state]!.approved_at = null; } saveStates(p.id, all); return c.json({ ok: true, ...(note ? { note } : {}) }, 200); });
const deleteTakeRoute = createRoute({ method: "delete", path: "/{id}/states/{state}/{take}", tags: ["Companions"], summary: "Delete a companion clip take", middleware: [requireAuth] as const, request: { params: statesParams }, responses: { 204: { description: "Clip deleted." }, ...errorResponses({ 403: "Only the author or an admin can edit this companion", 404: "No such take", 409: "Clip is approved" }) } });
companionsRoutes.openapi(deleteTakeRoute, (c) => { const p = c.req.valid("param"), denied = statesAccess(c.get("person"), p.id); if (denied) return c.json({ error: denied.error }, denied.status); try { if (!deleteTake(p.id, p.state!, p.take!)) return c.json({ error: "That clip could not be found." }, 404); return c.body(null, 204); } catch (e) { return c.json({ error: e instanceof Error ? e.message : "The clip could not be deleted." }, 409); } });
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
  request: { body: fieldsJson }, responses: { 201: { content: { "application/json": { schema: z.object({ id: z.string() }) } }, description: "Draft created." }, 400: companionValidationError, ...errorResponses({ 401: "Not signed in", 403: "Only adults can make a companion." }) } });
companionsRoutes.openapi(createCompanionRoute, (c) => {
  const actor = c.get("person"); if (speakerAgeBand(actor, new Date()) !== "adult" && !isOwnerOrAdmin(actor)) return c.json({ error: "Only adults can make a companion." }, 403);
  const result = createHouseholdCompanion(normalizedFields(c.req.valid("json")) as never, { display_name: actor.displayName, person_id: actor.id });
  if (!result.ok) return c.json({ error: result.error, ...(result.fields ? { fields: result.fields } : {}) }, 400);
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
  request: { params: idPath }, responses: { 200: { content: { "application/json": { schema: z.object({ look: z.object({ versions: z.number().int(), rest: z.string().nullable(), sheet_state: z.enum(["empty", "making", "needs_review", "approved"]) }) }).passthrough() } }, description: "Editable companion, including its picture count, approved starting picture and sheet state." }, ...errorResponses({ 401: "Not signed in", 404: "No companion you can edit" }) } });
companionsRoutes.openapi(editRoute, (c) => {
  const actor = c.get("person"), id = c.req.valid("param").id, manifest = getHouseholdCompanion(id);
  if (!manifest?.companion || !mayEdit(actor, id)) return c.json({ error: "No companion you can edit." }, 404);
  const look = readLook(id);
  return c.json({ id, ...manifest.companion, name: manifest.companion.display_name, audience: manifest.companion.audience ?? "adult", status: manifest.companion.status ?? "ready", review: manifest.companion.review ?? null, can_edit: true, can_copy: speakerAgeBand(actor, new Date()) === "adult" || isOwnerOrAdmin(actor), can_set_audience: isOwnerOrAdmin(actor), look: { versions: look.versions.length, rest: look.rest, sheet_state: look.sheet?.state ?? "empty" }, states: { approved: Object.values(readStates(id).states).filter((s) => s?.approved).length, total: 12 } }, 200);
});

const updateRoute = createRoute({ method: "put", path: "/{id}", tags: ["Companions"], summary: "Edit a household companion", middleware: [requireAuth] as const,
  request: { params: idPath, body: fieldsJson }, responses: { 200: { content: { "application/json": { schema: z.object({ id: z.string() }) } }, description: "Saved." }, 400: companionValidationError, ...errorResponses({ 401: "Not signed in", 403: "Not allowed to edit this companion", 404: "No such companion" }) } });
companionsRoutes.openapi(updateRoute, (c) => {
  const actor = c.get("person"), id = c.req.valid("param").id;
  if (PERSONAS.some((p) => p.id === id) && !getHouseholdCompanion(id)) return c.json({ error: "A bundled companion can't be changed. Make a copy to edit it." }, 403);
  if (!getHouseholdCompanion(id)) return c.json({ error: "That household companion could not be found." }, 404);
  if (!mayEdit(actor, id)) return c.json({ error: "Only the author or an admin can edit this companion." }, 403);
  const result = updateHouseholdCompanion(id, normalizedFields(c.req.valid("json")) as never); if (!result.ok) return c.json({ error: result.error, ...(result.fields ? { fields: result.fields } : {}) }, 400);
  if (result.value.companion?.status === "ready") reloadPersonas(); return c.json({ id }, 200);
});

const audienceRoute = createRoute({ method: "put", path: "/{id}/audience", tags: ["Companions"], summary: "Set companion audience", middleware: [requireAuth] as const,
  request: { params: idPath, body: { content: { "application/json": { schema: z.object({ audience: z.enum(["adult", "teen", "all"]), confirmed: z.boolean().optional() }) } } } }, responses: { 200: { content: { "application/json": { schema: z.object({ id: z.string() }) } }, description: "Audience saved." }, ...errorResponses({ 400: "Review confirmation required", 403: "Admin only", 404: "No such household companion", 409: "Companion is in use", 422: "Published artwork does not pass the new audience checks" }) } });
companionsRoutes.openapi(audienceRoute, async (c) => {
  const actor = c.get("person"), id = c.req.valid("param").id, body = c.req.valid("json");
  if (!isOwnerOrAdmin(actor)) return c.json({ error: "Only an admin can change a companion's audience." }, 403);
  if (!getHouseholdCompanion(id)) return c.json({ error: "That household companion could not be found." }, 404);
  if (body.audience === "all" && body.confirmed !== true) return c.json({ error: "Review the all ages checklist and confirm before making this companion available to everyone." }, 400);
  const uses = liveUseCounts(id, body.audience); if (uses.robots) return c.json({ error: inUseSentence("robots", uses.robots) }, 409); if (uses.people) return c.json({ error: inUseSentence("people", uses.people) }, 409);
  const bandRank = { adult: 0, teen: 1, all: 2 } as const, currentAudience = getHouseholdCompanion(id)?.companion?.audience ?? "adult";
  const audienceAssets = bandRank[body.audience] > bandRank[currentAudience] ? await collectLiveAssets(id) : [];
  if (audienceAssets.length > 0) {
    if (getHouseholdCompanion(id)?.companion?.animation) ensurePublishedRecord(id);
    const animationBefore = JSON.stringify(getHouseholdCompanion(id)?.companion?.animation ?? null), cache: NonNullable<ReturnType<typeof readStates>["checks"]> = { ...(readStates(id).checks ?? {}) };
    const reasons = await checkAssets(audienceAssets, body.audience, cache);
    // The checks can take minutes: merge only the gained checks into a fresh read, and refuse if a Publish changed the live art meanwhile.
    const fresh = readStates(id); fresh.checks = { ...(fresh.checks ?? {}), ...cache }; saveStates(id, fresh);
    if (JSON.stringify(getHouseholdCompanion(id)?.companion?.animation ?? null) !== animationBefore) return c.json({ error: "The companion's artwork changed while it was being checked. Nothing was changed. Try again." }, 409);
    if (reasons.length) return c.json({ error: `The ${body.audience === "all" ? "child" : "teen"} band blocked the audience change. Replace the artwork or keep the current audience. ${reasons.join(" ")}`, reasons }, 422);
  }
  const result = setHouseholdCompanionAudience(id, body.audience, { display_name: actor.displayName }); if (!result.ok) return c.json({ error: result.error }, 400);
  reloadPersonas(); return c.json({ id }, 200);
});

const statusRoute = createRoute({ method: "put", path: "/{id}/status", tags: ["Companions"], summary: "Set companion status", middleware: [requireAuth] as const,
  request: { params: idPath, body: { content: { "application/json": { schema: z.object({ status: z.enum(["draft", "ready"]) }) } } } }, responses: { 200: { content: { "application/json": { schema: z.object({ id: z.string() }) } }, description: "Status saved." }, 400: companionValidationError, ...errorResponses({ 403: "Only the author or an admin can change status", 404: "No such household companion" }) } });
companionsRoutes.openapi(statusRoute, (c) => {
  const actor = c.get("person"), id = c.req.valid("param").id, body = c.req.valid("json"), manifest = getHouseholdCompanion(id);
  if (!manifest?.companion) return c.json({ error: "That household companion could not be found." }, 404);
  if (!mayEdit(actor, id)) return c.json({ error: "Only the author or an admin can change this companion's status." }, 403);
  if (body.status === "ready" && (manifest.companion.examples?.length ?? 0) < 3) return c.json({ error: "Example lines: add at least 3.", fields: { examples: "Example lines: add at least 3." } }, 400);
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
  deleteStates(id); if (!deleteHouseholdCompanion(id)) return c.json({ error: "The companion could not be deleted. Check the household data folder and try again." }, 400);
  reloadPersonas(); return c.body(null, 204);
});
