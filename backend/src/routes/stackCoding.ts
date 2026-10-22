// CODE-STACK-01 H1: Settings, Coding, "What coding runs on". Owner and admin only: the engine, the coding model and the
// Splash draft with their state and disk size, and an Install or Remove for each piece that allows one. The words of a
// refusal are the Stack's or lib/stackCodingPieces.ts's, already plain sentences with the next step; they pass through.
// Removing a piece while Coding is on is refused here (turn Coding off first). Phase 1 installs no client (the plan note).
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireRole } from "@/middleware/auth";
import { CodingPieceError, installCodingPiece, listCodingPieces, removeCodingPiece } from "@/lib/stackCodingPieces";

export const stackCodingRoutes = apiRouter();

const PieceId = z.enum(["engine", "model", "draft", "heavy_model", "heavy_draft"]);
const PieceSchema = z.object({
  id: PieceId, name: z.string().describe("What the Stack runs or stores: splash, llama-server or the model id."), label: z.string(), summary: z.string(),
  state: z.enum(["installed", "installing", "notInstalled", "failed", "unsupported"]),
  size_bytes: z.number().nullable().describe("Bytes on disk when installed, the pinned download size otherwise, null when the Stack states none."),
  percent: z.number().nullable(), failure: z.string().nullable(),
  can_install: z.boolean(), install_block: z.string().nullable(), can_remove: z.boolean(), remove_block: z.string().nullable(),
});
const ListSchema = z.object({
  stack: z.enum(["ok", "unreachable"]), message: z.string().nullable(), coding_enabled: z.boolean(),
  engine: z.enum(["splash", "llama-server"]).nullable().describe("The engine the Stack chose for coding on this computer."),
  missing: z.string().nullable().describe("The first piece coding cannot run without, as a sentence; null when coding has what it needs. Coding keys show suspended while this is set."),
  pieces: z.array(PieceSchema),
});
const params = z.object({ id: PieceId });
const refusals = errorResponses({ 401: "Not signed in", 403: "Admins only", 404: "No such piece", 409: "It cannot be installed or removed right now (the message says why)", 503: "The engine is not answering" });

function failure(c: { json: (body: unknown, status: never) => Response }, error: unknown): Response {
  if (error instanceof CodingPieceError) return c.json({ error: error.message, code: error.code }, error.status as never);
  throw error;
}

const listRoute = createRoute({
  method: "get", path: "/pieces", tags: ["Coding"], summary: "The pieces local coding runs on, with state and disk size", middleware: [requireRole("owner", "admin")] as const,
  responses: { 200: { content: { "application/json": { schema: ListSchema } }, description: "The engine, the coding model and the Splash draft. With the engine unreachable the list is empty and `message` says what to do." }, ...refusals },
});
stackCodingRoutes.openapi(listRoute, async (c) => c.json(await listCodingPieces(), 200));

const installRoute = createRoute({
  method: "post", path: "/pieces/{id}/install", tags: ["Coding"], summary: "Install one coding piece (progress on the install strip)", middleware: [requireRole("owner", "admin")] as const,
  request: { params },
  responses: { 202: { content: { "application/json": { schema: z.object({ job: z.string().nullable(), piece: PieceId }) } }, description: "Started." }, ...refusals },
});
stackCodingRoutes.openapi(installRoute, async (c) => {
  try { return c.json(await installCodingPiece(c.req.valid("param").id), 202); }
  catch (error) { return failure(c, error) as never; }
});

const removeRoute = createRoute({
  method: "delete", path: "/pieces/{id}", tags: ["Coding"], summary: "Remove one coding piece and free its space", middleware: [requireRole("owner", "admin")] as const,
  request: { params },
  responses: { 200: { content: { "application/json": { schema: z.object({ piece: PieceId, removed: z.literal(true) }) } }, description: "Removed." }, ...refusals },
});
stackCodingRoutes.openapi(removeRoute, async (c) => {
  try { return c.json(await removeCodingPiece(c.req.valid("param").id), 200); }
  catch (error) { return failure(c, error) as never; }
});

import { codingModeReadiness } from "@/lib/codingMode";
import { getHouseholdSettingValue } from "@/lib/settings";
import { getStackClient } from "@/lib/stackEngine";
const modeRoute = createRoute({ method:"get", path:"/mode", tags:["Coding"], summary:"Coding mode readiness and current Stack state", middleware:[requireRole("owner","admin")] as const,
  responses:{ 200:{ content:{"application/json":{schema:z.object({readiness:z.unknown(),mode:z.enum(["normal","coding"]).nullable(),state:z.enum(["stable","waiting","switching","failed"]).nullable(),reason:z.string().nullable()})}},description:"Readiness and mode state."}, ...refusals } });
stackCodingRoutes.openapi(modeRoute, async c => {
  const readiness = await codingModeReadiness();
  try { const mode = await getStackClient().getCodingMode(); return c.json({ readiness, mode:mode.mode, state:mode.state, reason:mode.reason },200); }
  catch { return c.json({ readiness, mode:null, state:null, reason:"Home could not reach the AI engine." },200); }
});

const selfTestRoute = createRoute({ method:"post", path:"/mode/self-test", tags:["Coding"], summary:"Ask the AI engine to test the coding model", middleware:[requireRole("owner","admin")] as const,
  responses:{ 202:{ content:{"application/json":{schema:z.object({accepted:z.literal(true)})}},description:"The Stack accepted the test."}, 409:{content:{"application/json":{schema:z.object({error:z.string()})}},description:"The Stack refused the test in plain words."}, 503:{content:{"application/json":{schema:z.object({error:z.string()})}},description:"The AI engine is not answering."}, ...errorResponses({401:"Not signed in",403:"Admins only"}) } });
stackCodingRoutes.openapi(selfTestRoute, async c => {
  try {
    await getStackClient().runCodingModeSelfTest();
    return c.json({ accepted:true as const },202);
  } catch (error) {
    if (error instanceof Error && "status" in error && (error as {status?:number}).status === 409) return c.json({ error:error.message },409);
    return c.json({ error:"Home could not reach the AI engine." },503);
  }
});
