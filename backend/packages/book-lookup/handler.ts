import { McpServer } from "npm:@modelcontextprotocol/sdk@1.30.0/server/mcp.js";
import { StdioServerTransport } from "npm:@modelcontextprotocol/sdk@1.30.0/server/stdio.js";
import { z } from "npm:zod@4.6.5";
const API = "https://www.loc.gov/books/";
async function hostFetch(extra: { sendRequest: (req: unknown, schema: unknown) => Promise<{ value: unknown }> }, url: string) {
  return (await extra.sendRequest({ method: "host/fetch", params: { url } }, z.object({ value: z.unknown() }))).value as any;
}
export async function handleBook({ query, __attribution = "" }: { query: string; __attribution?: string }, extra: { sendRequest: (req: unknown, schema: unknown) => Promise<{ value: unknown }> }) {
  try {
    const url = `${API}?fo=json&c=5&q=${encodeURIComponent(query)}`;
    const response = await hostFetch(extra, url);
    const items = (response?.results ?? []).slice(0, 5).map((x: any) => ({ title: String(x.title ?? ""), author: Array.isArray(x.contributor) ? x.contributor.join(", ") : Array.isArray(x.contributors) ? x.contributors.join(", ") : null, year: x.date ? String(x.date).match(/\d{4}/)?.[0] ?? null : null, description: typeof x.description === "string" ? x.description.slice(0, 300) : null, url: typeof x.id === "string" ? x.id : null })).filter((x: any) => x.title);
    return { content: [{ type: "text" as const, text: JSON.stringify({ data: { ok: true, items, attribution: __attribution } }) }] };
  } catch { return { content: [{ type: "text" as const, text: JSON.stringify({ data: { ok: true, items: [], attribution: __attribution } }) }] }; }
}
if (import.meta.main) { const s=new McpServer({name:"book-lookup",version:"0.1.0"}); s.registerTool("handle",{inputSchema:{query:z.string().min(1),__attribution:z.string().optional()}},handleBook); await s.connect(new StdioServerTransport()); }
