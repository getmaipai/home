// H2: the two real transports, in-process on loopback only (a Bun.serve
// Streamable HTTP server and a child `bun` over stdio), proving the SDK
// works under Bun end to end. No outside network.
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createMcpConnector } from "@/lib/mcp/connector";

const closers: Array<() => Promise<unknown> | unknown> = [];
afterAll(async () => {
  for (const c of closers) await c();
});

describe("real transports", () => {
  test("Streamable HTTP: handshake, list, call, with the configured auth header", async () => {
    const seenAuth: Array<string | null> = [];
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        seenAuth.push(req.headers.get("authorization"));
        // Stateless: a fresh server and transport per request.
        const s = new Server({ name: "http-fixture", version: "1.0.0" }, { capabilities: { tools: {} } });
        s.setRequestHandler(ListToolsRequestSchema, async () => ({
          tools: [{ name: "HassTurnOn", description: "on", inputSchema: { type: "object", properties: { name: { type: "string" } } } }],
        }));
        s.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: "text", text: "lamp on" }] }));
        const t = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        await s.connect(t);
        return t.handleRequest(req);
      },
    });
    closers.push(() => server.stop(true));
    const c = createMcpConnector({
      id: "homeassistant",
      transport: { kind: "http", url: `http://127.0.0.1:${server.port}/api/mcp/assist`, headers: { Authorization: "Bearer test-token" } },
      allow: ["HassTurnOn"],
    });
    const tools = await c.listTools();
    expect(tools.map((t) => t.id)).toEqual(["homeassistant__HassTurnOn"]);
    expect(await c.callTool("homeassistant__HassTurnOn", { name: "lamp" })).toEqual({ status: "succeeded", text: "lamp on" });
    expect(seenAuth.every((a) => a === "Bearer test-token")).toBe(true);
    await c.close();
  });

  test("Streamable HTTP: a server that is down is an unavailable outcome", async () => {
    const c = createMcpConnector({ id: "ha", transport: { kind: "http", url: "http://127.0.0.1:1/api/mcp/assist" }, allow: ["x"], connectTimeoutMs: 2000 });
    expect(await c.listTools()).toEqual([]);
    expect(await c.callTool("ha__x", {})).toMatchObject({ status: "failed", failureKind: "unavailable" });
    await c.close();
  });

  test("stdio: handshake, list, call against a child process", async () => {
    const c = createMcpConnector({
      id: "echo",
      transport: { kind: "stdio", command: process.execPath, args: [join(import.meta.dir, "fixtures-stdioServer.ts")] },
      allow: ["echo"],
    });
    const tools = await c.listTools();
    expect(tools.map((t) => t.id)).toEqual(["echo__echo"]);
    expect(await c.callTool("echo__echo", { text: "hello" })).toEqual({ status: "succeeded", text: "hello" });
    await c.close();
  });
});
