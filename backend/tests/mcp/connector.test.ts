// H1/H2 (tools-ecosystem-design-2026-10-03.md sections 3 and 4): the MCP
// client manager against a scripted in-process MCP server built with the
// SDK's own Server class over its in-memory transport (no network, no
// child process). A failure is a failed outcome with a failure kind, never
// a thrown error (rule 6).
import { describe, expect, test } from "bun:test";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createMcpConnector } from "@/lib/mcp/connector";

interface Script {
  tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
  listExtra?: Record<string, unknown>;
  call?: (name: string, args: Record<string, unknown>, server: Server) => Promise<Record<string, unknown>> | Record<string, unknown>;
}

function scripted(script: Script) {
  const server = new Server({ name: "scripted", version: "1.0.0" }, { capabilities: { tools: {} } });
  const seen = { listCalls: 0, clientCapabilities: undefined as unknown, initialised: 0 };
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    seen.listCalls++;
    return {
      tools: (script.tools ?? []).map((t) => ({ inputSchema: { type: "object" as const, properties: {} }, ...t })),
      ...(script.listExtra ?? {}),
    };
  });
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const out = script.call
      ? await script.call(req.params.name, (req.params.arguments ?? {}) as Record<string, unknown>, server)
      : { content: [{ type: "text", text: "ok" }] };
    return out as never;
  });
  server.oninitialized = () => {
    seen.initialised++;
    seen.clientCapabilities = server.getClientCapabilities();
  };
  const create = () => {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    void server.connect(serverSide);
    return clientSide;
  };
  return { server, seen, create };
}

const LIGHTS = [
  { name: "HassTurnOn", description: "Turn something on", inputSchema: { type: "object", properties: { name: { type: "string", examples: ["x"] } }, required: ["name"] } },
  { name: "HassTurnOff", description: "Turn something off" },
  { name: "DangerousReset", description: "Not allowed" },
];

describe("MCP connector", () => {
  test("handshake, then list returns only allow-listed tools as ToolSpec with namespaced ids", async () => {
    const s = scripted({ tools: LIGHTS });
    const c = createMcpConnector({ id: "homeassistant", transport: { kind: "custom", create: s.create }, allow: ["HassTurnOn", "HassTurnOff"] });
    const tools = await c.listTools();
    expect(s.seen.initialised).toBe(1);
    expect(tools.map((t) => t.id)).toEqual(["homeassistant__HassTurnOn", "homeassistant__HassTurnOff"]);
    expect(tools[0]).toEqual({
      id: "homeassistant__HassTurnOn",
      description: "Turn something on",
      args: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    });
    await c.close();
  });

  test("a tool not on the allow list is not exposed and cannot be called", async () => {
    const s = scripted({ tools: LIGHTS });
    const c = createMcpConnector({ id: "ha", transport: { kind: "custom", create: s.create }, allow: ["HassTurnOn"] });
    const tools = await c.listTools();
    expect(tools.map((t) => t.id)).not.toContain("ha__DangerousReset");
    const out = await c.callTool("ha__DangerousReset", {});
    expect(out).toMatchObject({ status: "failed", failureKind: "not_offered" });
    await c.close();
  });

  test("an empty allow list exposes nothing", async () => {
    const s = scripted({ tools: LIGHTS });
    const c = createMcpConnector({ id: "ha", transport: { kind: "custom", create: s.create }, allow: [] });
    expect(await c.listTools()).toEqual([]);
    await c.close();
  });

  test("the list is cached for the server's ttlMs, then fetched again", async () => {
    const s = scripted({ tools: LIGHTS, listExtra: { ttlMs: 1000 } });
    let now = 1_000_000;
    const c = createMcpConnector({ id: "ha", transport: { kind: "custom", create: s.create }, allow: ["HassTurnOn"], now: () => now });
    await c.listTools();
    now += 900;
    await c.listTools();
    expect(s.seen.listCalls).toBe(1);
    now += 200;
    await c.listTools();
    expect(s.seen.listCalls).toBe(2);
    await c.close();
  });

  test("a call goes to the real tool name and maps text content to a succeeded outcome", async () => {
    let got: { name: string; args: Record<string, unknown> } | undefined;
    const s = scripted({
      tools: LIGHTS,
      call: (name, args) => {
        got = { name, args };
        return { content: [{ type: "text", text: "Turned on Juniper's lamp" }], structuredContent: { done: true } };
      },
    });
    const c = createMcpConnector({ id: "ha", transport: { kind: "custom", create: s.create }, allow: ["HassTurnOn"] });
    await c.listTools();
    const out = await c.callTool("ha__HassTurnOn", { name: "lamp" });
    expect(got).toEqual({ name: "HassTurnOn", args: { name: "lamp" } });
    expect(out).toEqual({ status: "succeeded", text: "Turned on Juniper's lamp", structured: { done: true } });
    await c.close();
  });

  test("a call before any list still resolves an allow-listed name", async () => {
    const s = scripted({ tools: LIGHTS });
    const c = createMcpConnector({ id: "ha", transport: { kind: "custom", create: s.create }, allow: ["HassTurnOn"] });
    expect(await c.callTool("ha__HassTurnOn", {})).toMatchObject({ status: "succeeded" });
    await c.close();
  });

  test("a call that outlives the timeout is a failed outcome with kind timed_out, not a throw", async () => {
    const s = scripted({ tools: LIGHTS, call: () => new Promise((r) => setTimeout(() => r({ content: [] }), 500)) });
    const c = createMcpConnector({ id: "ha", transport: { kind: "custom", create: s.create }, allow: ["HassTurnOn"], callTimeoutMs: 40 });
    await c.listTools();
    const out = await c.callTool("ha__HassTurnOn", {});
    expect(out).toMatchObject({ status: "failed", failureKind: "timed_out" });
    await c.close();
  });

  test("a tool that reports isError is a failed outcome (errored) and keeps the text only as admin detail", async () => {
    const s = scripted({ tools: LIGHTS, call: () => ({ isError: true, content: [{ type: "text", text: "401 Unauthorized token abc" }] }) });
    const c = createMcpConnector({ id: "ha", transport: { kind: "custom", create: s.create }, allow: ["HassTurnOn"] });
    const out = await c.callTool("ha__HassTurnOn", {});
    expect(out).toMatchObject({ status: "failed", failureKind: "errored", detail: "401 Unauthorized token abc" });
    expect(out).not.toHaveProperty("text");
    await c.close();
  });

  test("a server that cannot be reached is unavailable: list is empty, call is failed, nothing throws", async () => {
    const c = createMcpConnector({
      id: "ha",
      transport: { kind: "custom", create: () => { throw new Error("ECONNREFUSED"); } },
      allow: ["HassTurnOn"],
    });
    expect(await c.listTools()).toEqual([]);
    expect(await c.callTool("ha__HassTurnOn", {})).toMatchObject({ status: "failed", failureKind: "unavailable" });
    await c.close();
  });

  test("the sampling capability is never advertised, nor elicitation or roots", async () => {
    const s = scripted({ tools: LIGHTS });
    const c = createMcpConnector({ id: "ha", transport: { kind: "custom", create: s.create }, allow: ["HassTurnOn"] });
    await c.listTools();
    const caps = (s.seen.clientCapabilities ?? {}) as Record<string, unknown>;
    expect(caps).not.toHaveProperty("sampling");
    expect(caps).not.toHaveProperty("elicitation");
    expect(caps).not.toHaveProperty("roots");
    await c.close();
  });

  test("a server-initiated input request (elicitation) is answered with cancel and the call still completes", async () => {
    let answer: unknown;
    const s = scripted({
      tools: LIGHTS,
      call: async (_n, _a, server) => {
        // A server that ignores the missing capability and asks anyway.
        answer = await server.request(
          { method: "elicitation/create", params: { message: "Which room?", requestedSchema: { type: "object", properties: { room: { type: "string" } } } } },
          (await import("@modelcontextprotocol/sdk/types.js")).ElicitResultSchema,
        );
        return { content: [{ type: "text", text: "done without input" }] };
      },
    });
    const c = createMcpConnector({ id: "ha", transport: { kind: "custom", create: s.create }, allow: ["HassTurnOn"] });
    const out = await c.callTool("ha__HassTurnOn", {});
    expect(answer).toMatchObject({ action: "cancel" });
    expect(out).toMatchObject({ status: "succeeded", text: "done without input" });
    await c.close();
  });

  test("a server-initiated sampling request is refused, never answered with a model", async () => {
    let rejected = "";
    const s = scripted({
      tools: LIGHTS,
      call: async (_n, _a, server) => {
        try {
          await server.request(
            { method: "sampling/createMessage", params: { messages: [{ role: "user", content: { type: "text", text: "hi" } }], maxTokens: 10 } },
            (await import("@modelcontextprotocol/sdk/types.js")).CreateMessageResultSchema,
          );
        } catch (e) {
          rejected = (e as Error).message;
        }
        return { content: [{ type: "text", text: "ok" }] };
      },
    });
    const c = createMcpConnector({ id: "ha", transport: { kind: "custom", create: s.create }, allow: ["HassTurnOn"] });
    await c.callTool("ha__HassTurnOn", {});
    expect(rejected).not.toBe("");
    await c.close();
  });

  test("after the connection drops, the next call reconnects", async () => {
    const s = scripted({ tools: LIGHTS });
    let creates = 0;
    const c = createMcpConnector({ id: "ha", transport: { kind: "custom", create: () => { creates++; return s.create(); } }, allow: ["HassTurnOn"] });
    await c.listTools();
    await s.server.close();
    await Bun.sleep(10);
    const out = await c.callTool("ha__HassTurnOn", {});
    expect(creates).toBe(2);
    expect(out).toMatchObject({ status: "succeeded" });
    await c.close();
  });
});
