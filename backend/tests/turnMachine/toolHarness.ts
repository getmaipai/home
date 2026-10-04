// THIN-2G / R2 tests' shared scripted engine: one scripted chat engine that records every
// request (tool-call replies included), a weather tool that fails with a marked raw error,
// and the scripted model replies the retry-round tests use.
import { spyOn } from "bun:test";
import { startRecordingProxy } from "../../scripts/bench/conversationRunner";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";
import * as plugins from "@/lib/plugins";

export const MARKER = "ZXQ-RAW-ERR-7731";
export const NOTE = "I couldn't get the forecast, so I can only say Oslo is usually cool in autumn.";
export const FROM_SEARCH = "The search says Oslo is cool and cloudy today.";

export async function withStub<T>(
  opts: { reply: (request: ChatCompletionRequest) => string; calls: (request: ChatCompletionRequest) => { id: string; name: string; args: string }[] | undefined },
  fn: (seen: ChatCompletionRequest[]) => Promise<T>,
): Promise<T> {
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const seen: ChatCompletionRequest[] = [];
  const stub = startStubLlmServer(0, {
    scriptedChatReply: (request) => {
      // A request with tools is recorded by scriptedToolCalls below (the stub asks it first).
      if (!request.tools || request.tools.length === 0) seen.push(request);
      return opts.reply(request);
    },
    scriptedToolCalls: (request) => {
      if (!request.tools || request.tools.length === 0) return undefined;
      seen.push(request);
      return opts.calls(request)?.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: c.args } }));
    },
  });
  const proxy = startRecordingProxy(stub.url);
  process.env.MAIPAI_LLAMA_SERVER_URL = proxy.url;
  __resetLlmSupervisorForTests();
  try {
    return await fn(seen);
  } finally {
    proxy.stop();
    await stub.stop();
  }
}

/** The retry round's own instruction names what failed and the kind. */
export const isRetryRound = (request: ChatCompletionRequest) => request.tool_choice !== "none" && !request.messages.some((m) => m.role === "tool") && request.messages.at(-1)?.content?.toString().includes("did not happen") === true;
export const hasTools = (request: ChatCompletionRequest) => (request.tools?.length ?? 0) > 0;
export const lastText = (request: ChatCompletionRequest) => request.messages.at(-1)?.content?.toString() ?? "";

/** Runs weather as a failure (raw error carries MARKER) and every other tool for real. */
export function failWeather(error = `upstream said ${MARKER} at https://geo.internal/${MARKER}`, code = "upstream_broke", status: 400 | 502 = 502) {
  const original = plugins.runPlugin;
  const calls: { id: string; args: Record<string, unknown> }[] = [];
  const spy = spyOn(plugins, "runPlugin").mockImplementation(async (id, ...rest) => {
    if (id !== "weather") return original(id, ...rest);
    calls.push({ id, args: rest[1] });
    return { ok: false as const, status, error, code, fallback_reply: { reply: { text: "unused" }, actions: [] } } as never;
  });
  return { spy, calls };
}

/** Weather first; `retryCalls` on the retry round; nothing on the phrasing round (tool_choice none) or after a tool result. */
export function script(retryCalls?: { id: string; name: string; args: string }[]) {
  return (request: ChatCompletionRequest) => {
    if (request.tool_choice === "none" || request.messages.some((m) => m.role === "tool")) return undefined;
    return isRetryRound(request) ? retryCalls : [WEATHER_CALL];
  };
}

/** A search result in the thread: the answer from it; the "did not happen" line: the model's own note. */
export const replies = (request: ChatCompletionRequest) => (request.messages.some((m) => m.role === "tool") ? FROM_SEARCH : lastText(request).includes("did not happen") ? NOTE : "searching");

export const WEATHER_CALL = { id: "call-w", name: "weather", args: JSON.stringify({ place: "Oslo" }) };
export const SEARCH_CALL = { id: "call-s", name: "websearch", args: JSON.stringify({ expression: "oslo weather forecast today" }) };

