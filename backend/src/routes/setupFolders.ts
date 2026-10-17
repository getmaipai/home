// WIZ-STORAGE-02: the setup wizard's folder picker endpoints. Mounted by
// routes/setup.ts BEFORE its `/{step}` catch-all. Access: before an owner
// exists, loopback only (setupLocalOnly on the parent router, SETUP-LOCAL-ONLY-01);
// after, the signed-in owner; refused once setup is complete.
import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { apiRouter } from "@/lib/openapi";
import { db } from "@/db";
import { people } from "@/db/schema";
import { resolveHumanSession } from "@/middleware/auth";
import { getSetupState, getStorageChoice } from "@/lib/setupState";
import { createFolder, listFolder, validateProposedPath } from "@/lib/folderBrowse";
import { checkPlacement } from "@/lib/placement";
import { classDir } from "@/lib/paths";
import { chooseNativeFolder } from "@/lib/nativeFolderDialog";
import { aiRequiredBytes, defaultDiskPaths, planVolumes, recordedLevel, shippedPlanForLevel, type DiskIo, type DiskPaths } from "@/lib/diskPlan";
import { diskVerdict, freeGb, needGb, LEVEL_WORD } from "../../../shared/diskPlanMath";

/** One plain refusal per folder, chosen or default, whose drive is too small for what will land on it: the disk plan for this
 * computer's plan level (Home's files, the AI's models and engines, Home's records), counted per drive, so two folders on one
 * drive are asked for the sum. The same numbers as the installer and the plan step. */
export function spaceRows(layout: { models?: string; records?: string }, split: boolean, io: DiskIo = {}) {
  const rows: Array<{ class: string; kind: "refusal"; id: string; text: string; fix: string }> = [];
  const plan = shippedPlanForLevel(recordedLevel());
  const paths: DiskPaths = { ...defaultDiskPaths(), data: layout.records ?? classDir("records"), ai: layout.models ?? classDir("models") };
  const word = LEVEL_WORD[plan.level];
  for (const volume of planVolumes(paths, io, { aiOnAnotherComputer: split })) {
    // The AI on another computer is checked there, not here.
    const needs = split ? volume.needs.filter((need) => need !== "ai") : volume.needs;
    if (!needs.length) continue;
    const verdict = diskVerdict(plan, plan.default_selected, [{ ...volume, needs }]);
    if (verdict.state !== "red" || verdict.freeBytes === null) continue;
    const classes = [...new Set(needs.map((need) => (need === "ai" ? "models" : "records")))];
    for (const id of classes) {
      rows.push({ class: id, kind: "refusal", id: `space-wizard:${id}`, text: `The ${word} setup needs about ${needGb(verdict.requiredBytes)} GB free on this drive, and it has ${freeGb(verdict.freeBytes)} GB. Choose a folder on a drive with more room.`, fix: "Choose a folder on a drive with more free space." });
    }
  }
  return rows;
}

export const setupFolderRoutes = apiRouter();

const ErrorBody = z.object({ error: z.string() });
const errs = {
  400: { content: { "application/json": { schema: ErrorBody } }, description: "The request cannot be used as sent." },
  401: { content: { "application/json": { schema: ErrorBody } }, description: "Owner sign-in required." },
  403: { content: { "application/json": { schema: ErrorBody } }, description: "Not allowed here." },
  404: { content: { "application/json": { schema: ErrorBody } }, description: "The folder is gone." },
  409: { content: { "application/json": { schema: ErrorBody } }, description: "Setup is finished, or the name is taken." },
} as const;

/** Returns a refusal response, or null when the caller may use the picker. */
export function accessRefusal(c: Context): Response | null {
  if (getSetupState().completed_at) {
    return c.json({ error: "Setup is finished, so this screen is closed. Change where Home keeps its files in Settings, under Storage." }, 409);
  }
  const anyone = db.select({ id: people.id }).from(people).limit(1).get();
  if (!anyone) return null; // loopback already enforced by setupLocalOnly
  const token = getCookie(c, "session");
  const person = token ? resolveHumanSession(token) : null;
  if (!person) return c.json({ error: "Sign in as the owner to choose folders. Open Home and sign in with the owner account." }, 401);
  if (person.role !== "owner") return c.json({ error: "Only the owner can choose folders. Sign in with the owner account." }, 403);
  return null;
}

const FolderRowSchema = z.object({ name: z.string(), path: z.string(), writable: z.boolean() });

const listRoute = createRoute({
  method: "get", path: "/folders", tags: ["Setup"], summary: "List the subfolders of a folder on this computer",
  request: { query: z.object({ path: z.string().optional() }) },
  responses: {
    200: { content: { "application/json": { schema: z.object({
      path: z.string(), parent: z.string().nullable(), freeBytes: z.number().nullable(), writable: z.boolean(), folders: z.array(FolderRowSchema),
    }) } }, description: "Subfolders only, never file names." },
    ...errs,
  },
});
setupFolderRoutes.openapi(listRoute, (c) => {
  const refusal = accessRefusal(c);
  if (refusal) return refusal as never;
  const result = listFolder(c.req.valid("query").path);
  return result.ok ? c.json(result.value, 200) : (c.json({ error: result.error }, result.status) as never);
});

const createRouteDef = createRoute({
  method: "post", path: "/folders", tags: ["Setup"], summary: "Create one new folder inside a listed folder",
  request: { body: { content: { "application/json": { schema: z.object({ parent: z.string(), name: z.string() }).strict() } } } },
  responses: { 200: { content: { "application/json": { schema: FolderRowSchema } }, description: "The new folder." }, ...errs },
});
setupFolderRoutes.openapi(createRouteDef, (c) => {
  const refusal = accessRefusal(c);
  if (refusal) return refusal as never;
  const { parent, name } = c.req.valid("json");
  const result = createFolder(parent, name);
  return result.ok ? c.json(result.value, 200) : (c.json({ error: result.error }, result.status) as never);
});

const nativeRoute = createRoute({
  method: "post", path: "/folders/native", tags: ["Setup"], summary: "Open this computer's own folder window and return the folder chosen",
  request: { body: { content: { "application/json": { schema: z.object({ folder: z.enum(["records", "models"]) }).strict() } } } },
  responses: {
    200: { content: { "application/json": { schema: z.discriminatedUnion("status", [
      z.object({ status: z.literal("chosen"), path: z.string() }),
      z.object({ status: z.literal("cancelled") }),
      z.object({ status: z.literal("unavailable") }),
      z.object({ status: z.literal("refused"), error: z.string() }),
    ]) } }, description: "The folder, or why there is none. unavailable means use the in-page picker." },
    ...errs,
  },
});
setupFolderRoutes.openapi(nativeRoute, async (c) => {
  const refusal = accessRefusal(c);
  if (refusal) return refusal as never;
  const title = c.req.valid("json").folder === "models" ? "Choose the AI models folder" : "Choose Home's data folder";
  const picked = await chooseNativeFolder(title);
  if (picked.status !== "chosen") return c.json(picked, 200);
  const listing = listFolder(picked.path);
  if (!listing.ok) return c.json({ status: "refused" as const, error: listing.error }, 200);
  if (!listing.value.writable) return c.json({ status: "refused" as const, error: "Home can't save files in that folder. Choose a folder you own, or make a new one." }, 200);
  return c.json({ status: "chosen" as const, path: listing.value.path }, 200);
});

const PlacementRowSchema = z.object({ class: z.string(), kind: z.enum(["refusal", "warning", "unknown"]), id: z.string(), text: z.string(), fix: z.string() });
const checkRoute = createRoute({
  method: "post", path: "/storage/check", tags: ["Setup"], summary: "Check a proposed storage layout",
  request: { body: { content: { "application/json": { schema: z.object({ models: z.string().optional(), records: z.string().optional(), split: z.boolean().optional() }).strict() } } } },
  responses: { 200: { content: { "application/json": { schema: z.object({ rows: z.array(PlacementRowSchema) }) } }, description: "checkPlacement's rows, unchanged." }, ...errs },
});
setupFolderRoutes.openapi(checkRoute, async (c) => {
  const refusal = accessRefusal(c);
  if (refusal) return refusal as never;
  const { models, records, split } = c.req.valid("json");
  const layout = { ...(models ? { models } : {}), ...(records ? { records } : {}) };
  for (const path of Object.values(layout)) {
    const problem = validateProposedPath(path);
    if (problem) return c.json({ error: problem }, 400) as never;
  }
  // A class left out keeps its default folder and is not checked here.
  const space = spaceRows(layout, split === true);
  const placed = Object.keys(layout).length ? await checkPlacement(layout) : [];
  // The wizard's own space row says how much is needed, so the generic one is dropped.
  const rows = [...space, ...placed.filter((row) => !(row.id.startsWith("space:") && space.some((s) => s.class === row.class)))];
  return c.json({ rows }, 200);
});

const defaultsRoute = createRoute({
  method: "get", path: "/storage/defaults", tags: ["Setup"], summary: "The folders Home uses when none is chosen",
  responses: { 200: { content: { "application/json": { schema: z.object({ records: z.string(), models: z.string(), models_need_bytes: z.number().int(), chosen: z.object({ records: z.string().optional(), models: z.string().optional() }) }) } }, description: "Absolute paths, and the folders already chosen on this setup (empty when none)." }, ...errs },
});
setupFolderRoutes.openapi(defaultsRoute, (c) => {
  const refusal = accessRefusal(c);
  if (refusal) return refusal as never;
  return c.json({ records: classDir("records"), models: classDir("models"), models_need_bytes: aiRequiredBytes(shippedPlanForLevel(recordedLevel())), chosen: getStorageChoice() ?? {} }, 200);
});
