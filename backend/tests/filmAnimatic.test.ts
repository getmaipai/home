import { beforeEach, describe, expect, test } from "bun:test";
import { ANIMATIC_FAILED_LINE, ANIMATIC_MISSING_LINE, ANIMATIC_OLD_STACK_LINE, ANIMATIC_TIMEOUT_LINE, animaticRequest, runRoughCutJob, type RoughCutJobDeps } from "../src/lib/films/animatic";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";

const shot = (over: Record<string, unknown>) => ({ id: "s1", still: "A lighthouse at dusk, cartoon", line: "The light came on at six.", seconds: 5, motion: "zoom in", ...over }) as never;

describe("animaticRequest (the same lengths, motion and words the animatic always had)", () => {
  test("each shot keeps its seconds, its motion words and its line as the caption; the audience is adult and no lines are voiced", () => {
    const request = animaticRequest([shot({}), shot({ id: "s2", motion: "pan left", line: "", seconds: 7 })], ["/m/1.png", "/m/2.png"]);
    expect(request).toEqual({ audience: "adult", shots: [
      { id: "s1", picture: "/m/1.png", seconds: 5, motion: "zoom in", caption: "The light came on at six." },
      { id: "s2", picture: "/m/2.png", seconds: 7, motion: "pan left" },
    ] });
    expect("lines" in request).toBe(false);
  });
  test("a long line is cut to 200 characters like before", () => {
    expect(animaticRequest([shot({ line: "x".repeat(300) })], ["/m/1.png"]).shots[0]!.caption).toHaveLength(200);
  });
});

describe("runRoughCutJob (one Stack job, one plain line on any failure)", () => {
  let clock = 0;
  const deps = (over: Partial<RoughCutJobDeps> = {}): RoughCutJobDeps => ({
    submit: async () => ({ id: "j1", state: "queued" }), job: async () => ({ id: "j1", state: "done", result: { file: "/stack/out.mp4", total_s: 12 } }),
    cancel: async () => undefined, sleep: async () => { clock += 500; }, now: () => clock, readFile: () => new Uint8Array([1, 2, 3]), ...over,
  });
  const request = animaticRequest([shot({})], ["/m/1.png"]);
  test("done: the file's bytes, its length and the wall time", async () => {
    clock = 0;
    expect(await runRoughCutJob(request, undefined, deps())).toEqual({ ok: true, bytes: new Uint8Array([1, 2, 3]), seconds: 12, ms: 500 });
  });
  test("a Stack older than the op (submit refused) says to update the engine, not a broken page", async () => {
    expect(await runRoughCutJob(request, undefined, deps({ submit: async () => { throw new Error("422 unknown kind at /x/y"); } }))).toEqual({ ok: false, line: ANIMATIC_OLD_STACK_LINE });
  });
  test("a failed job uses the Stack's own plain sentence when it has one, else the general line; paths never show", async () => {
    expect(await runRoughCutJob(request, undefined, deps({ job: async () => ({ id: "j1", state: "failed", reason: "A picture does not open." }) }))).toEqual({ ok: false, line: "A picture does not open." });
    expect(await runRoughCutJob(request, undefined, deps({ job: async () => ({ id: "j1", state: "failed", reason: "ENOENT /Users/x/y.png" }) }))).toEqual({ ok: false, line: ANIMATIC_FAILED_LINE });
  });
  test("a file that cannot be read back, and a job that never finishes", async () => {
    expect(await runRoughCutJob(request, undefined, deps({ readFile: () => null }))).toEqual({ ok: false, line: ANIMATIC_MISSING_LINE });
    clock = 0;
    let cancelled = false;
    expect(await runRoughCutJob(request, undefined, deps({ job: async () => ({ id: "j1", state: "running" }), cancel: async () => { cancelled = true; }, sleep: async () => { clock += 5 * 60_000; } }))).toEqual({ ok: false, line: ANIMATIC_TIMEOUT_LINE });
    expect(cancelled).toBe(true);
  });
});

describe("POST /api/films/:id/animatic", () => {
  let client: TestClient;
  beforeEach(async () => { resetDb(); client = new TestClient(); await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" }); });
  test("an unknown film is 404 and nobody is 401", async () => {
    expect((await client.post("/api/films/none/animatic", {})).status).toBe(404);
    expect((await new TestClient().post("/api/films/none/animatic", {})).status).toBe(401);
  });
});
