// CODE-AGENT-01 (slice three): the OpenCode driver. It runs `opencode run --format json` inside the session's sandbox (lib/codingSandbox.ts exec), pointed at
// the household coding gateway with the session's key and tier, and turns what it prints into the bridge's events (lib/codingBridge.ts). Stop and the wall-clock
// budget abort the turn's signal, which ends the exec. UNVERIFIED AGAINST A REAL OPENCODE: the event field names below follow OpenCode's JSON run output as
// documented, and an event this mapper does not know is skipped, never guessed. Home maps no tier to a model (rule E): the tier travels as a header on the
// provider block and the gateway/Stack resolve the slot; the gateway does not read that header yet (see the slice notes).
//
// Approvals: `opencode run` cannot ask mid-run, so the brake (CODE-BRAKE-01) is applied once per turn, before it starts, for the two permissions that matter:
// editing files and running commands. A "do" turns the permission on, a "deny" turns it off; an "ask" is the held request the person answers first. Network
// fetches are always off (the sandbox has no network and a new host is the person's click). Per-action asks need OpenCode's server mode, a later slice.
import type { CodingAgent, CodingTurnResult } from "@/lib/codingTurns";
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
  sessionKey: (input: { personId: string; sessionId: string }) => Promise<string | null>;
}

export function openCodeConfig(input: { gatewayUrl: string; key: string; tier: Tier; allowEdit: boolean; allowBash: boolean }): string {
  return JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    autoupdate: false, share: "disabled",
    model: `maipai/${GATEWAY_MODEL}`,
    provider: { maipai: { npm: "@ai-sdk/openai-compatible", name: "MaiPai", options: { baseURL: input.gatewayUrl, apiKey: input.key, headers: { "x-maipai-coding-tier": input.tier } }, models: { [GATEWAY_MODEL]: { name: "Coding" } } } },
    permission: { edit: input.allowEdit ? "allow" : "deny", bash: input.allowBash ? "allow" : "deny", webfetch: "deny" },
  });
}

/** One JSON line of OpenCode's run output to bridge events and token counts. Unknown shapes give nothing. */
export function mapOpenCodeEvent(raw: unknown): { events: AgentEvent[]; tokens?: { input: number; output: number } } {
  const e = raw as { type?: unknown; part?: Record<string, unknown> } | null;
  if (!e || typeof e !== "object" || !e.part || typeof e.part !== "object") return { events: [] };
  const part = e.part as { text?: unknown; tool?: unknown; state?: { input?: Record<string, unknown>; metadata?: { exit?: unknown }; status?: unknown; time?: { start?: number; end?: number } }; tokens?: { input?: unknown; output?: unknown } };
  if (e.type === "text" && typeof part.text === "string") return { events: [{ kind: "text", text: part.text }] };
  if (e.type === "step_finish" && part.tokens) return { events: [], tokens: { input: Number(part.tokens.input) || 0, output: Number(part.tokens.output) || 0 } };
  if (e.type === "tool_use" && typeof part.tool === "string") {
    const input = part.state?.input ?? {};
    if (part.state?.status !== "completed" && part.state?.status !== "error") return { events: [] };
    switch (part.tool) {
      case "bash": {
        const exit = typeof part.state?.metadata?.exit === "number" ? part.state.metadata.exit : part.state?.status === "completed" ? 0 : 1;
        const t = part.state?.time; const duration = t?.start !== undefined && t.end !== undefined ? Math.max(0, t.end - t.start) : 0;
        return { events: [{ kind: "command", command: String(input.command ?? ""), exit_code: exit, duration_ms: duration }] };
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
      const allow = await permissions(host, row.mode);
      if (signal.aborted) return {};
      const key = await deps.sessionKey({ personId: row.personId, sessionId: row.id });
      if (!key) throw new Error("no_session_key");
      const later = listCodingMessages(row.personId, row.id).filter((m) => m.role === "user").length > 1;
      const argv = ["opencode", "run", "--format", "json", "--model", `maipai/${GATEWAY_MODEL}`, ...(later ? ["--continue"] : []), input.message];
      const env = { OPENCODE_CONFIG_CONTENT: openCodeConfig({ gatewayUrl: gateway, key, tier: input.tier, allowEdit: allow.edit, allowBash: allow.bash }) };
      let tokensIn = 0; let tokensOut = 0; let buffer = ""; let exit: number | null = null;
      const feed = (line: string) => {
        if (!line.trim()) return;
        let parsed: unknown; try { parsed = JSON.parse(line); } catch { return; }
        const mapped = mapOpenCodeEvent(parsed);
        for (const ev of mapped.events) host.emit(ev);
        if (mapped.tokens) { tokensIn += mapped.tokens.input; tokensOut += mapped.tokens.output; }
      };
      for await (const chunk of deps.sandbox.exec({ sessionId: input.sessionId, argv, cwd: "/workspace", env, signal })) {
        if ("exit" in chunk) { exit = chunk.exit; continue; }
        if (chunk.stream !== "stdout") continue; // stderr can hold anything the tools print; it is not stored
        buffer += chunk.text;
        let at: number; while ((at = buffer.indexOf("\n")) >= 0) { feed(buffer.slice(0, at)); buffer = buffer.slice(at + 1); }
      }
      feed(buffer);
      if (signal.aborted) return {};
      if (exit !== 0) throw new Error("agent_exit");
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
