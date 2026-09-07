// The next upcoming public holiday - one of the almanac's five small
// lookups (step 7). See almanac-date/handler.ts's own header for why
// this is Tier 1 and why it has zero required args; see knowledge/
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

interface NagerHoliday {
  date: string;
  localName: string;
  name: string;
}

// Nager.Date's own NextPublicHolidays endpoint already returns holidays
// in date order, upcoming only - no client-side "which one is next"
// math needed. Hardcoded to US: no household-country setting exists yet
// (a real, deferred gap, not silently invented here) - a household
// outside the US gets a wrong-country answer today, honestly documented
// in this package's own README rather than pretending to be
// locale-aware.
export function summarizeNextHoliday(data: unknown): Reply {
  const holidays = data as NagerHoliday[] | null;
  const next = holidays?.[0];
  // A real gap found by code review: checking only that `next` EXISTS
  // (not that its own fields do) let a malformed non-empty array - a
  // first element with no `name` or an unparseable `date` - through to
  // the interpolation below, producing "The next holiday is undefined
  // on Invalid Date" instead of this same not-found fallback.
  if (!next || typeof next.name !== "string" || typeof next.date !== "string") {
    const text = "I couldn't find an upcoming holiday.";
    return { text, speech: text };
  }
  const parsedDate = new Date(`${next.date}T00:00:00`);
  if (Number.isNaN(parsedDate.getTime())) {
    const text = "I couldn't find an upcoming holiday.";
    return { text, speech: text };
  }
  const when = parsedDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const text = `The next holiday is ${next.name} on ${when}.`;
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
  const server = new McpServer({ name: "almanac-holiday", version: "0.1.0" });
  server.registerTool(
    "handle",
    { inputSchema: {} },
    async (_args: Record<string, never>, extra: { sendRequest: (req: unknown, schema: unknown) => Promise<{ value: unknown }> }) => {
      let reply: Reply;
      try {
        const data = await hostFetch(extra, "https://date.nager.at/api/v3/NextPublicHolidays/US");
        reply = summarizeNextHoliday(data);
      } catch {
        reply = { text: "I couldn't look that up right now.", speech: "I couldn't look that up right now." };
      }
      return { content: [{ type: "text", text: JSON.stringify({ reply, actions: [] }) }] };
    },
  );
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
