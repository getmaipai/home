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
import { companionDetail, draftPersonaFor, companionAreaOn, canCreateCompanion, currentCompanionId, listCompanionCards, discoverCompanionCards, heldCompanionIds, mayUseCompanion, pickRefusal, robotAssignments } from "@/lib/companionsApp";
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
import { createHouseholdCompanion, copyBundledCompanion, copyHouseholdCompanion, getHouseholdCompanion, updateHouseholdCompanion, saveHouseholdCompanionPersonality, deleteHouseholdCompanion, setHouseholdCompanionAudience, setHouseholdCompanionStatus, householdCompanionAuthorId } from "@/lib/householdCompanions";
import { addVersion, approveSheet, deleteVersion, readLook, setRest, setSheetCard, setSheetKey, unapproveSheet, versionOriginalPath, versionPath, normalizePicture, uploadLabel } from "@/lib/companionLook";
import { LOOK_STYLE_IDS, stylesForBand, capOfStyle, type LookStyleId } from "@/lib/companionLookStyles";
import { LOOK_EDIT_PROMPT_LINE, LOOK_JOB_BUSY_LINE, LOOK_PROMPT_REQUIRED_LINE, activeLookJob, canGenerateLook, cancelLookJob, activeLookInfo, pollLookJob, runningSheetJob, startLookEdit, startLookGeneration, startLookSheet } from "@/lib/companionLookJobs";
import { fileTypeFromBuffer } from "file-type";
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, rmSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { removeBackground, upscale } from "@/lib/imaging/tools";
import media from "@maipai/spec/vocab/companion-media.json";
import { readStates, addTake, deleteTake, setMotion, takePath, bestTake, finishTake, companionStateJob, companionHasFinishingJob, deleteStates, clearApprovedStates, saveStates, swapInAnimation, creatorStateRows, legacyStateRows, keyframePath, keyframeMetaPath, readKeyframeMeta, writeKeyframe, removeKeyframe } from "@/lib/companionStates";
import { householdCompanionFolder, setHouseholdCompanionAnimation, listHouseholdCompanionIds } from "@/lib/householdCompanions";
import { activeTakeRun, cancelTakeRun, companionHasTakeRun, publicTakeRun, startStateTakes, takeRunFor, TAKE_NO_REST_LINE } from "@/lib/companionTakes";
import { clipPromptPack, picturePromptPack } from "@/lib/companionPromptPack";
import { portraitPath, readRetainedPortrait, retainCompanionPortrait } from "@/lib/companionPortrait";
import { checkFinishedAssets, type FinishedAsset } from "@/lib/pictures/finishedCheck";
import { checkCompanionArt, collectLiveAssets } from "@/lib/companionArtCheck";
import { extractKeyframes } from "@/lib/pictures/keyframes";
import { routeAudience } from "@/lib/pictures/audience";
import { pictureDenial, PICTURE_DENIAL_LINE } from "@/lib/pictures/policy";
import sharp from "sharp";
import { preparePicture } from "@/lib/imaging/prepare";
import { planFillCutOff } from "@/lib/imaging/fill";
import { planBodyCanvas } from "@/lib/imaging/outpaint";
import { bodyFillInstruction } from "@/lib/imaging/instructions";
import { restyleInstruction, FACE_AND_BODY } from "@/lib/imaging/instructions";
import type { Frame } from "@/lib/imaging/crop";
import { imagingTargets } from "@/lib/imaging/targets";
import { prepareEditSource } from "@/lib/pictures/editSources";
import { complete } from "@/lib/llm";
import { topicMessages } from "@/lib/topicPrompt";
import { COMPANION_PERSONALITIES, cleanStyleNotes, backstoryTagline } from "@/lib/companionPersonality";
import { evaluateSafety, forOutput, carriesCrisisSignal } from "@/lib/safety";

const pendingKeyframeJobs = new Map<string, { state: string; instruction: string; style: string }>();
let backstoryCompleteForTests: typeof complete | null = null;
export function __setBackstoryCompleteForTests(value: typeof complete | null) { backstoryCompleteForTests = value; }

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

const LookStyleChoice = z.object({ id: z.enum(LOOK_STYLE_IDS), label: z.string(), custom: z.boolean() });
const KeepLookChoice = z.object({ id: z.literal("keep"), label: z.string() });
function lookStyleChoices(band: "child" | "teen" | "adult") {
  return { styles: stylesForBand(band).map(({ id, label }) => ({ id, label, custom: id === "custom" })), keep: { id: "keep" as const, label: "Keep as is" } };
}
const lookStylesRoute = createRoute({ method: "get", path: "/look-styles", tags: ["Companions"], summary: "List companion look styles for the signed-in person's age band", middleware: [requireAuth] as const,
  responses: { 200: { content: { "application/json": { schema: z.object({ styles: z.array(LookStyleChoice), keep: KeepLookChoice }) } }, description: "Look styles available to this person." }, ...errorResponses({ 401: "Not signed in", 403: "Only teens and adults can make a companion." }) } });
companionsRoutes.openapi(lookStylesRoute, (c) => {
  const actor = c.get("person"), band = speakerAgeBand(actor, new Date());
  if (band === "child" && !isOwnerOrAdmin(actor)) return c.json({ error: "Only teens and adults can make a companion." }, 403);
  return c.json(lookStyleChoices(band), 200);
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
  const id = c.req.valid("param").id, found = PERSONAS.find((candidate) => candidate.id === id);
  const persona = found && mayUseCompanion(person, found) ? found : found ? null : draftPersonaFor(person, id, isOwnerOrAdmin(person));
  if (!persona) return c.json({ error: "No such companion" }, 404);
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
  clock_style: z.enum(["formal", "plain", "loose"]).optional(), hedging: z.enum(["low", "medium", "high"]).optional(),
  humor: z.enum(["low", "medium", "high"]).optional(), warmth: z.enum(["low", "medium", "high"]).optional(), initiative: z.enum(["low", "medium", "high"]).optional(),
  behavior: z.array(z.string()).optional(), examples: z.array(z.string()).optional(), examples_child: z.array(z.string()).optional(), examples_teen: z.array(z.string()).optional(), examples_adult: z.array(z.string()).optional(), voice_id: z.string().optional(), look_prompt: z.string().optional(),
});
function normalizedFields(value: z.infer<typeof fields>) {
  const { name, humor, warmth, initiative, ...rest } = value;
  const normalized: Record<string, unknown> = {};
  if (humor || warmth || initiative) normalized.social = { humor: humor ?? "medium", warmth: warmth ?? "medium", initiative: initiative ?? "medium" };
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
const LookResponse = z.object({ versions: z.array(z.object({ id: z.string(), label: z.string(), source: z.enum(["upload", "generated", "edit"]), width: z.number().int(), height: z.number().int(), created_at: z.string(), from: z.string().nullable(), clipped: z.array(z.enum(["left", "right", "top", "bottom"])).optional(), url: z.string() })), rest: z.string().nullable(), key: z.enum([media.key.default, media.key.alternate]), sheet: SheetResponse.nullable(), ready_for_video: z.boolean(), start_ready: z.boolean(), start_reason: z.string().optional(), can_generate: z.boolean(), generate_reason: z.string().optional(), styles: z.array(LookStyleChoice), keep: KeepLookChoice, audience_cap: z.enum(["all", "teen", "adult"]) });
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
  const startReady = Boolean(look.rest);
  const band = speakerAgeBand(c.get("person"), new Date()), restStyle = look.versions.find((version) => version.id === look.rest)?.style;
  const audienceCap = restStyle ? capOfStyle(restStyle) ?? "adult" : "all"; // no style recorded (an older companion): no cap, the checklist and art check still gate widening
  return c.json({ versions: look.versions.map(({ id: versionId, label, source, width, height, created_at, from, clipped }) => ({ id: versionId, label, source, width, height, created_at, from: from ?? null, ...(clipped !== undefined ? { clipped } : {}), url: `/api/companions/${encodeURIComponent(id)}/look/${versionId}/image` })), rest: look.rest, key: look.key, sheet, ready_for_video: look.sheet?.state === "approved", start_ready: startReady, ...(!startReady ? { start_reason: TAKE_NO_REST_LINE } : {}), ...generation, ...lookStyleChoices(band), audience_cap: audienceCap }, 200);
});

const lookGenerateBody = z.object({ prompt: z.string().max(600).optional(), style: z.enum(LOOK_STYLE_IDS).default("cartoon"), custom_style: z.string().min(1).max(120).optional(), count: z.number().int().min(1).max(4).default(4) }).superRefine((value, ctx) => { if (value.style === "custom" && !value.custom_style?.trim()) ctx.addIssue({ code: "custom", message: "Enter a custom style from 1 to 120 characters", path: ["custom_style"] }); });
const lookJobResponse = z.object({ job: z.string() });
const sheetStartRoute = createRoute({ method: "post", path: "/{id}/look/sheet", tags: ["Companions"], summary: "Make character sheet references", middleware: [requireAuth] as const,
  request: { params: lookIdParam }, responses: { 202: { content: { "application/json": { schema: z.object({ job: z.string().nullable(), card_source: z.enum(["model", "look_prompt"]) }) } }, description: "Character sheet written and approved; there is no job (job is null)." }, ...errorResponses({ 400: "Choose a rest picture and write a look prompt first", 403: "Only an allowed editor can make this sheet", 404: "No household companion", 409: "A picture is already being made for this companion", 422: "The picture request cannot be used", 503: "Picture creation is not set up" }) } });
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
  try { const job = await startLookGeneration({ actor: c.get("person"), companionId: id, lookPrompt, prompt: body.prompt, style: body.style, customStyle: body.custom_style, count: body.count }); return c.json({ job: driven(c.get("person"), id, job) }, 202); }
  catch (error) { const status = (error as { status?: number }).status ?? 503; return c.json({ error: error instanceof Error ? error.message : "The picture could not be started. Try again." }, status as 400 | 403 | 409 | 422 | 503); }
});

const lookEditBody = z.object({ version_id: z.string().regex(/^v-[0-9]+$/), instruction: z.string().min(1).max(300), style: z.enum(LOOK_STYLE_IDS).optional(), custom_style: z.string().min(1).max(120).optional() }).superRefine((value, ctx) => { if (value.style === "custom" && !value.custom_style?.trim()) ctx.addIssue({ code: "custom", message: "Enter a custom style from 1 to 120 characters", path: ["custom_style"] }); });
const lookEditRoute = createRoute({ method: "post", path: "/{id}/look/edit", tags: ["Companions"], summary: "Edit a companion look picture with words", middleware: [requireAuth] as const,
  request: { params: lookIdParam, body: { content: { "application/json": { schema: lookEditBody } } } },
  responses: { 202: { content: { "application/json": { schema: lookJobResponse } }, description: "Picture edit started." }, ...errorResponses({ 400: "Describe a change in 1 to 300 characters", 401: "Not signed in", 403: "Only an allowed editor can change this companion's pictures", 404: "No household companion or picture", 409: "A picture is already being made for this companion", 422: "The instruction cannot be used to edit this picture", 503: "Picture creation is not set up" }) } });
companionsRoutes.openapi(lookEditRoute, async (c) => {
  const { id } = c.req.valid("param"), denied = lookAccess(c.get("person"), id); if (denied) return c.json({ error: denied.error }, denied.status);
  const body = c.req.valid("json");
  try { const job = await startLookEdit({ actor: c.get("person"), companionId: id, versionId: body.version_id, instruction: body.instruction, style: body.style, customStyle: body.custom_style }); return c.json({ job: driven(c.get("person"), id, job) }, 202); }
  catch (error) { const status = (error as { status?: number }).status ?? 503; return c.json({ error: error instanceof Error ? error.message : LOOK_EDIT_PROMPT_LINE }, status as 400 | 403 | 404 | 409 | 422 | 503); }
});

const completeRoute = createRoute({ method: "post", path: "/{id}/look/complete", tags: ["Companions"], summary: "Complete a clipped companion picture", middleware: [requireAuth] as const,
  request: { params: lookIdParam, body: { content: { "application/json": { schema: z.object({ version_id: z.string().regex(/^v-[0-9]+$/) }) } } } },
  responses: { 202: { content: { "application/json": { schema: lookJobResponse } }, description: "Picture completion started." }, ...errorResponses({ 403: "Only an allowed editor can change this companion's pictures", 404: "No picture", 409: "Nothing is cut off in this picture", 422: "Picture withheld", 503: "Picture creation is not set up" }) } });
companionsRoutes.openapi(completeRoute, async (c) => {
  const { id } = c.req.valid("param"), actor = c.get("person"), denied = lookAccess(actor, id); if (denied) return c.json({ error: denied.error }, denied.status);
  const { version_id } = c.req.valid("json"), look = readLook(id), version = look.versions.find((item) => item.id === version_id), path = versionPath(id, version_id);
  if (!version || !path) return c.json({ error: "That picture could not be found." }, 404);
  try {
    const bytes = new Uint8Array(readFileSync(path)), plan = await planFillCutOff(bytes, version.clipped);
    if (!plan) return c.json({ error: "Nothing is cut off in this picture." }, 409);
    const body = (await planBodyCanvas(bytes, plan.edges)) ?? undefined;
    const job = await startLookEdit({ actor, companionId: id, versionId: version_id, instruction: body ? bodyFillInstruction() : plan.instruction, forceKeyComposite: true, fitSubject: true, ...(body ? { body } : {}) });
    return c.json({ job: driven(c.get("person"), id, job) }, 202);
  } catch (error) { const status = (error as { status?: number }).status ?? 503; return c.json({ error: error instanceof Error ? error.message : "The picture could not be completed. Try again." }, status as 403 | 404 | 409 | 422 | 503); }
});

const restyleBody = z.object({ version_id: z.string().regex(/^v-[0-9]+$/), style: z.string().refine((style) => LOOK_STYLE_IDS.includes(style as LookStyleId) && style !== "keep"), custom_style: z.string().min(1).max(120).optional() });
const restyleRoute = createRoute({ method: "post", path: "/{id}/look/restyle", tags: ["Companions"], summary: "Restyle a companion picture", middleware: [requireAuth] as const, request: { params: lookIdParam, body: { content: { "application/json": { schema: restyleBody } } } }, responses: { 202: { content: { "application/json": { schema: lookJobResponse } }, description: "Restyle started." }, ...errorResponses({ 400: "Invalid style", 403: "Only an allowed editor can change this companion's pictures", 404: "No household companion or picture", 409: "A picture is already being made", 422: "Style instruction cannot be used", 503: "Picture creation is not set up" }) } });
companionsRoutes.openapi(restyleRoute, async (c) => { const { id } = c.req.valid("param"), denied = lookAccess(c.get("person"), id); if (denied) return c.json({ error: denied.error }, denied.status); const body = c.req.valid("json"); try { const job = await startLookEdit({ actor: c.get("person"), companionId: id, versionId: body.version_id, instruction: restyleInstruction(), style: body.style as LookStyleId, customStyle: body.custom_style }); return c.json({ job: driven(c.get("person"), id, job) }, 202); } catch (error) { const status = (error as { status?: number }).status ?? 503; return c.json({ error: error instanceof Error ? error.message : LOOK_EDIT_PROMPT_LINE }, status as 400 | 403 | 404 | 409 | 422 | 503); } });

const prepareBody = z.object({ version_id: z.string().regex(/^v-[0-9]+$/), remove_background: z.boolean(), frame: z.object({ zoom: z.number().min(1).max(4), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional() });
const prepareRoute = createRoute({ method: "post", path: "/{id}/look/prepare", tags: ["Companions"], summary: "Prepare a companion picture", middleware: [requireAuth] as const, request: { params: lookIdParam, body: { content: { "application/json": { schema: prepareBody } } } }, responses: { 201: { content: { "application/json": { schema: z.object({ id: z.string(), clipped: z.array(z.string()) }) } }, description: "Prepared picture saved." }, ...errorResponses({ 400: "Picture preparation failed", 403: "Only an allowed editor can change this companion's pictures", 404: "No picture", 422: "Picture withheld" }) } });
companionsRoutes.openapi(prepareRoute, async (c) => { const { id } = c.req.valid("param"), actor = c.get("person"), denied = lookAccess(actor, id); if (denied) return c.json({ error: denied.error }, denied.status); const pictureDenied = pictureDenial(routeAudience(actor)); if (pictureDenied) return c.json({ error: PICTURE_DENIAL_LINE[pictureDenied] }, 403); const body = c.req.valid("json"), source = readLook(id).versions.find((item) => item.id === body.version_id), path = versionPath(id, body.version_id); if (!source || !path) return c.json({ error: "That picture could not be found." }, 404); try { const input: Uint8Array<ArrayBufferLike> = new Uint8Array(readFileSync(path)); const opts = { ...imagingTargets.portrait, ...(body.frame ? { placement: body.frame } : {}), ...(body.remove_background ? { removeBackground: (image: Uint8Array) => removeBackground(actor, image) } : { skipBackgroundRemoval: true }), upscale: async (image: Uint8Array) => new Uint8Array(await sharp(image).resize(1024, 1024, { fit: "inside" }).png().toBuffer()) }; const result = await preparePicture(input, opts); const checked = await checkCompanionArt(id, actor, [{ label: "That picture", bytes: result.bytes }]); if (!checked.ok) return c.json({ error: checked.reasons.join(" ") }, 422); const version = addVersion(id, result.bytes, { source: "edit", label: "Prepared picture", width: 1024, height: 1024, from: source.id, style: source.style, steps: result.steps, clipped: result.clipped.length ? result.clipped : source.clipped ?? [] }); return c.json({ id: version.id, clipped: version.clipped ?? [] }, 201); } catch (error) { return c.json({ error: error instanceof Error ? error.message : "That picture could not be prepared." }, 400); } });

const FILL_FAILED_LINE = "The rest of the body could not be drawn in. Try Approve & Continue again.";
/**
 * A starting picture that is cut off (no body, arms or hands) gets them drawn in before it becomes the starting picture, the way every
 * animation picture is drawn, so every later picture starts from a whole character. Waits for the picture job and returns the new picture.
 */
async function drawMissingBody(actor: import("@/types").PersonRow, id: string, version: { id: string; clipped?: readonly string[] }): Promise<string> {
  const path = versionPath(id, version.id); if (!path) throw new Error(FILL_FAILED_LINE);
  const bytes = new Uint8Array(readFileSync(path)), plan = await planFillCutOff(bytes, version.clipped as never);
  if (!plan) return version.id;
  const body = (await planBodyCanvas(bytes, plan.edges)) ?? undefined;
  const job = await startLookEdit({ actor, companionId: id, versionId: version.id, instruction: body ? bodyFillInstruction() : plan.instruction, forceKeyComposite: true, fitSubject: true, ...(body ? { body } : {}) });
  for (let round = 0; round < 180; round++) {
    await new Promise((resolve) => setTimeout(resolve, process.env.NODE_ENV === "test" ? 5 : 2000));
    const state = await readLookJob(job, actor, id);
    if (!state || state.state === "failed" || state.state === "cancelled") throw new Error(state?.error ?? FILL_FAILED_LINE);
    if (state.state === "done") { const made = state.versions[state.versions.length - 1]; if (!made) throw new Error(FILL_FAILED_LINE); return made.id; }
  }
  throw new Error(FILL_FAILED_LINE);
}
const approveLookRoute = createRoute({ method: "post", path: "/{id}/look/approve", tags: ["Companions"], summary: "Approve a companion starting picture", middleware: [requireAuth] as const, request: { params: lookIdParam, body: { content: { "application/json": { schema: z.object({ version_id: z.string().regex(/^v-[0-9]+$/) }) } } } }, responses: { 202: { content: { "application/json": { schema: z.object({ job: z.string().nullable() }).passthrough() } }, description: "Picture approved and character sheet started, running or already made (job is null when it is already made)." }, ...errorResponses({ 400: "Choose a valid picture", 403: "Only an allowed editor can approve this picture", 404: "No household companion or picture", 409: "Picture job busy", 422: "Picture withheld", 503: "Picture tools unavailable" }) } });
companionsRoutes.openapi(approveLookRoute, async (c) => { const { id } = c.req.valid("param"), actor = c.get("person"), denied = lookAccess(actor, id); if (denied) return c.json({ error: denied.error }, denied.status); const pictureDenied = pictureDenial(routeAudience(actor)); if (pictureDenied) return c.json({ error: PICTURE_DENIAL_LINE[pictureDenied] }, 403); const { version_id: picked } = c.req.valid("json"), pickedPath = versionPath(id, picked), pickedVersion = readLook(id).versions.find((item) => item.id === picked); if (!pickedPath || !pickedVersion) return c.json({ error: "That picture could not be found." }, 404); let version_id = picked; if (pickedVersion.clipped?.length && !(readLook(id).rest === picked && readLook(id).sheet)) { try { version_id = await drawMissingBody(actor, id, pickedVersion); } catch (error) { return c.json({ error: error instanceof Error ? error.message : FILL_FAILED_LINE }, (error as { status?: 403 | 409 | 422 | 503 }).status ?? 503); } } const path = versionPath(id, version_id), version = readLook(id).versions.find((item) => item.id === version_id); if (!path || !version) return c.json({ error: "That picture could not be found." }, 404); const bytes = new Uint8Array(readFileSync(path)), checked = await checkCompanionArt(id, actor, [{ label: "That picture", bytes }]); if (!checked.ok) return c.json({ error: checked.reasons[0] ?? "That picture could not be approved. Choose another picture and try again." }, 422); const before = readLook(id); if (before.rest === version_id && before.sheet?.state === "approved") return c.json({ job: null }, 202); const running = before.rest === version_id ? runningSheetJob(id) : null; if (running) return c.json({ job: running }, 202); ensurePublishedRecord(id); const prior = before.rest; setRest(id, version_id); if (prior !== version_id) clearStateApprovals(id); try { const result = await startLookSheet({ actor, companionId: id, lookPrompt: getHouseholdCompanion(id)?.companion?.look_prompt ?? "" }); return c.json({ ...result, job: result.job === null ? null : driven(actor, id, result.job) }, 202); } catch (error) { return c.json({ error: error instanceof Error ? error.message : "The character sheet could not be started." }, (error as { status?: 400 | 403 | 409 | 503 }).status ?? 400); } });

const lookJobParam = z.object({ id: z.string().min(1).max(80), job: z.string().min(1).max(160).openapi({ param: { name: "job", in: "path" } }) });
const lookJobState = z.object({ state: z.enum(["queued", "running", "done", "failed", "cancelled"]), percent: z.number().int(), label: z.string(), versions: z.array(z.object({ id: z.string(), url: z.string(), label: z.string() })), error: z.string().nullable() });
const pollLookRoute = createRoute({ method: "get", path: "/{id}/look/jobs/{job}", tags: ["Companions"], summary: "Read companion look picture job progress", middleware: [requireAuth] as const,
  request: { params: lookJobParam }, responses: { 200: { content: { "application/json": { schema: lookJobState } }, description: "Job state and any saved look versions." }, ...errorResponses({ 401: "Not signed in", 403: "Only the author or an admin can read this companion's pictures", 404: "No such companion or job" }) } });
/** Reads one picture job and, for an animation picture, saves it as that animation's keyframe once it is done. */
async function readLookJob(job: string, actor: import("@/types").PersonRow, id: string) {
  const result = await pollLookJob(job, actor, id), pending = pendingKeyframeJobs.get(job);
  if (result?.state === "done" && pending && result.versions.length) {
    try { const version = readLook(id).versions.find((item) => item.id === result.versions[0]!.id), path = version && versionPath(id, version.id); if (!version || !path) throw new Error("The keyframe picture could not be found."); const prepared = await preparePicture(new Uint8Array(readFileSync(path)), { ...imagingTargets.portrait, skipBackgroundRemoval: true, fit: async (png) => png, upscale: (bytes) => upscale(actor, bytes) }); const checked = await checkCompanionArt(id, actor, [{ label: "Animation keyframe", bytes: prepared.bytes }]); if (!checked.ok) { result.state = "failed"; result.error = checked.reasons.join(" "); result.versions = []; } else storeKeyframe(id, pending.state, prepared.bytes, "generated", pending.style, pending.instruction, version.model ?? null); } catch (e) { result.state = "failed"; result.error = e instanceof Error ? e.message : "The keyframe could not be saved."; result.versions = []; }
    pendingKeyframeJobs.delete(job);
  }
  return result;
}
/** Reads a started picture job every two seconds until it ends, so its lock clears even when nobody has the screen open. */
function driven(actor: import("@/types").PersonRow, companionId: string, job: string): string {
  if (process.env.NODE_ENV === "test") return job;
  void (async () => {
    for (let round = 0; round < 900; round++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      try { const state = await readLookJob(job, actor, companionId); if (!state || ["done", "failed", "cancelled"].includes(state.state)) return; } catch { return; }
    }
  })();
  return job;
}
companionsRoutes.openapi(pollLookRoute, async (c) => {
  const { id, job } = c.req.valid("param"), denied = lookAccess(c.get("person"), id); if (denied) return c.json({ error: denied.error }, denied.status);
  const result = await readLookJob(job, c.get("person"), id);
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

const uploadRoute = createRoute({ method: "post", path: "/{id}/look/upload", tags: ["Companions"], summary: "Add a look picture by upload", middleware: [requireAuth] as const,
  request: { params: lookIdParam, body: { content: { "multipart/form-data": { schema: z.object({ image: z.any() }) } } } },
  responses: { 201: { content: { "application/json": { schema: z.object({ id: z.string(), clipped: z.array(z.string()) }) } }, description: "Picture added." }, ...errorResponses({ 400: "Picture or required confirmations are invalid", 401: "Not signed in", 403: "Only the author or an admin can change this companion's pictures", 404: "No household companion", 413: "Picture exceeds the upload size limit", 422: "The picture did not pass the age check", 503: "Background removal is unavailable" }) } });
companionsRoutes.openapi(uploadRoute, async (c) => {
  const { id } = c.req.valid("param"), denied = lookAccess(c.get("person"), id); if (denied) return c.json({ error: denied.error }, denied.status);
  try {
    const form = await c.req.parseBody(), file = form.image;
    if (!(file instanceof File)) return c.json({ error: "Choose a PNG, JPEG or WebP picture to upload." }, 400);
    if (file.size > media.image.max_upload_bytes) return c.json({ error: "That picture is over 20 MB. Choose a smaller PNG, JPEG or WebP picture." }, 413);
    const bytes = new Uint8Array(await file.arrayBuffer()), detected = await fileTypeFromBuffer(bytes);
    if (!detected || !["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "image/tiff"].includes(detected.mime)) return c.json({ error: "Use a PNG, JPEG, WebP, GIF, AVIF or TIFF picture." }, 400);
    const prepared = await preparePicture(bytes, { ...imagingTargets.portrait, removeBackground: (image) => removeBackground(c.get("person"), image), upscale: (image) => upscale(c.get("person"), image) });
    const png = prepared.bytes;
    const checked = await checkCompanionArt(id, c.get("person"), [{ label: "That picture", bytes }]);
    if (!checked.ok) return c.json({ error: checked.reasons.join(" ") }, 422);
    const clipped = prepared.clipped;
    const version = addVersion(id, png, { source: "upload", label: uploadLabel(file.name), width: media.image.size, height: media.image.size, from: null, style: "keep", clipped });
    return c.json({ id: version.id, clipped }, 201);
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
const CreatorStateId = z.enum(creatorStateRows().map((row) => row.id) as [string, ...string[]]);
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
  const look = readLook(id);
  if (look.sheet?.state !== "approved" || !look.rest || !look.sheet.card) throw new Error("Approve the character sheet and choose its starting picture first.");
  const built: Record<string, { h264: string; av1?: string; still: string; loop: boolean }> = {};
  for (const [state, takeId] of Object.entries(states)) {
    const h264 = takePath(id, state, takeId, "clip.h264.mp4")!, still = takePath(id, state, takeId, "still.png")!, av1 = takePath(id, state, takeId, "clip.av1.mp4")!;
    if (!existsSync(h264) || !existsSync(still)) throw new Error("An approved clip file is missing. Replace or approve that clip again.");
    const keyframe = keyframePath(id, state); built[state] = { h264: `${state}.h264.mp4`, ...(existsSync(av1) ? { av1: `${state}.av1.mp4` } : {}), still: `${state}.png`, ...(existsSync(keyframe) ? { keyframe: `${state}-keyframe.png` } : {}), loop: media.states.find((row) => row.id === state)?.kind === "loop" };
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
  for (const [state, takeId] of Object.entries(stateMap)) { const keyframe = keyframePath(id, state); if (existsSync(keyframe)) add(`The ${state} keyframe`, keyframe); const still = takePath(id, state, takeId, "still.png")!, clip = takePath(id, state, takeId, "clip.h264.mp4")!; add(`The ${state} still`, still); const take = readStates(id).states[state]?.takes.find((row) => row.id === takeId); let frames: Uint8Array[] | null = null; try { frames = await extractKeyframes(new Uint8Array(readFileSync(clip)), take?.report?.seconds ?? null); } catch {} if (!frames) assets.push({ label: `The ${state} clip frames` }); else frames.forEach((bytes) => assets.push({ label: `The ${state} clip frames`, bytes })); }
  return assets;
}
async function checkAssets(assets: AppearanceAsset[], audience: "adult" | "teen" | "all", cache: NonNullable<ReturnType<typeof readStates>["checks"]>) {
  const result = await checkFinishedAssets({ assets, lane: audience === "all" ? "child" : audience, adultOnly: audience === "adult", kind: "video", cache });
  return result.reasons;
}
async function publishAppearance(id: string, actor: import("@/types").PersonRow): Promise<{ error: string; go_back_to: "look" | "animations"; status: 409 | 422 } | null> {
  const status = appearanceStatus(id), all = readStates(id);
  if (!status.can_publish) return { error: status.reasons[0] ?? "Go back to animations and approve the idle animation.", go_back_to: /idle clip|clip run/i.test(status.reasons[0] ?? "") ? "animations" : "look", status: 409 };
  const draft = Object.fromEntries(Object.entries(all.states).filter(([, row]) => row?.approved).map(([state, row]) => [state, row!.approved!]));
  all.checks ??= {}; const audience = getHouseholdCompanion(id)?.companion?.audience ?? "adult", restAtStart = readLook(id).rest, reasons = await checkAssets(await collectDraftAssets(id, draft), audience, all.checks);
  const fresh = readStates(id); fresh.checks = { ...(fresh.checks ?? {}), ...all.checks };
  if (reasons.length) { saveStates(id, fresh); return { error: reasons.join(" "), go_back_to: /starting picture|character sheet/i.test(reasons.join(" ")) ? "look" : "animations", status: 422 }; }
  const freshDraft = Object.fromEntries(Object.entries(fresh.states).filter(([, row]) => row?.approved).map(([state, row]) => [state, row!.approved!])), currentAudience = getHouseholdCompanion(id)?.companion?.audience ?? "adult";
  if (JSON.stringify(Object.entries(freshDraft).sort()) !== JSON.stringify(Object.entries(draft).sort()) || readLook(id).rest !== restAtStart || currentAudience !== audience) { saveStates(id, fresh); return { error: "The artwork or audience changed during the check. Go back to the look screen and try Save again.", go_back_to: "look", status: 409 }; }
  all.checks = fresh.checks;
  const root = householdCompanionFolder(id)!, next = join(root, "animation.next"), look = readLook(id), animation = buildAnimationManifest(id, draft, actor.displayName), previousPublished = fresh.published;
  try {
    rmSync(next, { recursive: true, force: true }); mkdirSync(next, { recursive: true });
    copyFileSync(versionPath(id, look.rest!)!, join(next, "rest.png")); writeFileSync(join(next, "card.json"), JSON.stringify({ text: look.sheet!.card!.text, species: look.sheet!.card!.species, colours: look.sheet!.card!.colours }, null, 2));
    for (const [state, takeId] of Object.entries(draft)) { copyFileSync(takePath(id, state, takeId, "clip.h264.mp4")!, join(next, `${state}.h264.mp4`)); copyFileSync(takePath(id, state, takeId, "still.png")!, join(next, `${state}.png`)); const keyframe = keyframePath(id, state); if (existsSync(keyframe)) copyFileSync(keyframe, join(next, `${state}-keyframe.png`)); const av1 = takePath(id, state, takeId, "clip.av1.mp4")!; if (existsSync(av1)) copyFileSync(av1, join(next, `${state}.av1.mp4`)); }
    if (!animation.states.idle) return { error: "Go back to animations and approve the idle animation.", go_back_to: "animations", status: 409 };
    swapInAnimation(root, () => { const changed = setHouseholdCompanionAnimation(id, animation as never); if (!changed.ok) throw new Error(changed.error); fresh.published = { at: new Date().toISOString(), by: actor.displayName, rest: look.rest!, states: draft }; saveStates(id, fresh); });
    return null;
  } catch (error) {
    rmSync(next, { recursive: true, force: true }); if (previousPublished) fresh.published = previousPublished;
    return { error: error instanceof Error ? error.message : "The appearance could not be checked. Go back to the look screen.", go_back_to: /idle clip|animation|clip/i.test(error instanceof Error ? error.message : "") ? "animations" : "look", status: 422 };
  }
}
const publishRoute = createRoute({ method: "post", path: "/{id}/appearance/publish", tags: ["Companions"], summary: "Publish the approved companion appearance", middleware: [requireAuth] as const, request: { params: lookIdParam }, responses: { 200: { content: { "application/json": { schema: z.object({ published: z.boolean() }) } }, description: "Appearance published." }, ...errorResponses({ 403: "Only the author or an admin can publish this companion", 404: "No household companion", 409: "Appearance is not ready to publish", 422: "Appearance checks need attention" }) } });
companionsRoutes.openapi(publishRoute, async (c) => {
  const { id } = c.req.valid("param"), actor = c.get("person"), denied = statesAccess(actor, id); if (denied) return c.json({ error: denied.error }, denied.status);
  const result = await publishAppearance(id, actor);
  if (result) return c.json({ error: result.error, ...(result.status === 422 ? { reasons: [result.error] } : {}) }, result.status);
  return c.json({ published: true }, 200);
});

const backstoryParams = lookIdParam;
const backstoryBody = z.object({ hint: z.string().max(300).optional() });
const backstoryRoute = createRoute({ method: "post", path: "/{id}/backstory/generate", tags: ["Companions"], summary: "Generate a companion backstory", middleware: [requireAuth] as const, request: { params: backstoryParams, body: { content: { "application/json": { schema: backstoryBody } } } }, responses: { 200: { content: { "application/json": { schema: z.object({ text: z.string().max(400) }) } }, description: "Generated editable backstory." }, ...errorResponses({ 403: "Only the author or an admin can generate this backstory", 404: "No household companion", 503: "The local chat model is unavailable" }) } });
companionsRoutes.openapi(backstoryRoute, async (c) => {
  const { id } = c.req.valid("param"), actor = c.get("person"), denied = statesAccess(actor, id);
  if (denied) return c.json({ error: denied.error }, denied.status);
  if (!mayEdit(actor, id) || speakerAgeBand(actor, new Date()) === "child") return c.json({ error: "Only the author or an admin can generate this backstory." }, 403);
  const companion = getHouseholdCompanion(id)?.companion; if (!companion) return c.json({ error: "That household companion could not be found." }, 404);
  const band = speakerAgeBand(actor, new Date()), hint = c.req.valid("json").hint?.trim();
  const completion = await (backstoryCompleteForTests ?? complete)("chat", topicMessages(actor, [{ role: "system", content: `Write one kind, plain, non-romantic backstory sentence for an AI companion. No profanity, instructions, tools or claims of real memories. Maximum 400 characters. Viewer age band: ${band}. Return only the sentence.` }, { role: "user", content: `Name: ${companion.display_name}. Personality: ${hint ? "creator's hint follows" : "gentle and helpful"}. ${hint ? `Hint: ${hint}` : ""}` }]), { max_tokens: 180, temperature: 0.7 });
  if (!completion.ok) return c.json({ error: "The local chat model is unavailable. Try again when it is ready." }, 503);
  const text = completion.value.text.trim().replace(/^['"`]+|['"`]+$/g, "").slice(0, 400).trim();
  if (!text) return c.json({ error: "The local chat model is unavailable. Try again when it is ready." }, 503);
  return c.json({ text }, 200);
});

const saveBody = z.object({ voice_id: z.string().min(1).max(120), personality: z.enum(["friendly", "funny", "calm", "professional", "playful", "custom"]), style_notes: z.string().max(300).optional(), backstory: z.string().max(400).optional() });
const saveRoute = createRoute({ method: "post", path: "/{id}/save", tags: ["Companions"], summary: "Save companion personality and publish its approved appearance", middleware: [requireAuth] as const, request: { params: lookIdParam, body: { content: { "application/json": { schema: saveBody } } } }, responses: { 200: { content: { "application/json": { schema: z.object({ id: z.string(), status: z.literal("ready"), published: z.boolean() }) } }, description: "Companion saved and appearance published." }, 409: { content: { "application/json": { schema: z.object({ error: z.string(), go_back_to: z.enum(["look", "animations"]) }) } }, description: "Complete the named screen and save again." }, 422: { content: { "application/json": { schema: z.object({ error: z.string(), go_back_to: z.enum(["look", "animations"]) }) } }, description: "The appearance check blocked publishing." }, ...errorResponses({ 400: "Companion fields are invalid", 403: "Only the author or an admin can save this companion", 404: "No household companion" }) } });
companionsRoutes.openapi(saveRoute, async (c) => {
  const { id } = c.req.valid("param"), actor = c.get("person"), body = c.req.valid("json"), denied = statesAccess(actor, id);
  if (denied) return c.json({ error: denied.error }, denied.status);
  if (!mayEdit(actor, id) || speakerAgeBand(actor, new Date()) === "child") return c.json({ error: "Only the author or an admin can save this companion." }, 403);
  const original = getHouseholdCompanion(id)?.companion; if (!original) return c.json({ error: "That household companion could not be found." }, 404);
  const look = readLook(id);
  if (!look.rest || look.sheet?.state !== "approved") return c.json({ error: "Go back to the look screen and approve the starting picture.", go_back_to: "look" as const }, 409);
  if (!readStates(id).states.idle?.approved) return c.json({ error: "Go back to animations and approve the idle animation.", go_back_to: "animations" as const }, 409);
  const preset = body.personality === "custom" ? null : COMPANION_PERSONALITIES[body.personality];
  const band = speakerAgeBand(actor, new Date());
  const checkedLines = (values: readonly string[], forBand: "child" | "teen" | "adult") => values.map((v) => v.replaceAll("{name}", original.display_name)).filter((line) => { const verdict = forOutput(evaluateSafety(line, forBand, "reply")); return verdict.action !== "refuse" && !carriesCrisisSignal(verdict); });
  const general = checkedLines(preset?.examples.general ?? [], band), child = checkedLines(preset?.examples.child ?? [], "child"), teen = checkedLines(preset?.examples.teen ?? [], "teen"), adult = checkedLines(preset?.examples.adult ?? [], "adult");
  const fallback = preset?.examples;
  const value = {
    ...(preset ? { formality: preset.dials.formality, complexity: preset.dials.complexity, engagement: preset.dials.engagement, filler_density: preset.dials.filler_density, clock_style: preset.dials.clock_style, hedging: preset.dials.hedging, social: { humor: preset.dials.humor, warmth: preset.dials.warmth, initiative: preset.dials.initiative } } : {}), voice_id: body.voice_id, behavior: cleanStyleNotes(body.style_notes),
    ...(body.backstory !== undefined ? { backstory: body.backstory.trim() } : {}),
    ...(preset ? { tagline: preset.tagline.replaceAll("{name}", original.display_name).slice(0, 80), examples: general.length >= 3 ? general : checkedLines(fallback!.general, band), examples_child: child.length >= 2 ? child : checkedLines(fallback!.child, "child"), examples_teen: teen.length >= 2 ? teen : checkedLines(fallback!.teen, "teen"), examples_adult: adult.length >= 2 ? adult : checkedLines(fallback!.adult, "adult") } : body.personality === "custom" && body.backstory ? { tagline: backstoryTagline(body.backstory) } : {}),
  };
  // Preserve identity fields through the narrow existing writer.
  const priorBackstory = body.backstory === undefined ? original.backstory : undefined;
  const result = saveHouseholdCompanionPersonality(id, { ...value, ...(priorBackstory !== undefined ? { backstory: priorBackstory } : {}) } as never);
  if (!result.ok) return c.json({ error: result.error }, 400);
  const appearance = appearanceStatus(id);
  let published = false;
  if (appearance.can_publish || !appearance.published) {
    const publishError = await publishAppearance(id, actor);
    if (publishError) { const go_back_to = publishError.go_back_to, error = go_back_to === "look" ? "Go back to the look screen and check the starting picture." : "Go back to animations and check the approved clips."; setHouseholdCompanionStatus(id, "draft"); return c.json({ error, go_back_to }, publishError.status); }
    published = true;
  }
  setHouseholdCompanionStatus(id, "ready"); reloadPersonas();
  return c.json({ id, status: "ready" as const, published }, 200);
});
const keyframeParams = statesParams.extend({ state: CompanionStateId });
const keyframeGenerateRoute = createRoute({ method: "post", path: "/{id}/states/{state}/keyframe/generate", tags: ["Companions"], summary: "Generate a companion state keyframe", middleware: [requireAuth] as const, request: { params: keyframeParams }, responses: { 202: { content: { "application/json": { schema: z.object({ job: z.string() }) } }, description: "Keyframe image job started." }, ...errorResponses({ 400: "The keyframe could not be started", 403: "Only an allowed editor can change this companion", 404: "No starting picture", 409: "Approve the character sheet first", 422: "Picture prompt refused", 503: "Picture engine is not ready" }) } });
companionsRoutes.openapi(keyframeGenerateRoute, async (c) => { const p = c.req.valid("param"), actor = c.get("person"), denied = keyframeDenied(actor, p.id); if (denied) return c.json({ error: denied.error }, denied.status); const look = readLook(p.id), rest = look.rest && look.versions.find((v) => v.id === look.rest), row = creatorStateRows().find((v) => v.id === p.state); if (!rest || look.sheet?.state !== "approved" || !row) return c.json({ error: "Approve the character sheet and choose its starting picture first." }, 409); const instruction = keyframeInstruction(row); try { const job = await startLookEdit({ actor, companionId: p.id, versionId: rest.id, instruction, style: rest.style && rest.style !== "keep" ? rest.style as LookStyleId : undefined }); pendingKeyframeJobs.set(job, { state: p.state, instruction, style: rest.style ?? "keep" }); return c.json({ job: driven(c.get("person"), p.id, job) }, 202); } catch (e) { const error = e as { status?: number }; return c.json({ error: e instanceof Error ? e.message : "The keyframe could not be started." }, (error.status ?? 503) as 400 | 403 | 404 | 409 | 422 | 503); } });
/** One instruction for every animation picture: the same person drawn the same way, whole, changing only the pose. */
const keyframeInstruction = (row: { motion: string; driven_by: string }) => `Keep exactly the same character, with the same clothing, colours, art style, size, position and camera framing as the picture, nothing cut off by the frame. ${FACE_AND_BODY} Change only the pose: ${row.motion}, ${row.driven_by}, frozen on the key moment.`;
async function startKeyframeForState(actor: import("@/types").PersonRow, id: string, state: string): Promise<string> {
  const look = readLook(id), rest = look.rest && look.versions.find((v) => v.id === look.rest), row = creatorStateRows().find((v) => v.id === state);
  if (!rest || look.sheet?.state !== "approved" || !row) throw Object.assign(new Error("Approve the character sheet and choose its starting picture first."), { status: 409 });
  const instruction = keyframeInstruction(row);
  const job = await startLookEdit({ actor, companionId: id, versionId: rest.id, instruction, style: rest.style && rest.style !== "keep" ? rest.style as LookStyleId : undefined });
  pendingKeyframeJobs.set(job, { state, instruction, style: rest.style ?? "keep" }); return driven(actor, id, job);
}
const keyframeEditRoute = createRoute({ method: "post", path: "/{id}/states/{state}/keyframe/edit", tags: ["Companions"], summary: "Edit a companion state keyframe", middleware: [requireAuth] as const, request: { params: keyframeParams, body: { content: { "application/json": { schema: z.object({ instruction: z.string().min(1).max(500) }) } } } }, responses: { 202: { content: { "application/json": { schema: z.object({ job: z.string() }) } }, description: "Keyframe edit job started." }, ...errorResponses({ 400: "The keyframe edit could not be started", 403: "Only an allowed editor can change this companion", 404: "No keyframe", 409: "A picture job is busy", 422: "Picture prompt refused", 503: "Picture engine is not ready" }) } });
companionsRoutes.openapi(keyframeEditRoute, async (c) => { const p = c.req.valid("param"), actor = c.get("person"), denied = keyframeDenied(actor, p.id); if (denied) return c.json({ error: denied.error }, denied.status); const path = keyframePath(p.id, p.state), meta = readKeyframeMeta(p.id, p.state); if (!existsSync(path) || !meta) return c.json({ error: "This animation has no picture yet." }, 404); try { const source = addVersion(p.id, new Uint8Array(readFileSync(path)), { source: "upload", label: "Animation keyframe edit source", width: 1024, height: 1024, from: null, style: meta.style }); const job = await startLookEdit({ actor, companionId: p.id, versionId: source.id, instruction: c.req.valid("json").instruction, style: meta.style !== "keep" ? meta.style as LookStyleId : undefined }); pendingKeyframeJobs.set(job, { state: p.state, instruction: c.req.valid("json").instruction, style: meta.style }); return c.json({ job: driven(c.get("person"), p.id, job) }, 202); } catch (e) { const error = e as { status?: number }; return c.json({ error: e instanceof Error ? e.message : "The keyframe edit could not be started." }, (error.status ?? 503) as 400 | 403 | 404 | 409 | 422 | 503); } });
const keyframePrepareBody = z.object({ remove_background: z.boolean(), frame: z.object({ zoom: z.number().min(1).max(4), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional() });
function keyframeDenied(actor: import("@/types").PersonRow, id: string) { const denied = statesAccess(actor, id); if (denied) return denied; if (routeAudience(actor).band === "child") return { status: 403 as const, error: "Children cannot edit companion pictures." }; return null; }
function storeKeyframe(id: string, state: string, bytes: Uint8Array, source: "generated" | "upload" | "edit", style: string, prompt: string, model: string | null = null) { const previous = readKeyframeMeta(id, state), now = new Date().toISOString(); writeKeyframe(id, state, bytes, { source, style, prompt_hash: createHash("sha256").update(prompt).digest("hex"), model, created_at: previous?.created_at ?? now, edited_at: now }); }
const keyframeRoute = createRoute({ method: "get", path: "/{id}/states/{state}/keyframe", tags: ["Companions"], summary: "Read a companion state keyframe", middleware: [requireAuth] as const, request: { params: keyframeParams }, responses: { 200: { description: "Keyframe PNG." }, ...errorResponses({ 403: "Only the author or an admin can read this companion", 404: "No keyframe" }) } });
companionsRoutes.openapi(keyframeRoute, (c) => { const p = c.req.valid("param"), denied = keyframeDenied(c.get("person"), p.id); if (denied) return c.json({ error: denied.error }, denied.status); const path = keyframePath(p.id, p.state); return existsSync(path) ? new Response(readFileSync(path), { headers: { "content-type": "image/png", "cache-control": "private, max-age=0, must-revalidate" } }) : c.json({ error: "This animation has no picture yet." }, 404); });
const keyframeUploadRoute = createRoute({ method: "post", path: "/{id}/states/{state}/keyframe", tags: ["Companions"], summary: "Upload a companion state keyframe", middleware: [requireAuth] as const, request: { params: keyframeParams, body: { content: { "multipart/form-data": { schema: z.any() } } } }, responses: { 201: { description: "Keyframe saved." }, ...errorResponses({ 400: "Picture could not be prepared", 403: "Only an allowed editor can change this companion", 422: "Picture withheld" }) } });
companionsRoutes.openapi(keyframeUploadRoute, async (c) => { const p = c.req.valid("param"), actor = c.get("person"), denied = keyframeDenied(actor, p.id); if (denied) return c.json({ error: denied.error }, denied.status); const audience = routeAudience(actor), pictureDenied = pictureDenial(audience); if (pictureDenied) return c.json({ error: PICTURE_DENIAL_LINE[pictureDenied] }, 403); try { const form = await c.req.parseBody(), file = form.picture ?? form.image; if (!(file instanceof File)) return c.json({ error: "Choose a PNG, JPEG or WebP picture." }, 400); const bytes = new Uint8Array(await file.arrayBuffer()), detected = await fileTypeFromBuffer(bytes); if (!detected || !["image/png", "image/jpeg", "image/webp"].includes(detected.mime)) return c.json({ error: "Use a PNG, JPEG or WebP picture." }, 400); const prep = await prepareEditSource({ audience, bytes, generated: false, text: "Upload a companion animation picture." }); if (!prep.ok) return c.json({ error: prep.line }, 422); const meta = await sharp(bytes).metadata(), alphaStats = meta.hasAlpha ? await sharp(bytes).ensureAlpha().stats() : null, transparent = Boolean(alphaStats && (alphaStats.channels[3]?.min ?? 255) < 255), prepared = await preparePicture(bytes, { ...imagingTargets.portrait, ...(transparent ? {} : { removeBackground: (image) => removeBackground(actor, image) }), upscale: (image) => upscale(actor, image) }); const checked = await checkCompanionArt(p.id, actor, [{ label: "Animation picture", bytes: prepared.bytes }]); if (!checked.ok) return c.json({ error: checked.reasons.join(" ") }, 422); storeKeyframe(p.id, p.state, prepared.bytes, "upload", readLook(p.id).versions.find((v) => v.id === readLook(p.id).rest)?.style ?? "keep", "Uploaded animation picture"); return c.json({ saved: true }, 201); } catch (e) { return c.json({ error: e instanceof Error ? e.message : "That picture could not be prepared." }, 400); } });
const keyframePrepareRoute = createRoute({ method: "post", path: "/{id}/states/{state}/keyframe/prepare", tags: ["Companions"], summary: "Prepare a companion state keyframe", middleware: [requireAuth] as const, request: { params: keyframeParams, body: { content: { "application/json": { schema: keyframePrepareBody } } } }, responses: { 200: { description: "Keyframe prepared." }, ...errorResponses({ 403: "Only an allowed editor can change this companion", 404: "No keyframe", 422: "Picture withheld" }) } });
companionsRoutes.openapi(keyframePrepareRoute, async (c) => { const p = c.req.valid("param"), actor = c.get("person"), denied = keyframeDenied(actor, p.id); if (denied) return c.json({ error: denied.error }, denied.status); const path = keyframePath(p.id, p.state); if (!existsSync(path)) return c.json({ error: "This animation has no picture yet." }, 404); try { const body = c.req.valid("json"), result = await preparePicture(new Uint8Array(readFileSync(path)), { ...imagingTargets.portrait, ...(body.frame ? { placement: body.frame } : {}), ...(body.remove_background ? { removeBackground: (image) => removeBackground(actor, image) } : { skipBackgroundRemoval: true }), upscale: (image) => upscale(actor, image) }); const checked = await checkCompanionArt(p.id, actor, [{ label: "Animation picture", bytes: result.bytes }]); if (!checked.ok) return c.json({ error: checked.reasons.join(" ") }, 422); const meta = readKeyframeMeta(p.id, p.state)!; storeKeyframe(p.id, p.state, result.bytes, "edit", meta.style, "Prepared animation picture", meta.model); return c.json({ saved: true }, 200); } catch (e) { return c.json({ error: e instanceof Error ? e.message : "That picture could not be prepared." }, 400); } });
const keyframeDeleteRoute = createRoute({ method: "delete", path: "/{id}/states/{state}/keyframe", tags: ["Companions"], summary: "Delete a companion state keyframe", middleware: [requireAuth] as const, request: { params: keyframeParams }, responses: { 204: { description: "Keyframe deleted." }, ...errorResponses({ 403: "Only an allowed editor can change this companion" }) } });
companionsRoutes.openapi(keyframeDeleteRoute, (c) => { const p = c.req.valid("param"), denied = keyframeDenied(c.get("person"), p.id); if (denied) return c.json({ error: denied.error }, denied.status); removeKeyframe(p.id, p.state); return c.body(null, 204); });
const statesRoute = createRoute({ method: "get", path: "/{id}/states", tags: ["Companions"], summary: "Read companion video states", middleware: [requireAuth] as const, request: { params: statesParams }, responses: { 200: { content: { "application/json": { schema: z.any() } }, description: "State, take and approval data." }, ...errorResponses({ 401: "Not signed in", 403: "Only the author or an admin can read this companion", 404: "No household companion" }) } });
companionsRoutes.openapi(statesRoute, (c) => { const { id } = c.req.valid("param"), denied = statesAccess(c.get("person"), id); if (denied) return c.json({ error: denied.error }, denied.status); const stored = readStates(id), look = readLook(id), startReady = Boolean(look.rest), run = activeTakeRun(id), states = creatorStateRows().map((v) => { const row = stored.states[v.id], takes = row?.takes ?? [], best = bestTake(takes), urls = (take: string) => ({ h264: `/api/companions/${encodeURIComponent(id)}/states/${v.id}/${take}/clip.h264.mp4`, av1: existsSync(takePath(id, v.id, take, "clip.av1.mp4")!) ? `/api/companions/${encodeURIComponent(id)}/states/${v.id}/${take}/clip.av1.mp4` : null, still: `/api/companions/${encodeURIComponent(id)}/states/${v.id}/${take}/still.png` }); const approved = row?.approved ? takes.find((t) => t.id === row.approved) : null, at = run ? run.states.indexOf(v.id) : -1, now = run?.current ? run.states.indexOf(run.current.state) : -1, making = at >= 0 && at === now, waiting = at >= 0 && (now < 0 || at > now); const keyframeMeta = readKeyframeMeta(id, v.id), hasKeyframe = existsSync(keyframePath(id, v.id)); return { id: v.id, label: v.id.split("_").map((x) => x[0]!.toUpperCase() + x.slice(1)).join(" "), keyframe: hasKeyframe ? { url: `/api/companions/${encodeURIComponent(id)}/states/${v.id}/keyframe`, edited_at: keyframeMeta?.edited_at ?? null } : null, clip_out_of_date: Boolean(hasKeyframe && approved && keyframeMeta && Date.parse(keyframeMeta.edited_at) > Date.parse(approved.created_at)), kind: v.kind, required: v.required, when_it_plays: v.driven_by, default_motion: v.motion, motion: row?.motion ?? v.motion, status: waiting ? "waiting" : approved ? "ready" : takes.some((t) => (t.report && !t.report.ok) || (!t.report && t.failure)) ? "Needs another try" : "missing", ...(waiting ? { status_label: "Waiting its turn" } : {}), approved: approved ? { take_id: approved.id, approved_by: row?.approved_by, approved_at: row?.approved_at, urls: urls(approved.id) } : null, takes: takes.map((t) => ({ id: t.id, label: t.label, source: t.source, created_at: t.created_at, ok: t.report?.ok ?? null, reasons: t.report?.reasons ?? [], seconds: t.report?.seconds ?? null, bytes: t.report?.bytes ?? null, colour_distance: t.report?.colour_distance ?? null, frame0_keyframe_distance: t.report?.frame0_keyframe_distance ?? null, area_ratio: t.report?.area_ratio ?? null, ...(t.report?.colour_match ? { colour_match: t.report.colour_match } : {}), ...(t.report?.settle_skipped_frames !== undefined ? { settle_skipped_frames: t.report.settle_skipped_frames } : {}), urls: urls(t.id), is_best: best?.id === t.id })), busy: making || takes.some((t) => companionStateJob(id, t.id)?.state === "running") }; }); const approved = states.filter((v) => v.approved).length; return c.json({ sheet_ready: look.sheet?.state === "approved", start_ready: startReady, ...(!startReady ? { start_reason: TAKE_NO_REST_LINE } : {}), busy: activeLookInfo(id), key: look.sheet?.key ?? look.key, states, run: run ? { job: run.id, label: run.label, percent: run.percent } : null, counts: { approved, total: states.length, required_missing: states.filter((v) => v.required && !v.approved).map((v) => v.id) } }, 200); });

const generateOneParams = z.object({ id: z.string().min(1).max(80), state: CreatorStateId });
const generateOneBody = z.object({ count: z.number().int().min(1).max(4).default(4), motion: z.string().min(1).max(200).optional() });
const generateAllBody = z.object({ states: z.array(z.string()).optional(), count: z.number().int().min(1).max(4).default(1), required_only: z.boolean().default(false) });
const runResponse = z.object({ job: z.string() });
const startFailure409 = { description: "A clip run is busy, the character sheet is not approved, or the companion has no starting picture.", content: { "application/json": { schema: z.object({ error: z.string(), code: z.enum(["no_original"]).optional() }) } } };
const generateOneRoute = createRoute({ method: "post", path: "/{id}/states/{state}/generate", tags: ["Companions"], summary: "Generate candidate clips for one companion state", middleware: [requireAuth] as const, request: { params: generateOneParams, body: { content: { "application/json": { schema: generateOneBody } } } }, responses: { 202: { content: { "application/json": { schema: runResponse } }, description: "Clip run started." }, ...errorResponses({ 400: "Invalid count or motion", 403: "Only an allowed editor can make clips", 404: "No household companion", 409: "Approve the character sheet, choose a Stack-made rest picture, or wait for the active clip run", 422: "The clip prompt cannot be used", 503: "Video model is not ready" }), 409: startFailure409 } });
companionsRoutes.openapi(generateOneRoute, async (c) => { const p = c.req.valid("param"), actor = c.get("person"), denied = statesAccess(actor, p.id); if (denied) return c.json({ error: denied.error }, denied.status); if (!mayEdit(actor, p.id)) return c.json({ error: "Only the author or an admin can edit this companion." }, 403); try { const job = await startStateTakes({ actor, companionId: p.id, states: [p.state], count: c.req.valid("json").count, motion: c.req.valid("json").motion }); return c.json({ job: driven(c.get("person"), p.id, job) }, 202); } catch (error) { const status = (error as { status?: number }).status ?? 503, rawCode = (error as { code?: string }).code, code = rawCode === "no_original" || rawCode === "needs_keyframe" ? rawCode : undefined, message = error instanceof Error ? error.message : "The clip run could not start. Check the video engine and try again."; if (code) return c.json({ error: message, code, ...((error as { missing?: string[] }).missing ? { missing_keyframes: (error as { missing?: string[] }).missing } : {}) }, 409); return c.json({ error: message }, status as 403 | 409 | 422 | 503); } });

const generateAllRoute = createRoute({ method: "post", path: "/{id}/states/generate", tags: ["Companions"], summary: "Generate candidate clips for selected companion states", middleware: [requireAuth] as const, request: { params: lookIdParam, body: { content: { "application/json": { schema: generateAllBody } } } }, responses: { 202: { content: { "application/json": { schema: runResponse } }, description: "Clip queue started." }, ...errorResponses({ 400: "A state is not in the creator vocabulary", 403: "Only an allowed editor can make clips", 404: "No household companion", 409: "Choose a Stack-made rest picture, approve the character sheet, or wait for the active clip run", 422: "A clip prompt cannot be used", 503: "Video model is not ready" }), 409: startFailure409 } });
companionsRoutes.openapi(generateAllRoute, async (c) => { const { id } = c.req.valid("param"), actor = c.get("person"), denied = statesAccess(actor, id); if (denied) return c.json({ error: denied.error }, denied.status); if (!mayEdit(actor, id)) return c.json({ error: "Only the author or an admin can edit this companion." }, 403); const body = c.req.valid("json"), stored = readStates(id), creators = creatorStateRows(), creatorIds = new Set(creators.map((row) => row.id)); if (body.states?.some((state) => !creatorIds.has(state))) return c.json({ error: "Choose only listed companion states." }, 400); const selected = body.states?.length ? body.states : creators.filter((row) => row.required && !stored.states[row.id]?.approved).map((row) => row.id); if (!selected.length) return c.json({ error: "Every selected state already has an approved clip." }, 409); try { const job = await startStateTakes({ actor, companionId: id, states: selected, count: body.count }); return c.json({ job: driven(c.get("person"), id, job) }, 202); } catch (error) { const status = (error as { status?: number }).status ?? 503, rawCode = (error as { code?: string }).code, code = rawCode === "no_original" || rawCode === "needs_keyframe" ? rawCode : undefined, message = error instanceof Error ? error.message : "The clip queue could not start. Check the video engine and try again."; if (code) return c.json({ error: message, code, ...((error as { missing?: string[] }).missing ? { missing_keyframes: (error as { missing?: string[] }).missing } : {}) }, 409); return c.json({ error: message }, status as 403 | 409 | 422 | 503); } });

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
companionsRoutes.openapi(approveStateRoute, (c) => { const p = c.req.valid("param"), denied = statesAccess(c.get("person"), p.id); if (denied) return c.json({ error: denied.error }, denied.status); ensurePublishedRecord(p.id); try { const state = p.state!, body = c.req.valid("json"), all = readStates(p.id), row = all.states[state], take = row?.takes.find((t) => t.id === body.take_id); if (!take?.report) return c.json({ error: "That clip is not finished yet. Wait for finishing to complete." }, 400); if (!take.report.ok) return c.json({ error: "Needs another try" }, 409); if (state !== "idle" && !all.states.idle?.approved) return c.json({ error: "Approve the idle clip first." }, 409); if (state === "idle" && readLook(p.id).sheet?.state !== "approved") return c.json({ error: "Approve the character sheet first." }, 409); row!.approved = take.id; row!.approved_by = c.get("person").displayName; row!.approved_at = new Date().toISOString(); saveStates(p.id, all); return c.json({ approved: take.id }, 200); } catch (e) { return c.json({ error: e instanceof Error ? e.message : "The clip could not be approved." }, 400); } });
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
  const actor = c.get("person"), band = speakerAgeBand(actor, new Date()); if (band === "child" && !isOwnerOrAdmin(actor)) return c.json({ error: "Only teens and adults can make a companion." }, 403);
  const result = createHouseholdCompanion(normalizedFields(c.req.valid("json")) as never, { display_name: actor.displayName, person_id: actor.id }, band === "teen" ? "teen" : "adult");
  if (!result.ok) return c.json({ error: result.error, ...(result.fields ? { fields: result.fields } : {}) }, 400);
  return c.json({ id: result.value.id }, 201);
});

const draftRoute = createRoute({ method: "post", path: "/draft", tags: ["Companions"], summary: "Create a name-only companion draft", middleware: [requireAuth] as const, request: { body: { content: { "application/json": { schema: z.object({ name: z.string().trim().min(1).max(40) }) } } } }, responses: { 200: { content: { "application/json": { schema: z.object({ id: z.string() }) } }, description: "Existing draft returned." }, 201: { content: { "application/json": { schema: z.object({ id: z.string() }) } }, description: "Draft created." }, ...errorResponses({ 400: "Invalid name", 403: "Only teens and adults can make a companion" }) } });
companionsRoutes.openapi(draftRoute, (c) => { const actor = c.get("person"), band = speakerAgeBand(actor, new Date()); if (band === "child" && !isOwnerOrAdmin(actor)) return c.json({ error: "Only teens and adults can make a companion." }, 403); const { name } = c.req.valid("json"); for (const existing of listHouseholdCompanionIds()) { const found = getHouseholdCompanion(existing), author = householdCompanionAuthorId(existing); if (author === actor.id && found?.companion?.display_name.toLowerCase() === name.toLowerCase() && found.companion.status === "draft" && readLook(existing).versions.length === 0) return c.json({ id: existing }, 200); } const made = createHouseholdCompanion({ display_name: name, formality: "neutral", complexity: "standard", engagement: "balanced", filler_density: "light", status: "draft" } as never, { display_name: actor.displayName, person_id: actor.id }, band === "teen" ? "teen" : "adult"); if (!made.ok) return c.json({ error: made.error }, 400); const draftFolder = householdCompanionFolder(made.value.id); if (draftFolder) writeFileSync(join(draftFolder, ".name-only-draft"), ""); return c.json({ id: made.value.id }, 201); });

const copyRoute = createRoute({ method: "post", path: "/{id}/copy", tags: ["Companions"], summary: "Copy a companion into a household draft", middleware: [requireAuth] as const,
  request: { params: idPath }, responses: { 201: { content: { "application/json": { schema: z.object({ id: z.string() }) } }, description: "Draft copied." }, ...errorResponses({ 401: "Not signed in", 403: "Only adults can make a companion.", 404: "No such companion" }) } });
companionsRoutes.openapi(copyRoute, (c) => {
  const actor = c.get("person"); if (speakerAgeBand(actor, new Date()) === "child" && !isOwnerOrAdmin(actor)) return c.json({ error: "Only teens and adults can make a companion." }, 403);
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
  return c.json({ id, ...manifest.companion, humor: manifest.companion.social?.humor ?? "medium", warmth: manifest.companion.social?.warmth ?? "medium", initiative: manifest.companion.social?.initiative ?? "medium", clock_style: manifest.companion.clock_style ?? "plain", hedging: manifest.companion.hedging ?? "medium", name: manifest.companion.display_name, audience: manifest.companion.audience ?? "adult", status: manifest.companion.status ?? "ready", review: manifest.companion.review ?? null, can_edit: true, can_copy: speakerAgeBand(actor, new Date()) === "adult" || isOwnerOrAdmin(actor), can_set_audience: isOwnerOrAdmin(actor), look: { versions: look.versions.length, rest: look.rest, sheet_state: look.sheet?.state ?? "empty" }, states: { approved: Object.values(readStates(id).states).filter((s) => s?.approved).length, total: creatorStateRows().length } }, 200);
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
  const currentAudience = getHouseholdCompanion(id)?.companion?.audience ?? "adult", bandRank = { adult: 0, teen: 1, all: 2 } as const;
  if (bandRank[body.audience] > bandRank[currentAudience]) {
    const look = readLook(id), restStyle = look.versions.find((version) => version.id === look.rest)?.style;
    const cap = capOfStyle(restStyle ?? "") ?? "adult", capRank = { adult: 0, teen: 1, all: 2 } as const;
    if (restStyle !== undefined && bandRank[body.audience] > capRank[cap]) return c.json({ error: cap === "teen" ? "This look can reach teens. Pick a cartoon look to make it for everyone." : "This look is for adults. Pick a cartoon look to make it for everyone." }, 400);
  }
  if (body.audience === "all" && body.confirmed !== true) return c.json({ error: "Review the all ages checklist and confirm before making this companion available to everyone." }, 400);
  const uses = liveUseCounts(id, body.audience); if (uses.robots) return c.json({ error: inUseSentence("robots", uses.robots) }, 409); if (uses.people) return c.json({ error: inUseSentence("people", uses.people) }, 409);
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
