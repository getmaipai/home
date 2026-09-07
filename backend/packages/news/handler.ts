// Top news headlines (step 7) - NPR's own public RSS feed, published for
// syndication (the "prefer the front door" standard: this is the feed
// NPR's own apps and readers already pull, not a scrape of their site),
// no API key. See almanac-date/handler.ts's own header for why this is
// Tier 1; see knowledge/handler.ts's own header for why this file has
// no import from anywhere outside its own directory and duplicates the
// host/fetch wire shape rather than sharing it.
import { McpServer } from "npm:@modelcontextprotocol/sdk@1.30.0/server/mcp.js";
import { StdioServerTransport } from "npm:@modelcontextprotocol/sdk@1.30.0/server/stdio.js";
import { z } from "npm:zod@4.5.4";

export interface Reply {
  text: string;
  speech: string;
}

// host.fetch returns RSS as a raw string (packageHost.ts's own
// attemptHttpFetch: a JSON.parse failure on a real HTTP 200 falls back
// to the plain text body, never a host.fetch error) - this hand-rolled
// extraction is deliberately narrow (title text inside <item> blocks
// only) rather than a real XML parser, matching this package's own
// scope: headlines, not a general feed reader.
function stripCdata(raw: string): string {
  const match = raw.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  return match ? match[1] : raw;
}

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

export function summarizeHeadlines(xml: unknown, count = 3): Reply {
  const titles: string[] = [];
  if (typeof xml === "string") {
    const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
    for (const block of itemBlocks) {
      const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
      if (!titleMatch) continue;
      const decoded = decodeXmlEntities(stripCdata(titleMatch[1])).trim();
      if (decoded) titles.push(decoded);
      if (titles.length >= count) break;
    }
  }
  if (titles.length === 0) {
    const text = "I couldn't find any news headlines right now.";
    return { text, speech: text };
  }
  const text = `Top headlines: ${titles.join(". ")}.`;
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
  const server = new McpServer({ name: "news", version: "0.1.0" });
  server.registerTool(
    "handle",
    { inputSchema: {} },
    async (_args: Record<string, never>, extra: { sendRequest: (req: unknown, schema: unknown) => Promise<{ value: unknown }> }) => {
      // Fix B (docs/dev.md's "Chat reliability: the 2026-09-07 incident
      // and the five fixes"): a real fetch failure is reported as a
      // typed `error`, never a fabricated `reply` - the caller
      // (denoHost.ts's callTier1Handle()) decides the household-facing
      // fallback text (the manifest's own `fallback_reply`).
      try {
        const data = await hostFetch(extra, "https://feeds.npr.org/1001/rss.xml");
        const reply = summarizeHeadlines(data);
        return { content: [{ type: "text", text: JSON.stringify({ reply, actions: [] }) }] };
      } catch (err) {
        const error = { code: "network_unreachable", message: err instanceof Error ? err.message : String(err) };
        return { content: [{ type: "text", text: JSON.stringify({ error }) }] };
      }
    },
  );
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
