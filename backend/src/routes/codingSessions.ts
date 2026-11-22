// CODE-AGENT-01 (slice two): the Code app's session routes, /api/code/sessions. Thin: every rule (access, admission copy, tier clamp, queue, brake, redaction)
// lives in lib/codingSessions.ts, lib/codingTurns.ts, lib/codingBridge.ts and lib/codingShare.ts. Every route needs a signed-in person and reads only that
// person's own sessions; a refusal says what went wrong and what to do (the household's admission copy). No route returns a token or another person's record.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { CodingSession } from "@maipai/spec/gen/ts/coding-session.js";
import { CodingEvent } from "@maipai/spec/gen/ts/coding-event.js";
import {
  CodingSessionError, createCodingSession, offeredCodingTiers, CreateCodingSessionInput, getCodingSession, listCodingSessions, setSessionMode, setSessionTier, codingSessionRefusal,
  CodingSessionListed, renameSession, setSessionPinned, setSessionArchived, markSessionOpened,
} from "@/lib/codingSessions";
import { warmCodingSession, cancelQueuedMessage, deleteCodingSession, offersUseStandard, queuedMessageIds, sendMessage, retryLastTurn, stopCodingSession, turnQueueLine, undoToCheckpoint, useStandardForThisMessage, activeTurnOf } from "@/lib/codingTurns";
import { answerHostRequest, pendingRequestsFor } from "@/lib/codingBridge";
import { listCodingMessages } from "@/lib/codingTranscript";
import { listCodingEvents } from "@/lib/codingEvents";
import { sessionContext } from "@/lib/codingContext";
import { uploadToWorkspace } from "@/lib/codingUpload";
import { sessionChanges, sessionFile, sessionTree } from "@/lib/codingWorkspaceView";
import { pushCodingSession } from "@/lib/codingShare";
import { createCodingPullRequest } from "@/lib/codingPullRequest";
import { codingConcern } from "@/lib/roleHealth";
import { codingNotice } from "@/lib/failureCopy";
import type { PersonRow } from "@/types";

export const codingSessionsRoutes = apiRouter();

const STATUS = { not_allowed: 403, not_found: 404, bad_input: 400, busy: 409 } as const;
const failure = (e: unknown): { status: 400 | 403 | 404 | 409; error: string } | null => (e instanceof CodingSessionError ? { status: STATUS[e.code], error: e.message } : null);
const errors = { 400: "The request is not valid", 401: "Not signed in", 403: "Not allowed", 404: "Not found", 409: "The session is busy" };
const Tier = z.enum(["standard", "boost", "max"]);
const sessionIdParam = z.object({ id: z.string().regex(/^csess-[a-z0-9]{6,}$/) });

/** One session plus what it waits for: the queue line, the held requests and the message queue (design 3.3 and 3.4). */
async function view(person: PersonRow, id: string) {
  const session = getCodingSession(person, id);
  if (!session) return null;
  const turn = activeTurnOf(id);
  const concern = await codingConcern();
  return { session, coding_notice: concern.cause ? codingNotice(concern.cause) : null, waiting: turn ? { turn_id: turn, line: turnQueueLine(person, turn), offers_standard: offersUseStandard(turn) } : null, requests: pendingRequestsFor(person.id, id), queued_messages: queuedMessageIds(person, id) };
}
const ViewSchema = z.object({
  session: CodingSessionListed,
  /** CODE-NOTIFY-01: the one composer line while the coding engine cannot take a message (null when it can). */
  coding_notice: z.string().nullable(),
  waiting: z.object({ turn_id: z.string(), line: z.string().nullable(), offers_standard: z.boolean() }).nullable(),
  requests: z.array(z.object({ request_id: z.string(), effect: z.string() })),
  queued_messages: z.array(z.string()),
});

const createR = createRoute({
  method: "post", path: "/", tags: ["Code"], summary: "Start a Code session (the tier is the person's stored choice)", middleware: [requireAuth] as const,
  request: { body: { content: { "application/json": { schema: CreateCodingSessionInput } } } },
  responses: { 201: { content: { "application/json": { schema: CodingSession } }, description: "The new session." }, ...errorResponses(errors) },
});
codingSessionsRoutes.openapi(createR, (c) => {
  try { return c.json(createCodingSession(c.get("person"), c.req.valid("json")), 201); } catch (e) { const f = failure(e); if (f) return c.json({ error: f.error }, f.status); throw e; }
});

const listR = createRoute({
  method: "get", path: "/", tags: ["Code"], summary: "My Code sessions, newest activity first", middleware: [requireAuth] as const,
  responses: { 200: { content: { "application/json": { schema: z.array(CodingSessionListed) } }, description: "Only the signed-in person's sessions, with pinned_at, archived_at and unread (CODE-UX-01)." }, ...errorResponses({ 401: "Not signed in", 403: "Coding is not available to you" }) },
});
codingSessionsRoutes.openapi(listR, (c) => {
  const person = c.get("person"); const refusal = codingSessionRefusal(person);
  if (refusal) return c.json({ error: refusal }, 403);
  return c.json(listCodingSessions(person), 200);
});

const tiersR = createRoute({
  method: "get", path: "/tiers", tags: ["Code"], summary: "The tiers this person may run for coding, and the one a new session starts on", middleware: [requireAuth] as const,
  responses: { 200: { content: { "application/json": { schema: z.object({ tiers: z.array(Tier), last: Tier }) } }, description: "Only tiers the person may run now (a tier they cannot use is absent)." }, ...errorResponses({ 401: "Not signed in", 403: "Coding is not available to this person" }) },
});
codingSessionsRoutes.openapi(tiersR, (c) => {
  const person = c.get("person"); const refusal = codingSessionRefusal(person);
  if (refusal) return c.json({ error: refusal }, 403);
  return c.json(offeredCodingTiers(person), 200);
});

const getR = createRoute({
  method: "get", path: "/{id}", tags: ["Code"], summary: "One session with its queue line, held requests and message queue", middleware: [requireAuth] as const,
  request: { params: sessionIdParam },
  responses: { 200: { content: { "application/json": { schema: ViewSchema } }, description: "The session." }, ...errorResponses(errors) },
});
codingSessionsRoutes.openapi(getR, async (c) => {
  const refusal = codingSessionRefusal(c.get("person")); if (refusal) return c.json({ error: refusal }, 403);
  const v = await view(c.get("person"), c.req.valid("param").id);
  return v ? c.json(v, 200) : c.json({ error: "That session was not found. It may have been deleted." }, 404);
});

const modeR = createRoute({
  method: "put", path: "/{id}/mode", tags: ["Code"], summary: "Switch the session's permission mode; it applies at the next message", middleware: [requireAuth] as const,
  request: { params: sessionIdParam, body: { content: { "application/json": { schema: z.object({ mode: z.enum(["plan", "ask", "auto_edit"]) }).strict() } } } },
  responses: { 200: { content: { "application/json": { schema: CodingSession } }, description: "The session with its new mode." }, ...errorResponses(errors) },
});
codingSessionsRoutes.openapi(modeR, (c) => {
  try { return c.json(setSessionMode(c.get("person"), c.req.valid("param").id, c.req.valid("json").mode), 200); } catch (e) { const f = failure(e); if (f) return c.json({ error: f.error }, f.status); throw e; }
});

const tierR = createRoute({
  method: "put", path: "/{id}/tier", tags: ["Code"], summary: "Switch the session's stored tier; it applies at the next message", middleware: [requireAuth] as const,
  request: { params: sessionIdParam, body: { content: { "application/json": { schema: z.object({ tier: Tier }).strict() } } } },
  responses: { 200: { content: { "application/json": { schema: CodingSession } }, description: "The session with its new tier." }, ...errorResponses(errors) },
});
codingSessionsRoutes.openapi(tierR, (c) => {
  try { return c.json(setSessionTier(c.get("person"), c.req.valid("param").id, c.req.valid("json").tier), 200); } catch (e) { const f = failure(e); if (f) return c.json({ error: f.error }, f.status); throw e; }
});

/** CODE-UX-01: the owner manages the list from a row's menu (rename, pin, archive, open). Delete is below. */
const listed = (description: string) => ({ 200: { content: { "application/json": { schema: CodingSessionListed } }, description }, ...errorResponses(errors) });
const renameR = createRoute({
  method: "put", path: "/{id}/title", tags: ["Code"], summary: "Rename a session", middleware: [requireAuth] as const,
  request: { params: sessionIdParam, body: { content: { "application/json": { schema: z.object({ title: z.string() }).strict() } } } },
  responses: listed("The session with its new name."),
});
codingSessionsRoutes.openapi(renameR, (c) => {
  try { return c.json(renameSession(c.get("person"), c.req.valid("param").id, c.req.valid("json").title), 200); } catch (e) { const f = failure(e); if (f) return c.json({ error: f.error }, f.status); throw e; }
});
const pinR = createRoute({
  method: "put", path: "/{id}/pin", tags: ["Code"], summary: "Pin or unpin a session; pinned sessions lead the list", middleware: [requireAuth] as const,
  request: { params: sessionIdParam, body: { content: { "application/json": { schema: z.object({ pinned: z.boolean() }).strict() } } } },
  responses: listed("The session with its pin state."),
});
codingSessionsRoutes.openapi(pinR, (c) => {
  try { return c.json(setSessionPinned(c.get("person"), c.req.valid("param").id, c.req.valid("json").pinned), 200); } catch (e) { const f = failure(e); if (f) return c.json({ error: f.error }, f.status); throw e; }
});
const archiveR = createRoute({
  method: "put", path: "/{id}/archive", tags: ["Code"], summary: "Archive or unarchive a session (a working session is refused)", middleware: [requireAuth] as const,
  request: { params: sessionIdParam, body: { content: { "application/json": { schema: z.object({ archived: z.boolean() }).strict() } } } },
  responses: listed("The session with its archive state."),
});
codingSessionsRoutes.openapi(archiveR, (c) => {
  try { return c.json(setSessionArchived(c.get("person"), c.req.valid("param").id, c.req.valid("json").archived), 200); } catch (e) { const f = failure(e); if (f) return c.json({ error: f.error }, f.status); throw e; }
});
const openedR = createRoute({
  method: "post", path: "/{id}/opened", tags: ["Code"], summary: "The owner has seen the session as it is now (clears its unread dot)", middleware: [requireAuth] as const,
  request: { params: sessionIdParam },
  responses: listed("The session, no longer unread."),
});
codingSessionsRoutes.openapi(openedR, (c) => {
  try { return c.json(markSessionOpened(c.get("person"), c.req.valid("param").id), 200); } catch (e) { const f = failure(e); if (f) return c.json({ error: f.error }, f.status); throw e; }
});

const retryR = createRoute({
  method: "post", path: "/{id}/retry", tags: ["Code"], summary: "Run the last message again after a turn that stopped on an error", middleware: [requireAuth] as const,
  request: { params: sessionIdParam },
  responses: { 202: { content: { "application/json": { schema: z.object({ turn_id: z.string(), tier: Tier }) } }, description: "The turn started or queued." }, ...errorResponses(errors) },
});
codingSessionsRoutes.openapi(retryR, (c) => {
  try { return c.json(retryLastTurn(c.get("person"), c.req.valid("param").id), 202); } catch (e) { const f = failure(e); if (f) return c.json({ error: f.error }, f.status); throw e; }
});

const messageR = createRoute({
  method: "post", path: "/{id}/messages", tags: ["Code"], summary: "Send a message: it starts a turn, or joins the message queue while the agent works", middleware: [requireAuth] as const,
  request: { params: sessionIdParam, body: { content: { "application/json": { schema: z.object({ text: z.string().min(1).max(200_000) }).strict() } } } },
  responses: {
    202: { content: { "application/json": { schema: z.object({ turn_id: z.string().optional(), tier: Tier.optional(), queued_message_id: z.string().optional(), position: z.number().optional() }) } }, description: "A turn started or queued, or the message waits in the session's queue." },
    ...errorResponses(errors),
  },
});
codingSessionsRoutes.openapi(messageR, (c) => {
  try { return c.json(sendMessage(c.get("person"), c.req.valid("param").id, c.req.valid("json").text), 202); } catch (e) { const f = failure(e); if (f) return c.json({ error: f.error }, f.status); throw e; }
});

const transcriptR = createRoute({
  method: "get", path: "/{id}/messages", tags: ["Code"], summary: "The transcript (credentials already removed)", middleware: [requireAuth] as const,
  request: { params: sessionIdParam },
  responses: { 200: { content: { "application/json": { schema: z.array(z.object({ id: z.string(), session_id: z.string(), seq: z.number(), role: z.enum(["user", "agent", "system"]), parts: z.array(z.record(z.string(), z.any())), created_at: z.string() })) } }, description: "Oldest first." }, ...errorResponses(errors) },
});
codingSessionsRoutes.openapi(transcriptR, (c) => {
  const person = c.get("person"); const id = c.req.valid("param").id;
  const refusal = codingSessionRefusal(person); if (refusal) return c.json({ error: refusal }, 403);
  if (!getCodingSession(person, id)) return c.json({ error: "That session was not found. It may have been deleted." }, 404);
  return c.json(listCodingMessages(person.id, id), 200);
});

const okBody = z.object({ ok: z.literal(true) });
const warmR = createRoute({
  method: "post", path: "/{id}/warm", tags: ["Code"], summary: "Start the session's sandbox in the background so the next message pays no start", middleware: [requireAuth] as const,
  request: { params: sessionIdParam },
  responses: { 202: { content: { "application/json": { schema: okBody } }, description: "Warming has begun (or was not needed); nothing waits on it." }, ...errorResponses(errors) },
});
codingSessionsRoutes.openapi(warmR, (c) => {
  const person = c.get("person"); const id = c.req.valid("param").id;
  const refusal = codingSessionRefusal(person); if (refusal) return c.json({ error: refusal }, 403);
  if (!getCodingSession(person, id)) return c.json({ error: "That session was not found. It may have been deleted." }, 404);
  void warmCodingSession(person, id);
  return c.json({ ok: true as const }, 202);
});

const trailR = createRoute({
  method: "get", path: "/{id}/events", tags: ["Code"], summary: "The person's audit trail for the session", middleware: [requireAuth] as const,
  request: { params: sessionIdParam },
  responses: { 200: { content: { "application/json": { schema: z.array(CodingEvent) } }, description: "Oldest first. Owner only." }, ...errorResponses(errors) },
});
codingSessionsRoutes.openapi(trailR, (c) => {
  const person = c.get("person"); const id = c.req.valid("param").id;
  const refusal = codingSessionRefusal(person); if (refusal) return c.json({ error: refusal }, 403);
  if (!getCodingSession(person, id)) return c.json({ error: "That session was not found. It may have been deleted." }, 404);
  return c.json(listCodingEvents(person.id, id), 200);
});

const changesR = createRoute({
  method: "get", path: "/{id}/changes", tags: ["Code"], summary: "The session's committed changes against its base branch (from a clean copy, hooks off)", middleware: [requireAuth] as const,
  request: { params: sessionIdParam },
  responses: { 200: { content: { "application/json": { schema: z.object({ available: z.boolean(), files: z.array(z.object({ path: z.string(), additions: z.number(), deletions: z.number(), binary: z.boolean() })), diff: z.string(), truncated: z.boolean() }) } }, description: "Empty when the session has no repository." }, ...errorResponses(errors) },
});
codingSessionsRoutes.openapi(changesR, async (c) => {
  try { return c.json(await sessionChanges(c.get("person"), c.req.valid("param").id), 200); } catch (e) { const f = failure(e); if (f) return c.json({ error: f.error }, f.status); throw e; }
});

const treeR = createRoute({
  method: "get", path: "/{id}/files", tags: ["Code"], summary: "The workspace's file tree (links are never followed, .git is left out)", middleware: [requireAuth] as const,
  request: { params: sessionIdParam },
  responses: { 200: { content: { "application/json": { schema: z.object({ entries: z.array(z.object({ path: z.string(), name: z.string(), depth: z.number(), kind: z.enum(["folder", "file"]) })), truncated: z.boolean() }) } }, description: "Folders and files, depth first." }, ...errorResponses(errors) },
});
codingSessionsRoutes.openapi(treeR, async (c) => {
  try { return c.json(await sessionTree(c.get("person"), c.req.valid("param").id), 200); } catch (e) { const f = failure(e); if (f) return c.json({ error: f.error }, f.status); throw e; }
});

const fileR = createRoute({
  method: "get", path: "/{id}/file", tags: ["Code"], summary: "One text file from the workspace (size-capped, binary refused, credentials removed)", middleware: [requireAuth] as const,
  request: { params: sessionIdParam, query: z.object({ path: z.string().min(1).max(500) }) },
  responses: { 200: { content: { "application/json": { schema: z.object({ path: z.string(), content: z.string() }) } }, description: "The file." }, ...errorResponses(errors) },
});
codingSessionsRoutes.openapi(fileR, async (c) => {
  try { return c.json(await sessionFile(c.get("person"), c.req.valid("param").id, c.req.valid("query").path), 200); } catch (e) { const f = failure(e); if (f) return c.json({ error: f.error }, f.status); throw e; }
});

const contextR = createRoute({
  method: "get", path: "/{id}/context", tags: ["Code"], summary: "How full the session's context is (engine numbers, or text size divided by four) and the model's window when the Stack reports one", middleware: [requireAuth] as const,
  request: { params: sessionIdParam },
  responses: { 200: { content: { "application/json": { schema: z.object({ used_tokens: z.number(), window_tokens: z.number().nullable(), source: z.enum(["engine", "estimate"]) }) } }, description: "Token figures." }, ...errorResponses(errors) },
});
codingSessionsRoutes.openapi(contextR, async (c) => {
  try { return c.json(await sessionContext(c.get("person"), c.req.valid("param").id), 200); } catch (e) { const f = failure(e); if (f) return c.json({ error: f.error }, f.status); throw e; }
});

const uploadR = createRoute({
  method: "post", path: "/{id}/upload", tags: ["Code"], summary: "Add one file to the session's workspace (uploads folder; size and type capped, text scanned for credentials, never overwrites)", middleware: [requireAuth] as const,
  request: { params: sessionIdParam, body: { content: { "multipart/form-data": { schema: z.object({ file: z.any() }) } } } },
  responses: { 201: { content: { "application/json": { schema: z.object({ path: z.string(), bytes: z.number() }) } }, description: "Where the file now is, relative to the workspace." }, ...errorResponses(errors) },
});
codingSessionsRoutes.openapi(uploadR, async (c) => {
  try {
    const form = await c.req.formData(); const file = form.get("file");
    if (!(file instanceof File)) return c.json({ error: "No file came with that request. Choose a file and try again." }, 400);
    return c.json(await uploadToWorkspace(c.get("person"), c.req.valid("param").id, file.name, new Uint8Array(await file.arrayBuffer())), 201);
  } catch (e) { const f = failure(e); if (f) return c.json({ error: f.error }, f.status); throw e; }
});

const stopR = createRoute({
  method: "post", path: "/{id}/stop", tags: ["Code"], summary: "Stop: cancels a queued turn, aborts a running one, clears the message queue", middleware: [requireAuth] as const,
  request: { params: sessionIdParam },
  responses: { 200: { content: { "application/json": { schema: okBody } }, description: "Stopped." }, ...errorResponses(errors) },
});
codingSessionsRoutes.openapi(stopR, (c) => stopCodingSession(c.get("person"), c.req.valid("param").id) ? c.json({ ok: true as const }, 200) : c.json({ error: "That session was not found. It may have been deleted." }, 404));

const deleteR = createRoute({
  method: "delete", path: "/{id}", tags: ["Code"], summary: "Delete a session: it moves to the household Trash for 30 days and POST /api/trash/coding_session/{id}/restore brings it back", middleware: [requireAuth] as const,
  request: { params: sessionIdParam },
  responses: { 200: { content: { "application/json": { schema: okBody } }, description: "Deleted." }, ...errorResponses(errors) },
});
codingSessionsRoutes.openapi(deleteR, async (c) => (await deleteCodingSession(c.get("person"), c.req.valid("param").id)) ? c.json({ ok: true as const }, 200) : c.json({ error: "That session was not found. It may have been deleted." }, 404));

const standardR = createRoute({
  method: "post", path: "/{id}/turns/{turn}/use-standard", tags: ["Code"], summary: "Use Standard for this message (the stored tier stays)", middleware: [requireAuth] as const,
  request: { params: z.object({ id: sessionIdParam.shape.id, turn: z.string().regex(/^ctrn-[a-z0-9]+$/) }) },
  responses: { 200: { content: { "application/json": { schema: okBody } }, description: "The turn runs at Standard." }, ...errorResponses(errors) },
});
codingSessionsRoutes.openapi(standardR, (c) => {
  const p = c.req.valid("param");
  const refusal = codingSessionRefusal(c.get("person")); if (refusal) return c.json({ error: refusal }, 403);
  if (!getCodingSession(c.get("person"), p.id)) return c.json({ error: "That session was not found. It may have been deleted." }, 404);
  return useStandardForThisMessage(c.get("person"), p.turn) ? c.json({ ok: true as const }, 200) : c.json({ error: "That message is not waiting for Max any more." }, 409);
});

const answerR = createRoute({
  method: "post", path: "/{id}/requests/{request}", tags: ["Code"], summary: "Answer a held request from the agent (allow or deny)", middleware: [requireAuth] as const,
  request: { params: z.object({ id: sessionIdParam.shape.id, request: z.string().regex(/^creq-[a-z0-9]+$/) }), body: { content: { "application/json": { schema: z.object({ answer: z.enum(["allow", "deny"]) }).strict() } } } },
  responses: { 200: { content: { "application/json": { schema: okBody } }, description: "Answered." }, ...errorResponses(errors) },
});
codingSessionsRoutes.openapi(answerR, (c) => {
  const p = c.req.valid("param");
  try { answerHostRequest(c.get("person"), p.id, p.request, c.req.valid("json").answer); return c.json({ ok: true as const }, 200); } catch (e) { const f = failure(e); if (f) return c.json({ error: f.error }, f.status); throw e; }
});

const cancelQueuedR = createRoute({
  method: "delete", path: "/{id}/queue/{message}", tags: ["Code"], summary: "Take back a queued message", middleware: [requireAuth] as const,
  request: { params: z.object({ id: sessionIdParam.shape.id, message: z.string().regex(/^cqm-[a-z0-9]+$/) }) },
  responses: { 200: { content: { "application/json": { schema: okBody } }, description: "Taken back." }, ...errorResponses(errors) },
});
codingSessionsRoutes.openapi(cancelQueuedR, (c) => {
  const p = c.req.valid("param");
  return cancelQueuedMessage(c.get("person"), p.id, p.message) ? c.json({ ok: true as const }, 200) : c.json({ error: "That message is not waiting any more." }, 404);
});

const pushR = createRoute({
  method: "post", path: "/{id}/push", tags: ["Code"], summary: "Push the session's own branch after the secret check (the person's confirmation)", middleware: [requireAuth] as const,
  request: { params: sessionIdParam, body: { content: { "application/json": { schema: z.object({ confirm: z.boolean() }).strict() } } } },
  responses: { 200: { content: { "application/json": { schema: okBody } }, description: "Pushed." }, ...errorResponses(errors) },
});
codingSessionsRoutes.openapi(pushR, async (c) => {
  try { await pushCodingSession(c.get("person"), c.req.valid("param").id, c.req.valid("json").confirm); return c.json({ ok: true as const }, 200); } catch (e) { const f = failure(e); if (f) return c.json({ error: f.error }, f.status); throw e; }
});

const undoR = createRoute({
  method: "post", path: "/{id}/undo", tags: ["Code"], summary: "Undo on a receipt: restore a checkpoint", middleware: [requireAuth] as const,
  request: { params: sessionIdParam, body: { content: { "application/json": { schema: z.object({ checkpoint_id: z.string() }).strict() } } } },
  responses: { 200: { content: { "application/json": { schema: okBody } }, description: "Restored." }, ...errorResponses(errors) },
});
codingSessionsRoutes.openapi(undoR, async (c) => {
  try { await undoToCheckpoint(c.get("person"), c.req.valid("param").id, c.req.valid("json").checkpoint_id); return c.json({ ok: true as const }, 200); } catch (e) { const f = failure(e); if (f) return c.json({ error: f.error }, f.status); throw e; }
});


const prR = createRoute({
  method: "post", path: "/{id}/pull-request", tags: ["Code"], summary: "Open a pull request for the session's branch (the person's confirmation; the secret check runs first)", middleware: [requireAuth] as const,
  request: { params: sessionIdParam, body: { content: { "application/json": { schema: z.object({ confirm: z.boolean(), title: z.string().trim().min(1).max(200).optional(), draft: z.boolean().optional() }).strict() } } } },
  responses: { 201: { content: { "application/json": { schema: z.object({ url: z.string(), number: z.number(), draft: z.boolean() }) } }, description: "The pull request." }, ...errorResponses(errors) },
});
codingSessionsRoutes.openapi(prR, async (c) => {
  try { const b = c.req.valid("json"); return c.json(await createCodingPullRequest(c.get("person"), c.req.valid("param").id, b), 201); } catch (e) { const f = failure(e); if (f) return c.json({ error: f.error }, f.status); throw e; }
});
