// What happened on this day in history - one of the almanac's five
// small lookups (step 7). See almanac-date/handler.ts's own header for
// why this is Tier 1 and why it has zero required args; see knowledge/
// handler.ts's own header for why this file has no import from
// anywhere outside its own directory and duplicates the host/fetch wire
// shape rather than sharing it.
import { McpServer } from "npm:@modelcontextprotocol/sdk@1.30.0/server/mcp.js";
import { StdioServerTransport } from "npm:@modelcontextprotocol/sdk@1.30.0/server/stdio.js";
import { z } from "npm:zod@4.5.4";

export interface Reply {
  text: string;
  speech: string;
}

interface OnThisDayEvent {
  text: string;
  year: number;
}

export function summarizeOnThisDay(data: unknown): Reply {
  const events = (data as { events?: OnThisDayEvent[] } | null)?.events;
  const event = events?.[0];
  // A real gap found by code review: checking only that `event` EXISTS
  // (not that its own fields do) let a malformed first event - missing
  // `text` or `year` - through to the interpolation below, producing
  // "In undefined, undefined" instead of this same not-found fallback.
  if (!event || typeof event.text !== "string" || typeof event.year !== "number") {
    const text = "I couldn't find anything for this day in history.";
    return { text, speech: text };
  }
  const text = `In ${event.year}, ${event.text}`;
  return { text, speech: text };
}

async function hostFetch(
  extra: { sendRequest: (req: unknown, schema: unknown) => Promise<{ value: unknown }> },
  url: string,
): Promise<unknown> {
  const result = await extra.sendRequest({ method: "host/fetch", params: { url } }, z.object({ value: z.unknown() }));
  return result.value;
}

if (import.meta.main) {
  const server = new McpServer({ name: "almanac-onthisday", version: "0.1.0" });
  server.registerTool(
    "handle",
    { inputSchema: {} },
    async (_args: Record<string, never>, extra: { sendRequest: (req: unknown, schema: unknown) => Promise<{ value: unknown }> }) => {
      let reply: Reply;
      try {
        const now = new Date();
        const month = String(now.getMonth() + 1).padStart(2, "0");
        const day = String(now.getDate()).padStart(2, "0");
        const data = await hostFetch(extra, `https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${month}/${day}`);
        reply = summarizeOnThisDay(data);
      } catch {
        reply = { text: "I couldn't look that up right now.", speech: "I couldn't look that up right now." };
      }
      return { content: [{ type: "text", text: JSON.stringify({ reply, actions: [] }) }] };
    },
  );
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
