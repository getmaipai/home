// The model role port (platform plan 4.11): "Roles, not model names, in
// code." Only `chat` is implemented this pass; every other role is a
// real, named gap, not a silently missing one. See spec/llm/README.md for
// the full scope and why `host.llm.complete` in packageHost.ts still
// isn't wired to this (a real, separate architectural gap: the Host RPC
// boundary is synchronous, this port is inherently async).
import { getChatClient } from "@/lib/llmSupervisor";
import { LlmClientError } from "@maipai/spec/llm/ts/client.js";
import type { ChatRole } from "@maipai/spec/llm/ts/types.js";

export type LlmRole =
  | "chat"
  | "router"
  | "embed"
  | "vision"
  | "image"
  | "video"
  | "coding"
  | "tts"
  | "stt"
  | "wakeword";

const IMPLEMENTED_ROLES: ReadonlySet<LlmRole> = new Set(["chat"]);

export interface LlmMessage {
  role: ChatRole;
  content: string;
}

export interface LlmCompleteOptions {
  temperature?: number;
  max_tokens?: number;
  /** Off by default (Jesse, 2026-09-04: "thinking mode off by default
   * with the ability to enable in chats when needed"): a household
   * member turns it on per message, not a standing mode, since the
   * catalog's one chat model (Qwen3 8B) answers noticeably slower with it
   * on and most turns don't need it. No auto-detect heuristic here on
   * purpose - guessing "does this question need reasoning" is a real,
   * unbuilt research problem (a router role, 4.11's other deferred role),
   * not something to improvise as a side effect of this slice. */
  thinking?: boolean;
}

export interface LlmCompleteValue {
  text: string;
  model: string;
}

export type LlmOpResult =
  | { ok: true; value: LlmCompleteValue }
  | { ok: false; status: 400 | 503; code: "unsupported_role" | "invalid_input" | "unavailable"; error: string };

const VALID_MESSAGE_ROLES: ReadonlySet<string> = new Set(["system", "user", "assistant"]);

export async function complete(
  role: LlmRole,
  messages: LlmMessage[],
  opts: LlmCompleteOptions = {},
): Promise<LlmOpResult> {
  if (!IMPLEMENTED_ROLES.has(role)) {
    return {
      ok: false,
      status: 400,
      code: "unsupported_role",
      error: `the ${role} model role is not implemented on this host build yet (4.11)`,
    };
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, status: 400, code: "invalid_input", error: "messages must be a non-empty array" };
  }
  for (const message of messages) {
    if (!message || typeof message.content !== "string" || !VALID_MESSAGE_ROLES.has(message.role)) {
      return {
        ok: false,
        status: 400,
        code: "invalid_input",
        error: "every message needs role in system|user|assistant and a string content",
      };
    }
  }

  let client;
  try {
    client = await getChatClient();
  } catch (err) {
    return { ok: false, status: 503, code: "unavailable", error: `chat model unavailable: ${(err as Error).message}` };
  }

  try {
    const { thinking, ...rest } = opts;
    const response = await client.chatComplete({
      model: "chat",
      messages,
      ...rest,
      chat_template_kwargs: { enable_thinking: !!thinking },
    });
    const choice = response.choices[0];
    if (!choice) {
      return { ok: false, status: 503, code: "unavailable", error: "chat model returned no choices" };
    }
    return { ok: true, value: { text: choice.message.content, model: response.model } };
  } catch (err) {
    const message = err instanceof LlmClientError ? err.message : (err as Error).message;
    return { ok: false, status: 503, code: "unavailable", error: `chat model unavailable: ${message}` };
  }
}
