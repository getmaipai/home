// H1/H2 (tools-ecosystem-design-2026-10-03.md sections 3 and 4): one MCP
// client connection per connector, on the official TypeScript SDK (stdio
// and Streamable HTTP; denoHost.ts already runs its Client over stdio).
//
//  - Connects lazily on first use and reconnects after a drop.
//  - Advertises NO client capabilities: never sampling (a connector must not
//    borrow Home's model), never elicitation or roots. A server that sends an
//    input request anyway (elicitation/create) is answered with cancel;
//    any other server-initiated request is refused.
//  - Exposes only the tools on the connector's allow list (C3), as Home
//    ToolSpec shapes with namespaced ids and sanitised schemas. Wiring them
//    into the turn's offered set is decision T2, not done here.
//  - A failure is a failed outcome with a failure kind and an admin-only
//    detail, never a thrown error (rule 6). The detail is never text for the
//    model or a non-admin.
//
// Not built here: egress control (H3), the supply-chain pin (H4), idle stop
// under the sidecar supervisor.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { ToolSpec } from "@/lib/llm";
import { sanitiseSchema } from "./schemaSanitiser";
import { createNameMap } from "./nameMap";

export type McpTransportConfig =
  | { kind: "http"; url: string; headers?: Record<string, string> }
  | { kind: "stdio"; command: string; args?: string[]; env?: Record<string, string>; cwd?: string }
  /** An already-built transport (tests, in-process servers). */
  | { kind: "custom"; create: () => Transport };

export interface McpConnectorConfig {
  /** The namespace in `server__tool`; the connector's package id. */
  id: string;
  transport: McpTransportConfig;
  /** Tool names (as the server names them) that may be offered. Empty offers nothing. */
  allow: readonly string[];
  callTimeoutMs?: number;
  connectTimeoutMs?: number;
  /** Used when the server's tools/list gives no ttlMs. */
  defaultTtlMs?: number;
  now?: () => number;
}

/** Kinds match lookupFallback's LookupFailureKind, plus `not_offered` (a name that is not on the list). */
export type McpFailureKind = "unavailable" | "timed_out" | "errored" | "not_offered";

export type McpToolOutcome =
  | { status: "succeeded"; text: string; structured?: unknown }
  | { status: "failed"; failureKind: McpFailureKind; /** Admin-only. Never shown to the model, a child or a non-admin. */ detail?: string };

export interface McpConnector {
  readonly id: string;
  /** The allow-listed tools as ToolSpec; [] when the server is unreachable. Never throws. */
  listTools(): Promise<ToolSpec[]>;
  /** Call by wire name (`server__tool`). Never throws. */
  callTool(wireName: string, args: Record<string, unknown>): Promise<McpToolOutcome>;
  close(): Promise<void>;
}

const DEFAULT_CALL_TIMEOUT_MS = 15_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 8_000;
const DEFAULT_TTL_MS = 60_000;

function buildTransport(cfg: McpTransportConfig): Transport {
  switch (cfg.kind) {
    case "http":
      return new StreamableHTTPClientTransport(new URL(cfg.url), cfg.headers ? { requestInit: { headers: cfg.headers } } : undefined);
    case "stdio":
      return new StdioClientTransport({ command: cfg.command, args: cfg.args, env: cfg.env, cwd: cfg.cwd, stderr: "ignore" });
    case "custom":
      return cfg.create();
  }
}

function detailOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function kindOf(e: unknown): McpFailureKind {
  if (e instanceof McpError && e.code === ErrorCode.RequestTimeout) return "timed_out";
  if (e instanceof McpError && e.code === ErrorCode.ConnectionClosed) return "unavailable";
  return "errored";
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((c) => (c && typeof c === "object" && (c as { type?: unknown }).type === "text" ? String((c as { text?: unknown }).text ?? "") : ""))
    .filter(Boolean)
    .join("\n");
}

export function createMcpConnector(config: McpConnectorConfig): McpConnector {
  const now = config.now ?? Date.now;
  const callTimeoutMs = config.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  const connectTimeoutMs = config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const allow = new Set(config.allow);
  const names = createNameMap();

  let client: Client | undefined;
  let connecting: Promise<Client> | undefined;
  let cache: { tools: ToolSpec[]; expires: number } | undefined;

  function connect(): Promise<Client> {
    if (client) return Promise.resolve(client);
    connecting ??= (async () => {
      const c = new Client({ name: "maipai-home", version: "0.1.0" }, { capabilities: {} });
      // Server-initiated requests: input is cancelled, everything else refused.
      c.fallbackRequestHandler = async (request) => {
        if (request.method === "elicitation/create") return { action: "cancel" };
        throw new McpError(ErrorCode.MethodNotFound, `Method not supported: ${request.method}`);
      };
      c.onclose = () => {
        if (client === c) client = undefined;
      };
      try {
        await c.connect(buildTransport(config.transport), { timeout: connectTimeoutMs });
      } catch (e) {
        await c.close().catch(() => undefined);
        throw e;
      }
      client = c;
      return c;
    })().finally(() => {
      connecting = undefined;
    });
    return connecting;
  }

  async function fetchTools(c: Client): Promise<ToolSpec[]> {
    const res = await c.listTools(undefined, { timeout: connectTimeoutMs });
    const ttl = (res as { ttlMs?: unknown }).ttlMs;
    const ttlMs = typeof ttl === "number" && ttl >= 0 ? ttl : (config.defaultTtlMs ?? DEFAULT_TTL_MS);
    const specs: ToolSpec[] = [];
    for (const tool of res.tools) {
      if (!allow.has(tool.name)) continue;
      specs.push({ id: names.toWire(config.id, tool.name), description: tool.description ?? "", args: sanitiseSchema(tool.inputSchema) });
    }
    cache = { tools: specs, expires: now() + ttlMs };
    return specs;
  }

  async function listTools(): Promise<ToolSpec[]> {
    if (cache && now() < cache.expires) return cache.tools;
    try {
      return await fetchTools(await connect());
    } catch {
      return [];
    }
  }

  async function callTool(wireName: string, args: Record<string, unknown>): Promise<McpToolOutcome> {
    const target = names.fromWire(wireName);
    // The reverse map only ever holds names built from the allow list, but a
    // call before the first list has not built one yet: resolve it the same way.
    let tool = target && target.server === config.id && allow.has(target.tool) ? target.tool : undefined;
    if (tool === undefined && !target) {
      const prefix = `${config.id}__`;
      const raw = wireName.startsWith(prefix) ? wireName.slice(prefix.length) : undefined;
      if (raw !== undefined && allow.has(raw) && names.toWire(config.id, raw) === wireName) tool = raw;
    }
    if (tool === undefined) return { status: "failed", failureKind: "not_offered" };
    let c: Client;
    try {
      c = await connect();
    } catch (e) {
      return { status: "failed", failureKind: "unavailable", detail: detailOf(e) };
    }
    try {
      const res = await c.callTool({ name: tool, arguments: args }, undefined, { timeout: callTimeoutMs });
      const text = textOf(res.content);
      if (res.isError) return { status: "failed", failureKind: "errored", detail: text };
      return res.structuredContent === undefined ? { status: "succeeded", text } : { status: "succeeded", text, structured: res.structuredContent };
    } catch (e) {
      return { status: "failed", failureKind: kindOf(e), detail: detailOf(e) };
    }
  }

  async function close(): Promise<void> {
    const c = client;
    client = undefined;
    cache = undefined;
    if (c) await c.close().catch(() => undefined);
  }

  return { id: config.id, listTools, callTool, close };
}
