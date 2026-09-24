// The current time - one of the almanac's five small lookups (step 7).
// See almanac-date/handler.ts's own header for why this is Tier 1 and
// why it has zero required args.
import { McpServer } from "npm:@modelcontextprotocol/sdk@1.30.0/server/mcp.js";
import { StdioServerTransport } from "npm:@modelcontextprotocol/sdk@1.30.0/server/stdio.js";
import { z } from "npm:zod@4.6.5";
// SIGNAL-02: city-timezones (MIT, zero runtime deps, offline static
// data) resolves "Tokyo" to a real IANA zone - the exact same package
// and resolution rule (highest-population match on an ambiguous name)
// as backend/src/lib/timezones.ts's own resolveZone(), which
// manifestLint.ts's COMPUTED_WILDCARD_RESOLVERS reads to decide
// whether the "what time is it in *" pattern fires at all before this
// handler ever runs. This handler is a separate Deno MCP subprocess
// (every bundled package's own recipe/handler runtime) - it cannot
// import that Bun-side file directly, so the same lookup is
// re-implemented here under Deno's own npm specifier rather than left
// duplicated by drift; a change to the resolution rule updates both.
import { lookupViaCity, findFromCityStateProvince } from "npm:city-timezones@1.3.4";

const UNKNOWN_PLACE_LINE = "I don't know that place's time zone.";

/** Mirrors timezones.ts's own resolveZone() exactly - see this file's
 * header for why it's a second definition rather than a shared import. */
function resolveZone(place: string): string | null {
  const trimmed = place.trim();
  if (!trimmed) return null;
  const matches = lookupViaCity(trimmed).length > 0 ? lookupViaCity(trimmed) : findFromCityStateProvince(trimmed);
  if (matches.length === 0) return null;
  const best = matches.reduce((a, b) => (b.pop > a.pop ? b : a));
  return best.timezone || null;
}

export function currentTime(now: Date = new Date(), zone?: string, place?: string): { text: string; speech: string } {
  const options: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  if (zone) options.timeZone = zone;
  const formatted = now.toLocaleTimeString("en-US", options);
  const text = place ? `It's ${formatted} in ${place}.` : `It's ${formatted}.`;
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
  server.registerTool("handle", { inputSchema: z.object({ __now: z.string().optional(), place: z.string().optional() }).passthrough() }, async (args: Record<string, unknown>) => {
    const place = typeof args.place === "string" ? args.place.trim() : "";
    if (place) {
      const zone = resolveZone(place);
      // No search, ever - the fixed line, the same posture a
      // rejected-remainder wildcard already gets by yielding to the
      // model instead of firing blind (OPENER-01), except this call
      // already committed to running the package (the model itself
      // chose to call almanac-time with this place under `auto`, not
      // the deterministic floor) - so the honest answer is the fixed
      // line, never a websearch this package has no business doing.
      if (!zone) return { content: [{ type: "text", text: JSON.stringify({ reply: { text: UNKNOWN_PLACE_LINE, speech: UNKNOWN_PLACE_LINE }, actions: [] }) }] };
      return { content: [{ type: "text", text: JSON.stringify({ reply: currentTime(handlerNow(args), zone, place), actions: [] }) }] };
    }
    return { content: [{ type: "text", text: JSON.stringify({ reply: currentTime(handlerNow(args)), actions: [] }) }] };
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
