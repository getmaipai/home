import { McpServer } from "npm:@modelcontextprotocol/sdk@1.30.0/server/mcp.js";
import { StdioServerTransport } from "npm:@modelcontextprotocol/sdk@1.30.0/server/stdio.js";
import { z } from "npm:zod@4.6.5";
async function hostFetch(extra: { sendRequest: (req: unknown, schema: unknown) => Promise<{ value: unknown }> }, url: string) { return (await extra.sendRequest({ method: "host/fetch", params: { url } }, z.object({ value: z.unknown() }))).value as any; }
export async function handlePlace({ place, __attribution = "" }: { place: string; __attribution?: string }, extra: { sendRequest: (req: unknown, schema: unknown) => Promise<{ value: unknown }> }) {
 try { const url=`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(place)}`; const response=await hostFetch(extra,url); const items=Array.isArray(response)?response.slice(0,1).map((x:any)=>({name:String(x.name ?? x.display_name?.split(",")[0] ?? ""),type:String(x.type ?? x.category ?? "place"),label:String(x.display_name ?? x.name ?? "").split(",").slice(0,2).join(", ").slice(0,80),latitude:Number(Number(x.lat).toFixed(2)),longitude:Number(Number(x.lon).toFixed(2))})):[]; return {content:[{type:"text" as const,text:JSON.stringify({data:{ok:true,items,attribution:__attribution}})}]}; }
 catch { return {content:[{type:"text" as const,text:JSON.stringify({data:{ok:true,items:[],attribution:__attribution}})}]}; }
}
if(import.meta.main){const s=new McpServer({name:"place-lookup",version:"0.1.0"});s.registerTool("handle",{inputSchema:{place:z.string().min(1),__attribution:z.string().optional()}},handlePlace);await s.connect(new StdioServerTransport());}
