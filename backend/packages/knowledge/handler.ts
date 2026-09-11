// The knowledge lookup: session-d-packages-and-store.md step 5's own
// proving package for the Tier 1 Deno sandbox. Offline Wikipedia through
// a local Kiwix ZIM is the plan's own "when present" path; no ZIM ships
// this wave (no household-facing way to add one yet, and shipping one
// would be a real multi-hundred-megabyte asset with nowhere to manage
// it), so this package always takes the "otherwise" branch: Wikipedia's
// own public REST summary API, called the ordinary way every fetch-based
// Tier 0 package already does - through host.fetch, never a direct
// Deno-side fetch (this process has no net permission at all; see
// lib/denoHost.ts's own header on why).
//
// This file has NO import from anywhere outside its own directory: a
// Tier 1 package's Deno process can only read its own directory
// (`--allow-read`, lib/denoHost.ts), so nothing under backend/src/lib
// is reachable from here even if it wanted to be. The MCP
// request/response shape for `host/fetch` below has to match
// lib/denoHost.ts's own `HostFetchRequestSchema` by convention, not by a
// shared import - the same "independent implementations agreeing on a
// wire contract" MCP itself is built on.
import { McpServer } from "npm:@modelcontextprotocol/sdk@1.30.0/server/mcp.js";
import { StdioServerTransport } from "npm:@modelcontextprotocol/sdk@1.30.0/server/stdio.js";
import { z } from "npm:zod@4.5.4";

// Exported (not just used inline below) so handler.test.ts's own `deno
// test` (lib/smoke.ts's `deno_test` smoke kind) can exercise the actual
// formatting logic without needing a live MCP round-trip, which a bare
// `deno test` has no host to answer anyway.
export function summarizeWikipediaResponse(topic: string, data: unknown): { text: string; speech: string } {
  const summary = data as { title?: string; extract?: string; type?: string } | null;
  if (!summary?.extract || summary.type === "disambiguation") {
    const text = `I couldn't find a clear answer about ${topic}.`;
    return { text, speech: text };
  }
  const text = `${summary.title ?? topic}: ${summary.extract}`;
  return { text, speech: `${summary.title ?? topic}. ${summary.extract}` };
}

async function hostFetch(
  extra: { sendRequest: (req: unknown, schema: unknown) => Promise<{ value: unknown }> },
  url: string,
): Promise<unknown> {
  const result = await extra.sendRequest(
    { method: "host/fetch", params: { url } },
    z.object({ value: z.unknown() }),
  );
  return result.value;
}

export async function handleKnowledge(
  { topic }: { topic: string },
  extra: { sendRequest: (req: unknown, schema: unknown) => Promise<{ value: unknown }> },
) {
  // The host chooses the manifest's fallback for a typed fetch failure.
  try {
    const data = await hostFetch(extra, `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`);
    const reply = summarizeWikipediaResponse(topic, data);
    return { content: [{ type: "text" as const, text: JSON.stringify({ reply, actions: [] }) }] };
  } catch (err) {
    const error = { code: "network_unreachable", message: err instanceof Error ? err.message : String(err) };
    return { content: [{ type: "text" as const, text: JSON.stringify({ error }) }] };
  }
}

if (import.meta.main) {
  const server = new McpServer({ name: "knowledge", version: "0.1.0" });
  server.registerTool(
    "handle",
    { inputSchema: { topic: z.string().min(1) } },
    handleKnowledge,
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
