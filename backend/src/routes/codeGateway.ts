// CODE-API-01: the coding gateway at /code/v1 (design local-coding-2026-10-17 section 3.6). Anthropic Messages, OpenAI Responses and Chat
// Completions for the Stack's coding role, authenticated by a personal `code` key (lib/apiKeys.ts) and nothing else. Like routes/openai.ts it is a plain
// Hono router: the wires are Anthropic's and OpenAI's contracts, which a tool reads from their docs, not from ours.
//
// The gate chain, in order, on every request:
//   1. transport   HTTPS (plain http only from this machine); home-network source, or a tailnet source when coding.api.away is on; never a proxy or public URL
//   2. the key     bearer or x-api-key; valid, not expired or revoked, scope `code`            -> 401 (one refusal for every bad key)
//   3. the person  their controls read now: not a guest, Coding on, not paused, adult by default or a grant, a minor's grant allowing keys  -> 403 / 503
//   4. the door    coding.api.enabled                                                           -> 503
//   5. the rate    this key's requests a minute                                                 -> 429 + Retry-After
//   6. the body    a request this wire can use                                                  -> 400
//   7. the floor   the person's words, in                                                       -> 403 (crisis: offered, never blocked)
//   8. the day     tokens used today against the cap                                            -> 429 + Retry-After
//   9. streams     requests this person has running or waiting                                  -> 429 + Retry-After
//  10. the queue   a fair, per-person turn at the engine's slots                                -> waits, or 429 when full
//  11. the Stack   the coding role; sampling dropped, thinking clamped (a minor's off), a minor's topic block added
//  12. the floor   the engine's answer, out: text, reasoning and tool arguments; reasoning dropped for a minor; crisis resources added when due
// A failure at any step answers in the wire's own error shape with a sentence that says what went wrong and what to do. No log line or error body carries a
// key, a prompt, a name, a host or an address (rule 6a); the one event recorded is `coding.api_request` with a status class and a duration.
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { requireApiKey, type ApiKeyDoor } from "@/middleware/auth";
import { API_KEY_REFUSAL } from "@/lib/apiKeys";
import { getHouseholdSettingValue } from "@/lib/settings";
import { getStackClient } from "@/lib/stackEngine";
import { StackError } from "@/lib/stack/errors";
import { topicBlockFor } from "@/lib/topicPrompt";
import {
  codingQueue, dailyTokenRefusal, maxStreamsFor, rateRefusal, recordApiRequest, refreshCodingSlots, streamCounter, tokenLedger,
  transportRefusal, type GateRefusal, type Slot,
} from "@/lib/codeGate";
import { alertIfMinor, bandOf, codingFloor, crisisText, inputRefusalLine, outputRefusalLine } from "@/lib/codeSafety";
import {
  appendCrisis, CodeRequestError, errorBody, noteUsage, parseBody, personText, scanReply, shapeRequest, WIRE_PATH, wireOfPath,
  type CodeWire, type Usage,
} from "@/lib/codeWire";
import { gateStream } from "@/lib/codeStream";
import type { AppEnv } from "@/types";

export const codeGatewayRoutes = new Hono<AppEnv>();

const PAUSED_RETRY_SECONDS = 300;
const MAX_BODY_BYTES = 8 * 1024 * 1024; // A long agent conversation is several hundred thousand tokens of text.

function refuse(c: Context, status: number, message: string, code: string, retryAfter?: number): Response {
  const headers: Record<string, string> = { "cache-control": "no-store" };
  if (retryAfter !== undefined) headers["retry-after"] = String(retryAfter);
  return new Response(JSON.stringify(errorBody(wireOfPath(c.req.path), status, message, code)), { status, headers: { ...headers, "content-type": "application/json" } });
}
const refusedBy = (c: Context, r: GateRefusal) => refuse(c, r.status, r.message, r.code, r.retryAfter);

const door: ApiKeyDoor = {
  xApiKey: true,
  refuse: (c, reason) => {
    switch (reason) {
      case "invalid": return refuse(c, 401, API_KEY_REFUSAL, "invalid_api_key");
      case "not_allowed": return refuse(c, 403, "Coding is not turned on for you. Ask an admin.", "coding_not_allowed");
      case "keys_off": return refuse(c, 403, "Your coding access does not include keys. Ask an admin to allow keys in your Coding access.", "keys_not_allowed");
      case "coding_off": return refuse(c, 503, "Coding is turned off in this home. Ask an admin to turn it on in Settings, Coding.", "coding_off", PAUSED_RETRY_SECONDS);
      case "coding_paused": return refuse(c, 503, "Coding is paused by an admin. Try again later.", "coding_paused", PAUSED_RETRY_SECONDS);
    }
  },
};

const viaTransport = async (c: Context, next: () => Promise<void>) => {
  const refusal = transportRefusal(c);
  if (refusal) { recordApiRequest(refusal.status, Date.now()); return refusedBy(c, refusal); }
  return next();
};
const tooLarge = (c: Context) => refuse(c, 413, "This request is too large for the coding service. Start a new conversation or send less at once.", "request_too_large");

function apiDoorOff(c: Context): Response | null {
  return getHouseholdSettingValue("coding.api.enabled") === false
    ? refuse(c, 503, "The coding API is turned off in this home. Ask an admin to turn it on in Settings, Coding.", "api_off", PAUSED_RETRY_SECONDS) : null;
}

const UNEXPECTED = "Coding hit an unexpected problem. Try again; if it keeps happening, ask an admin to check the Status page.";
const ENGINE_DOWN = "Coding is starting or cannot start right now. Try again in a minute; if it keeps failing, ask an admin to check the Status page.";

function thinkingCeiling(): number {
  const v = getHouseholdSettingValue("coding.thinking_budget_ceiling");
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 2000;
}

/** The engine's non-2xx reply as the tool should see it. The Stack's 4xx (a bad request, an engine's context error) pass through as sent; its 5xx become one plain sentence. */
async function mapUpstreamFailure(c: Context, res: { status: number; body: ReadableStream<Uint8Array> | null }): Promise<Response> {
  const status = res.status;
  if (status >= 400 && status < 500 && status !== 404 && status !== 408 && status !== 429) {
    const text = res.body ? (await new Response(res.body).text().catch(() => "")).slice(0, 64 * 1024) : "";
    return new Response(text || JSON.stringify(errorBody(wireOfPath(c.req.path), status, "The coding engine could not use this request.", "engine_rejected")), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  }
  await res.body?.cancel().catch(() => {});
  if (status === 404 || status === 501) return refuse(c, 501, "The coding engine on this computer does not serve this endpoint. Use /code/v1/chat/completions instead, or ask an admin to update the coding engine.", "wire_not_served");
  if (status === 499) return new Response(null, { status: 499 });
  if (status === 429) return refuse(c, 429, "Coding is busy with other requests. Try again in a minute.", "engine_busy", 30);
  if (status === 503 || status === 504) return refuse(c, 503, ENGINE_DOWN, "engine_unavailable", 30);
  return refuse(c, 502, "The coding engine did not answer properly. Send the request again.", "engine_error");
}

async function proxy(c: Context<AppEnv>, wire: CodeWire): Promise<Response> {
  const started = Date.now();
  const person = c.get("person");
  const key = c.get("apiKey");
  const answer = (res: Response) => { recordApiRequest(res.status, started); return res; };
  let endStream: (() => void) | null = null;
  let slot: Slot | null = null;
  const letGo = () => { slot?.release(); slot = null; endStream?.(); endStream = null; };
  try {
    const off = apiDoorOff(c);
    if (off) return answer(off);
    const limited = rateRefusal(key.id, key.requestsPerMinute);
    if (limited) return answer(refusedBy(c, limited));

    let body;
    try { body = parseBody(wire, await c.req.json().catch(() => undefined)); }
    catch (error) { if (error instanceof CodeRequestError) return answer(refuse(c, 400, error.message, "invalid_request")); throw error; }

    const band = bandOf(person);
    const minor = band !== "adult";
    let crisis = false;
    const counts = wire !== "count_tokens";
    if (counts) {
      const text = personText(wire, body);
      if (text.trim()) {
        const verdict = codingFloor(text, band, "in");
        alertIfMinor(person, verdict.result);
        if (verdict.action === "refuse") return answer(refuse(c, 403, inputRefusalLine(band), "safety_refused"));
        crisis = verdict.crisis;
      }
    }
    let shaped;
    try { shaped = shapeRequest(wire, body, { ceiling: thinkingCeiling(), minor, topicBlock: minor ? topicBlockFor(band, person.id) : "" }); }
    catch (error) { if (error instanceof CodeRequestError) return answer(refuse(c, 400, error.message, "invalid_request")); throw error; }

    if (counts) {
      const day = dailyTokenRefusal(person);
      if (day) return answer(refusedBy(c, day));
      endStream = streamCounter.begin(person.id, maxStreamsFor(person));
      if (!endStream) return answer(refuse(c, 429, "You already have as many coding requests running as your access allows. Wait for one to finish, then try again.", "too_many_streams", 5));
      await refreshCodingSlots();
      const got = await codingQueue.acquire(person.id, c.req.raw.signal);
      if (got === "aborted") { letGo(); return answer(new Response(null, { status: 499 })); }
      if (got === "full" || got === "timeout") { letGo(); return answer(refuse(c, 429, "Coding is busy with other people's requests. Try again in a minute.", "queue_full", 30)); }
      slot = got;
    }

    const client = getStackClient();
    if (!client.codingWire) { letGo(); return answer(refuse(c, 503, ENGINE_DOWN, "engine_unavailable", 30)); }
    let upstream;
    try { upstream = await client.codingWire(WIRE_PATH[wire], shaped, { signal: c.req.raw.signal }); }
    catch (error) {
      letGo();
      if (c.req.raw.signal.aborted) return answer(new Response(null, { status: 499 }));
      return answer(error instanceof StackError ? refuse(c, 503, ENGINE_DOWN, "engine_unavailable", 30) : refuse(c, 502, UNEXPECTED, "gateway_error"));
    }
    if (upstream.status < 200 || upstream.status >= 300 || !upstream.body) { letGo(); return answer(await mapUpstreamFailure(c, upstream)); }

    const settle = (usage: Usage) => { tokenLedger.add(person.id, usage.input + usage.output); letGo(); };
    const wantsStream = counts && body.stream === true && (upstream.headers.get("content-type") ?? "").includes("text/event-stream");
    if (wantsStream) {
      const stream = gateStream(upstream.body, {
        wire, band, crisis,
        onFinish: ({ usage, outcome }) => { settle(usage); recordApiRequest(outcome === "ok" ? 200 : outcome === "refused" ? 403 : outcome === "cancelled" ? 499 : 502, started); },
      });
      return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-store", "x-accel-buffering": "no" } });
    }

    let reply: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(await new Response(upstream.body).text());
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      reply = parsed as Record<string, unknown>;
    } catch { letGo(); return answer(refuse(c, 502, "The coding engine did not answer properly. Send the request again.", "engine_error")); }
    const usage: Usage = { input: 0, output: 0 };
    noteUsage(usage, reply);
    settle(usage);
    if (wire === "count_tokens") return answer(new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } }));
    const { scan, reply: scrubbed } = scanReply(wire, reply, minor);
    const out = codingFloor([minor ? "" : scan.reasoning, scan.text, scan.args].filter(Boolean).join("\n"), band, "out");
    if (out.action === "refuse") return answer(refuse(c, 403, outputRefusalLine(band), "safety_refused"));
    const final = crisis || out.crisis ? appendCrisis(wire, scrubbed, crisisText()) : scrubbed;
    return answer(new Response(JSON.stringify(final), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } }));
  } catch {
    // Never echo or log the error: its text could carry part of the request.
    letGo();
    return answer(refuse(c, 500, UNEXPECTED, "gateway_error"));
  }
}

const limit = bodyLimit({ maxSize: MAX_BODY_BYTES, onError: tooLarge });
for (const [path, wire] of [["/messages", "messages"], ["/messages/count_tokens", "count_tokens"], ["/responses", "responses"], ["/chat/completions", "chat"]] as const) {
  codeGatewayRoutes.post(path, viaTransport, requireApiKey("code", door), limit, (c) => proxy(c, wire));
}

codeGatewayRoutes.get("/models", viaTransport, requireApiKey("code", door), async (c) => {
  const started = Date.now();
  const answer = (res: Response) => { recordApiRequest(res.status, started); return res; };
  const off = apiDoorOff(c);
  if (off) return answer(off);
  const limited = rateRefusal(c.get("apiKey").id, c.get("apiKey").requestsPerMinute);
  if (limited) return answer(refusedBy(c, limited));
  try {
    const client = getStackClient();
    if (!client.codingModels) return answer(refuse(c, 503, ENGINE_DOWN, "engine_unavailable", 30));
    const served = (await client.codingModels({ signal: c.req.raw.signal })).data.find(m => m.role === undefined || m.role === "coding");
    const entry = (id: string) => ({ id, object: "model", created: 0, owned_by: "maipai-home", ...(served?.context_length ? { context_length: served.context_length } : {}) });
    const data = served ? [entry("maipai-coder"), ...(served.id !== "maipai-coder" ? [entry(served.id)] : [])] : [];
    return answer(new Response(JSON.stringify({ object: "list", data }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } }));
  } catch (error) {
    return answer(error instanceof StackError ? refuse(c, 503, ENGINE_DOWN, "engine_unavailable", 30) : refuse(c, 500, UNEXPECTED, "gateway_error"));
  }
});
