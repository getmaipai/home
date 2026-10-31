// CODE-API-01: what the coding gateway does to a request and to the engine's reply, wire by wire. The engine's own bytes are the answer (rule 2):
// Home never re-wraps a template or re-parses a tool call. It does only what the design (local-coding-2026-10-17 section 3.6 and 3.7) lists:
// drop client sampling, clamp the thinking budget, turn thinking off and add the band's topic block for a minor, read the engine's parsed
// text, reasoning and tool-argument fields to run the safety floor on them, drop reasoning parts for a minor, and add the crisis resources
// as a text part. Nothing here logs, and no function here keeps a prompt past the call.
import type { CodingWirePath } from "@/lib/stack/client";
import { withTopicBlock } from "@/lib/topicPrompt";
import type { LlmMessage } from "@/lib/llm";

export type CodeWire = "messages" | "count_tokens" | "responses" | "chat";
export const WIRE_PATH: Record<CodeWire, CodingWirePath> = {
  messages: "/v1/messages", count_tokens: "/v1/messages/count_tokens", responses: "/v1/responses", chat: "/v1/chat/completions",
};
type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => v !== null && typeof v === "object" && !Array.isArray(v);

/** A request the gateway cannot use; `message` says what to change. Never carries any of the request's own text. */
export class CodeRequestError extends Error {}

/** The same list the Stack drops (stack lib/codingWire.ts DROPPED_CLIENT_SAMPLING): the model's own settings decide, not the client's defaults. */


// ---- request ------------------------------------------------------------------------------------------------------------------------

/** The body of a coding request, or the plain reason it cannot be used. */
export function parseBody(wire: CodeWire, value: unknown): Json {
  if (!isObj(value)) throw new CodeRequestError("Send a JSON object as the request body.");
  if (wire === "responses") {
    if (typeof value.input !== "string" && !Array.isArray(value.input)) throw new CodeRequestError("Send `input` as text or a list, the way your tool normally does.");
  } else if (!Array.isArray(value.messages)) throw new CodeRequestError("Send `messages` as a list, the way your tool normally does.");
  return value;
}

function textOfParts(content: unknown, partTypes: readonly string[]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter(isObj).filter(p => partTypes.includes(String(p.type)) && typeof p.text === "string").map(p => p.text as string).join("\n");
}

/** The person's own newest words in the request. Earlier turns were checked when they were new and tool results are not the person's words, so only
 * the last message counts, and only when it is the person's. */
export function personText(wire: CodeWire, body: Json): string {
  if (wire === "responses") {
    if (typeof body.input === "string") return body.input;
    const last = (body.input as unknown[]).at(-1);
    return isObj(last) && last.role === "user" ? textOfParts(last.content, ["input_text", "text"]) : "";
  }
  const last = (body.messages as unknown[]).at(-1);
  return isObj(last) && last.role === "user" ? textOfParts(last.content, ["text"]) : "";
}

function clampOne(value: unknown, ceiling: number, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new CodeRequestError(`${field} must be a number of tokens. Send a whole number, or leave it out to use the household's limit of ${ceiling}.`);
  return value < 0 ? ceiling : Math.min(Math.floor(value), ceiling);
}

/** The fields each wire defines and the coding role honours. Anything else a client sends (an engine's own `id_slot`, `lora`, `n_predict`, `grammar`, `cache_prompt`)
 * is dropped. Thinking fields are not here: they are rebuilt below from the ceiling. */
const ALLOWED: Record<CodeWire, readonly string[]> = {
  messages: ["model", "messages", "system", "max_tokens", "stream", "tools", "tool_choice", "stop_sequences", "metadata"],
  count_tokens: ["model", "messages", "system", "tools", "tool_choice"],
  chat: ["model", "messages", "max_tokens", "max_completion_tokens", "stream", "stream_options", "tools", "tool_choice", "parallel_tool_calls", "stop", "seed", "logit_bias", "response_format", "user"],
  responses: ["model", "input", "instructions", "max_output_tokens", "stream", "tools", "tool_choice", "parallel_tool_calls", "text", "user", "metadata", "previous_response_id"],
};
/** The cap on one answer when the client names none, so a request cannot ask the engine for an unbounded answer by leaving the limit out. */
export const DEFAULT_OUTPUT_TOKENS = 16384;
const EFFORTS = ["none", "minimal", "low", "medium"];

export interface ShapeOptions { ceiling: number; minor: boolean; topicBlock: string }

/** True when the client asked for thinking in any of the ways the wires have. */
function asksForThinking(b: Json): boolean {
  const thinking = isObj(b.thinking) ? b.thinking : null;
  const reasoning = isObj(b.reasoning) ? b.reasoning : null;
  const kwargs = isObj(b.chat_template_kwargs) ? b.chat_template_kwargs : null;
  return (thinking !== null && thinking.type !== "disabled") || (b.thinking_budget_tokens !== undefined && b.thinking_budget_tokens !== 0)
    || (typeof b.reasoning_effort === "string" && b.reasoning_effort !== "none") || (typeof reasoning?.effort === "string" && reasoning.effort !== "none")
    || kwargs?.enable_thinking === true;
}

/** The request the Stack gets. Never raises a budget: a client that asks for thinking in any form gets the ceiling at most, a minor (or a ceiling of 0) gets an
 * explicit off in the wire's own words. */
export function shapeRequest(wire: CodeWire, body: Json, o: ShapeOptions): Json {
  const out: Json = {};
  for (const key of ALLOWED[wire]) if (body[key] !== undefined) out[key] = body[key];
  out.model = "coding"; // The gateway serves the coding role whatever model name the tool sends (Claude Code sends its own for background calls).
  const ceiling = Math.max(0, Math.floor(o.ceiling));
  if (isObj(body.thinking) && body.thinking.budget_tokens !== undefined) clampOne(body.thinking.budget_tokens, ceiling, "thinking.budget_tokens");
  if (body.thinking !== undefined && body.thinking !== null && !isObj(body.thinking)) throw new CodeRequestError("thinking must be an object like {\"type\": \"enabled\", \"budget_tokens\": 1000}.");
  if (body.thinking_budget_tokens !== undefined) clampOne(body.thinking_budget_tokens, ceiling, "thinking_budget_tokens");

  if (o.minor || ceiling === 0) {
    // A minor's turn never receives reasoning, because the hub does not ask for it (SAFETY.md, owner's ruling 2026-09-22). The Stack makes an explicit off real.
    out.chat_template_kwargs = { enable_thinking: false };
    if (wire === "messages" || wire === "count_tokens") out.thinking = { type: "disabled" };
    if (wire === "responses") out.reasoning = { effort: "none" };
  } else if (asksForThinking(body)) {
    const own = isObj(body.thinking) && body.thinking.budget_tokens !== undefined ? body.thinking.budget_tokens : body.thinking_budget_tokens;
    const budget = own === undefined ? ceiling : clampOne(own, ceiling, "thinking budget");
    const effort = (v: unknown) => (typeof v === "string" && EFFORTS.includes(v) ? v : "medium"); // "high" and anything unknown is held to medium
    if (wire === "messages" || wire === "count_tokens") out.thinking = { type: "enabled", budget_tokens: budget };
    else {
      out.thinking_budget_tokens = budget;
      if (wire === "chat" && body.reasoning_effort !== undefined) out.reasoning_effort = effort(body.reasoning_effort);
      if (wire === "responses" && isObj(body.reasoning)) out.reasoning = { ...(typeof body.reasoning.summary === "string" ? { summary: body.reasoning.summary } : {}), effort: effort(body.reasoning.effort) };
    }
  } else if (isObj(body.thinking) && body.thinking.type === "disabled" && (wire === "messages" || wire === "count_tokens")) out.thinking = { type: "disabled" };

  const positive = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0;
  if (wire === "messages" && !positive(out.max_tokens)) out.max_tokens = DEFAULT_OUTPUT_TOKENS;
  if (wire === "chat" && !positive(out.max_tokens) && !positive(out.max_completion_tokens)) out.max_tokens = DEFAULT_OUTPUT_TOKENS;
  if (wire === "responses" && !positive(out.max_output_tokens)) out.max_output_tokens = DEFAULT_OUTPUT_TOKENS;
  // The engine reports usage on a chat stream only when asked; the daily cap counts it.
  if (wire === "chat" && out.stream === true) out.stream_options = { ...(isObj(body.stream_options) ? body.stream_options : {}), include_usage: true };

  if (o.topicBlock) {
    // The band's topic block is the first system part of every minor's call.
    if (wire === "responses") out.instructions = typeof out.instructions === "string" && out.instructions ? `${o.topicBlock}\n\n${out.instructions}` : o.topicBlock;
    else if (wire === "chat") out.messages = withTopicBlock(o.topicBlock, out.messages as LlmMessage[]);
    else if (typeof out.system === "string" && out.system) out.system = `${o.topicBlock}\n\n${out.system}`;
    else if (Array.isArray(out.system)) out.system = [{ type: "text", text: o.topicBlock }, ...out.system];
    else out.system = o.topicBlock;
  }
  return out;
}

// ---- everything a person put in a request -----------------------------------------------------------------------------------------------

/** Keys whose strings are structure, not words. */
const STRUCTURAL = new Set(["type", "id", "role", "model", "object", "status", "stop_reason", "stop_sequence", "finish_reason", "name", "call_id", "item_id", "tool_use_id", "tool_call_id", "output_index", "content_index", "index", "media_type", "system_fingerprint", "service_tier", "signature", "event", "created", "created_at"]);
/** Every string of words in `value`: nested content, tool results, documents, anything. Base64 payloads are not words. */
export function collectText(value: unknown, into: string[] = [], key = "", parent: Json | null = null): string[] {
  if (typeof value === "string") {
    const binary = key === "data" && parent !== null && (parent.type === "base64" || (typeof parent.media_type === "string" && !parent.media_type.startsWith("text/")));
    if (!STRUCTURAL.has(key) && !binary && value.trim()) into.push(value);
  } else if (Array.isArray(value)) for (const v of value) collectText(v, into, key, parent);
  else if (isObj(value)) for (const [k, v] of Object.entries(value)) collectText(v, into, k, value);
  return into;
}
/** For a minor: all of the request the person (or their tool, on their behalf) supplied, not just the newest message. Tool definitions are the tool's own configuration and are not read. */
export function allRequestText(wire: CodeWire, body: Json): string {
  const parts: string[] = [];
  for (const field of ["messages", "system", "input", "instructions"]) if (body[field] !== undefined) collectText(body[field], parts);
  return parts.join("\n");
}

// ---- errors in the wire's own shape ---------------------------------------------------------------------------------------------------

const ANTHROPIC_TYPES: Record<number, string> = { 400: "invalid_request_error", 401: "authentication_error", 403: "permission_error", 413: "request_too_large", 429: "rate_limit_error", 500: "api_error", 501: "api_error", 502: "api_error", 503: "overloaded_error" };
const WIRE_OF_PATH: Array<[RegExp, CodeWire]> = [[/\/messages\/count_tokens\/?$/, "count_tokens"], [/\/messages\/?$/, "messages"], [/\/responses\/?$/, "responses"], [/\/chat\/completions\/?$/, "chat"]];
export function wireOfPath(path: string): CodeWire | null { return WIRE_OF_PATH.find(([re]) => re.test(path))?.[1] ?? null; }

/** A gateway refusal as the tool expects to read it. Claude Code reads Anthropic's `{type:"error", error:{type, message}}`; every OpenAI client reads `{error:{message, type, code}}`. */
export function errorBody(wire: CodeWire | null, status: number, message: string, code: string): Json {
  if (wire === "messages" || wire === "count_tokens") return { type: "error", error: { type: ANTHROPIC_TYPES[status] ?? "api_error", message } };
  return { error: { message, type: status === 429 ? "rate_limit_error" : status === 403 || status === 401 ? "permission_error" : "api_error", code } };
}

/** An error inside an event stream that already started. */
export function errorFrame(wire: CodeWire, message: string, code: string): string {
  if (wire === "messages") return `event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "api_error", message } })}\n\n`;
  if (wire === "responses") return `event: error\ndata: ${JSON.stringify({ type: "error", code, message })}\n\n`;
  return `data: ${JSON.stringify({ error: { message, type: "api_error", code } })}\n\ndata: [DONE]\n\n`;
}

// ---- reply: scanning, scrubbing, usage ------------------------------------------------------------------------------------------------

export interface Scan { text: string; reasoning: string; args: string }
export interface Usage { input: number; output: number }
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

/** The engine's own usage counts; the larger value seen wins because a stream reports input at its start and output at its end. */
export function noteUsage(into: Usage, j: unknown): void {
  if (!isObj(j)) return;
  const sources = [j.usage, isObj(j.message) ? j.message.usage : undefined, isObj(j.response) ? j.response.usage : undefined];
  for (const u of sources) {
    if (!isObj(u)) continue;
    into.input = Math.max(into.input, num(u.input_tokens), num(u.prompt_tokens));
    into.output = Math.max(into.output, num(u.output_tokens), num(u.completion_tokens));
  }
}

const REASONING_ITEMS = new Set(["thinking", "redacted_thinking", "reasoning"]);
const stringify = (v: unknown) => { try { return typeof v === "string" ? v : JSON.stringify(v) ?? ""; } catch { return ""; } };

/** What a whole (non-streamed) reply says, and the reply with reasoning parts removed. */
export function scanReply(wire: CodeWire, json: Json, dropReasoning: boolean): { scan: Scan; reply: Json } {
  const scan: Scan = { text: "", reasoning: "", args: "" };
  const reply: Json = { ...json };
  if (wire === "messages" && Array.isArray(json.content)) {
    const kept: unknown[] = [];
    for (const block of json.content) {
      if (!isObj(block)) { kept.push(block); continue; }
      if (block.type === "text") scan.text += String(block.text ?? "");
      else if (block.type === "tool_use") scan.args += stringify(block.input);
      else if (REASONING_ITEMS.has(String(block.type))) { scan.reasoning += String(block.thinking ?? ""); if (dropReasoning) continue; }
      kept.push(block);
    }
    reply.content = kept;
  } else if (wire === "chat" && Array.isArray(json.choices)) {
    reply.choices = json.choices.map(choice => {
      if (!isObj(choice) || !isObj(choice.message)) return choice;
      const message: Json = { ...choice.message };
      scan.text += textOfParts(message.content, ["text"]);
      for (const key of ["reasoning_content", "reasoning"]) {
        if (typeof message[key] === "string") scan.reasoning += message[key] as string;
        if (dropReasoning) delete message[key];
      }
      if (Array.isArray(message.tool_calls)) for (const call of message.tool_calls) if (isObj(call) && isObj(call.function)) scan.args += stringify(call.function.arguments);
      return { ...choice, message };
    });
  } else if (wire === "responses" && Array.isArray(json.output)) {
    const kept: unknown[] = [];
    for (const item of json.output) {
      if (!isObj(item)) { kept.push(item); continue; }
      if (item.type === "message") scan.text += textOfParts(item.content, ["output_text", "text"]);
      else if (item.type === "function_call") scan.args += stringify(item.arguments);
      else if (item.type === "reasoning") { scan.reasoning += stringify(item.summary) + stringify(item.content); if (dropReasoning) continue; }
      kept.push(item);
    }
    reply.output = kept;
  }
  return { scan, reply };
}

/** The crisis resources as a text part of a whole reply, in the wire's own shape. */
export function appendCrisis(wire: CodeWire, reply: Json, text: string): Json {
  if (wire === "messages" && Array.isArray(reply.content)) return { ...reply, content: [...reply.content, { type: "text", text }] };
  if (wire === "chat" && Array.isArray(reply.choices) && isObj(reply.choices[0]) && isObj(reply.choices[0].message)) {
    const first = reply.choices[0] as Json; const message = first.message as Json;
    const existing = typeof message.content === "string" ? message.content : "";
    return { ...reply, choices: [{ ...first, message: { ...message, content: existing ? `${existing}\n\n${text}` : text } }, ...reply.choices.slice(1)] };
  }
  if (wire === "responses" && Array.isArray(reply.output)) {
    return { ...reply, output: [...reply.output, { type: "message", id: "msg_crisis_resources", status: "completed", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] }] };
  }
  return reply;
}

// ---- reply: event streams -----------------------------------------------------------------------------------------------------------

export interface Frame { raw: string; event: string | null; data: string }

/** Splits a text/event-stream into whole frames. `raw` is the frame exactly as it arrived, blank line included. */
export function createFrameParser() {
  let rest = "";
  return {
    push(chunk: string): Frame[] {
      rest += chunk;
      const frames: Frame[] = [];
      for (;;) {
        const m = /\r?\n\r?\n/.exec(rest);
        if (!m) break;
        const raw = rest.slice(0, m.index + m[0].length);
        rest = rest.slice(m.index + m[0].length);
        frames.push(toFrame(raw));
      }
      return frames;
    },
    flush(): Frame[] { const raw = rest; rest = ""; return raw.trim() ? [toFrame(raw)] : []; },
  };
}
function toFrame(raw: string): Frame {
  let event: string | null = null; const data: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  return { raw, event, data: data.join("\n") };
}
const serialise = (event: string | null, j: unknown) => `${event ? `event: ${event}\n` : ""}data: ${JSON.stringify(j)}\n\n`;

export type Channel = "text" | "reasoning" | "args" | "other";
export interface Classified {
  channel: Channel;
  text: string;
  /** True when the frame only exists to carry reasoning (dropped whole for a minor); false when scrubbing it leaves something to forward. */
  dropWhole: boolean;
  /** The frame with its text replaced, for a text frame. */
  withText?: (text: string) => string;
  /** The frame without its reasoning, when only part of it is reasoning (used when reasoning is dropped). */
  scrubbed?: string;
  /** The frame's parsed JSON, for usage counts. */
  json?: unknown;
  /** What the safety floor reads in this frame when that is more than `text` (a delta with text and tool arguments, or a frame of a shape this gateway does not know). */
  checkText?: string;
}
export interface FrameState { reasoningBlocks: Set<number>; dropReasoning: boolean }

/** One frame, read for the safety floor and for reasoning. `state` carries the indexes of reasoning blocks across frames. */
export function classifyFrame(wire: CodeWire, frame: Frame, state: FrameState): Classified {
  if (!frame.data || frame.data === "[DONE]") return { channel: "other", text: "", dropWhole: false };
  let j: unknown;
  // Data that is not JSON could carry anything, so it is read as text.
  try { j = JSON.parse(frame.data); } catch { return { channel: "other", text: "", dropWhole: false, checkText: frame.data }; }
  if (!isObj(j)) return { channel: "other", text: "", dropWhole: false, checkText: frame.data };
  const c = classifyParsed(wire, frame, j, state);
  // A frame this gateway has no name for is read for any words in it (a `.done` event, an initial content block, a refusal field).
  const checkText = c.checkText ?? (c.channel === "other" ? collectText(j).join("\n") || undefined : undefined);
  return { ...c, json: j, ...(checkText !== undefined ? { checkText } : {}) };
}

function classifyParsed(wire: CodeWire, frame: Frame, j: Json, state: FrameState): Classified {
  const other: Classified = { channel: "other", text: "", dropWhole: false };
  if (wire === "messages") {
    const index = typeof j.index === "number" ? j.index : -1;
    if (j.type === "content_block_start" && isObj(j.content_block) && REASONING_ITEMS.has(String(j.content_block.type))) { state.reasoningBlocks.add(index); return { channel: "reasoning", text: "", dropWhole: true }; }
    if (j.type === "content_block_stop" && state.reasoningBlocks.has(index)) return { channel: "reasoning", text: "", dropWhole: true };
    if (j.type === "content_block_delta" && isObj(j.delta)) {
      const d = j.delta;
      if (state.reasoningBlocks.has(index) || d.type === "thinking_delta" || d.type === "signature_delta") return { channel: "reasoning", text: String(d.thinking ?? ""), dropWhole: true };
      if (d.type === "text_delta") return { channel: "text", text: String(d.text ?? ""), dropWhole: false, withText: t => serialise(frame.event, { ...j, delta: { ...d, text: t } }) };
      if (d.type === "input_json_delta") return { channel: "args", text: String(d.partial_json ?? ""), dropWhole: false };
    }
    return other;
  }
  if (wire === "chat") {
    const choice = Array.isArray(j.choices) ? j.choices[0] : undefined;
    if (!isObj(choice) || !isObj(choice.delta)) return other;
    const d = choice.delta;
    const reasoning = ["reasoning_content", "reasoning"].map(k => d[k]).filter((v): v is string => typeof v === "string").join("");
    const hasReasoningKey = "reasoning_content" in d || "reasoning" in d;
    const args = Array.isArray(d.tool_calls) ? d.tool_calls.map(c => (isObj(c) && isObj(c.function) ? stringify(c.function.arguments) : "")).join("") : "";
    const text = typeof d.content === "string" ? d.content : "";
    const clean: Json = { ...d }; delete clean.reasoning_content; delete clean.reasoning;
    const rest = (j.choices as unknown[]).slice(1);
    const withDelta = (delta: Json) => serialise(frame.event, { ...j, choices: [{ ...choice, delta }, ...rest] });
    const empty = Object.keys(clean).length === 0 && !choice.finish_reason;
    const scrubbed = hasReasoningKey && !empty ? withDelta(clean) : undefined;
    if (hasReasoningKey && !text && !args) return { channel: "reasoning", text: reasoning, dropWhole: empty, scrubbed };
    const base = state.dropReasoning ? clean : d;
    const both = text && args ? `${text}\n${args}` : undefined; // a delta can carry words and a tool call's arguments together: both are read
    if (text) return { channel: "text", text, dropWhole: false, scrubbed, checkText: both, withText: t => withDelta({ ...base, content: t }) };
    if (args) return { channel: "args", text: args, dropWhole: false, scrubbed };
    return other;
  }
  // responses
  const type = String(j.type ?? "");
  if (type.startsWith("response.reasoning")) return { channel: "reasoning", text: String(j.delta ?? j.text ?? ""), dropWhole: true };
  if ((type === "response.output_item.added" || type === "response.output_item.done") && isObj(j.item) && j.item.type === "reasoning") return { channel: "reasoning", text: "", dropWhole: true };
  if (type === "response.output_text.delta") return { channel: "text", text: String(j.delta ?? ""), dropWhole: false, withText: t => serialise(frame.event, { ...j, delta: t }) };
  if (type === "response.function_call_arguments.delta") return { channel: "args", text: String(j.delta ?? ""), dropWhole: false };
  if (isObj(j.response) && Array.isArray(j.response.output) && j.response.output.some(i => isObj(i) && i.type === "reasoning")) {
    return { channel: "other", text: "", dropWhole: false, scrubbed: serialise(frame.event, { ...j, response: { ...j.response, output: j.response.output.filter(i => !(isObj(i) && i.type === "reasoning")) } }) };
  }
  return other;
}
