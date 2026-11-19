export type LabTool = { name: string; arguments: Record<string, unknown> };
export const toolDefinitions = [
  { type: "function", function: { name: "web_search", description: "Search the web", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
  { type: "function", function: { name: "get_time", description: "Get the current time in a city", parameters: { type: "object", properties: { place: { type: "string" } }, required: ["place"] } } },
];
export const toolCapabilities = { web_search: { readOnly: true }, get_time: { readOnly: true } } as const;
export async function runTool(call: LabTool, toolDelayMs = 2500, now = new Date()): Promise<string> {
  if (call.name === "get_time") {
    const zones: Record<string, string> = { tokyo: "Asia/Tokyo", "new york": "America/New_York", london: "Europe/London", paris: "Europe/Paris", sydney: "Australia/Sydney", "los angeles": "America/Los_Angeles" };
    const place = String(call.arguments.place ?? "").trim().toLowerCase();
    const zone = zones[place];
    return zone ? new Intl.DateTimeFormat("en-US", { timeZone: zone, dateStyle: "full", timeStyle: "short" }).format(now) : "unknown place";
  }
  if (call.name === "web_search") {
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, toolDelayMs)));
    return "Web search is not connected in this test page, so there are no results. Tell the person that in one short sentence, then say what you know from memory if that helps. Do not say you are looking anything up again.";
  }
  throw new Error("unknown tool");
}
