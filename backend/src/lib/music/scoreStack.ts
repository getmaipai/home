import { createStackHttp } from "@/lib/stack/http";
import { getStackUrl } from "@/lib/stackEngine";

const stack = createStackHttp({ makeError: (status, code) => Object.assign(new Error("Score transcription could not finish."), { status, code }), noStackMessage: "", unreachableMessage: "" });
export const __setScoreFetchForTests = stack.__setFetchForTests;
export const scoreStackConfigured = () => stack.hasTestFetch() || !!getStackUrl();
async function checked(path: string, init: RequestInit = {}, timeoutMs = 15_000) {
  const response = await stack.request(path, { ...init, timeoutMs });
  if (!response.ok) return stack.failure(response, { fallback: "Score transcription is not available. Check the AI and models page, then try again." });
  return response;
}
export async function scoreEngineReady(): Promise<boolean> {
  try { const body = await (await checked("/stack/v1/score", {}, 5_000)).json() as { score?: { installed?: boolean } }; return body.score?.installed === true; }
  catch { return false; }
}
export async function submitScore(bytes: Uint8Array): Promise<string> {
  const form = new FormData(); form.set("file", new Blob([bytes]), "song.audio");
  const result = await (await checked("/v1/audio/score", { method: "POST", body: form }, 60_000)).json() as { id?: string };
  if (!result.id) throw new Error("The score job did not start. Try again."); return result.id;
}
export async function getScore(id: string): Promise<{ state: string; phase?: string; progress?: number; error?: string | null; data?: { midi?: string; notes?: string } | null; result?: { tempo_bpm?: number } }> {
  return await (await checked(`/v1/audio/score/${encodeURIComponent(id)}`)).json() as never;
}
export async function fetchScoreFile(id: string, kind: "midi" | "notes"): Promise<Uint8Array> {
  return new Uint8Array(await (await checked(`/v1/audio/score/${encodeURIComponent(id)}/file?kind=${kind}`, {}, 60_000)).arrayBuffer());
}
