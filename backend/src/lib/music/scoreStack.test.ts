import { afterEach, describe, expect, test } from "bun:test";
import { __setScoreFetchForTests, fetchScoreFile, getScore, scoreEngineReady, submitScore } from "@/lib/music/scoreStack";
const calls: string[] = [];
const midi = new Uint8Array([77, 84, 104, 100]);
__setScoreFetchForTests((async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input)); calls.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
  if (url.pathname === "/stack/v1/score") return Response.json({ score: { installed: true } });
  if (url.pathname === "/v1/audio/score" && init?.method === "POST") return Response.json({ id: "job-1" });
  if (url.pathname === "/v1/audio/score/job-1") return Response.json({ id: "job-1", state: "done", result: { tempo_bpm: 120 }, data: { midi: "/midi", notes: "/notes" } });
  if (url.pathname === "/v1/audio/score/job-1/file" && url.searchParams.get("kind") === "midi") return new Response(midi);
  if (url.pathname === "/v1/audio/score/job-1/file") return new Response(JSON.stringify({ tempo_bpm: 120, notes: [] }));
  return new Response("Not found", { status: 404 });
}) as unknown as typeof fetch);
afterEach(() => { __setScoreFetchForTests(null); });
describe("score Stack contract", () => {
  test("checks readiness, submits audio and fetches job results and MIDI", async () => {
    expect(await scoreEngineReady()).toBe(true);
    expect(await submitScore(new Uint8Array([1, 2, 3]))).toBe("job-1");
    expect((await getScore("job-1")).result?.tempo_bpm).toBe(120);
    expect([...await fetchScoreFile("job-1", "midi")]).toEqual([...midi]);
    expect(calls).toEqual(["GET /stack/v1/score", "POST /v1/audio/score", "GET /v1/audio/score/job-1", "GET /v1/audio/score/job-1/file?kind=midi"]);
  });
});
