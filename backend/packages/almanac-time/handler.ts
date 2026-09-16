// The current time - one of the almanac's five small lookups (step 7).
// See almanac-date/handler.ts's own header for why this is Tier 1 and
// why it has zero required args.
import { McpServer } from "npm:@modelcontextprotocol/sdk@1.30.0/server/mcp.js";
import { StdioServerTransport } from "npm:@modelcontextprotocol/sdk@1.30.0/server/stdio.js";
import { z } from "npm:zod@4.5.4";

export function currentTime(now: Date = new Date()): { text: string; speech: string } {
  const formatted = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const text = `It's ${formatted}.`;
  return { text, speech: text };
}

function handlerNow(args: Record<string, unknown>): Date {
  const value = args.__now;
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

if (import.meta.main) {
  const server = new McpServer({ name: "almanac-time", version: "0.1.0" });
  server.registerTool("handle", { inputSchema: z.object({ __now: z.string().optional() }).passthrough() }, async (args: Record<string, unknown>) => {
    return { content: [{ type: "text", text: JSON.stringify({ reply: currentTime(handlerNow(args)), actions: [] }) }] };
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
