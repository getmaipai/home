import { createHash } from "node:crypto";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { Transport } from "@modelcontextprotocol/client";
import type { ToolSpec } from "@/lib/llm";
import { createNameMap } from "./nameMap";
import { sanitiseSchema } from "./schemaSanitiser";

export type ConnectorConfig = {
  id: string;
  transport: { kind: "stdio"; command: string; args: string[]; env?: Record<string, string> } | { kind: "http"; url: string };
  toolAllowlist: string[];
  pins?: Record<string, string>;
  callTimeoutMs?: number;
  maxResultBytes?: number;
};

export type FailureKind = "unreachable" | "refused" | "timeout";
export type CallResult = { ok: true; text: string; truncated: boolean } | { ok: false; kind: FailureKind };
export type ListedTool = ToolSpec & { hash: string; disabled?: true; reason?: "definition_changed" };
export type ConnectorState = { status: "connecting" | "ready" | "failed"; kind?: FailureKind };
type ClientLike = Pick<Client, "connect" | "close" | "listTools" | "callTool"> & Partial<Pick<Client, "fallbackRequestHandler" | "onclose">>;
export interface ConnectorDeps { createClient?: () => ClientLike; createTransport?: (config: ConnectorConfig["transport"]) => Transport }

function transportFor(config: ConnectorConfig["transport"]): Transport {
  return config.kind === "stdio"
    ? new StdioClientTransport({ command: config.command, args: config.args, env: config.env, stderr: "ignore" })
    : new StreamableHTTPClientTransport(new URL(config.url));
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${canonical(obj[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
function cleanText(text: string): string { return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ""); }
function errorKind(error: unknown): FailureKind {
  const e = error as { code?: unknown; name?: unknown; message?: unknown };
  if (e?.name === "AbortError" || e?.code === "REQUEST_TIMEOUT" || /timeout|timed out/i.test(String(e?.message ?? ""))) return "timeout";
  if (/refused|denied|isError/i.test(String(e?.message ?? ""))) return "refused";
  return "unreachable";
}

export function createConnector(config: ConnectorConfig, deps: ConnectorDeps = {}) {
  const names = createNameMap();
  const allowed = new Set(config.toolAllowlist);
  const timeout = config.callTimeoutMs ?? 15_000;
  const maxBytes = config.maxResultBytes ?? 65_536;
  let client: ClientLike | undefined;
  let pending: Promise<ClientLike> | undefined;
  let status: ConnectorState = { status: "connecting" };
  const disabled = new Set<string>();
  const createClient = deps.createClient ?? (() => new Client({ name: "maipai-home", version: "0.1.0" }, { capabilities: {} }) as unknown as ClientLike);

  async function connect(): Promise<void> {
    if (client) { status = { status: "ready" }; return; }
    if (pending) { await pending; return; }
    status = { status: "connecting" };
    pending = (async () => {
      const c = createClient();
      if (c.fallbackRequestHandler) c.fallbackRequestHandler = async () => { throw new Error("refused"); };
      c.onclose = () => { if (client === c) client = undefined; };
      await c.connect((deps.createTransport ?? transportFor)(config.transport));
      client = c;
      status = { status: "ready" };
      return c;
    })().catch((error) => { status = { status: "failed", kind: errorKind(error) }; throw error; }).finally(() => { pending = undefined; });
    await pending;
  }
  async function listTools(): Promise<ListedTool[]> {
    try {
      await connect();
      const { tools } = await client!.listTools(undefined, { cacheMode: "bypass" });
      const listed: ListedTool[] = [];
      for (const tool of tools) {
        if (!allowed.has(tool.name)) continue;
        const schema = sanitiseSchema(tool.inputSchema);
        const hash = createHash("sha256").update(canonical({ name: tool.name, description: (tool.description ?? "").slice(0, 1000), inputSchema: schema, outputSchema: tool.outputSchema, annotations: tool.annotations })).digest("hex");
        const changed = config.pins?.[tool.name] !== undefined && config.pins[tool.name] !== hash;
        if (changed) disabled.add(tool.name); else disabled.delete(tool.name);
        listed.push({ id: names.toWire(config.id, tool.name), description: (tool.description ?? "").slice(0, 1000), args: schema, hash, ...(changed ? { disabled: true, reason: "definition_changed" as const } : {}) });
      }
      return listed.sort((a, b) => a.id.localeCompare(b.id));
    } catch (error) { status = { status: "failed", kind: errorKind(error) }; return []; }
  }
  async function callTool(wireName: string, args: Record<string, unknown>, options: { signal?: AbortSignal } = {}): Promise<CallResult> {
    const target = names.fromWire(wireName);
    if (!target || target.server !== config.id || !allowed.has(target.tool) || disabled.has(target.tool)) return { ok: false, kind: "refused" };
    try {
      if (!client) await connect();
      const c = client!;
      const controller = new AbortController();
      const abort = () => controller.abort(options.signal?.reason);
      options.signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(() => controller.abort(new Error("timeout")), timeout);
      try {
        const res = await c.callTool({ name: target.tool, arguments: args }, { signal: controller.signal, timeout });
        if (res.isError || (res as { input_required?: boolean }).input_required) return { ok: false, kind: "refused" };
        const raw = Array.isArray(res.content) ? res.content.map((item) => item.type === "text" ? item.text : "").filter(Boolean).join("\n") : "";
        const text = cleanText(raw);
        const bytes = new TextEncoder().encode(text);
        if (bytes.byteLength > maxBytes) {
          const marker = "\n[Result truncated]";
          const limit = Math.max(0, maxBytes - new TextEncoder().encode(marker).byteLength);
          const clipped = new TextDecoder().decode(bytes.slice(0, limit));
          return { ok: true, text: clipped + marker, truncated: true };
        }
        return { ok: true, text, truncated: false };
      } finally { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); }
    } catch (error) { const kind = errorKind(error); status = { status: "failed", kind }; client = undefined; return { ok: false, kind }; }
  }
  async function close(): Promise<void> { const c = client; client = undefined; if (c) await c.close().catch(() => undefined); }
  return { connect, close, state: () => ({ ...status }), listTools, callTool };
}
