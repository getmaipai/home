#!/usr/bin/env bun
// Minimal newline-delimited JSON-RPC fixture for the MCP stdio transport.
export {};
const tools = [
  { name: "allow", description: "Allowed tool", inputSchema: { type: "object", properties: {} } },
  { name: "deny", description: "Not allowed", inputSchema: { type: "object", properties: {} } },
  { name: "x".repeat(70), description: "Long name", inputSchema: { type: "object", properties: {} } },
];
let callDelay = Number(process.env.FIXTURE_DELAY_MS ?? 0);
let output = "";
function send(message: unknown) { process.stdout.write(`${JSON.stringify(message)}\n`); }
for await (const chunk of process.stdin) {
  output += Buffer.from(chunk).toString("utf8");
  let newline: number;
  while ((newline = output.indexOf("\n")) >= 0) {
    const line = output.slice(0, newline); output = output.slice(newline + 1);
    let msg: any;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.method === "notifications/initialized" || msg.method === "notifications/cancelled") continue;
    if (msg.method === "initialize") {
      send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: msg.params?.protocolVersion ?? "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } } });
    } else if (msg.method === "tools/list") {
      send({ jsonrpc: "2.0", id: msg.id, result: { tools } });
    } else if (msg.method === "tools/call") {
      if (callDelay) await Bun.sleep(callDelay);
      const name = msg.params?.name;
      const content = process.env.FIXTURE_TEXT ?? `called:${name}\u0001`;
      send({ jsonrpc: "2.0", id: msg.id, result: { isError: name === "error", content: [{ type: "text", text: content }] } });
    } else if (msg.id !== undefined) {
      send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "refused" } });
    }
  }
}
