// Today's date - one of the almanac's five small lookups (step 7,
// legacy had five separate tools for this). Tier 1 only because there
// is no Tier 0 recipe step that can read the wall clock (recipe.schema.json
// has fetch/pick/format/compute/ask, nothing that reads "now") - the
// computation itself is one line, no network, no host access.
//
// Zero required args, deliberately: `lib/turnEngine.ts`'s route() can
// only bind a package's ONE required arg from a routing.patterns
// wildcard capture, and this package (like every other almanac-* one)
// has nothing for a household member to fill in - the question is
// always the same. Matches joke/trivia's own zero-arg shape.
//
// This file has NO import from anywhere outside its own directory - see
// knowledge/handler.ts's own header for why.
import { McpServer } from "npm:@modelcontextprotocol/sdk@1.30.0/server/mcp.js";
import { StdioServerTransport } from "npm:@modelcontextprotocol/sdk@1.30.0/server/stdio.js";

export function currentDate(now: Date = new Date()): { text: string; speech: string } {
  const formatted = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const text = `Today is ${formatted}.`;
  return { text, speech: text };
}

if (import.meta.main) {
  const server = new McpServer({ name: "almanac-date", version: "0.1.0" });
  server.registerTool("handle", { inputSchema: {} }, async () => {
    return { content: [{ type: "text", text: JSON.stringify({ reply: currentDate(), actions: [] }) }] };
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
