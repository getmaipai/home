// Music artist lookup (step 7) - MusicBrainz's own public search API, no
// key. Scoped to artists only for v0.1.0: the plan's fuller "music and
// media lookup" also names movie/TV metadata via a TMDB-style API "with
// the user's own key where required" - that needs a household-supplied
// secret a package can actually read, which no package has a way to do
// yet (every manifest's own `config` is still empty everywhere in this
// bundle). Deferred honestly (docs/BACKLOG.md) rather than built on top
// of settings infrastructure that doesn't exist, matching this session's
// own "known gap" call on news's single fixed feed.
//
// MusicBrainz's own API etiquette asks for an identifying User-Agent,
// not the generic default host.fetch sends every other package -
// host.fetch's own `opts.headers` (packageHost.ts's performHttpFetch)
// already merges over the default per-call, so this is the first
// package to actually use that rather than accepting the shared default.
//
// See almanac-date/handler.ts's own header for why this is Tier 1; see
// knowledge/handler.ts's own header for why this file has no import
// from anywhere outside its own directory and duplicates the
// host/fetch wire shape rather than sharing it.
import { McpServer } from "npm:@modelcontextprotocol/sdk@1.30.0/server/mcp.js";
import { StdioServerTransport } from "npm:@modelcontextprotocol/sdk@1.30.0/server/stdio.js";
import { z } from "npm:zod@4.5.4";

export interface Reply {
  text: string;
  speech: string;
}

interface MbArtist {
  name?: string;
  type?: string;
  area?: { name?: string };
  "life-span"?: { begin?: string; ended?: string | null };
}

interface MbSearchResult {
  artists?: MbArtist[];
}

function describeType(type: string | undefined): string {
  if (type === "Group") return "a band";
  if (type === "Person") return "a solo artist";
  if (type === "Orchestra") return "an orchestra";
  if (type === "Choir") return "a choir";
  return "an artist";
}

export function summarizeArtist(data: unknown, query: string): Reply {
  const artist = (data as MbSearchResult | null)?.artists?.[0];
  if (!artist || typeof artist.name !== "string") {
    const text = `I couldn't find an artist named "${query}".`;
    return { text, speech: text };
  }
  const kind = describeType(artist.type);
  const isPerson = artist.type === "Person";
  const verb = isPerson ? "born" : "formed";
  const area = typeof artist.area?.name === "string" ? artist.area.name : null;
  const begin = typeof artist["life-span"]?.begin === "string" ? artist["life-span"]!.begin : null;
  const ended = typeof artist["life-span"]?.ended === "string" ? artist["life-span"]!.ended : null;

  let text = `${artist.name} is ${kind}`;
  if (area) text += ` from ${area}`;
  if (begin) text += `, ${verb} in ${begin}`;
  text += ".";
  if (ended) {
    text += isPerson ? ` They passed away in ${ended}.` : ` They disbanded in ${ended}.`;
  }
  return { text, speech: text };
}

async function hostFetch(
  extra: { sendRequest: (req: unknown, schema: unknown) => Promise<{ value: unknown }> },
  url: string,
): Promise<unknown> {
  const result = await extra.sendRequest(
    {
      method: "host/fetch",
      params: { url, opts: { headers: { "User-Agent": "MaiPaiHome/0.1.0 (https://github.com/getmaipai/home)" } } },
    },
    z.object({ value: z.unknown() }),
  );
  return result.value;
}

if (import.meta.main) {
  const server = new McpServer({ name: "music", version: "0.1.0" });
  server.registerTool(
    "handle",
    { inputSchema: { query: z.string() } },
    async (args: { query: string }, extra: { sendRequest: (req: unknown, schema: unknown) => Promise<{ value: unknown }> }) => {
      let reply: Reply;
      try {
        const url = `https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent(`artist:${args.query}`)}&fmt=json&limit=1`;
        const data = await hostFetch(extra, url);
        reply = summarizeArtist(data, args.query);
      } catch {
        reply = { text: "I couldn't look that up right now.", speech: "I couldn't look that up right now." };
      }
      return { content: [{ type: "text", text: JSON.stringify({ reply, actions: [] }) }] };
    },
  );
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
