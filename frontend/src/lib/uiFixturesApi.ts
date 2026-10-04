// UI-SHOWCASE: the two calls behind the admin Chat showcase (/dev/ui). Kept
// beside, not inside, lib/api.ts: nothing else on the web calls them.
export type ShowcasePace = "instant" | "normal" | "slow";
export interface ShowcaseScenario { id: string; title: string; description: string; live_in_chat: string }

export async function listShowcaseScenarios(): Promise<ShowcaseScenario[]> {
  const res = await fetch("/api/dev/ui-fixtures", { credentials: "include" });
  if (!res.ok) throw new Error(res.status === 403 ? "The Chat showcase is for owners and admins." : res.statusText);
  return ((await res.json()) as { fixtures: ShowcaseScenario[] }).fixtures;
}

/** Opens one scenario as an assistant-stream turn, the same wire the real chat reads. */
export async function openShowcaseStream(id: string, pace: ShowcasePace, signal: AbortSignal): Promise<Response> {
  const res = await fetch(`/api/dev/ui-fixtures/${encodeURIComponent(id)}/stream`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/x-assistant-stream" },
    body: JSON.stringify({ pace }),
    signal,
  });
  if (!res.ok) throw new Error(res.status === 403 ? "The Chat showcase is for owners and admins." : res.statusText);
  return res;
}
