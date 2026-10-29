import { noteInterruptedReply } from "@/lib/interruptedReply";
import { createRoute, z } from "@hono/zod-openapi";
import { parseCurrentLocation } from "@/lib/places";
import { bodyLimit } from "hono/body-limit";
import type { MiddlewareHandler } from "hono";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { requireAuth } from "@/middleware/auth";
import { prewarmPrefix } from "@/lib/prefixPrewarm";
import { normalizeForSpeech } from "@maipai/spec/voice/ts/normalizeForSpeech.js";
import { StreamSafetyRefusal, StreamUnavailable, DocumentAttachmentError, BareModeForbidden, crisisSupportFor, conversationInCrisis, type Surface, type TurnOpResult, type TurnStreamResult } from "@/lib/turnShared";
import { answeredByFor, runTurnNext, runTurnNextStream } from "@/lib/turnMachine/turnNext";
import { isOwnerOrAdmin, canHaveTemporaryChat } from "@/lib/access";
import { pickThinkingCue, pickStillCue } from "@/lib/replyVariation";
import { feedThinkSplit, flushThinkSplit, newThinkSplitState, type ThinkSpan } from "@/lib/wellFormed";
import { speakerAgeBand } from "@/lib/ageBand";
import { safetyRefusalLine } from "@/lib/failureCopy";
import { personWithinTurnBudget, personWithinEphemeralBudget } from "@/lib/llm";
import { isFixedHomeCardQuery } from "@/lib/homeCardQueries";
import { MAX_CHAT_IMAGES, type TurnStreamEvent, type TurnValue } from "@/wire";
import type { TurnStreamEvent as ToolStreamEvent } from "@maipai/spec/stack/ts/turn-stream-event.js";
import type { AppEnv, PersonRow } from "@/types";
import { streamEventForViewer, valueForViewer } from "@/lib/turnErrorDetail";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { turnOwnerId, isTemporaryConversation, packageLatencyFromRecentOutcomes, applyHeardPrefix } from "@/lib/conversationHistory";
import { surfaceClassOf } from "@/lib/surfaceClass";
import { attachments } from "@/db/schema";
import { db } from "@/db";
import { readAttachment, getTemporaryChatImage } from "@/lib/attachments";
import { getStackClient, isStackConfigured } from "@/lib/stackEngine";
import { createAssistantStreamSink } from "@/lib/assistantStreamWire";
import { getDeviceById } from "@/lib/devices";

// THIN-7C (docs/design/RULES.md rule 12): this route calls one path, the turn
// machine (turnMachine/turnNext.ts). Bare mode, document attachments,
// temporary turns, supersedes, continuation and a Home card's ephemeral query
// are options of that path, not branches of a second engine. The setting that
// used to choose between two engines is retired by THIN-7D and read nowhere here.

type ModelSelectionStatus = { requested: string; selected: string | null; fallback: boolean; message?: string };

export async function resolveTurnModel(requested: string | undefined, surface: Surface, minor: boolean, bare: boolean): Promise<{ model?: string; status?: ModelSelectionStatus }> {
  if (requested === undefined) return {};
  const fallback = (selected: string | null, message: string): { status: ModelSelectionStatus } => ({ status: { requested, selected, fallback: true, message } });
  if (surface !== "chat" || minor || bare) return fallback(null, "Model selection is unavailable for this turn; the active chat model was used.");
  if (!isStackConfigured()) return fallback(null, "No Stack chat models are available; the active chat model was used.");
  try {
    const { roles } = await getStackClient().roles();
    const chat = roles.find((role) => role.id === "chat");
    const model = chat?.models?.find((option) => option.id === requested);
    if (model) return { model: model.id, status: { requested, selected: model.id, fallback: false } };
    const defaultModel = chat?.model?.id;
    return {
      ...(defaultModel ? { model: defaultModel } : {}),
      status: { requested, selected: defaultModel ?? null, fallback: true, message: "That model is unknown or unavailable; the chat role's default model was used." },
    };
  } catch {
    return fallback(null, "The Stack model list is unavailable; the active chat model was used.");
  }
}

export const turnRoutes = apiRouter();
/** TURN-TTL-01: how long a FINISHED turn's stream stays buffered for a reconnecting client. It starts when the
 * turn ends and never aborts a running turn: a running turn is bounded by its node deadlines and the stream
 * watchdog (RULES.md rule 5, DEADLINE-02), and only a client Stop or the owner leaving cancels it. */
export const RESUME_TTL_MS = 60_000;
let resumeTtlMs = RESUME_TTL_MS;
/** Tests only: a short TTL so expiry can be observed without waiting a minute. */
export function __setResumeTtlForTests(ms: number | null): void { resumeTtlMs = ms ?? RESUME_TTL_MS; }

interface StoredStreamEvent {
  event: TurnStreamEvent;
  sequence: number | null;
  afterSequence: number;
  terminal: boolean;
}

// THIN-5D: a subscriber is a wire. The NDJSON wire writes one line per event;
// the assistant-stream wire (lib/assistantStreamWire.ts) writes the same
// events as protocol chunks. Both are fed the identical released events.
interface StreamSubscriber {
  write(event: TurnStreamEvent | ToolStreamEvent): void;
  close(): void;
  resumeFrom: number;
}

type Wire = "ndjson" | "assistant-stream";
const ASSISTANT_STREAM_MEDIA_TYPE = "application/x-assistant-stream";
// Content negotiation: only a request that asks for it by name gets the
// assistant-stream wire. No Accept, `*/*` and every other value stay NDJSON.
function wireFor(accept: string | undefined): Wire {
  return accept?.toLowerCase().includes(ASSISTANT_STREAM_MEDIA_TYPE) ? "assistant-stream" : "ndjson";
}

interface ResumeSession {
  generation: number;
  startedAtMs: number;
  sttMs: number | null;
  token: string;
  ownerId: string;
  // THIN-1E: who the stream is for, so the done value's raw error detail is admin-only.
  viewer: PersonRow;
  // REASONING-01: a minor's own turn (child or teen, ageBand.ts's shared
  // band) never emits a `reasoning` event (docs/dev.md's own
  // "REASONING-01" section) - computed once here from the real actor at
  // session-construction time, since streamTurnEvents() itself only ever
  // sees `ownerId`, a bare string.
  dropReasoning: boolean;
  spokenTurn: boolean;
  /** REG-02: set once the turn is known to be a refusal, error, crisis, package or command line; no spoken cue after that. */
  cueBlocked?: boolean;
  modelStatus?: ModelSelectionStatus;
  conversationId: string;
  turnId: string;
  answerMetadata?: import("@/wire").AnsweredBy;
  controller: AbortController;
  result: Extract<TurnStreamResult, { ok: true; kind: "stream" }>;
  events: StoredStreamEvent[];
  subscribers: Set<StreamSubscriber>;
  sequence: number;
  terminal: boolean;
  terminalDelivered: boolean;
  cancelled: boolean;
  releasedText: string;
  heardChars?: number;
  expired: boolean;
  /** TURN-TTL-01: armed once, when the turn ends. */
  expiryTimer?: ReturnType<typeof setTimeout>;
}

const resumeSessions = new Map<string, ResumeSession>();
const inFlightTurns = new Map<string, ResumeSession>();

export function isStaleTurnGeneration(turnId: string, generation: number | undefined): boolean {
  const session = inFlightTurns.get(turnId);
  return Boolean(session && generation !== undefined && generation < session.generation);
}

export function isOwnedStaleTurnGeneration(turnId: string, ownerId: string, generation: number | undefined): boolean {
  const session = inFlightTurns.get(turnId);
  return Boolean(session && session.ownerId === ownerId && isStaleTurnGeneration(turnId, generation));
}

/** REG-02: whether the speech route may add a spoken cue to this turn's
 * sentences. Fails closed: only the owner's own, spoken, model-worded turn
 * that has not been a refusal, an error or a crisis qualifies. */
export function turnAllowsVoiceCues(turnId: string, ownerId: string): boolean {
  const session = inFlightTurns.get(turnId);
  return Boolean(session && session.ownerId === ownerId && session.spokenTurn && !session.cueBlocked && !conversationInCrisis(session.conversationId));
}

export function staleGenerationEvent(event: TurnStreamEvent | ToolStreamEvent, stale: boolean): TurnStreamEvent | ToolStreamEvent | null {
  if (!stale) return event;
  if ("type" in event && (event.type === "done" || event.type === "error")) return { type: "error", error: "cancelled", code: "turn_cancelled" };
  return null;
}

const cancelTurnRoute = createRoute({
  method: "post", path: "/{turn_id}/cancel", tags: ["Turns"],
  summary: "Cancel an in-flight turn",
  description: "Aborts an in-flight completion for a turn owned by the caller.",
  middleware: [requireAuth] as const,
  request: {
    params: idParamSchema("turn_id"),
    body: {
      required: false,
      content: { "application/json": { schema: z.object({ heard_chars: z.number({ error: "heard_chars must be a whole number from 0 to 1000000: send the count of reply characters the person heard, or leave the body out" }).int({ error: "heard_chars must be a whole number from 0 to 1000000: send the count of reply characters the person heard, or leave the body out" }).min(0, { error: "heard_chars must be a whole number from 0 to 1000000: send the count of reply characters the person heard, or leave the body out" }).max(1_000_000, { error: "heard_chars must be a whole number from 0 to 1000000: send the count of reply characters the person heard, or leave the body out" }).optional() }) } },
    },
  },
  responses: {
    200: { content: { "application/json": { schema: z.object({ cancelled: z.boolean() }) } }, description: "Whether the turn was in flight and cancelled." },
    ...errorResponses({ 400: "Invalid heard character count", 401: "Not signed in", 403: "The turn belongs to another person", 404: "Unknown turn" }),
  },
});

function cutAtWord(releasedText: string, heardChars: number): string {
  const prefix = releasedText.slice(0, heardChars);
  if (heardChars >= releasedText.length || releasedText[heardChars]?.trim() === "") return prefix;
  for (let index = prefix.length - 1; index >= 0; index--) {
    if (prefix[index]?.trim() === "") return prefix.slice(0, index + 1);
  }
  return "";
}

turnRoutes.openapi(cancelTurnRoute, (c) => {
  const { heard_chars: heardChars } = c.req.valid("json") ?? {};
  const flight = inFlightTurns.get(c.req.valid("param").turn_id);
  const owner = flight?.ownerId ?? turnOwnerId(c.req.valid("param").turn_id);
  if (owner === null) return c.json({ error: "Turn not found" }, 404);
  if (owner !== c.get("person").id) return c.json({ error: "Cannot cancel another person's turn" }, 403);
  const wasInFlight = Boolean(flight && !flight.cancelled && !flight.terminal);
  if (flight && !flight.cancelled && !flight.terminal) {
    flight.heardChars = heardChars;
    flight.controller.abort();
    flight.cancelled = true;
    flight.generation += 1;
  }
  // DUPLEX-06: a reply that finished generating before the cut-in (generation is much faster than speech) is already stored in full, so
  // cut the stored row to what was heard; one that is still finishing is cut where it finalizes (streamTurnEvents). Idempotent.
  if (typeof heardChars === "number") {
    const applied = applyHeardPrefix(c.req.valid("param").turn_id, owner, heardChars, cutAtWord);
    if (applied) noteInterruptedReply(applied.conversationId, owner, applied.released, applied.heardPrefix);
  }
  return c.json({ cancelled: wasInFlight }, 200);
});

const RATE_LIMIT_RESPONSE = { error: "Too many requests too quickly.", code: "turn_rate_limited" } as const;

// Any signed-in person, no role gate: a household member's own
// conversation turn isn't a privileged action, the same posture
// /api/safety/check and /api/llm/chat already take. This is the real
// caller those two routes' comments named as "ahead of the turn engine";
// they stay useful in their own right (diagnostics, direct model/safety
// checks) now that this one exists.
// Keep ordinary requests under 64 KiB. Document requests need room for
// base64, so streamTurnBodyLimit() admits the larger ceiling when its early
// scan finds an attachment marker. This is a best-effort fast-path DoS
// mitigation, not JSON validation: its literal text-key scan can be fooled
// by a decoy nested key, which may weaken only the early rejection. The
// authoritative text-length check is MAX_TURN_TEXT_LENGTH downstream,
// after parsing the request body.
const TURN_BODY_LIMIT = 64 * 1024;
const STREAM_TURN_BODY_LIMIT = 68 * 1024 * 1024;
const MAX_STREAM_TEXT_CHARS = 8_000;
const EARLY_TEXT_SCAN_BYTES = 64 * 1024;
const streamTurnBodyLimit: MiddlewareHandler = async (c, next) => {
  const request = c.req.raw as Request;
  const lengthHeader = request.headers.get("content-length");
  const length = lengthHeader === null ? Number.POSITIVE_INFINITY : Number(lengthHeader);
  if (length <= TURN_BODY_LIMIT) return bodyLimit({ maxSize: TURN_BODY_LIMIT })(c, next);
  const reader = request.body?.getReader();
  if (!reader) return c.json({ error: "Payload Too Large", code: "payload_too_large" }, 413);
  const chunks: Uint8Array[] = [];
  let size = 0;
  let scan = new Uint8Array(0);
  const textKey = new TextEncoder().encode('"text"');
  let textStart = -1;
  let textScanned = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > STREAM_TURN_BODY_LIMIT) {
        await reader.cancel();
        return c.json({ error: "Payload Too Large", code: "payload_too_large" }, 413);
      }
      chunks.push(value);
      if (scan.length < EARLY_TEXT_SCAN_BYTES && !textScanned) {
        const merged = new Uint8Array(Math.min(EARLY_TEXT_SCAN_BYTES, scan.length + value.length));
        merged.set(scan);
        merged.set(value.subarray(0, merged.length - scan.length), scan.length);
        scan = merged;
        outer: for (let i = 0; textStart < 0 && i <= scan.length - textKey.length; i++) {
          let matched = true;
          for (let j = 0; j < textKey.length; j++) if (scan[i + j] !== textKey[j]) { matched = false; break; }
          if (!matched) continue;
          let cursor = i + textKey.length;
          while (cursor < scan.length && [32, 9, 10, 13].includes(scan[cursor]!)) cursor++;
          if (scan[cursor++] !== 58) continue;
          while (cursor < scan.length && [32, 9, 10, 13].includes(scan[cursor]!)) cursor++;
          if (scan[cursor] === 34) { textStart = cursor + 1; break outer; }
        }
      }
      if (textStart >= 0 && !textScanned) {
        let escaped = false;
        let chars = 0;
        let closed = false;
        for (let i = textStart; i < scan.length; i++) {
          const byte = scan[i]!;
          if (escaped) { escaped = false; chars++; continue; }
          if (byte === 92) { escaped = true; continue; }
          if (byte === 34) { closed = true; break; }
          chars++;
        }
        if (chars > MAX_STREAM_TEXT_CHARS) {
          await reader.cancel();
          return c.json({ error: "text must be 8000 characters or fewer", code: "invalid_input" }, 400);
        }
        if (closed) textScanned = true;
      }
      if (size > TURN_BODY_LIMIT && scan.length >= EARLY_TEXT_SCAN_BYTES) {
        const prefix = new TextDecoder().decode(scan);
        const markerIndex = prefix.search(/"document_attachments"\s*:\s*\[\s*\{/);
        if (markerIndex < 0) {
          await reader.cancel();
          return c.json({ error: "Payload Too Large", code: "payload_too_large" }, 413);
        }
      }
    }
  } catch {
    return c.json({ error: "Invalid turn request", code: "invalid_input" }, 400);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  c.req.raw = new Request(request, { body: bytes, duplex: "half" });
  return next();
};
const evidence = z.object({ person: z.string().regex(/^person-[a-z0-9]{6,}$/).nullable(), basis: z.enum(["signed_in", "voice", "face", "voice_and_face", "claimed", "unknown"]), level: z.enum(["confirmed", "tentative", "unknown"]) }).strict();
const present = z.array(evidence).nullable();
// APPROVE-CARD-01: a tapped approve/deny card on a parked confirm.
// `turn_id` is matched against the pending ask's own PendingAsk.turnId
// (turnMachine/turnNext.ts's resumesAsk()) - a mismatch (a second ask
// parked since the card was shown) never resumes, same as an unrelated
// new statement. Validated here, the same way evidence/present already
// are, since this field genuinely drives a package call when approved.
const askAnswer = z.union([z.object({ turn_id: z.string(), approved: z.boolean() }).strict(), z.object({ turn_id: z.string(), values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])) }).strict(), z.object({ offer_id: z.string().min(1).max(128), approved: z.boolean() }).strict()]);

// VOICE-PREWARM-01: a voice session that just opened asks for this person's last prompt prefix to be put back in the engine's cache, so the first word is not the slow one.
turnRoutes.post("/prewarm", requireAuth, async (c) => {
  const warmed = await prewarmPrefix(c.get("person").id, "spoken");
  return c.json({ warmed }, 200);
});

turnRoutes.post("/", requireAuth, bodyLimit({ maxSize: TURN_BODY_LIMIT }), async (c) => {
  const actor = c.get("person");
  if (!personWithinTurnBudget(actor.id)) {
    return c.json(RATE_LIMIT_RESPONSE, 429);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    surface?: string;
    text?: string;
    model?: string;
    thinking?: boolean;
    conversation_id?: string;
    mention_companion_id?: string;
    try_companion_id?: string;
    supersedes?: string;
    continuation_of?: string;
    continuation_text?: string;
    speaker_evidence?: unknown;
    present?: unknown;
    temporary?: boolean;
    spoken?: boolean;
    ask_answer?: unknown;
    page_context?: unknown;
  };
  // A robot that cannot tell who is speaking sends speaker_evidence: null (the hosted StackChan always did); that means "no evidence", the same as leaving it out.
  const parsedEvidence = z.object({ speaker_evidence: evidence.nullish(), present: present.optional(), ask_answer: askAnswer.optional() }).safeParse(body);
  if (!parsedEvidence.success) return c.json({ error: "Invalid turn request", code: "invalid_input" }, 400);
  const surface = (body.surface ?? "chat") as Surface;
  const deviceId = c.get("deviceId");
  const robotName = surface === "robot" && deviceId ? getDeviceById(deviceId)?.name : undefined;
  // TEMP-CHAT-01: the clean 403, checked here even though
  // resolveOrCreateConversation() (conversationHistory.ts) asserts the
  // identical thing again on its own construction path - the same
  // "route-level primary gate, structural backstop underneath"
  // ADMIN-COMPARE-01 (b) already established for bare mode.
  if (body.temporary === true && !canHaveTemporaryChat(actor)) {
    return c.json({ error: "temporary chat is not available for minors" }, 403);
  }
  // REASONING-03 (safety ruling, 2026-09-22): a minor's turn never even
  // asks the model to think, belt and braces alongside the composer's
  // own control being hidden for a minor (ChatPage.tsx) - a client
  // can be edited, so `body.thinking` is never trusted for a minor
  // regardless of what it claims. Reasoning is a disclosure surface
  // built for typed chat's own Reasoning Element - never sent on a
  // surface that has no such affordance (voice/robot/tv/phone), adult
  // actor or not; a review caught the first draft only skipping the
  // MODEL for a minor and leaving a non-chat surface to spend the
  // tokens and latency on a think block this same gate discards below
  // anyway.
  const isMinor = speakerAgeBand(actor, new Date()) !== "adult";
  const dropReasoning = isMinor || surface !== "chat" || body.spoken === true; // THIN-5B: a spoken turn has nowhere to show reasoning
  const modelSelection = await resolveTurnModel(body.model, surface, isMinor, false);
  // runTurnNext() always resolves "immediate" (its own header note); the
  // explicit kind check is TypeScript's, not a real branch.
  const next = await runTurnNext(actor, surface, body.text ?? "", { conversationId: body.conversation_id, pageContext: body.page_context, mentionCompanionId: typeof body.mention_companion_id === "string" ? body.mention_companion_id : undefined, tryCompanionId: typeof body.try_companion_id === "string" ? body.try_companion_id : undefined, temporary: body.temporary, supersedes: body.supersedes, spoken: body.spoken === true, thinking: dropReasoning ? false : body.thinking, model: modelSelection.model, ask_answer: parsedEvidence.data.ask_answer, ...(robotName ? { robotName } : {}), ...(surface === "robot" && deviceId ? { deviceId } : {}), ...(surface === "robot" ? { speakerEvidence: parsedEvidence.data.speaker_evidence ?? null, present: parsedEvidence.data.present ?? null } : {}) }); // Evidence is only honored on the robot surface.
  const result: TurnOpResult = next.ok && next.kind === "immediate" ? { ok: true, value: next.value } : next.ok ? { ok: false, status: 503, code: "unavailable", error: "the turn machine returned a stream result unexpectedly" } : next;
  if (!result.ok) {
    return c.json({ error: result.error, code: result.code }, result.status);
  }
  // REASONING-02: this blocking route serializes the whole TurnValue
  // (unlike /stream's own hand-built events), so a minor's reasoning
  // field is stripped here rather than at a shared boundary - the same
  // dropReasoning gate the streaming route's own version uses.
  return c.json(valueForViewer({ ...result.value, ...(dropReasoning && result.value.reasoning !== undefined ? { reasoning: undefined } : {}), ...(modelSelection.status ? { model_status: modelSelection.status } : {}) }, actor));
});

const encoder = new TextEncoder();
// TOOL-EVENTS-01(b): the spec's own tool_call/tool_result/tool_error
// shape is a deliberately separate NDJSON line shape from wire.ts's own
// TurnStreamEvent (keyed by `t`, not `type` - chatModelAdapter.ts's own
// header comment on the frontend side of this same split), never a
// member of that union - widened here rather than merged into it.
function ndjsonLine(event: TurnStreamEvent | ToolStreamEvent): Uint8Array {
  return encoder.encode(`${JSON.stringify(event)}\n`);
}

function newResumeToken(): string {
  return randomBytes(32).toString("base64url");
}

function isTerminalEvent(event: TurnStreamEvent): boolean {
  return event.type === "done" || event.type === "error";
}

function shouldDeliver(stored: StoredStreamEvent, resumeFrom: number | null): boolean {
  if (resumeFrom === null) return true;
  if (stored.terminal) return true;
  // TOOL-EVENTS-02: a tool_call/tool_result/tool_error line carries no
  // `type` (spec's own `t`-keyed shape) and no `sequence` of its own -
  // found live, a code review: with `afterSequence` pinned to whatever
  // `session.sequence` was before any delta/reasoning event ever
  // advanced it (0, if the tool round finishes before the first token,
  // always true by construction here), `stored.afterSequence >
  // resumeFrom` reads `0 > 0` for a client that reconnects having seen
  // nothing but turn_meta/signal so far (chatModelAdapter.ts's own
  // `lastAcknowledgedSequence` starts at 0) - the exact case a real
  // search hits, and the one this route exists to fix. Always
  // redelivered, like a terminal event above: idempotent on the
  // consumer (chatModelAdapter.ts's own toolCalls Map just re-sets the
  // same call's state), so an already-seen resend costs nothing.
  if (!("type" in stored.event)) return true;
  if (stored.sequence !== null) return stored.sequence > resumeFrom;
  return stored.afterSequence > resumeFrom;
}

function detachSubscriber(session: ResumeSession, subscriber: StreamSubscriber): void {
  session.subscribers.delete(subscriber);
}

function closeSubscriber(session: ResumeSession, subscriber: StreamSubscriber): void {
  detachSubscriber(session, subscriber);
  try {
    subscriber.close();
  } catch {
    // A client can cancel between the last enqueue and close. The session
    // already has the terminal event buffered, so there is nothing else to
    // do for this subscriber.
  }
}

function appendSessionEvent(session: ResumeSession, event: TurnStreamEvent): void {
  if (session.terminal) return;
  const sequence = (event.type === "delta" || event.type === "reasoning") && event.sequence !== undefined ? event.sequence : null;
  const stored: StoredStreamEvent = { event, sequence, afterSequence: session.sequence, terminal: isTerminalEvent(event) };
  session.events.push(stored);
  if (event.type === "error" || (event.type === "done" && (event.value.source !== "model" || event.value.crisis_resources))) session.cueBlocked = true;
  if (stored.terminal) session.terminal = true;
  for (const subscriber of [...session.subscribers]) {
    if (!shouldDeliver(stored, subscriber.resumeFrom)) continue;
    try {
      subscriber.write(event);
      if (stored.terminal) {
        session.terminalDelivered = true;
        closeSubscriber(session, subscriber);
      }
    } catch {
      detachSubscriber(session, subscriber);
    }
  }
  if (session.terminal) armResumeExpiry(session);
}

/** TURN-TTL-01: the resume TTL starts when the turn ends, never when it starts. */
function armResumeExpiry(session: ResumeSession): void {
  if (session.expiryTimer) return;
  session.expiryTimer = setTimeout(() => {
    session.expired = true;
    resumeSessions.delete(session.token);
    inFlightTurns.delete(session.turnId);
  }, resumeTtlMs);
}

function streamResponse(session: ResumeSession, resumeFrom: number | null, wire: Wire = "ndjson"): Response {
  let subscriber: StreamSubscriber | undefined;
  const replay = (sub: StreamSubscriber) => {
    try {
      sub.write({ type: "turn_meta", conversation_id: session.conversationId, turn_id: session.turnId, resume_token: session.token, ...(session.answerMetadata ? { answered_by: session.answerMetadata } : {}) });
      for (const stored of session.events) {
        if (!shouldDeliver(stored, resumeFrom)) continue;
        sub.write(stored.event);
        if (stored.terminal) session.terminalDelivered = true;
      }
      if (session.terminal) closeSubscriber(session, sub);
    } catch {
      detachSubscriber(session, sub);
    }
  };
  if (wire === "assistant-stream") {
    const sink = createAssistantStreamSink(() => { if (subscriber) detachSubscriber(session, subscriber); });
    subscriber = { write: (event) => sink.write(event), close: () => sink.close(), resumeFrom: resumeFrom ?? -1 };
    session.subscribers.add(subscriber);
    replay(subscriber);
    return new Response(sink.readable, { headers: sink.headers });
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      subscriber = { write: (event) => controller.enqueue(ndjsonLine(event)), close: () => controller.close(), resumeFrom: resumeFrom ?? -1 };
      session.subscribers.add(subscriber);
      replay(subscriber);
    },
    cancel() {
      if (subscriber) detachSubscriber(session, subscriber);
      // A dropped body is recoverable. Only the explicit cancel route aborts
      // the shared generation, so a reconnect can keep using this token.
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson" } });
}

function startResumeSession(session: ResumeSession): void {
  const generation = session.generation;
  void (async () => {
    try {
      for await (const rawEvent of streamTurnEvents(session.result, session.ownerId, session.spokenTurn ? SPOKEN_CUE_DELAY_MS : THINKING_CUE_DELAY_MS, session.controller.signal, session.dropReasoning, session.modelStatus, speakerAgeBand(session.viewer, new Date()), () => session.releasedText, () => session.heardChars, { spokenTurn: session.spokenTurn })) {
        // One shared counter for `delta` and `reasoning` alike (REASONING-01):
        // a resuming client's own replay filter (shouldDeliver()) needs a
        // real per-event sequence for both, or a `reasoning` event sitting
        // between two `delta` sequence numbers would never be redelivered
        // on a resume exactly at that boundary.
        const current = staleGenerationEvent(rawEvent, session.generation !== generation);
        if (!current) continue;
        const stamped = "type" in current && (current.type === "delta" || current.type === "reasoning" || current.type === "status" || current.type === "spoken_cue") ? { ...current, generation } : current;
        const event = "type" in stamped && (stamped.type === "delta" || stamped.type === "reasoning") ? { ...stamped, sequence: ++session.sequence } : stamped;
        // The turn's own clock starts before the session's, so the end-to-end time is never shorter than the turn's first token or total.
        const withLatency = "type" in event && event.type === "done" ? { ...event, value: { ...event.value, latency: { stt_ms: session.sttMs, first_token_ms: event.value.stats?.time_to_first_token_ms ?? null, tts_ttfa_ms: null, e2e_ms: Math.max(Date.now() - session.startedAtMs, event.value.stats?.time_to_first_token_ms ?? 0, event.value.stats?.total_time_ms ?? 0) } } } : event;
        // THIN-1E and CHAT-CALM-ERRORS-01b (rule 6): the done value and the
        // error event's admin detail pass the one viewer filter.
        const delivered = streamEventForViewer(withLatency as TurnStreamEvent, session.viewer);
        appendSessionEvent(session, delivered);
        if ("type" in delivered && delivered.type === "delta") session.releasedText += delivered.text;
      }
    } catch (err) {
      // streamTurnEvents() maps generation failures to a terminal event. This
      // guard keeps the reconnect contract terminal even if a future change
      // makes an outer iterator failure escape that helper.
      console.error("[turn/stream] resume session failed:", err);
      if (!session.terminal) {
        try { session.result.finalize(""); } catch (finalizeErr) { console.error("[turn/stream] resume finalize failed:", finalizeErr); }
        appendSessionEvent(session, { type: "error", error: "The turn stream became unavailable.", code: "unavailable" });
      }
    }
  })();
}

// How long the `chat` model's own time to first token can run before
// silence starts reading as dead air rather than a fast answer arriving
// (home-legacy.git's own tuned TOOL_ACK_DELAY_MS, arXiv 2507.22352:
// fillers measurably help at multi-second waits and hurt at sub-second
// ones). A real, instant reply never crosses this and so never gets a
// cue - the same "answer when you know it, say 'let me check' only when
// checking actually takes a moment" logic, applied to the model's own
// generation latency instead of a tool call's.
export const THINKING_CUE_DELAY_MS = 900;
/** VOICE-REPLY-02: a spoken turn's bridge phrase ("One sec.") covers the wait for the first word.
 * Measured 2026-10-29 on the Stack chat model: a spoken turn's first token arrives 2.1 to 3.3 seconds
 * after the request (jokes and weather alike), and no quick lane exists (INSTANT-05: the 4B does not
 * answer spoken turns), so at 2.5 seconds the cue fired late or never and the call felt like a
 * walkie-talkie. It goes out at 1.0 second: the gap it fills is real, and an answer that is faster
 * than that never gets a cue. The cue is never the answer and never the same phrase twice in a row (pickThinkingCue). */
export const SPOKEN_CUE_DELAY_MS = 1000;
/** VOICE-FILLER-02: how long after the first cue a spoken turn waits before its second ("Still on it."). */
export const STILL_CUE_GAP_MS = 3000;

/** Returns the timer alongside the promise so the common case (the real
 * token wins the race) can cancel it - a code review (2026-09-05) found
 * the original version left the timeout running for the rest of its
 * `cueDelayMs` on every ordinary, fast reply, doing nothing but holding
 * its closure alive. */
function delay(ms: number): { promise: Promise<"timeout">; cancel: () => void } {
  let handle: ReturnType<typeof setTimeout>;
  const promise = new Promise<"timeout">((resolve) => {
    handle = setTimeout(() => resolve("timeout"), ms);
  });
  return { promise, cancel: () => clearTimeout(handle) };
}

/** The real event sequence for a "stream" kind TurnStreamResult: a
 * "spoken_cue" first IF the model's own first token is genuinely slow to
 * arrive (never more than once - only the very first token is raced, the
 * one real latency source in this codebase today), then every delta as
 * it arrives, then exactly one "done" or "error" terminal event.
 * Extracted from the route handler so a code review's "finalize() must
 * still run on the error path" fix can be proven directly, with a
 * hand-built failing `tokens` generator, instead of needing a genuinely
 * broken network connection - Bun.serve's own ReadableStream masks a
 * mid-stream server-side error as a clean close from the client's side,
 * so that real failure mode can't be reproduced end to end in a test at
 * all, only trusted to have the right code shape here. */
export async function* streamTurnEvents(
  result: Extract<TurnStreamResult, { ok: true; kind: "stream" }>,
  actorId: string,
  cueDelayMs = THINKING_CUE_DELAY_MS,
  signal?: AbortSignal,
  // REASONING-01: a minor's turn (child or teen) never emits a
  // `reasoning` event at all (the coordinator's own call, docs/dev.md's
  // "REASONING-01" section) - a minor sees the answer, not the model's
  // thinking. The safety/guard pass upstream (the retired turn engine) is entirely
  // unaffected: this drops the already-classified reasoning span at the
  // OUTPUT boundary, after the combined text has gone through the
  // identical pass every turn gets.
  dropReasoning = false,
  modelStatus?: ModelSelectionStatus,
  // SAFETY-NOTICE-01: whose words a safety refusal's line is in. The
  // strictest band when a caller does not say.
  speakerBand: "adult" | "teen" | "child" = "child",
  releasedText?: () => string,
  heardChars?: () => number | undefined,
  options: { spokenTurn?: boolean; stillCueGapMs?: number; onToolStart?: (packageId: string) => void } = {},
): AsyncGenerator<TurnStreamEvent, void, void> {
  let fullText = "";
  // REASONING-01: splits each chunk of the pipeline's own combined text
  // (a think block, if present, embedded per wellFormed.ts's own
  // contract) into `reasoning`/`delta` wire events - the one and only
  // place this split happens; `result.tokens` (the retired turn engine's whole
  // pipeline) is never touched, and `fullText` keeps accumulating the
  // UNSPLIT original chunks, so `finalize()` and the stored row are
  // unaffected either way (docs/dev.md's own "smallest change" section).
  const thinkSplit = newThinkSplitState();
  let earlyCueSent = false;
  // Sequence numbers are stamped by the caller (startResumeSession(), one
  // shared counter for `delta` and `reasoning` alike, so a resuming
  // client's replay filter works identically for both) - this function
  // never sets one itself, matching `delta`'s own existing contract.
  // Shared by the main loop and the end-of-stream flush below (a review
  // caught these two sites duplicating the identical span-to-event
  // mapping): each ThinkSpan[] this converts came from either
  // feedThinkSplit() (mid-stream) or flushThinkSplit() (once, at the
  // end) - the mapping itself doesn't care which.
  function* spanEvents(spans: readonly ThinkSpan[]): Generator<TurnStreamEvent, void, void> {
    for (const span of spans) {
      if (span.reasoning) {
        if (!dropReasoning) yield { type: "reasoning", text: span.text };
      } else {
        yield { type: "delta", text: span.text };
      }
    }
  }
  // THIN-5B: live reasoning rides the status channel (turnNext.ts); the
  // same minor/surface gate that filters the think-split path filters it.
  function* sideEvents(): Generator<TurnStreamEvent, void, void> {
    for (const event of result.status.drain()) {
      if (event.type === "tool_start") {
        options.onToolStart?.(event.package_id);
        const latency = options.spokenTurn && !earlyCueSent && !result.cueSuppressed
          ? packageLatencyFromRecentOutcomes(event.package_id)
          : null;
        if (latency && latency.count >= 5 && latency.medianMs !== null && latency.medianMs > 1_000) {
          const cue = pickThinkingCue(actorId, result.bannedPhrases);
          if (cue) { earlyCueSent = true; yield { type: "spoken_cue", text: normalizeForSpeech(cue) }; }
        }
      } else if (!(dropReasoning && event.type === "reasoning")) yield event;
    }
  }
  function* splitEvents(text: string): Generator<TurnStreamEvent, void, void> {
    yield* spanEvents(feedThinkSplit(thinkSplit, text));
  }
  try {
    const iterator = result.tokens[Symbol.asyncIterator]();
    // FAST-04: start the timer from startedAt (when prepareTurn() began),
    // not from when we enter this function, so the cue fires 900 ms after
    // the utterance arrived when nothing has streamed yet.
    const elapsedMs = Date.now() - result.startedAt;
    const remainingDelayMs = Math.max(0, cueDelayMs - elapsedMs);
    // Only one `.next()` call is ever made for the first step - racing a
    // timer against it means racing which one gets AWAITED first, never
    // calling `.next()` a second time (which would skip a real token).
    // The status channel wakes the race when a line is queued; the
    // lines themselves are drained synchronously, so a status emitted
    // before a delta (the `composing` line before the composition's
    // first token, K6) goes out ahead of it whatever the two promises'
    // settling order. A wake with nothing queued (the close) yields
    // nothing.
    // A closed channel never wakes the race again (its wait() would
    // resolve at once, forever); its last lines are drained below.
    const statusWake = () => (result.status.closed ? new Promise<never>(() => {}) : result.status.wait().then(() => "status" as const));
    let pendingStatus = statusWake();
    const firstStep = iterator.next();
    const timer = delay(remainingDelayMs);
    // A status line wakes the race without ending the wait: the cue's timer
    // keeps running, so a slow first token still gets its cue (THIN-7C: every
    // turn now carries status lines, which used to cancel the timer).
    let race = await Promise.race([firstStep, pendingStatus, timer.promise]);
    while (race === "status") {
      yield* sideEvents();
      pendingStatus = statusWake();
      race = await Promise.race([firstStep, pendingStatus, timer.promise]);
    }
    timer.cancel();
    if (race === "timeout" && !earlyCueSent && !result.cueSuppressed) { const cue = pickThinkingCue(actorId, result.bannedPhrases); if (cue) yield { type: "spoken_cue", text: normalizeForSpeech(cue) }; } // SPEECH-ROBOT-01: every spoken text passes the one normalizer
    // THIN-5B: while the first answer piece is still coming, side events
    // (live reasoning, status lines) keep going out as they are emitted, so
    // an adult's reasoning is shown while the model is still thinking
    // rather than all at once when the answer starts.
    let current = race as Exclude<typeof race, "status" | "timeout">;
    if (race === "timeout") {
      // VOICE-FILLER-02: a spoken turn whose first word is still not here STILL_CUE_GAP_MS after the first cue gets one more short phrase, then waits.
      let stillTimer = options.spokenTurn && !result.cueSuppressed ? delay(options.stillCueGapMs ?? STILL_CUE_GAP_MS) : null;
      let waited = await Promise.race([firstStep, pendingStatus, ...(stillTimer ? [stillTimer.promise] : [])]);
      while (waited === "status" || waited === "timeout") {
        if (waited === "status") { yield* sideEvents(); pendingStatus = statusWake(); }
        else { stillTimer = null; const still = pickStillCue(actorId, result.bannedPhrases); if (still) yield { type: "spoken_cue", text: normalizeForSpeech(still) }; }
        waited = await Promise.race([firstStep, pendingStatus, ...(stillTimer ? [stillTimer.promise] : [])]);
      }
      stillTimer?.cancel();
      current = waited;
    }
    // TOOL-EVENTS-02: `result.toolEvents` (the machine's own live
    // array, turnMachine/contract.ts) is already fully populated the
    // moment this first `iterator.next()` settles - the tool round is
    // one synchronous machine transition strictly before the phrasing
    // round that produces this first token, never interleaved with it.
    // Ahead of every delta, the same ordering the "immediate" kind's
    // own toolEventLines already keep (ahead of "done"). Cast, not a
    // widened return type: `ndjsonLine()` (the only thing that reads a
    // yielded value off this generator, this file's `for await`
    // consumers below and every test's own `TurnStreamEvent[]`
    // collector) already treats a `t`-keyed line as opaque data to
    // serialize, never dispatching on `.type` for one - widening the
    // generator's own declared type would have forced two dozen
    // pre-existing, unrelated test assertions across chatTurn.test.ts/
    // safety01.test.ts/turnNext.test.ts to narrow a case their own
    // fixtures can never actually produce (neither hand-built
    // `TurnStreamResult` there ever sets `toolEvents`).
    // GENUI-13c: a `block` event is not sent here with the tool lines; it goes out where the one placer put it (below),
    // with its `after_paragraph` stamped, so it lands between two released pieces and never above text already sent.
    for (const event of result.toolEvents ?? []) {
      if ("t" in event && event.t === "block" && result.placedBlocks) continue;
      yield event as unknown as TurnStreamEvent;
    }

    // ANSWER-IMG-02, GENUI-13c and GENUI-05 (rule 9): a ready visual (an answer block, a picture gallery included) goes
    // out exactly where the placer put it, between two released pieces at a paragraph boundary, so it never lands above
    // text already sent; one placed after the whole answer goes after the last piece.
    let blocksSent = 0;
    function* imagesAt(length: number): Generator<TurnStreamEvent, void, void> {
      const blocks = result.placedBlocks?.() ?? [];
      while (blocksSent < blocks.length && length >= blocks[blocksSent]!.offset) {
        yield blocks[blocksSent++]!.event as unknown as TurnStreamEvent;
      }
    }
    while (!current.done) {
      yield* sideEvents();
      yield* imagesAt(fullText.length);
      fullText += current.value;
      yield* splitEvents(current.value);
      const nextToken = iterator.next();
      let next = await Promise.race([nextToken, pendingStatus]);
      while (next === "status") {
        yield* sideEvents();
        pendingStatus = statusWake();
        next = await Promise.race([nextToken, pendingStatus]);
      }
      current = next;
    }
    // Whatever feedThinkSplit() was still holding back when the model's
    // own generation ended (a truncated open think block - the same
    // "generation cut off mid-reasoning" shape OPEN_THINK_RE already
    // treats as real and expected - or the last few characters of
    // visible text that were never actually the start of a tag).
    yield* spanEvents(flushThinkSplit(thinkSplit));
    while (true) {
      yield* sideEvents();
      if (result.status.closed) break;
      await result.status.wait();
    }
    yield* imagesAt(Number.POSITIVE_INFINITY);
    // `current.value` here is the generator's own RETURN value (step 9),
    // not a yielded delta: a StreamOutcome (the retired turn engine). Either the
    // most recently flagged, non-refuse SafetyResult gateOutputSafety()
    // saw (a self_harm mention in the model's own words, say; a review,
    // 2026-09-05, found this was previously discarded, so a flag that
    // never refuses never reached the logged turn or its
    // crisis_resources), or, FAST-04, `{ resolved }`: the model called a
    // tool, the package answered, and the stream yielded no deltas at
    // all. finalize() returns that TurnValue as-is, so this is still
    // exactly one "done" line either way, and the resolved case simply
    // has no "delta" lines before it.
    // DUPLEX-06: a cut-in that landed while the reply was still finishing generating stores only what was heard.
    const finalText = fullText.trim();
    const heardNow = heardChars?.();
    const storedText = typeof heardNow === "number" && heardNow < finalText.length ? cutAtWord(finalText, heardNow).trim() : finalText;
    const value = result.finalize(storedText, (current as IteratorReturnResult<import("@/lib/turnShared").StreamOutcome>).value);
    // The turn machine persists the row from the full text before this point, so cut the stored row to the heard prefix too.
    if (storedText !== finalText && typeof heardNow === "number") applyHeardPrefix(result.turnId, actorId, heardNow, cutAtWord);
    if (storedText !== finalText && options.spokenTurn) noteInterruptedReply(result.conversationId, actorId, finalText, storedText);
    // REASONING-02: TurnValue.reasoning is dropped from the `done` event
    // for a minor's turn, the same gate `spanEvents()` already applies to
    // the live `reasoning` stream event above.
    yield { type: "done", value: { ...value, ...(dropReasoning && value.reasoning !== undefined ? { reasoning: undefined } : {}), ...(modelStatus ? { model_status: modelStatus } : {}) } };
  } catch (err) {
    // This catch had no server-side log at all (a live incident,
    // 2026-09-07: the real reason only ever left the process as
    // `event.error` on the wire, and the frontend collapses every
    // "error" event's code to the same generic banner regardless -
    // chatModelAdapter.ts always throws `code: "unavailable"` here, so
    // the actual message was undiagnosable without this). Kept as a
    // permanent log line, not a one-off: llm.ts's recoverFromDeadBackend()
    // now self-heals the one cause found so far (a dead backend process),
    // but this catch is the generic "something failed mid-turn" case and
    // will keep catching failures that fix doesn't cover.
    console.error("[turn/stream] failed mid-stream:", err);
    // Headers (and a 200 status) are already committed by the time
    // generation can fail here - an HTTP error status is no longer
    // possible, so the failure has to travel as its own event instead
    // (the retired turn engine's "unavailable" code covers this same down-state
    // class for the non-streaming route; ChatPage.tsx maps this event to
    // the identical friendly message).
    //
    // A StreamSafetyRefusal (step 9) is a real, mapped failure: it gets
    // spec/errors/errors.json's own "safety_refused" code on the wire
    // (every other failure here has none - a genuine down-engine error,
    // not something the catalogue has a specific code for), and its own
    // SafetyResult is passed into finalize() so the logged/returned turn
    // reflects the real reason it was cut, not the input-side result
    // computed before generation ever started.
    //
    // A StreamUnavailable (FAST-04) is the engine-down case that used
    // to be an HTTP 503 with `code: "unavailable"` when the turn
    // still waited for the first token before returning; it now happens
    // after turn_meta is out, so it carries the same code on the error
    // event instead.
    if (signal?.aborted) {
      const released = releasedText?.() ?? fullText;
      const heard = heardChars?.();
      const heardPrefix = (typeof heard === "number" && heard <= released.length ? cutAtWord(released, heard) : released).trim();
      result.finalize(heardPrefix);
      // DUPLEX-06: a spoken reply that was cut in on keeps its unheard part for the next turn only (memory only, never stored).
      if (options.spokenTurn) noteInterruptedReply(result.conversationId, actorId, released, heardPrefix);
      yield { type: "error", error: "cancelled", code: "turn_cancelled" };
      return;
    }
    const safetyRefusal = err instanceof StreamSafetyRefusal ? err : undefined;
    // The category names (never the words) go to the log, so a false alarm can be traced to the rule that fired.
    if (safetyRefusal) console.error(`[turn/stream] safety gate cut the reply: categories=${safetyRefusal.safety.categories.join(",") || "none"} signals=${safetyRefusal.safety.matched_signals.length} released_chars=${fullText.length}`);
    // SAFETY-01 (#85): a streamed refusal's crisis resources reach the
    // client on the error event, the one terminal event this path
    // sends; finalize() below computes them, so it runs first for a
    // refusal (it never writes to the stream itself).
    let refused: TurnValue | undefined;
    if (safetyRefusal) {
      try {
        refused = result.finalize(fullText.trim(), safetyRefusal.safety);
      } catch (finalizeErr) {
        // The terminal event goes out whatever finalize did (a review).
        console.error("[turn/stream] finalize failed on a refusal:", finalizeErr);
      }
    }
    // SAFETY-NOTICE-01: the person reads one plain sentence in their band's
    // words (failureCopy.ts), never the gate's internal message, and the
    // crisis resources ride with it as a support block a client can draw.
    if (safetyRefusal) yield { type: "error", error: safetyRefusalLine(speakerBand, safetyRefusal.safety.categories), code: "safety_refused", ...(refused?.crisis_resources ? { crisis_resources: refused.crisis_resources, crisis_support: crisisSupportFor(refused.crisis_resources, speakerBand) } : {}) };
    else if (err instanceof StreamUnavailable) yield { type: "error", error: err.message, code: err.code, ...(err.detail ? { detail: err.detail } : {}) };
    else yield { type: "error", error: (err as Error).message };
    // Still finalize (and so still log) whatever text actually streamed
    // before the failure: a code review (2026-09-04) found this skipped
    // on the error path, so a reply that had already streamed several
    // real sentences into the household's own thread - shown and spoken
    // before the engine crashed - was never written to conversation
    // history at all, as if the exchange had never happened. Fine to run
    // after yielding the error event: `finalize` only builds and logs a
    // TurnValue, it never writes to the response stream itself. A safety
    // refusal always finalizes even with an EMPTY fullText (the very
    // first sentence was itself the unsafe one) - step 9's own "log a
    // flagged turn" - unlike a generic mid-stream crash with nothing
    // real to log, an all-refused turn is exactly the case worth a
    // record of.
    // Trimmed at the edges (#99's review): a paragraph break beside a
    // sentence the guards skipped would otherwise open or close the
    // stored reply with a bare blank line the blocking path never has.
    // CHAT-CALM-ERRORS-01b: an engine_unavailable turn is stored as
    // `failed` by the turn itself (turnNext.ts), so it is never finalized here.
    if (fullText.trim() && !safetyRefusal && !(err instanceof StreamUnavailable && err.code === "engine_unavailable")) result.finalize(fullText.trim());
  }
}

// Real token-by-token streaming (2026-09-04): the prerequisite for
// speaking a reply sentence by sentence as it's generated, not after the
// whole thing finishes (spec/voice/README.md's "what Jesse actually meant
// by streamed"). Newline-delimited JSON, not SSE: one real HTTP response
// body, no `text/event-stream` framing to parse on the way back out for a
// wire shape this simple - see wire.ts's TurnStreamEvent for the three
// event kinds. Same auth posture as POST /api/turn above.
turnRoutes.post("/stream", requireAuth, streamTurnBodyLimit, async (c) => {
  const actor = c.get("person");
  const body = (await c.req.json().catch(() => ({}))) as {
    surface?: string;
    text?: string;
    model?: string;
    thinking?: boolean;
    conversation_id?: string;
    mention_companion_id?: string;
    try_companion_id?: string;
    turn_id?: string;
    resume_token?: string;
    resume_from?: number;
    supersedes?: string;
    continuation_of?: string;
    continuation_text?: string;
    ephemeral?: boolean;
    speaker_evidence?: unknown;
    present?: unknown;
    bare?: boolean;
    temporary?: boolean;
    spoken?: boolean;
    current_location?: unknown;
    stt_ms?: number;
    ask_answer?: unknown;
    page_context?: unknown;
    document_attachments?: { name: string; media_type: string; data: string }[];
    images?: { id: string; name: string; width: number; height: number; media_type: string }[];
  };
  if (body.resume_token !== undefined) {
    const session = typeof body.resume_token === "string" ? resumeSessions.get(body.resume_token) : undefined;
    const resumeFrom = body.resume_from;
    if (!session || session.expired || (session.terminal && session.terminalDelivered) || session.ownerId !== actor.id || body.turn_id !== session.turnId || body.conversation_id !== session.conversationId || !Number.isInteger(resumeFrom) || resumeFrom! < 0 || resumeFrom! > session.sequence) {
      return c.json({ error: "The turn stream is no longer available.", code: "turn_resume_unavailable" }, 503);
    }
    return streamResponse(session, resumeFrom!, wireFor(c.req.header("accept")));
  }
  const documentAttachments = body.document_attachments ?? [];
  if (!Array.isArray(documentAttachments) || documentAttachments.length > 8 || documentAttachments.some((item) =>
    !item || typeof item.name !== "string" || item.name.length > 255 || typeof item.media_type !== "string" || typeof item.data !== "string" ||
    !/^data:[^;,]+;base64,[A-Za-z0-9+/]*={0,2}$/.test(item.data) || item.data.length > 70_000_000
  )) return c.json({ error: "Invalid document attachment" }, 400);
  if (documentAttachments.length > 0 && body.bare === true) {
    return c.json({ error: "Document attachments are not available in bare mode", code: "document_attachments_unavailable" }, 400);
  }
  const imageParts = body.images ?? [];
  if (!Array.isArray(imageParts) || imageParts.length > MAX_CHAT_IMAGES || imageParts.some((item) =>
    !item || typeof item.id !== "string" || !/^file-[a-z0-9]{6,}$/.test(item.id) || typeof item.name !== "string" || item.name.length > 255 ||
    !Number.isInteger(item.width) || item.width < 1 || !Number.isInteger(item.height) || item.height < 1 || item.media_type !== "image/jpeg"
  )) return c.json({ error: "Invalid image attachment." }, 400);
  if (imageParts.length > 0) {
    if (!body.turn_id || !body.conversation_id || body.surface && body.surface !== "chat" || body.spoken === true || body.bare === true) return c.json({ error: "Images are available on written chat turns only." }, 400);
    const temporaryImages = isTemporaryConversation(body.conversation_id);
    for (const part of imageParts) {
      let bytes: Uint8Array | undefined;
      if (temporaryImages) {
        const stored = getTemporaryChatImage(actor, body.conversation_id, part.id);
        if (!stored || stored.turnId !== body.turn_id) return c.json({ error: "Picture unavailable." }, 404);
        bytes = stored.bytes;
        if (stored.name !== part.name || stored.width !== part.width || stored.height !== part.height || stored.mediaType !== part.media_type) return c.json({ error: "Picture metadata did not match its stored copy." }, 400);
      } else {
        const row = db.select().from(attachments).where(eq(attachments.id, part.id)).get();
        if (!row || row.ownerPersonId !== actor.id || row.conversationId !== body.conversation_id || row.turnId !== body.turn_id || row.mediaType !== part.media_type) return c.json({ error: "Picture unavailable." }, 404);
        const read = readAttachment(actor, part.id);
        if (!read.ok) return c.json({ error: "Picture unavailable." }, 404);
        bytes = read.value.bytes;
      }
      const metadata = await sharp(bytes).metadata().catch(() => null);
      if (!metadata || metadata.width !== part.width || metadata.height !== part.height) return c.json({ error: "Picture metadata did not match its stored copy." }, 400);
    }
  }
  const parsedEvidence = z.object({ speaker_evidence: evidence.nullish(), present: present.optional(), ask_answer: askAnswer.optional() }).safeParse(body);
  if (!parsedEvidence.success) return c.json({ error: "Invalid turn request", code: "invalid_input" }, 400);
  const surface = (body.surface ?? "chat") as Surface;
  const deviceId = c.get("deviceId");
  const robotName = surface === "robot" && deviceId ? getDeviceById(deviceId)?.name : undefined;
  const spokenTurn = surfaceClassOf(body.bare === true ? "chat" : surface, body.spoken === true) === "spoken";
  // getmaipai/home#91 (a code review of the original ephemeral fix,
  // 2026-09-13): honoring the flag for whatever text a caller sends
  // would let a household member skip their own chat-history/episode
  // write on ordinary content just by setting it, undercutting
  // conversationHistory.ts's own "a parent can see a request was made"
  // guarantee. `isFixedHomeCardQuery()` is the one place the actual
  // allowed question is declared, so a request claiming `ephemeral` is
  // only honored when the text matches it exactly; anything else is
  // logged normally, same as if the flag had never been sent, and
  // warned about here so a stray/misbehaving caller is visible.
  const requestedEphemeral = body.ephemeral === true;
  const ephemeral = requestedEphemeral && isFixedHomeCardQuery(body.text ?? "");
  if (requestedEphemeral && !ephemeral) {
    console.warn(`[turn/stream] ephemeral requested for a non-widget utterance from ${actor.id}; logging it normally`);
  }
  // getmaipai/home#102: the budget is read after the body, since the
  // card's own question (the validated flag, never the claimed one)
  // pays from its own bucket and everything else from the chat budget.
  if (ephemeral ? !personWithinEphemeralBudget(actor.id) : !personWithinTurnBudget(actor.id)) {
    return c.json(RATE_LIMIT_RESPONSE, 429);
  }
  // COR-7 (code review, 2026-09-06): the session controller's signal still
  // reaches all the way to the real fetch (lib/llm.ts's
  // startCompleteStream, spec/llm/ts/client.ts's chatCompleteStream),
  // but a dropped response body only detaches its subscriber. The explicit
  // cancel route fires this signal when the person really stops the turn.
  const abortController = new AbortController();
  // ADMIN-COMPARE-01 (b): the clean 403, checked here (the primary gate) even
  // though beginTurn() (turnMachine/turnNext.ts) asserts the identical two
  // things again on its own and throws BareModeForbidden (the structural
  // backstop).
  if (body.bare === true) {
    if (!isOwnerOrAdmin(actor)) return c.json({ error: "bare mode is owner/admin only" }, 403);
    if (speakerAgeBand(actor, new Date()) !== "adult") return c.json({ error: "bare mode is not available to a minor" }, 403);
  }
  // TEMP-CHAT-01: same shape as bare mode just above - the route-level
  // clean 403, checked again as a structural backstop inside
  // resolveOrCreateConversation() itself.
  if (body.temporary === true && !canHaveTemporaryChat(actor)) {
    return c.json({ error: "temporary chat is not available for minors" }, 403);
  }
  // REASONING-03 (safety ruling, 2026-09-22): same belt-and-braces as
  // the non-stream route above - a minor's turn never asks the model to
  // think, regardless of what `body.thinking` claims, and neither does
  // any turn on a surface with no Reasoning Element to disclose it in
  // (voice/robot/tv/phone) - a review caught the first draft only
  // skipping the model for a minor, leaving a non-chat surface to spend
  // the tokens and latency on a think block dropReasoning discards
  // below anyway.
  const isMinor = speakerAgeBand(actor, new Date()) !== "adult";
  const dropReasoning = isMinor || surface !== "chat" || body.spoken === true; // THIN-5B: a spoken turn has nowhere to show reasoning
  const modelSelection = await resolveTurnModel(body.model, surface, isMinor, body.bare === true);
  let result: TurnStreamResult;
  try {
    // STREAM-NEXT-01: runTurnNextStream(), not runTurnNext() - this route needs
    // the "stream" kind TurnStreamResult (a live status/tokens pair the machine
    // hasn't finished yet), never the "immediate" one the blocking POST / uses.
    // THIN-7C: bare mode is a chat-surface debug bypass (ADMIN-COMPARE-01): the
    // route's 403s above are the primary gate, BareModeForbidden inside the
    // turn the structural backstop. It always runs on the chat surface, with
    // the model the active chat role's, and thinking on.
    const bare = body.bare === true;
    const currentLocation = parseCurrentLocation(body.current_location);
    result = await runTurnNextStream(actor, bare ? "chat" : surface, body.text ?? "", {
      conversationId: body.conversation_id,
      pageContext: body.page_context,
      mentionCompanionId: typeof body.mention_companion_id === "string" ? body.mention_companion_id : undefined,
      tryCompanionId: typeof body.try_companion_id === "string" ? body.try_companion_id : undefined,
      temporary: body.temporary,
      bare,
      spoken: body.spoken === true,
      ...(currentLocation ? { currentLocation } : {}),
      thinking: dropReasoning ? false : body.thinking,
      model: modelSelection.model,
      ...(robotName ? { robotName } : {}),
      ...(surface === "robot" && deviceId ? { deviceId } : {}),
      signal: abortController.signal,
      ask_answer: parsedEvidence.data.ask_answer,
      supersedes: body.supersedes,
      continuation: body.continuation_text === undefined ? undefined : { fromTurnId: body.continuation_of, assistantText: body.continuation_text },
      // A widget's own fixed-utterance query (Home's weather card), never a
      // household member's own words: nothing is stored for it, while it goes
      // through the exact same model/safety/reply path a typed message does
      // (getmaipai/home BACKLOG, found 2026-09-11).
      ephemeral,
      documentAttachments: documentAttachments.map((item) => ({ name: item.name, mediaType: item.media_type, data: item.data })),
      ...(imageParts.length ? { turnId: body.turn_id, images: imageParts } : {}),
      ...(surface === "robot" && !bare ? { speakerEvidence: parsedEvidence.data.speaker_evidence ?? null, present: parsedEvidence.data.present ?? null } : {}), // Evidence is only honored on the robot surface.
    });
  } catch (err) {
    if (err instanceof BareModeForbidden) return c.json({ error: err.message }, 403);
    if (err instanceof DocumentAttachmentError) return c.json({ error: err.message, code: "invalid_document" }, 400);
    throw err;
  }
  if (!result.ok) {
    return c.json({ error: result.error, code: result.code }, result.status);
  }

  // The contract's first line, either way (step 3): "turn_meta" before
  // anything else, so a client always knows which conversation and turn
  // this reply belongs to even if it never reads past the first line.
  const resumeToken = newResumeToken();
  const turnMeta: TurnStreamEvent =
    result.kind === "immediate"
      ? { type: "turn_meta", conversation_id: result.value.conversation_id, turn_id: result.value.turn_id, resume_token: resumeToken }
      : { type: "turn_meta", conversation_id: result.conversationId, turn_id: result.turnId, resume_token: resumeToken, ...(!body.temporary && body.bare !== true && !ephemeral && result.answerMetadata ? { answered_by: result.answerMetadata } : {}) };

  if (result.kind === "immediate") {
    // A safety refusal or a plugin reply is already complete, deterministic
    // text - one "done" event, no artificial trickle for something with
    // nothing left to stream. STREAM-NEXT-01: runTurnNextStream() (this
    // route) returns "stream", not "immediate" - its own
    // `reasoning.emit` gate still runs inside the machine (the state
    // record's "decided once, in context, before the model runs"), so
    // `result.value.reasoning` is already undefined for a minor by
    // construction; stripped here too anyway, the same belt-and-braces
    // every other reasoning site in this route already keeps.
    const value = valueForViewer({ ...result.value, ...(dropReasoning && result.value.reasoning !== undefined ? { reasoning: undefined } : {}), ...(modelSelection.status ? { model_status: modelSelection.status } : {}) }, actor);
    // TOOL-EVENTS-01(b): the new path's own tool_call/tool_result/
    // tool_error lines (chatModelAdapter.ts's toolTimelinePart, its
    // frontend consumer half, landed first) - present only when this
    // turn actually ran a tool (turnNext.ts omits an empty array),
    // always ahead of "done" so the tool timeline is already populated
    // by the time the reply itself arrives.
    const toolEventLines = (result.toolEvents ?? []).map((event) => ndjsonLine(event));
    if (wireFor(c.req.header("accept")) === "assistant-stream") {
      const sink = createAssistantStreamSink();
      for (const event of [turnMeta, { type: "signal", signal: result.signal } as TurnStreamEvent, ...(result.toolEvents ?? []), { type: "done", value } as TurnStreamEvent]) sink.write(event);
      return new Response(sink.readable, { headers: sink.headers });
    }
    const body = new Blob([ndjsonLine(turnMeta), ndjsonLine({ type: "signal", signal: result.signal }), ...toolEventLines, ndjsonLine({ type: "done", value })]);
    return new Response(body, {
      headers: { "content-type": "application/x-ndjson" },
    });
  }

  const session: ResumeSession = {
    generation: 0,
    startedAtMs: Date.now(),
    sttMs: typeof body.stt_ms === "number" && Number.isFinite(body.stt_ms) && body.stt_ms >= 0 && body.stt_ms < 600_000 ? body.stt_ms : null,
    token: resumeToken,
    ownerId: actor.id,
    viewer: actor,
    // The shared, birthdate-aware band (ageBand.ts's own header: role
    // alone is "an independent, less accurate signal") - a review
    // caught the first draft reading actor.role directly, which both
    // excluded teen and could disagree with every other minor-gated
    // decision on this same turn (host.ts's chat-models gate, the retired turn engine's
    // withholdSensitive/mayDefer, composer.ts's child-only projection).
    dropReasoning,
    spokenTurn,
    modelStatus: modelSelection.status,
    conversationId: result.conversationId,
    turnId: result.turnId,
    answerMetadata: !body.temporary && body.bare !== true && !ephemeral ? result.answerMetadata : undefined,
    controller: abortController,
    result,
    events: [],
    subscribers: new Set(),
    sequence: 0,
    terminal: false,
    terminalDelivered: false,
    cancelled: false,
    releasedText: "",
    expired: false,
  };
  resumeSessions.set(session.token, session);
  inFlightTurns.set(session.turnId, session);
  appendSessionEvent(session, { type: "signal", signal: result.signal, generation: session.generation });
  startResumeSession(session);
  const response = streamResponse(session, null, wireFor(c.req.header("accept")));
  // The initial response has a signal in its replay buffer, but its meta
  // event is deliberately sent first and the signal stays immediately next.
  return response;
});
