// CODE-AGENT-01 (slice three): the OpenCode driver. It runs `opencode run --format json` inside the session's sandbox (lib/codingSandbox.ts exec), pointed at
// the household coding gateway with the session's key and tier, and turns what it prints into the bridge's events (lib/codingBridge.ts). Stop and the wall-clock
// budget abort the turn's signal, which ends the exec. UNVERIFIED AGAINST A REAL OPENCODE: the event field names below follow OpenCode's JSON run output as
// documented, and an event this mapper does not know is skipped, never guessed. Home maps no tier to a model (rule E): the tier travels as a header on the
// provider block and the gateway/Stack resolve the slot; the gateway does not read that header yet (see the slice notes).
//
// Approvals, per action where `opencode run` allows it (it cannot ask mid-run): in Ask mode a turn starts with edits and commands off. When OpenCode reports a
// tool refused for permission, the driver records the action (a command or a file path), lets the run finish, then asks the brake for that one action; each
// "allow" turns that permission on and the run continues (`--continue`) at most MAX_ROUNDS times. So the person is asked about the command or file the agent
// actually wanted, not about a whole turn. Auto edit asks the brake once up front (a command after outside content asks); plan never writes. Network fetches are
// always off (the sandbox has no network and a new host is the person's click). Truly mid-run asks need OpenCode's server mode, which needs a port to the sandbox.
import { CodingTurnError, type CodingAgent, type CodingTurnResult } from "@/lib/codingTurns";
import type { AgentEvent, CodingHost } from "@/lib/codingBridge";
import type { ExecSandbox } from "@/lib/codingSandbox";
import { listCodingMessages } from "@/lib/codingTranscript";

import type { Tier } from "@/lib/tiers";

export const MAX_ARG_CHARS = 100_000;
export const GATEWAY_MODEL = "coding";

export interface OpenCodeDeps {
  sandbox: ExecSandbox;
  /** The gateway's address as the sandbox sees it (host-only network), e.g. `http://192.0.2.1:3000/code/v1`; null when not configured. */
  gatewayUrl: () => string | null;
  /** The session-scoped key the agent presents to the gateway; null when none can be made. Never logged, never stored in a record. */
  /** Whether session keys can be made at all; false keeps every turn from starting (nothing would be able to reach the gateway). */
  canMintKeys: () => boolean;
  sessionKey: (input: { personId: string; sessionId: string; tier: Tier }) => Promise<string | null>;
}

/** What the agent is told it is in (verified against OpenCode 1.19.6: `agent.build.prompt` replaces the stock prompt, which says nothing about this sandbox). */
export const SANDBOX_PROMPT = [
  "You are the coding agent of MaiPai Home. You work inside a private sandbox: your project folder is /workspace, and nothing outside it exists for you. There is no internet.",
  "You have tools to read and search files, and (outside plan mode) to edit and write files and to run commands. Use the tools you are given to do the task; never paste a whole file or script into your answer in place of writing it.",
  "Some actions wait for the person's approval. If a tool call is refused, do not apologise or print the content instead: the person is asked, and you carry on when they allow it. In plan mode you only read and propose a plan.",
  "Keep answers short and plain. Say what you changed and where.",
].join("\n");

export function openCodeConfig(input: { gatewayUrl: string; key: string; tier: Tier; allowEdit: boolean; allowBash: boolean; readOnly?: boolean }): string {
  // "deny" hides a tool from the model altogether (the model then says it has no such tool and prints the script); "ask" keeps it visible and `opencode run` refuses the call
  // with "rejected permission", which is how a per-action ask starts. Only plan mode (read-only) uses "deny".
  const rule = (allowed: boolean) => (allowed ? "allow" : input.readOnly ? "deny" : "ask");
  return JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    autoupdate: false, share: "disabled", small_model: `maipai/${GATEWAY_MODEL}`,
    model: `maipai/${GATEWAY_MODEL}`,
    provider: { maipai: { npm: "@ai-sdk/openai-compatible", name: "MaiPai", options: { baseURL: input.gatewayUrl, apiKey: input.key, headers: { "x-maipai-coding-tier": input.tier } }, models: { [GATEWAY_MODEL]: { name: "Coding" } } } },
    // No separate title request: on one model slot it would run a whole extra completion ahead of the answer; the app titles sessions itself. No model-list fetch either (no network in the sandbox).
    agent: { title: { disable: true }, build: { prompt: SANDBOX_PROMPT } },
    permission: { edit: rule(input.allowEdit), bash: rule(input.allowBash), webfetch: "deny" },
  });
}

/** One JSON line of OpenCode's run output to bridge events and token counts. Unknown shapes give nothing. */
export type BlockedAction = { effect: "file_write" | "command"; detail: { command?: string; path?: string } };
const PERMISSION_ERROR = /permission|denied|rejected|not allowed|disabled/i;
export function mapOpenCodeEvent(raw: unknown): { events: AgentEvent[]; tokens?: { input: number; output: number }; blocked?: BlockedAction } {
  const e = raw as { type?: unknown; part?: Record<string, unknown> } | null;
  if (!e || typeof e !== "object" || !e.part || typeof e.part !== "object") return { events: [] };
  const part = e.part as { text?: unknown; tool?: unknown; state?: { output?: unknown; input?: Record<string, unknown>; error?: unknown; metadata?: { exit?: unknown }; status?: unknown; time?: { start?: number; end?: number } }; tokens?: { input?: unknown; output?: unknown } };
  if (e.type === "text" && typeof part.text === "string") return { events: [{ kind: "text", text: part.text }] };
  if (e.type === "step_finish" && part.tokens) return { events: [], tokens: { input: Number(part.tokens.input) || 0, output: Number(part.tokens.output) || 0 } };
  if (e.type === "tool_use" && typeof part.tool === "string") {
    const input = part.state?.input ?? {};
    if (part.state?.status !== "completed" && part.state?.status !== "error") return { events: [] };
    if (part.state?.status === "error" && typeof part.state.error === "string" && PERMISSION_ERROR.test(part.state.error)) {
      if (part.tool === "bash") return { events: [], blocked: { effect: "command", detail: { command: String(input.command ?? "") } } };
      if (part.tool === "edit" || part.tool === "write" || part.tool === "patch") return { events: [], blocked: { effect: "file_write", detail: { path: String(input.filePath ?? input.path ?? "") } } };
    }
    switch (part.tool) {
      case "bash": {
        const exit = typeof part.state?.metadata?.exit === "number" ? part.state.metadata.exit : part.state?.status === "completed" ? 0 : 1;
        const t = part.state?.time; const duration = t?.start !== undefined && t.end !== undefined ? Math.max(0, t.end - t.start) : 0;
        return { events: [{ kind: "command", command: String(input.command ?? ""), exit_code: exit, duration_ms: duration, ...(typeof part.state?.output === "string" ? { output: part.state.output } : {}) }] };
      }
      case "edit": case "write": case "patch": return { events: [{ kind: "file_write", path: String(input.filePath ?? input.path ?? "") }] };
      case "todowrite": {
        const todos = Array.isArray(input.todos) ? input.todos as { content?: unknown; status?: unknown }[] : [];
        return { events: [{ kind: "plan", items: todos.map((t) => ({ text: String(t.content ?? ""), done: t.status === "completed" })) }] };
      }
      case "webfetch": return { events: [{ kind: "external_read" }] };
      default: return { events: [] };
    }
  }
  return { events: [] };
}

export const MAX_ROUNDS = 3;
/** What OpenCode prints when it cannot reach the gateway at all (refused, reset, timed out, no route, an empty reply): a different fault from the agent itself failing. */
const GATEWAY_DOWN = /ECONNREFUSED|ConnectionRefused|Unable to connect|ECONNRESET|socket connection was closed|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|fetch failed|empty reply|Cannot connect to API/i;
const CONTINUE_MESSAGE = "You now have the permission you asked for. Continue the task.";

export function createOpenCodeAgent(deps: OpenCodeDeps): CodingAgent {
  return {
    ready: () => (!deps.gatewayUrl() ? "Code sessions are not set up on this home yet: the coding gateway address for sandboxes is missing. Ask an admin to finish the Coding setup in Settings."
      : !deps.canMintKeys() ? "Code sessions cannot sign in to the coding gateway yet. Try again after the next update." : null),
    async runTurn(input): Promise<CodingTurnResult> {
      const { host, signal } = input;
      const row = sessionById(input.sessionId);
      if (!row) throw new Error("session_missing");
      const gateway = deps.gatewayUrl(); if (!gateway) throw new Error("gateway_missing");
      if (input.message.length > MAX_ARG_CHARS) throw new Error("message_too_long");
      // Ask mode starts with nothing granted and asks per action; auto edit asks the brake once; plan grants nothing.
      const granted = row.mode === "auto_edit" ? await permissions(host, row.mode) : { edit: false, bash: false };
      if (signal.aborted) return {};
      const key = await deps.sessionKey({ personId: row.personId, sessionId: row.id, tier: input.tier });
      if (!key) throw new Error("no_session_key");
      const hadEarlier = listCodingMessages(row.personId, row.id).filter((m) => m.role === "user").length > 1;
      let tokensIn = 0; let tokensOut = 0;
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const blocked: BlockedAction[] = [];
        const argv = ["opencode", "run", "--format", "json", "--model", `maipai/${GATEWAY_MODEL}`, ...(hadEarlier || round > 0 ? ["--continue"] : []), round === 0 ? input.message : CONTINUE_MESSAGE];
        const env = { OPENCODE_CONFIG_CONTENT: openCodeConfig({ gatewayUrl: gateway, key, tier: input.tier, allowEdit: granted.edit, allowBash: granted.bash, readOnly: row.mode === "plan" }) };
        let buffer = ""; let exit: number | null = null; let stderrTail = "";
        const feed = (line: string) => {
          if (!line.trim()) return;
          let parsed: unknown; try { parsed = JSON.parse(line); } catch { return; }
          const mapped = mapOpenCodeEvent(parsed);
          for (const ev of mapped.events) host.emit(ev);
          if (mapped.tokens) { tokensIn += mapped.tokens.input; tokensOut += mapped.tokens.output; }
          if (mapped.blocked) blocked.push(mapped.blocked);
        };
        for await (const chunk of deps.sandbox.exec({ sessionId: input.sessionId, argv, cwd: "/workspace", env, signal })) {
          if ("exit" in chunk) { exit = chunk.exit; continue; }
          if (chunk.stream !== "stdout") { stderrTail = (stderrTail + chunk.text).slice(-2000); continue; } // stderr can hold anything the tools print; it is only matched for a connection failure here, never stored or logged
          buffer += chunk.text;
          let at: number; while ((at = buffer.indexOf("\n")) >= 0) { feed(buffer.slice(0, at)); buffer = buffer.slice(at + 1); }
        }
        feed(buffer);
        if (signal.aborted) return {};
        if (exit !== 0) throw new CodingTurnError(GATEWAY_DOWN.test(stderrTail) ? "gateway_unreachable" : "agent_exit");
        // Per-action asks: each distinct permission the agent was refused is put to the brake with the action it wanted; an allow turns it on for the next round.
        let newlyGranted = false;
        for (const effect of ["file_write", "command"] as const) {
          const wanted = blocked.find((b) => b.effect === effect);
          const already = effect === "file_write" ? granted.edit : granted.bash;
          if (!wanted || already || row.mode === "plan") continue;
          if ((await host.permit({ effect, detail: wanted.detail })) === "allow") { if (effect === "file_write") granted.edit = true; else granted.bash = true; newlyGranted = true; }
          if (signal.aborted) return {};
        }
        if (!newlyGranted) break;
      }
      return { usage: { input_tokens: tokensIn, output_tokens: tokensOut } };
    },
  };
}

/** The brake, once per turn, for the permissions OpenCode's run mode takes: file edits and commands. Plan mode never writes (the brake says never); a denied ask turns the permission off. */
async function permissions(host: CodingHost, mode: string): Promise<{ edit: boolean; bash: boolean }> {
  if (mode === "plan") return { edit: false, bash: false };
  const edit = (await host.permit({ effect: "file_write" })) === "allow";
  const bash = (await host.permit({ effect: "command" })) === "allow";
  return { edit, bash };
}

import { db } from "@/db";
import { codingSessions } from "@/db/schema";
import { eq } from "drizzle-orm";
const sessionById = (id: string) => db.select().from(codingSessions).where(eq(codingSessions.id, id)).get();
