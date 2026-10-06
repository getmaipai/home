// A scripted Stack whose chat engine holds `contextTokens` (per slot) and
// refuses a prompt that does not fit beside its max_tokens the way
// llama-server does (a 400 naming n_prompt_tokens and n_ctx). The count
// route uses the spec stub's own template and tokenizer, so Home's counts
// and the engine's agree; a fold request (model "judge") gets a short
// summary. Shared by the compaction tests (THIN-3C, THIN-3F, THIN-3G).
import { startStackFixture, IDENTITY_HEADERS, type StackFixture } from "../stackFixture";
import { __setStackClientForTests } from "@/lib/stackEngine";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __setChatWindowContextForTests } from "@/lib/roleHealth";
import { stubRenderTemplate, stubTokenize, startStubLlmServer, type StubLlmServerHandle } from "@maipai/spec/llm/ts/stubServer.js";

type Body = { messages?: Array<{ role?: unknown; content?: unknown }>; tools?: unknown[]; model?: string; max_tokens?: number };

export interface ContextEngine {
  fixture: StackFixture;
  /** Prompt sizes the engine refused as too large. */
  refused: number[];
  /** Every fold prompt the background role was sent. */
  summaryPrompts: string[];
  /** Every chat request the engine answered. */
  chatBodies: Body[];
  stop(): Promise<void>;
}

export const sizeOf = (body: Body): number => stubTokenize(stubRenderTemplate(body.messages ?? [], body.tools)).length;

export function startContextEngine(contextTokens: number, reply = "A reply of a few words."): ContextEngine {
  const engine: StubLlmServerHandle = startStubLlmServer(0, { scriptedChatReply: () => reply });
  const refused: number[] = [];
  const summaryPrompts: string[] = [];
  const chatBodies: Body[] = [];
  const fixture = startStackFixture({
    "POST /v1/tokenize": async (req) => Response.json({ count: sizeOf(await req.json() as Body) }, { headers: IDENTITY_HEADERS }),
    "POST /v1/chat/completions": async (req) => {
      const body = await req.json() as Body;
      if (body.model === "judge") {
        summaryPrompts.push(JSON.stringify(body.messages));
        return Response.json({ choices: [{ index: 0, message: { role: "assistant", content: `Summary ${summaryPrompts.length}: they talked about the garden.` }, finish_reason: "stop" }] }, { headers: IDENTITY_HEADERS });
      }
      const prompt = sizeOf(body);
      if (prompt + (body.max_tokens ?? 0) > contextTokens) {
        refused.push(prompt);
        return Response.json({ error: { code: 400, type: "exceed_context_size_error", message: `the request (${prompt} tokens) exceeds the available context size (${contextTokens} tokens), try increasing it`, n_prompt_tokens: prompt, n_ctx: contextTokens } }, { status: 400, headers: IDENTITY_HEADERS });
      }
      chatBodies.push(body);
      const upstream = await fetch(`${engine.url}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const headers = new Headers(upstream.headers);
      for (const [k, v] of Object.entries(IDENTITY_HEADERS)) headers.set(k, v);
      return new Response(upstream.body, { status: upstream.status, headers });
    },
    "POST /v1/embeddings": async (req) => fetch(`${engine.url}/v1/embeddings`, { method: "POST", headers: { "content-type": "application/json" }, body: await req.text() }),
    "GET /stack/v1/roles": async () => Response.json({ roles: ["chat", "embed", "judge"].map((id) => ({ id, state: { state: "ready", since: "scripted-test" }, reason: null })) }),
    "GET /stack/v1/health": async () => Response.json({ health: [] }),
  });
  __setStackClientForTests(fixture.client);
  setHouseholdSettingValue("engines.stack.url", fixture.url);
  __setChatWindowContextForTests(contextTokens);
  return {
    fixture,
    refused,
    summaryPrompts,
    chatBodies,
    stop: async () => {
      fixture.stop();
      await engine.stop();
    },
  };
}
