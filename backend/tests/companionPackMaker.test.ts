import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { OpenAPIHono } from "@hono/zod-openapi";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { db } from "@/db";
import { jobs, people, sessions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { companionsRoutes } from "@/routes/companions";
import { createHouseholdCompanion, householdCompanionFolder, setHouseholdCompanionAudience, setHouseholdCompanionStatus } from "@/lib/householdCompanions";
import { loadManifestOnly } from "@/lib/plugins";
import { __reloadPersonasForTests } from "@/lib/persona";
import { addTake, readStates, saveStates, takePath, keyframePath, __resetCompanionStatesForTests } from "@/lib/companionStates";
import { addVersion, approveSheet, setRest, updateSheet } from "@/lib/companionLook";
import { writeKeyframe } from "@/lib/companionStates";
import { collectLiveAssets } from "@/lib/companionArtCheck";
import { setHouseholdSettingValue } from "@/lib/settings";
import { VIDEO_DENIAL_LINE } from "@/lib/videos/policy";
import { readCompanionPack, packFolder } from "@/lib/companionPack";
import { renameSync } from "node:fs";
import { __setStackClientForTests } from "@/lib/stackEngine";
import { __setKeyframesForTests } from "@/lib/pictures/keyframes";
import { __setAgeCheckRunnerForTests, __resetAgeCheckForTests, type AgeVerdict, type ImageCheck } from "@/lib/pictures/ageCheck";
import { __setChildSafetyRunnerForTests, type ChildSafetyCheck } from "@/lib/pictures/laneGate";
import {
  EMOTIONS, PACK_CLIP_STATES, PACK_NO_BOX_LINE, PACK_BAD_BOX_LINE, PACK_BAD_EYES_LINE, PACK_BOX_PHOTO_LINE, PACK_NO_EYES_LINE, STYLISED_LETTERS, StackPackOps, TALK_LETTERS, __clearPackJobsForTests, __setPackDepsForTests, cancelPackJob, packJobRunning, readPackJob, readPackJobReconciled, startPackJob, approvePackStage, waitPackJob, __setRenameForTests, PACK_EMPTY_LINE,
  type ClipMaker, type PackDeps, type PackJobStatus, type PackOpKind, type PackOpsClient,
} from "@/lib/companionPackMaker";
import type { PersonRow } from "@/types";
import { resetDb } from "./reset-db";
import sharp from "sharp";

const app = new OpenAPIHono();
app.route("/api/companions", companionsRoutes);
const now = new Date().toISOString();
const root = join(process.env.MAIPAI_DATA_DIR!, "companions");
const specFixture = join(dirname(Bun.resolveSync("@maipai/spec/package.json", import.meta.dir)), "fixtures", "companion-pack", "valid-man.json");
const fixture = loadManifestOnly("rivet");
if (!fixture.ok || !fixture.value.companion) throw new Error("rivet fixture is unavailable");
const fixtureCompanion = fixture.value.companion;

const okVerdict = (over: Partial<AgeVerdict> = {}): ImageCheck => ({ ok: true, verdict: { people_count: 1, apparent_min_age_estimate: 30, label: "adult", is_nude_or_sexual: false, confidence: 1, ...over } });
const cartoon: ChildSafetyCheck = { ok: true, verdict: { is_cartoon: true, looks_like_photo: false, brand_or_licensed_character: false, violent_or_scary: false, sexual_or_romantic: false, weapons_drugs_or_alcohol: false, confidence: 1 } };
const photo: ChildSafetyCheck = { ok: true, verdict: { ...cartoon.verdict, is_cartoon: false, looks_like_photo: true } } as never;
let n = 0;
const png = () => new Uint8Array([137, 80, 78, 71, ++n, 2, 3]);
/** A real 64x64 picture: the key colour with a grey figure from x 16..47 and y 8..55 (its opaque box 32x48 gives the pack frame {x: 7, y: 7, size: 51}); one pixel differs per call so no two are equal. */
async function figure(size = 64): Promise<Uint8Array> {
  const w = size, h = size, raw = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4, inside = x >= w / 4 && x < (3 * w) / 4 && y >= h / 8 && y < (7 * h) / 8; raw[o] = inside ? 128 : 0; raw[o + 1] = inside ? 128 : 255; raw[o + 2] = inside ? 128 : 0; raw[o + 3] = 255; }
  raw[2] = ++n % 200;
  return new Uint8Array(await sharp(raw, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer());
}
const EXPECTED_FRAME = { x: 14, y: 4, size: 36 }; // the headshot frame of the fake 64x64 figure (x 16..47, y 8..55): band 36 high, centred on the figure, 10 percent above its top

function addPerson(id: string, role: string, birthdate?: string) {
  db.insert(people).values({ id, displayName: id, role, avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test", ...(birthdate ? { birthdate } : {}) } as never).run();
  const token = `session-${id}`;
  db.insert(sessions).values({ id: `sess-${id}`, personId: id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 60_000).toISOString(), createdAt: now }).run();
  return token;
}
const person = (id: string): PersonRow => db.select().from(people).where(eq(people.id, id)).get() as PersonRow;
const post = (path: string, token: string, body: unknown) => app.request(`http://localhost/api/${path}`, { method: "POST", headers: { cookie: `session=${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
const get = (path: string, token: string) => app.request(`http://localhost/api/${path}`, { headers: { cookie: `session=${token}` } });

// ---- the fakes
interface Fakes { ops: PackOpsClient & { calls: string[]; inputs: Array<{ kind: string; input: any }>; restSizes: Array<Array<number | undefined>>; jobs: string[]; cancelled: string[]; edits: number; eyes?: number[]; shapesWrite: string[]; block?: { release(): void; kind: PackOpKind } | null; failKind?: PackOpKind | null }; clips: ClipMaker & { calls: number; frames: Array<{ frame?: unknown; frameSource?: unknown }>; artRefuse: boolean; uploadDuring: boolean; throwAfterCreate: boolean; block?: Promise<void>; editKeyframe?: boolean; settleMs: number; settled: boolean; uploadTake?: string }; checks: Array<{ label: string; actor: string; kind: string }>; deps: Partial<PackDeps> }

function fakes(id: string): Fakes {
  const checks: Fakes["checks"] = [];
  let jobSeq = 0;
  const ops: Fakes["ops"] = {
    calls: [], inputs: [], restSizes: [], jobs: [], cancelled: [], edits: 0, block: null, failKind: null, shapesWrite: ["atlas.png", "weight.png"],
    async imageEdit(input) { ops.edits++; const job = `stack-edit-${++jobSeq}`; ops.jobs.push(job); input.onJob(job); return figure(); },
    async talkFrames(input) { const job = `stack-talk-${++jobSeq}`; ops.jobs.push(job); input.onJob(job); const face = { outerLips: [[10, 10], [30, 18]], innerLips: [[12, 12]], nose: [[20, 8]], contour: [[1, 1]], points: [[1, 1]] };
      return { frames: Object.fromEntries(await Promise.all(input.letters.map(async (l) => [l, await figure()]))), sourceLandmarks: { ...face, points: Array.from({ length: 203 }, (_, i) => [i, i]) }, landmarks: Object.fromEntries(input.letters.map((l) => [l, face])) }; },
    async run(kind, input, hooks) {
      ops.calls.push(kind); ops.inputs.push({ kind, input: JSON.parse(JSON.stringify(input)) });
      const job = `stack-${kind}-${++jobSeq}`; ops.jobs.push(job); hooks.onJob(job);
      if (ops.block?.kind === kind) await new Promise<void>((resolve, reject) => { ops.block!.release = resolve; hooks.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))); });
      if (input.rest) ops.restSizes.push(await sharp(String(input.rest)).metadata().then((m) => [m.width, m.height, m.channels]));
      if (ops.failKind === kind) return { ok: false, reasons: [`The ${kind} measurement failed: the lighting step is over the limit. Make the clips again.`], report: {} };
      const out = String(input.output_dir);
      mkdirSync(out, { recursive: true });
      if (kind === "media.companion_emotion") { const l = input.landmarks as { leftEye: number[][]; rightEye: number[][] }; ops.eyes = [l.leftEye.length, l.rightEye.length, l.leftEye[0]![0]!, l.rightEye[0]![0]!]; }
      if (kind === "media.companion_track") writeFileSync(join(out, "track.json"), JSON.stringify({ m: [], res: [], cc: [], low: [], frames: 0 }));
      if (kind === "media.companion_shapes") { mkdirSync(join(out, "shapes", "calm"), { recursive: true }); for (const name of ops.shapesWrite) writeFileSync(join(out, "shapes", "calm", name), png()); }
      if (kind === "media.companion_emotion") { mkdirSync(join(out, "emotion"), { recursive: true }); writeFileSync(join(out, "emotion", "angry.png"), png()); writeFileSync(join(out, "emotion", "meta.json"), "{}"); }
      if (kind === "media.companion_pack") writePack(join(out, "pack"));
      return { ok: true, reasons: [], report: { ok: true } };
    },
    async cancel(job) { ops.cancelled.push(job); },
  };
  const clips: Fakes["clips"] = {
    calls: 0, frames: [], artRefuse: false, uploadDuring: false, throwAfterCreate: false, settleMs: 0, settled: true,
    async makeTakes({ companionId, state, count, job, onJob, signal, frame, frameSource }) {
      clips.calls++; clips.frames.push({ frame, frameSource }); onJob(`video-${clips.calls}`); onJob(`finish-${clips.calls}`);
      if (clips.editKeyframe) writeKeyframe(companionId, state, new Uint8Array([9, 9, 9]), { source: "upload", style: "keep", prompt_hash: "y".repeat(64), model: null, created_at: now, edited_at: now });
      if (clips.block) await Promise.race([clips.block, new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))))]);
      if (clips.settleMs) { clips.settled = false; await Bun.sleep(clips.settleMs); clips.settled = true; }
      const out: Array<{ take: string; ok: boolean; art: boolean; reasons: string[] }> = [];
      if (clips.uploadDuring) { const up = addTake(companionId, state, { source: "upload", label: "A person's own upload" }); clips.uploadTake = up.id; }
      for (let i = 0; i < count; i++) {
        const take = addTake(companionId, state, { source: "generated", seed: 1, label: "Candidate", pack_job: job });
        mkdirSync(dirname(takePath(companionId, state, take.id, "still.png")!), { recursive: true });
        writeFileSync(takePath(companionId, state, take.id, "still.png")!, png());
        writeFileSync(takePath(companionId, state, take.id, "clip.h264.mp4")!, png());
        writeFileSync(takePath(companionId, state, take.id, "clip.phone.h264.mp4")!, new Uint8Array([0xee, 1, 2]));
        if (clips.throwAfterCreate) throw new Error("The video engine stopped. Try again.");
        writeFileSync(join(dirname(takePath(companionId, state, take.id, "still.png")!), "..", "source.mp4"), png());
        const all = readStates(companionId), row = all.states[state as "idle"]!, t = row.takes.find((x) => x.id === take.id)!;
        if (clips.artRefuse) { t.failure = "This picture looks like a photo, and a child's companion can only be a cartoon. Choose a cartoon."; t.failure_kind = "art"; saveStates(companionId, all); out.push({ take: take.id, ok: false, art: true, reasons: [t.failure] }); continue; }
        t.report = { ok: true, reasons: [], seconds: 3, bytes: { h264: 10, av1: null }, colour_distance: 1, area_ratio: 1, loop_gap: 0, opaque_share: { min: 0.2, max: 0.5 } };
        saveStates(companionId, all); // a pack take is never auto-approved (finishTake skips it for pack runs)
        out.push({ take: take.id, ok: true, art: false, reasons: [] });
      }
      return out;
    },
  };
  void id;
  return { ops, clips, checks, deps: { ops, clips, readiness: async () => null, checkArt: async (_id, actor, assets, kind) => { for (const a of assets) checks.push({ label: a.label, actor: actor.id, kind }); return { ok: true, reasons: [], unavailable: false, definite: false }; } } };
}

/** A pack that passes the spec validator: the spec's fixture manifest with a placeholder for every file it names. */
function writePack(dir: string) {
  const pack = JSON.parse(readFileSync(specFixture, "utf8"));
  const put = (rel: string, body: string) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), body); };
  put("pack.json", JSON.stringify(pack)); put(pack.rest, "webp-bytes");
  for (const clips of Object.values<any[]>(pack.states)) for (const c of clips) { put(c.file, "0123456789"); put(c.trackFile, "[]"); if (c.phone) put(c.phone, "phone"); }
  for (const d of [pack.mouth.calm.dir, pack.mouth.shout?.dir, pack.head.dir, pack.eyes.dir, pack.emotion.dir]) if (d) put(`${d}/meta.json`, "{}");
  put("head/flow.z", "zzzz");
}

let owner: string, child: string, other: string, id: string, stillId: string;

function setup(audience: "adult" | "teen" | "all" = "adult"): string {
  const made = createHouseholdCompanion({ ...fixtureCompanion, display_name: "Pack maker fox" }, { display_name: "Author", person_id: "maker-owner" });
  if (!made.ok) throw new Error(made.error);
  const cid = made.value.id;
  setHouseholdCompanionAudience(cid, audience, { display_name: "Admin" }); setHouseholdCompanionStatus(cid, "ready"); __reloadPersonasForTests();
  const rest = addVersion(cid, new Uint8Array([1, 2, 3]), { source: "upload", label: "rest", width: 1024, height: 1024, from: null }); setRest(cid, rest.id);
  updateSheet(cid, { views: { left: null, right: null, mouth: null }, card: { text: "a man", species: "human", colours: ["#CC3322"] }, key: "#00FF00", state: "needs_review", approved_by: null, approved_at: null } as never); approveSheet(cid, "Author");
  stillId = rest.id;
  return cid;
}

beforeEach(() => {
  resetDb(); rmSync(root, { recursive: true, force: true }); __resetCompanionStatesForTests(); __clearPackJobsForTests(); n = 0;
  owner = addPerson("maker-owner", "owner"); child = addPerson("maker-child", "child", "2018-01-01"); other = addPerson("maker-other", "member", "1990-01-01");
  __setAgeCheckRunnerForTests(async (images) => images.map(() => okVerdict())); __setChildSafetyRunnerForTests(async (images) => images.map(() => cartoon) as never);
  __setKeyframesForTests(async () => [new Uint8Array([7])]);
  id = setup();
});
afterEach(() => { __setRenameForTests(null); setHouseholdSettingValue("generation.video.enabled", true); __clearPackJobsForTests(); __setPackDepsForTests(null); __resetAgeCheckForTests(); __setChildSafetyRunnerForTests(null); __setKeyframesForTests(null); __setStackClientForTests(null); rmSync(root, { recursive: true, force: true }); __resetCompanionStatesForTests(); });

async function runTo(rec: ReturnType<typeof readPackJob>, status: PackJobStatus) { await waitPackJob(id); const now = readPackJob(id)!; expect(now.status).toBe(status); return now ?? rec; }

describe("the pack job state machine", () => {
  test("happy path: stages in order, three approvals, the pack installed validates, every output was checked", async () => {
    const f = fakes(id); __setPackDepsForTests(f.deps);
    const started = await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "photo" });
    expect(started.ok).toBe(true);
    let rec = await runTo(null, "waiting_approval");
    expect(rec.waiting_for).toBe("B");
    expect(rec.stages.source.status).toBe("done"); expect(rec.stages.clips.status).toBe("done"); expect(rec.stages.track.status).toBe("pending");
    expect(f.clips.calls).toBe(PACK_CLIP_STATES.length); // idle once for its two, then one call each
    expect((await approvePackStage(id, person("maker-owner"), "C")).ok).toBe(false);
    expect((await approvePackStage(id, person("maker-owner"), "B")).ok).toBe(true);
    rec = await runTo(null, "waiting_approval");
    expect(rec.waiting_for).toBe("C"); expect(rec.stages.validate.status).toBe("done"); expect(rec.stages.install.status).toBe("pending");
    expect(existsSync(join(householdCompanionFolder(id)!, "pack", "pack.json"))).toBe(false); // nothing installed before approval C
    expect((await approvePackStage(id, person("maker-owner"), "C")).ok).toBe(true);
    rec = await runTo(null, "done");
    expect(Object.values(rec.stages).every((s) => s.status === "done")).toBe(true);
    expect(f.ops.calls).toEqual(["media.companion_track", "media.companion_track", "media.companion_track", "media.companion_track", "media.companion_track", "media.companion_shapes", "media.companion_emotion", "media.companion_pack"]);
    expect(f.ops.eyes!.slice(0, 2)).toEqual([24, 24]); expect(f.ops.eyes![2]).toBeCloseTo((0 - 14) * 480 / 36, 3); expect(f.ops.eyes![3]).toBeCloseTo((24 - 14) * 480 / 36, 3); // leftEye = points 0..23, rightEye = 24..47, in the pack frame
    expect(rec.notes).toContain("head and eyes layers: skipped, not supported yet");
    expect(readCompanionPack(id)).not.toBeNull(); // validateCompanionPack through packFolderProblems on the installed folder
    expect(existsSync(join(packFolder(id)!, "pack.json"))).toBe(true);
    // One check call per output: 1 green source + 5 take sets (a still and its frames each) (idle x2, listening, thinking, speaking) + 9 mouth pictures + 2 tiles + 4 poses + 1 emotion tile.
    // The generation outputs are all there (the pack is scanned again in validate and install, so more calls follow).
    const labels = f.checks.map((c) => c.label);
    expect(labels.filter((l) => l === "The green source picture").length).toBe(1);
    expect(labels.filter((l) => l.startsWith("The mouth picture")).length).toBe(TALK_LETTERS.length);
    expect(labels.filter((l) => /^The (idle|listening|thinking|speaking) (still|clip frames|phone clip frames)/.test(l)).length).toBe(5 * 3); // each take: its still, its clip frames and its phone twin
    expect(labels.filter((l) => l.endsWith("pose")).length).toBe(EMOTIONS.length);
    expect(labels.some((l) => l.startsWith("A mouth shape tile"))).toBe(true); expect(labels.some((l) => l.startsWith("An emotion tile"))).toBe(true);
    expect(labels.filter((l) => l.startsWith("The pack to install")).length).toBeGreaterThan(0);
    expect(f.checks.every((c) => c.actor === "maker-owner")).toBe(true);
    expect(rec.stages.source.stack_jobs.length).toBe(1);
    expect(rec.stages.shapes.stack_jobs.length).toBe(2);
    expect(db.select().from(jobs).all().some((j) => j.kind === "companion_pack_job" && j.state === "done")).toBe(true);
  });

  test("refuses to start without an approved still picture", async () => {
    const f = fakes(id); __setPackDepsForTests(f.deps);
    const stray = addVersion(id, new Uint8Array([9, 9]), { source: "upload", label: "other", width: 1024, height: 1024, from: null });
    expect(await startPackJob({ actor: person("maker-owner"), companionId: id, stillId: "", shapes: "photo" })).toMatchObject({ ok: false, status: 422 });
    expect(await startPackJob({ actor: person("maker-owner"), companionId: id, stillId: "nope", shapes: "photo" })).toMatchObject({ ok: false, status: 422 });
    expect(await startPackJob({ actor: person("maker-owner"), companionId: id, stillId: stray.id, shapes: "photo" })).toMatchObject({ ok: false, status: 409 });
    expect(readPackJob(id)).toBeNull(); expect(f.ops.edits).toBe(0);
  });

  test("a stage failure keeps the earlier stages, stops with its plain reason, and a new start continues at that stage", async () => {
    const f = fakes(id); __setPackDepsForTests(f.deps);
    await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "photo" });
    await runTo(null, "waiting_approval");
    f.ops.failKind = "media.companion_track";
    await approvePackStage(id, person("maker-owner"), "B");
    const rec = await runTo(null, "failed");
    expect(rec.stage).toBe("track"); expect(rec.stages.track.status).toBe("failed");
    expect(rec.error).toContain("lighting step"); expect(rec.stages.source.status).toBe("done"); expect(rec.stages.clips.status).toBe("done");
    f.ops.failKind = null; const edits = f.ops.edits, clipCalls = f.clips.calls;
    const again = await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "photo" });
    expect(again).toMatchObject({ ok: true, resumed: true });
    await runTo(null, "waiting_approval");
    expect(f.clips.calls).toBe(clipCalls); // the clips were not made again
    expect(f.ops.edits).toBe(edits + EMOTIONS.length); // only the emotion poses were edited after the restart point
  });

  test("resume after a restart continues at the stage that was running, not from the start", async () => {
    const f = fakes(id); __setPackDepsForTests(f.deps);
    await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "photo" });
    await runTo(null, "waiting_approval");
    f.ops.block = { kind: "media.companion_track", release() {} };
    await approvePackStage(id, person("maker-owner"), "B");
    for (let i = 0; i < 100 && f.ops.calls.length === 0; i++) await Bun.sleep(10);
    expect(readPackJob(id)!.stage).toBe("track");
    const lostJob = readPackJob(id)!.stages.track.stack_jobs[0]!;
    __clearPackJobsForTests(); // the process restarts: the live run is gone, the state file stays
    expect(readPackJobReconciled(id)!.status).toBe("running"); expect(db.select().from(jobs).all().find((j) => j.kind === "companion_pack_job")!.errorKind).toBe("interrupted"); // the activity row says so (finding 10)
    expect(packJobRunning(id)).toBe(false);
    const rec = readPackJob(id)!; expect(rec.status).toBe("running"); expect(rec.stages.source.status).toBe("done");
    f.ops.block = null; const edits = f.ops.edits, clipCalls = f.clips.calls;
    expect(await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "photo" })).toMatchObject({ ok: true, resumed: true });
    await runTo(null, "waiting_approval");
    expect(readPackJob(id)!.waiting_for).toBe("C");
    expect(f.clips.calls).toBe(clipCalls); expect(f.ops.edits).toBe(edits + EMOTIONS.length);
    expect(f.ops.cancelled.filter((x) => x === lostJob).length).toBe(1); // finding 9: the cut-off stage's Stack job is cancelled once on resume
  });

  test("cancel cancels the running Stack job and keeps the finished stages", async () => {
    const f = fakes(id); __setPackDepsForTests(f.deps);
    await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "photo" });
    await runTo(null, "waiting_approval");
    f.ops.block = { kind: "media.companion_track", release() {} };
    await approvePackStage(id, person("maker-owner"), "B");
    for (let i = 0; i < 100 && f.ops.calls.length === 0; i++) await Bun.sleep(10);
    const running = readPackJob(id)!.stages.track.stack_jobs[0]!;
    const result = await cancelPackJob(id);
    expect(result.job!.status).toBe("cancelled");
    expect(f.ops.cancelled).toContain(running);
    expect(result.job!.stages.source.status).toBe("done"); expect(result.job!.stages.track.status).toBe("pending");
    expect(packJobRunning(id)).toBe(false);
  });

  test("a no-mouth character and an unknown kind get a plain refusal; a stylised start needs the box", async () => {
    __setPackDepsForTests(fakes(id).deps);
    expect(await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "mouthless" })).toMatchObject({ ok: false, status: 422, error: expect.stringContaining("Only photo and stylised") });
    expect(await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "stylised" })).toMatchObject({ ok: false, status: 422, error: PACK_NO_BOX_LINE });
    expect(readPackJob(id)).toBeNull();
  });
});

describe("MAKER-D2: previews and the stylised path", () => {
  const stylisedStart = (extra: Record<string, unknown> = {}) => startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "stylised", box: [400, 600, 200, 100], face_height_px: 700, eyes: { left: [[300, 300], [320, 296], [340, 300]], right: [[600, 300], [620, 296], [640, 300]] }, ...extra } as never);

  test("preview fields: clips with take ids and URLs at B, a pack block at C, neither at other times", async () => {
    const f = fakes(id); __setPackDepsForTests(f.deps);
    await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "photo" });
    const atB = await (await get(`companions/${id}/pack-job`, owner)).json() as any;
    await waitPackJob(id);
    const b = await (await get(`companions/${id}/pack-job`, owner)).json() as any;
    expect(atB.clips).toEqual([]); expect(b.waiting_for).toBe("B"); expect(b.preview).toBeNull();
    expect(b.clips.map((c: any) => c.state).sort()).toEqual(["idle", "idle", "listening", "speaking", "thinking"]);
    for (const c of b.clips) { expect(c.url).toBe(`/api/companions/${id}/states/${c.state}/${c.take}/clip.h264.mp4`); expect((await get(c.url.replace("/api/", ""), owner)).status).toBe(200); }
    await approvePackStage(id, person("maker-owner"), "B"); await waitPackJob(id);
    const c = await (await get(`companions/${id}/pack-job`, owner)).json() as any;
    expect(c.waiting_for).toBe("C"); expect(c.clips).toEqual([]);
    expect(c.preview).toEqual({ pack_url_base: `/api/companions/${id}/pack-job/preview/`, pack_json_url: `/api/companions/${id}/pack-job/preview/pack.json`, installed: false });
  });

  test("the preview route: pack.json and an mp4 range at C, traversal and links refused, editors only, 409 elsewhere, block after install", async () => {
    const f = fakes(id); __setPackDepsForTests(f.deps);
    const url = (file: string) => `companions/${id}/pack-job/preview/${file}`;
    await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "photo" });
    await waitPackJob(id);
    expect((await get(url("pack.json"), owner)).status).toBe(409); // waiting at B
    await approvePackStage(id, person("maker-owner"), "B"); await waitPackJob(id);
    const pj = await get(url("pack.json"), owner); expect(pj.status).toBe(200); expect(pj.headers.get("content-type")).toContain("application/json");
    const pack = await pj.json() as any, clipFile = (Object.values(pack.states)[0] as any[])[0].file as string;
    const ranged = await app.request(`http://localhost/api/${url(clipFile)}`, { headers: { cookie: `session=${owner}`, range: "bytes=0-3" } });
    expect(ranged.status).toBe(206); expect((await ranged.arrayBuffer()).byteLength).toBe(4);
    const dir = join(householdCompanionFolder(id)!, "pack-job", "work", "pack-out", "pack");
    expect((await get(url("..%2Fsource.png"), owner)).status).not.toBe(200); expect((await get(url("%2e%2e/%2e%2e/state.json"), owner)).status).not.toBe(200);
    writeFileSync(join(dir, "..", "secret.json"), "{}"); symlinkSync(join(dir, "..", "secret.json"), join(dir, "link.json"));
    expect((await get(url("link.json"), owner)).status).toBe(404);
    expect((await get(url("notes.txt"), owner)).status).toBe(404); expect((await get(url("nope.json"), owner)).status).toBe(404);
    expect((await get(url("pack.json"), child)).status).toBeGreaterThanOrEqual(403); expect((await get(url("pack.json"), other)).status).toBeGreaterThanOrEqual(403);
    rmSync(join(dir, "link.json"), { force: true }); // a planted link would (rightly) fail the install
    await approvePackStage(id, person("maker-owner"), "C"); await waitPackJob(id);
    const done = await (await get(`companions/${id}/pack-job`, owner)).json() as any;
    expect(done.preview).toEqual({ pack_url_base: `/api/companions/${id}/pack/`, pack_json_url: `/api/companions/${id}/pack/pack.json`, installed: true });
    expect((await get(url("pack.json"), owner)).status).toBe(409); // after install the preview route is closed; the installed pack answers at /pack/
    expect((await get(`companions/${id}/pack/pack.json`, owner)).status).toBe(200);
  });

  test("the preview route is closed for a failed job and for a closed (safety) job", async () => {
    const f = fakes(id); __setPackDepsForTests(f.deps);
    await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "photo" }); await waitPackJob(id);
    await approvePackStage(id, person("maker-owner"), "B"); await waitPackJob(id);
    const url = `companions/${id}/pack-job/preview/pack.json`;
    expect((await get(url, owner)).status).toBe(200);
    const rec = readPackJob(id)!; rec.status = "failed"; writeFileSync(join(householdCompanionFolder(id)!, "pack-job", "state.json"), JSON.stringify(rec));
    expect((await get(url, owner)).status).toBe(409);
    rec.status = "waiting_approval"; rec.closed = true; writeFileSync(join(householdCompanionFolder(id)!, "pack-job", "state.json"), JSON.stringify(rec));
    expect((await get(url, owner)).status).toBe(409);
  });

  test("a changed box wipes the old job (takes gone, old Stack jobs cancelled once); the same box resumes without wiping", async () => {
    const f = fakes(id); __setPackDepsForTests(f.deps);
    await stylisedStart(); await runTo(null, "waiting_approval");
    const first = readPackJob(id)!, oldJobs = Object.values(first.stages).flatMap((st) => st.stack_jobs), oldTakes = first.clips.map((c) => `${c.state}/${c.take}`);
    expect(oldJobs.length).toBeGreaterThan(0); expect(oldTakes.length).toBe(5);
    __clearPackJobsForTests();
    const clipCalls = f.clips.calls;
    expect(await stylisedStart()).toMatchObject({ ok: true, resumed: true }); await runTo(null, "waiting_approval");
    expect(f.clips.calls).toBe(clipCalls); expect(f.ops.cancelled).toEqual([]); // control: nothing wiped, nothing cancelled
    for (const t of oldTakes) { const [state, take] = t.split("/"); expect(existsSync(takePath(id, state!, take!, "clip.h264.mp4")!)).toBe(true); }
    __clearPackJobsForTests();
    expect(await stylisedStart({ box: [100, 100, 80, 40] })).toMatchObject({ ok: true, resumed: false });
    for (const j of oldJobs) expect(f.ops.cancelled.filter((x) => x === j).length).toBe(1);
    for (const t of oldTakes) { const [state, take] = t.split("/"); expect(existsSync(takePath(id, state!, take!, "clip.h264.mp4")!)).toBe(false); }
  });

  test("when the green source differs in size from the starting picture, the box, face height and eyes are scaled", async () => {
    const f = fakes(id); __setPackDepsForTests(f.deps);
    const sharp = (await import("sharp")).default, half = new Uint8Array(await sharp({ create: { width: 512, height: 512, channels: 3, background: "#00ff00" } }).png().toBuffer());
    f.ops.imageEdit = async (input) => { input.onJob(`stack-edit-${++f.ops.edits}`); return half; };
    const calls: Array<{ kind: string; input: Record<string, any> }> = []; const run = f.ops.run;
    f.ops.run = async (kind, input, hooks) => { calls.push({ kind, input }); return run(kind, input, hooks); };
    expect(await stylisedStart()).toMatchObject({ ok: true });
    await runTo(null, "waiting_approval"); await approvePackStage(id, person("maker-owner"), "B"); await runTo(null, "waiting_approval");
    expect(calls.find((c) => c.kind === "media.companion_shapes")!.input).toMatchObject({ mouth_box: [188, 281, 94, 47], face_height_px: 328 }); // scaled by 0.5 into the 512 source, then by 480/512 (no figure to key out: the frame is the whole picture)
    expect(calls.find((c) => c.kind === "media.companion_emotion")!.input.landmarks.leftEye[0]).toEqual([140.625, 140.625]);
    expect(calls.find((c) => c.kind === "media.companion_pack")!.input.descriptor.mouth.anchor).toMatchObject({ x: 187.5 / 480, w: 93.75 / 480 });
    expect(calls.find((c) => c.kind === "media.companion_pack")!.input.descriptor.tile).toEqual({ desktop: 480, phone: 320 }); // named, so the Stack declares every phone twin
  });

  test("an oversize or wrong-length box or eyes request is refused at the route with a plain message", async () => {
    const f = fakes(id); __setPackDepsForTests(f.deps);
    const pts = (n: number) => Array.from({ length: n }, (_, i) => [i, i]);
    for (const body of [{ box: [1, 2, 3, 4, 5] }, { box: [1, 2, 3] }, { eyes: { left: pts(101), right: pts(3) } }, { eyes: { left: pts(2), right: pts(3) } }]) {
      const r = await post(`companions/${id}/pack-job`, owner, { still_id: stillId, shapes: "stylised", box: [400, 600, 200, 100], ...body });
      expect(r.status).toBe(422); expect(typeof ((await r.json()) as any).error).toBe("string");
    }
    expect(readPackJob(id)).toBeNull();
  });

  test("the preview route is closed after a cancel", async () => {
    const f = fakes(id); __setPackDepsForTests(f.deps);
    await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "photo" }); await waitPackJob(id);
    await approvePackStage(id, person("maker-owner"), "B"); await waitPackJob(id);
    expect((await get(`companions/${id}/pack-job/preview/pack.json`, owner)).status).toBe(200);
    await cancelPackJob(id);
    expect((await get(`companions/${id}/pack-job/preview/pack.json`, owner)).status).toBe(409);
  });

  test("box validation: inside the picture, positive, minimum size; ignored values are refused for photo", async () => {
    const f = fakes(id); __setPackDepsForTests(f.deps);
    for (const box of [[-1, 10, 50, 50], [10, 10, 4, 50], [10, 10, 50, 7], [1000, 10, 50, 50], [10, 1000, 50, 50], [10, 10, 50], [10, 10, 0, 0]]) expect(await stylisedStart({ box })).toMatchObject({ ok: false, status: 422, error: PACK_BAD_BOX_LINE });
    expect(await stylisedStart({ face_height_px: 0 })).toMatchObject({ ok: false, status: 422, error: PACK_BAD_BOX_LINE });
    expect(await stylisedStart({ face_height_px: 5000 })).toMatchObject({ ok: false, status: 422, error: PACK_BAD_BOX_LINE });
    expect(await stylisedStart({ eyes: { left: [[1, 1]], right: [[2, 2], [3, 3], [4, 4]] } })).toMatchObject({ ok: false, status: 422, error: PACK_BAD_EYES_LINE });
    expect(await stylisedStart({ eyes: { left: [[1, 1], [2, 2], [3, 5000]], right: [[2, 2], [3, 3], [4, 4]] } })).toMatchObject({ ok: false, status: 422, error: PACK_BAD_EYES_LINE });
    expect(await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "photo", box: [10, 10, 50, 50] } as never)).toMatchObject({ ok: false, status: 422, error: PACK_BOX_PHOTO_LINE });
    expect(await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "photo", eyes: { left: [], right: [] } } as never)).toMatchObject({ ok: false, status: 422, error: PACK_BOX_PHOTO_LINE });
    expect(readPackJob(id)).toBeNull(); expect(f.ops.edits).toBe(0);
    const viaRoute = await post(`companions/${id}/pack-job`, owner, { still_id: stillId, shapes: "photo", box: [1, 2, 30, 30] }); expect(viaRoute.status).toBe(422);
  });

  test("stylised happy path: every letter picture is art-checked, the op gets the stylised params, the box is stored", async () => {
    const f = fakes(id); __setPackDepsForTests(f.deps);
    const calls: Array<{ kind: string; input: Record<string, unknown> }> = []; const run = f.ops.run;
    f.ops.run = async (kind, input, hooks) => { calls.push({ kind, input }); return run(kind, input, hooks); };
    f.ops.imageEdit = async (input) => { input.onJob(`stack-edit-${++f.ops.edits}`); return figure(1024); }; // the green source is as big as the starting picture
    const instructions: string[] = []; const edit = f.ops.imageEdit; f.ops.imageEdit = async (input) => { instructions.push(input.instruction); return edit(input); };
    let talk = 0; const tf = f.ops.talkFrames; f.ops.talkFrames = async (input) => { talk++; return tf(input); };
    expect(await stylisedStart()).toMatchObject({ ok: true });
    await runTo(null, "waiting_approval"); await approvePackStage(id, person("maker-owner"), "B");
    const rec = await runTo(null, "waiting_approval");
    expect(rec.shapes).toBe("stylised"); expect(rec.box).toEqual([400, 600, 200, 100]); expect(talk).toBe(0); // no face tools
    const shapes = calls.find((c) => c.kind === "media.companion_shapes")!.input;
    // a 1024 source with the figure from x 256..767, y 128..895: the headshot frame is {x: 224, y: 70, size: 576}; the box is moved into it and scaled to 480
    const g = { x: 224, y: 70, size: 576 }, pk = 480 / g.size;
    expect(rec.frame).toEqual(g);
    expect(shapes).toMatchObject({ path: "stylised", mouth_box: [Math.round((400 - g.x) * pk), Math.round((600 - g.y) * pk), Math.round(200 * pk), Math.round(100 * pk)], face_height_px: Math.round(700 * pk), sets: ["calm"] });
    expect(shapes.landmarks).toBeUndefined();
    const labels = f.checks.map((c) => c.label);
    for (const l of STYLISED_LETTERS) expect(labels).toContain(`The mouth picture ${l}`); // each letter picture checked once per lane
    expect(labels.filter((l) => l.startsWith("The mouth picture")).length).toBe(STYLISED_LETTERS.length);
    expect(labels.some((l) => l.startsWith("A mouth shape tile"))).toBe(true);
    expect(instructions.filter((i) => i.startsWith("Change only the mouth")).length).toBe(STYLISED_LETTERS.length);
    const emotion = calls.find((c) => c.kind === "media.companion_emotion")!.input as any;
    expect(emotion.landmarks.leftEye[0][0]).toBeCloseTo((300 - g.x) * pk, 3); expect(emotion.landmarks.leftEye[1][1]).toBeCloseTo((296 - g.y) * pk, 3);
    const pack = calls.find((c) => c.kind === "media.companion_pack")!.input as any;
    expect(pack.descriptor.mouth.anchor.w).toBeCloseTo(200 / g.size, 3); expect(pack.descriptor.mouth.anchor.x).toBeCloseTo((400 - g.x) / g.size, 3);
    await approvePackStage(id, person("maker-owner"), "C"); expect((await runTo(null, "done")).status).toBe("done");
  });

  test("stylised without eyes stops the emotion stage with a plain reason before any pose is made", async () => {
    const f = fakes(id); __setPackDepsForTests(f.deps);
    expect(await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "stylised", box: [400, 600, 200, 100] } as never)).toMatchObject({ ok: true });
    await runTo(null, "waiting_approval"); await approvePackStage(id, person("maker-owner"), "B");
    const rec = await runTo(null, "failed"); const edits = f.ops.edits;
    expect(rec.stage).toBe("emotion"); expect(rec.error).toBe(PACK_NO_EYES_LINE);
    expect(f.checks.filter((c) => c.label.endsWith("pose")).length).toBe(0); expect(edits).toBe(1 + STYLISED_LETTERS.length);
  });

  test("a stylised letter picture the art check refuses closes the job and keeps nothing", async () => {
    const f = fakes(id); let seen = 0;
    __setPackDepsForTests({ ...f.deps, checkArt: async (_i, actor, assets, kind) => { for (const a of assets) { f.checks.push({ label: a.label, actor: actor.id, kind }); if (a.label === "The mouth picture D") { seen++; return { ok: false, reasons: ["That mouth picture was refused by the safety check."], unavailable: false, definite: true } as never; } } return { ok: true, reasons: [], unavailable: false, definite: false }; } });
    expect(await stylisedStart()).toMatchObject({ ok: true });
    await runTo(null, "waiting_approval"); await approvePackStage(id, person("maker-owner"), "B");
    const rec = await runTo(null, "failed");
    expect(seen).toBe(1); expect(rec.closed).toBe(true); expect(rec.stage).toBe("shapes");
    expect(f.ops.calls).not.toContain("media.companion_shapes"); // the engine op never read a refused picture
    expect(existsSync(join(householdCompanionFolder(id)!, "pack-job", "work"))).toBe(false);
    expect(rec.takes).toEqual([]); expect(existsSync(join(householdCompanionFolder(id)!, "pack"))).toBe(false);
    for (const state of ["idle", "listening", "thinking", "speaking"]) expect(readStates(id).states[state as "idle"]?.takes ?? []).toEqual([]);
  });

  test("a changed box starts a new job rather than continuing the old one", async () => {
    const f = fakes(id); __setPackDepsForTests(f.deps);
    await stylisedStart(); await runTo(null, "waiting_approval");
    __clearPackJobsForTests();
    expect(await stylisedStart({ box: [100, 100, 80, 40] })).toMatchObject({ ok: true, resumed: false });
  });
});

describe("safety: RULES 0 and 10", () => {
  async function runWithRealCheck(actorId: string, audience: "adult" | "teen" | "all") {
    id = setup(audience);
    const f = fakes(id); __setPackDepsForTests({ ops: f.ops, clips: f.clips, readiness: async () => null }); // the real checkCompanionArt stays
    await startPackJob({ actor: person(actorId), companionId: id, stillId, shapes: "photo" });
    await waitPackJob(id);
    return f;
  }

  test("a child profile keeps the cartoon filter: a photo-like source closes the job and keeps nothing", async () => {
    __setChildSafetyRunnerForTests(async (images) => images.map(() => photo) as never);
    const f = await runWithRealCheck("maker-child", "all");
    const rec = readPackJob(id)!;
    expect(rec.status).toBe("failed"); expect(rec.closed).toBe(true); expect(rec.stages.source.status).toBe("failed");
    expect(existsSync(join(householdCompanionFolder(id)!, "pack-job", "work"))).toBe(false);
    expect(f.clips.calls).toBe(0); expect(existsSync(join(householdCompanionFolder(id)!, "pack"))).toBe(false);
  });

  test("an all-ages companion made by an adult still gets the child check", async () => {
    __setChildSafetyRunnerForTests(async (images) => images.map(() => photo) as never);
    await runWithRealCheck("maker-owner", "all");
    expect(readPackJob(id)).toMatchObject({ status: "failed", closed: true });
  });

  test("a teen profile keeps its filter: a possible minor in a sexual picture is withheld", async () => {
    __setAgeCheckRunnerForTests(async (images) => images.map(() => okVerdict({ label: "possibly_minor", apparent_min_age_estimate: 15, is_nude_or_sexual: true })));
    addPerson("maker-teen", "member", "2010-01-01");
    const f = await runWithRealCheck("maker-teen", "adult");
    const rec = readPackJob(id)!;
    expect(rec.status).toBe("failed"); expect(rec.error!.length).toBeGreaterThan(10); expect(rec.stages.source.reasons).toEqual([rec.error!]);
    expect(f.ops.edits).toBe(0); expect(f.clips.calls).toBe(0); // refused at the source screen, before anything was made
    expect(existsSync(join(householdCompanionFolder(id)!, "pack-job", "work", "source.png"))).toBe(false);
    expect(existsSync(join(householdCompanionFolder(id)!, "pack"))).toBe(false); expect(existsSync(keyframePath(id, "idle"))).toBe(false); expect(readStates(id).states.idle?.takes ?? []).toEqual([]);
  });

  test("a check that cannot run fails the job closed: takes and work removed, nothing installed", async () => {
    id = setup("adult");
    const f = fakes(id);
    let calls = 0;
    // The source and the first take pass; the next check cannot run (no vision model).
    __setPackDepsForTests({ ...f.deps, checkArt: async (cid, actor, assets, kind) => { if (++calls > 2) throw new Error("no vision model"); return f.deps.checkArt!(cid, actor, assets, kind); } });
    await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "photo" });
    await waitPackJob(id);
    const rec = readPackJob(id)!;
    expect(rec).toMatchObject({ status: "failed", closed: true }); expect(rec.error).toContain("nothing was kept");
    expect(existsSync(join(householdCompanionFolder(id)!, "pack-job", "work"))).toBe(false);
    expect(readStates(id).states.idle?.takes ?? []).toEqual([]); expect(rec.takes).toEqual([]);
    expect(existsSync(join(householdCompanionFolder(id)!, "pack"))).toBe(false);
    // A closed job is not resumed: the next start is a fresh job.
    __setPackDepsForTests(fakes(id).deps);
    expect(await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "photo" })).toMatchObject({ ok: true, resumed: false });
  });

  test("the starting image goes through prepareEditSource: a refused upload fails the source stage", async () => {
    const f = fakes(id); __setPackDepsForTests(f.deps);
    __setAgeCheckRunnerForTests(async (images) => images.map(() => okVerdict({ label: "possibly_minor", apparent_min_age_estimate: 10, is_nude_or_sexual: true })));
    await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "photo" });
    await waitPackJob(id);
    expect(readPackJob(id)).toMatchObject({ status: "failed" }); expect(f.ops.edits).toBe(0);
  });
});

describe("the routes", () => {
  test("start, state, approve and cancel; the guards", async () => {
    const f = fakes(id); __setPackDepsForTests(f.deps);
    expect((await post(`companions/${id}/pack-job`, other, { still_id: stillId })).status).toBe(403);
    expect((await post(`companions/${id}/pack-job`, child, { still_id: stillId })).status).toBe(403);
    expect((await get(`companions/${id}/pack-job`, other)).status).toBe(403);
    expect((await get(`companions/${id}/pack-job`, owner)).status).toBe(404);
    expect((await post(`companions/${id}/pack-job`, owner, { still_id: stillId, shapes: "stylised" })).status).toBe(422);
    const started = await post(`companions/${id}/pack-job`, owner, { still_id: stillId, shapes: "photo" });
    expect(started.status).toBe(202);
    await waitPackJob(id);
    const state = await (await get(`companions/${id}/pack-job`, owner)).json() as { status: string; waiting_for: string; stages: Array<{ name: string; status: string }> };
    expect(state).toMatchObject({ status: "waiting_approval", waiting_for: "B" }); expect(state.stages.map((s) => s.name)).toEqual(["source", "clips", "track", "shapes", "emotion", "assemble", "validate", "install"]);
    expect((await post(`companions/${id}/pack-job/approve`, owner, { stage: "C" })).status).toBe(409);
    expect((await post(`companions/${id}/pack-job/approve`, other, { stage: "B" })).status).toBe(403);
    expect((await post(`companions/${id}/pack-job/approve`, owner, { stage: "B" })).status).toBe(200);
    await waitPackJob(id);
    expect((await post(`companions/${id}/pack-job/cancel`, owner, {})).status).toBe(200);
    expect(readPackJob(id)!.status).toBe("cancelled");
  });

  test("not ready: the route refuses with the plain reason and starts nothing", async () => {
    __setPackDepsForTests({ ...fakes(id).deps, readiness: async () => ({ status: 503, error: "Making a talking pack needs the face tools, which are not ready on this computer yet." }) });
    const res = await post(`companions/${id}/pack-job`, owner, { still_id: stillId });
    expect(res.status).toBe(503); expect((await res.json() as { error: string }).error).toContain("face tools");
    expect(readPackJob(id)).toBeNull();
  });
});

describe("StackPackOps against the documented MAKER-H and talk-frames shapes (Stack docs/integrations.md, fc459c8)", () => {
  const face = { outerLips: [[1, 2]], innerLips: [[3, 4]], nose: [[5, 6]], contour: [[7, 8]], points: [[9, 10]] };
  function client(result: Record<string, unknown>) {
    const submitted: Array<{ kind: string; input: Record<string, unknown> }> = [], forms: Record<string, FormData[]> = { edits: [], talk: [] };
    const c = {
      mediaRoots: async () => ({ read: [], write: [] }), setMediaRoots: async () => undefined,
      submitJob: async (request: { kind: string; input: Record<string, unknown> }) => { submitted.push(request); return { id: "job-1", state: "done", result }; },
      job: async () => ({ id: "job-1", state: "done", result }),
      imageEdit: async (form: FormData) => { forms.edits!.push(form); return { kind: "running", job: "edit-1" }; },
      imageEditResult: async () => new Uint8Array([5, 6]), cancelJob: async () => ({}),
      talkFrames: async (form: FormData) => { forms.talk!.push(form); return { kind: "done", body: { job: "talk-1", sourceEye: 0.3, sourceLip: 0.1, sourceLandmarks: face, frames: [0, 1].map((i) => ({ kind: "lip", ratio: i / 10, landmarks: i === 0 ? face : null })) } }; },
      talkFramePicture: async (_job: string, index: number) => new Uint8Array([index, 9]),
    };
    __setStackClientForTests(c as never);
    return { submitted, forms };
  }
  test("a media op is submitted under its kind with the input as given, and a real MAKER-H track result is read", async () => {
    const real = { output_dir: "/o", track_path: "/o/track.json", report_path: "/o/report.json", ok: true, reasons: [], frames: 12, low: [] };
    const { submitted } = client(real), seen: string[] = [];
    const input = { rest: "/r.png", clip: "/c.mp4", output_dir: "/o" };
    const result = await StackPackOps.run("media.companion_track", input, { onJob: (j) => seen.push(j) });
    expect(submitted).toEqual([{ kind: "media.companion_track", input }]); expect(seen).toEqual(["job-1"]);
    expect(result).toEqual({ ok: true, reasons: [], report: real });
  });
  test("a worker refusal (state done, ok false) comes back with its reasons; the pack result shape is kept", async () => {
    client({ output_dir: "/o", report_path: "/o/report.json", ok: false, reasons: ["The pack is over its size budget; the largest files are listed."], code: "over_budget" });
    const refused = await StackPackOps.run("media.companion_pack", { rest: "/r.png", staging: "/s", descriptor: { id: "x" }, output_dir: "/o" }, { onJob: () => undefined });
    expect(refused).toMatchObject({ ok: false, reasons: ["The pack is over its size budget; the largest files are listed."] });
    client({ ok: true, reasons: [], pack_dir: "/o/pack", pack: { id: "x", desktopBytes: 10, phoneBytes: 2, budgetBytes: 12, files: 5, lossyChecks: [] } });
    const made = await StackPackOps.run("media.companion_pack", { rest: "/r.png", staging: "/s", descriptor: { id: "x" } }, { onJob: () => undefined });
    expect((made.report as { pack: { desktopBytes: number } }).pack.desktopBytes).toBe(10);
  });
  test("imageEdit posts the edits route fields", async () => {
    const { forms } = client({});
    const bytes = await StackPackOps.imageEdit({ image: new Uint8Array([1]), instruction: "Do it", seed: 7, imageSource: "generated", onJob: () => undefined });
    expect([...bytes]).toEqual([5, 6]);
    const form = forms.edits![0]!; expect(form.get("operation")).toBe("edit"); expect(form.get("instruction")).toBe("Do it"); expect(form.get("seed")).toBe("7"); expect(form.get("image_source")).toBe("generated");
  });
  test("talk-frames posts image and lip ratios (letters in order) and reads frames, sourceLandmarks and per-frame landmarks", async () => {
    const { forms } = client({});
    const talk = await StackPackOps.talkFrames({ image: new Uint8Array([1]), letters: ["A", "wide"], onJob: () => undefined });
    const form = forms.talk![0]!; expect(form.get("lip")).toBe("0,1"); expect(form.get("timeout_ms")).toBe("120000"); expect(form.get("operation")).toBeNull();
    expect([...talk.frames.A!]).toEqual([0, 9]); expect([...talk.frames.wide!]).toEqual([1, 9]);
    expect(talk.sourceLandmarks).toEqual(face); expect(talk.landmarks.A).toEqual(face); expect(talk.landmarks.wide).toBeNull();
  });
});

// ---------------------------------------------------------------- the review fixes (findings 1 to 13)

/** Real checkCompanionArt (no checkArt override): the age and child runners decide. */
const real = (f: Fakes) => ({ ops: f.ops, clips: f.clips, readiness: f.deps.readiness });
async function toWaiting(f: Fakes, who = "maker-owner", approver = "maker-owner") {
  await startPackJob({ actor: person(who), companionId: id, stillId, shapes: "photo" });
  await waitPackJob(id);
  if (readPackJob(id)!.waiting_for === "B") { await approvePackStage(id, person(approver), "B"); await waitPackJob(id); }
  return readPackJob(id)!;
}

describe("finding 1: the assembled pack is checked again at install, against the audience as it is then", () => {
  test("an audience changed to all-ages after validate refuses the install and keeps nothing", async () => {
    __setChildSafetyRunnerForTests(async (images) => images.map(() => photo) as never); // consulted only in the child lane
    const f = fakes(id); __setPackDepsForTests(real(f));
    const rec = await toWaiting(f);
    expect(rec.waiting_for).toBe("C"); // everything passed in the adult lane
    setHouseholdCompanionAudience(id, "all", { display_name: "Admin" });
    expect((await approvePackStage(id, person("maker-owner"), "C")).ok).toBe(true);
    await waitPackJob(id);
    const after = readPackJob(id)!;
    expect(after).toMatchObject({ status: "failed", closed: true }); expect(after.stages.install.status).toBe("failed");
    expect(existsSync(join(householdCompanionFolder(id)!, "pack", "pack.json"))).toBe(false);
    expect(existsSync(join(householdCompanionFolder(id)!, "pack-job", "work"))).toBe(false);
  });
  test("collectLiveAssets covers an installed pack and a pack job's work folder, so an audience change re-checks them", async () => {
    const f = fakes(id); __setPackDepsForTests(f.deps);
    await toWaiting(f); await approvePackStage(id, person("maker-owner"), "C"); await waitPackJob(id);
    const labels = (await collectLiveAssets(id)).map((a) => a.label);
    expect(labels.some((l) => l.startsWith("The pack: "))).toBe(true); expect(labels.some((l) => l.startsWith("The pack in progress: "))).toBe(true);
  });
});

describe("finding 2: phone twins are checked", () => {
  test("an unreadable phone twin closes the job (the frames of the twin are part of the take's check)", async () => {
    __setKeyframesForTests(async (mp4) => (mp4[0] === 0xee ? null : [new Uint8Array([7])]));
    const f = fakes(id); __setPackDepsForTests(real(f));
    await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "photo" }); await waitPackJob(id);
    expect(readPackJob(id)).toMatchObject({ status: "failed", closed: true }); expect(f.ops.calls).toEqual([]);
  });
});

describe("finding 3: a folder the check cannot read or that is empty closes the job", () => {
  test("only an unknown-extension picture closes the job", async () => {
    const f = fakes(id); f.ops.shapesWrite = ["atlas.bmp"]; __setPackDepsForTests(real(f));
    await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "photo" }); await waitPackJob(id); await approvePackStage(id, person("maker-owner"), "B"); await waitPackJob(id);
    expect(readPackJob(id)).toMatchObject({ status: "failed", closed: true }); expect(readPackJob(id)!.stages.shapes.status).toBe("failed");
  });
  test("an empty output folder closes the job with the plain line", async () => {
    const f = fakes(id); f.ops.shapesWrite = []; __setPackDepsForTests(f.deps);
    await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "photo" }); await waitPackJob(id); await approvePackStage(id, person("maker-owner"), "B"); await waitPackJob(id);
    expect(readPackJob(id)).toMatchObject({ status: "failed", closed: true, error: PACK_EMPTY_LINE });
  });
});

describe("findings 4, 11 and 12: closing removes everything this job made, and an art refusal closes at once", () => {
  test("an art refusal at the clips stage closes on the first refusal, no re-roll; whole take folders, keyframes and .pack-installing are gone; a person's own upload, keyframe and approval stay", async () => {
    const f = fakes(id); f.clips.artRefuse = true; f.clips.uploadDuring = true; __setPackDepsForTests(f.deps);
    const own = addTake(id, "idle", { source: "upload", label: "mine" }); const all = readStates(id); all.states.idle!.approved = own.id; all.states.idle!.approved_by = "maker-owner"; all.states.idle!.approved_at = now; saveStates(id, all);
    writeKeyframe(id, "listening", new Uint8Array([4, 4]), { source: "upload", style: "keep", prompt_hash: "x".repeat(64), model: null, created_at: now, edited_at: now });
    mkdirSync(join(householdCompanionFolder(id)!, ".pack-installing"), { recursive: true });
    await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "photo" }); await waitPackJob(id);
    const rec = readPackJob(id)!;
    expect(rec).toMatchObject({ status: "failed", closed: true }); expect(f.clips.calls).toBe(1); expect(rec.error).toContain("cartoon");
    const states = readStates(id).states.idle!, root = householdCompanionFolder(id)!;
    expect(states.takes.map((t) => t.id).sort()).toEqual([own.id, f.clips.uploadTake!].sort()); // nothing of the job's left; the upload added during the run stays
    expect(existsSync(join(root, "states", "idle", f.clips.uploadTake!))).toBe(true);
    for (const t of ["take-3", "take-4", "take-5"]) expect(existsSync(join(root, "states", "idle", t))).toBe(false); // whole folders, source.mp4 included
    expect(existsSync(keyframePath(id, "idle"))).toBe(false); expect(existsSync(keyframePath(id, "listening"))).toBe(true); // only the keyframes the job wrote
    expect(existsSync(join(root, ".pack-installing"))).toBe(false);
    expect(states.approved).toBe(own.id); expect(states.approved_by).toBe("maker-owner");
  });
  test("a take of a call that was stopped is removed", async () => {
    const f = fakes(id); f.clips.throwAfterCreate = true; __setPackDepsForTests(f.deps);
    await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "photo" }); await waitPackJob(id);
    expect(readPackJob(id)).toMatchObject({ status: "failed", closed: false });
    expect((readStates(id).states.idle?.takes ?? []).filter((t) => t.pack_job)).toEqual([]);
  });
  test("clip frames are sampled with the report's seconds, as finishTake does", async () => {
    const seen: Array<number | null> = []; __setKeyframesForTests(async (_m, seconds) => { seen.push(seconds); return [new Uint8Array([7])]; });
    __setPackDepsForTests(fakes(id).deps); await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "photo" }); await waitPackJob(id);
    expect(seen).toContain(3); expect(seen.slice(0, 5).every((x) => x === 3)).toBe(true);
  });
});

describe("finding 5: a person's clip approvals are not overwritten", () => {
  test("an approved earlier take stays approved while the pack job runs and after it completes", async () => {
    const f = fakes(id); __setPackDepsForTests(f.deps);
    addTake(id, "idle", { source: "upload", label: "one" }); const two = addTake(id, "idle", { source: "upload", label: "two" });
    const all = readStates(id); all.states.idle!.approved = two.id; all.states.idle!.approved_by = "someone"; all.states.idle!.approved_at = now; saveStates(id, all);
    await toWaiting(f);
    expect(readStates(id).states.idle).toMatchObject({ approved: two.id, approved_by: "someone", approved_at: now });
    await approvePackStage(id, person("maker-owner"), "C"); await waitPackJob(id);
    expect(readPackJob(id)!.status).toBe("done");
    expect(readStates(id).states.idle).toMatchObject({ approved: two.id, approved_by: "someone", approved_at: now });
  });
});

describe("finding 6: two simultaneous starts make one job", () => {
  test("one 202 and one 409", async () => {
    __setPackDepsForTests({ ...fakes(id).deps, readiness: async () => { await Bun.sleep(20); return null; } });
    const [a, b] = await Promise.all([post(`companions/${id}/pack-job`, owner, { still_id: stillId }), post(`companions/${id}/pack-job`, owner, { still_id: stillId })]);
    expect([a.status, b.status].sort()).toEqual([202, 409]);
    expect(db.select().from(jobs).all().filter((j) => j.kind === "companion_pack_job").length).toBe(1);
  });
});

describe("finding 7: a failed swap keeps the old pack", () => {
  test("a rename failure leaves the old pack installed and the job failed, not closed", async () => {
    const f = fakes(id); __setPackDepsForTests(f.deps);
    const dir = packFolder(id)!; writePack(dir); writeFileSync(join(dir, "old-marker.txt"), "old");
    await toWaiting(f);
    __setRenameForTests(((from: string, to: string) => { if (String(from).endsWith(".pack-installing")) throw new Error("disk full"); return renameSync(from, to); }) as never);
    await approvePackStage(id, person("maker-owner"), "C"); await waitPackJob(id);
    expect(readPackJob(id)).toMatchObject({ status: "failed", closed: false }); expect(readPackJob(id)!.error).toContain("old pack was kept");
    expect(existsSync(join(packFolder(id)!, "old-marker.txt"))).toBe(true); expect(readCompanionPack(id)).not.toBeNull();
    expect(existsSync(join(householdCompanionFolder(id)!, ".pack-old"))).toBe(false);
  });
});

describe("finding 8: approvers pass the same gates; every lane applies", () => {
  test("with video switched off, approving B is refused with the plain reason", async () => {
    const f = fakes(id); __setPackDepsForTests(f.deps);
    await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "photo" }); await waitPackJob(id);
    setHouseholdSettingValue("generation.video.enabled", false);
    expect(await approvePackStage(id, person("maker-owner"), "B")).toEqual({ ok: false, status: 403, error: VIDEO_DENIAL_LINE.household_off });
    expect(readPackJob(id)!.waiting_for).toBe("B");
    const res = await post(`companions/${id}/pack-job/approve`, owner, { stage: "B" }); expect(res.status).toBe(403);
  });
  test("not ready at approval time is a 503 with the reason", async () => {
    const f = fakes(id); __setPackDepsForTests(f.deps);
    await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "photo" }); await waitPackJob(id);
    __setPackDepsForTests({ ...f.deps, readiness: async () => ({ status: 503, error: "The video model is not ready." }) });
    expect(await approvePackStage(id, person("maker-owner"), "B")).toEqual({ ok: false, status: 503, error: "The video model is not ready." });
  });
  test("a child starter with an adult approver: the checks after approval run for both people", async () => {
    id = setup("adult"); const f = fakes(id); __setPackDepsForTests(f.deps);
    await startPackJob({ actor: person("maker-child"), companionId: id, stillId, shapes: "photo" }); await waitPackJob(id);
    await approvePackStage(id, person("maker-owner"), "B"); await waitPackJob(id);
    const mouth = f.checks.filter((c) => c.label.startsWith("The mouth picture")).map((c) => c.actor);
    expect(new Set(mouth)).toEqual(new Set(["maker-child", "maker-owner"]));
  });
});

describe("finding 10: restart, cancel and the activity row", () => {
  test("cancel leaves a closed record's status and reason unchanged", async () => {
    const f = fakes(id); f.clips.artRefuse = true; __setPackDepsForTests(f.deps);
    await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "photo" }); await waitPackJob(id);
    const before = readPackJob(id)!; const result = await cancelPackJob(id);
    expect(result.job!.status).toBe("failed"); expect(result.job!.error).toBe(before.error);
  });
  test("restart:true wipes a failed job and starts over with a new job", async () => {
    const f = fakes(id); __setPackDepsForTests(f.deps);
    const first = await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "photo" }); await waitPackJob(id); await approvePackStage(id, person("maker-owner"), "B");
    await waitPackJob(id);
    const again = await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "photo", restart: true });
    expect(again).toMatchObject({ ok: true, resumed: false }); expect((again as { job: { job: string } }).job.job).not.toBe((first as { job: { job: string } }).job.job);
    await waitPackJob(id); expect(readPackJob(id)!.stages.source.status).toBe("done"); expect(readPackJob(id)!.approvals.B).toBeNull();
  });
});

// ---------------------------------------------------------------- the second review (items A to I)

import { TakeClipMaker, takeDeps, reconcileInterruptedPackJobs } from "@/lib/companionPackMaker";
import { __addTakeRunForTests, type TakeRun } from "@/lib/companionTakes";
import { dirAssets } from "@/lib/companionArtCheck";
import { packFile } from "@/lib/companionPack";
import { chmodSync, symlinkSync } from "node:fs";

describe("item A: nothing is purged while a take is still finishing", () => {
  test("makeTakes does not return or throw until the take run is fully settled, even after a cancel", async () => {
    let settled = false;
    const run: TakeRun = { id: "run-a", companionId: id, personId: "maker-owner", states: ["idle"], current: null, state: "cancelled", phase: "cancelled", percent: 0, label: "", cancelled: true, error: null, takesMade: 0, stackJob: null, settled: Bun.sleep(60).then(() => { settled = true; }) };
    __addTakeRunForTests(run);
    const original = takeDeps.start; takeDeps.start = (async () => "run-a") as never;
    try { await expect(TakeClipMaker.makeTakes({ actor: person("maker-owner"), companionId: id, state: "idle", count: 1, job: "j", signal: new AbortController().signal, onRun: () => undefined, onJob: () => undefined })).rejects.toThrow(); }
    finally { takeDeps.start = original; }
    expect(settled).toBe(true);
  });
  test("cancel returns only after the clip call has settled", async () => {
    const f = fakes(id); f.clips.settleMs = 80; __setPackDepsForTests(f.deps);
    await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "photo" });
    for (let i = 0; i < 100 && f.clips.calls === 0; i++) await Bun.sleep(5);
    await cancelPackJob(id); expect(f.clips.settled).toBe(true);
  });
});

describe("item B: cancel then resume re-makes the clips", () => {
  test("cancelling at track, then starting again, makes the clips again instead of failing on missing files", async () => {
    const f = fakes(id); __setPackDepsForTests(f.deps);
    await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "photo" }); await waitPackJob(id);
    f.ops.block = { kind: "media.companion_track", release() {} };
    await approvePackStage(id, person("maker-owner"), "B");
    for (let i = 0; i < 100 && f.ops.calls.length === 0; i++) await Bun.sleep(10);
    const cancelled = (await cancelPackJob(id)).job!;
    expect(cancelled.status).toBe("cancelled"); expect(cancelled.clips).toEqual([]); expect(cancelled.stages.clips.status).toBe("pending"); expect(cancelled.stages.source.status).toBe("done"); expect(cancelled.approvals.B).toBeNull();
    expect(cancelled.error).toContain("made again");
    f.ops.block = null; const clipCalls = f.clips.calls;
    expect(await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "photo" })).toMatchObject({ ok: true, resumed: true });
    await waitPackJob(id);
    const rec = readPackJob(id)!; expect(rec.status).toBe("waiting_approval"); expect(rec.waiting_for).toBe("B");
    expect(f.clips.calls).toBe(clipCalls + PACK_CLIP_STATES.length); expect(rec.clips.length).toBe(5);
  });
});

describe("item C: an interrupted swap is put right when a job starts or is read", () => {
  function crashed() { const root = householdCompanionFolder(id)!; rmSync(join(root, "pack"), { recursive: true, force: true }); mkdirSync(join(root, ".pack-old"), { recursive: true }); writeFileSync(join(root, ".pack-old", "old-marker.txt"), "old"); return root; }
  test("a start with restart:true restores the old pack", async () => {
    const root = crashed(); __setPackDepsForTests(fakes(id).deps);
    await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "photo", restart: true });
    expect(existsSync(join(root, "pack", "old-marker.txt"))).toBe(true); expect(existsSync(join(root, ".pack-old"))).toBe(false);
  });
  test("reading the job restores it too", async () => {
    const root = crashed(); readPackJobReconciled(id);
    expect(existsSync(join(root, "pack", "old-marker.txt"))).toBe(true);
  });
});

describe("item D: links are never followed, copied or served", () => {
  test("dirAssets treats a symlink as unreadable; an unreadable folder fails closed", async () => {
    const dir = join(householdCompanionFolder(id)!, "scan-me"); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "real.png"), png()); writeFileSync(join(dir, "..", "outside.png"), png()); symlinkSync(join(dir, "..", "outside.png"), join(dir, "link.png"));
    const found = await dirAssets(dir, "X");
    expect(found.assets.filter((a) => !a.bytes).length).toBe(1); expect(found.assets.find((a) => !a.bytes)!.label).toContain("link");
    chmodSync(dir, 0o000);
    try { const blocked = await dirAssets(dir, "Y"); expect(blocked.assets.length).toBe(1); expect(blocked.assets[0]!.bytes).toBeUndefined(); } finally { chmodSync(dir, 0o755); }
  });
  test("a pack that carries a link closes the job and installs nothing", async () => {
    const f = fakes(id); const original = f.ops.run.bind(f.ops);
    f.ops.run = async (kind, input, hooks) => { const result = await original(kind, input, hooks); if (kind === "media.companion_pack") symlinkSync("/etc/hosts", join(String(input.output_dir), "pack", "evil.png")); return result; };
    __setPackDepsForTests(real(f));
    await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "photo" }); await waitPackJob(id); await approvePackStage(id, person("maker-owner"), "B"); await waitPackJob(id);
    expect(readPackJob(id)).toMatchObject({ status: "failed" }); expect(existsSync(join(householdCompanionFolder(id)!, "pack", "pack.json"))).toBe(false);
  });
  test("pack serving refuses a symlink and a path that resolves outside the pack", () => {
    const dir = packFolder(id)!; mkdirSync(dir, { recursive: true }); const outside = join(dir, "..", "secret.txt"); writeFileSync(outside, "s");
    symlinkSync(outside, join(dir, "leak.json")); writeFileSync(join(dir, "ok.json"), "{}");
    expect(packFile(id, "leak.json")).toBeNull(); expect(packFile(id, "ok.json")).not.toBeNull();
    const other = join(householdCompanionFolder(id)!, "elsewhere"); mkdirSync(other, { recursive: true }); writeFileSync(join(other, "x.json"), "{}"); symlinkSync(other, join(dir, "sub"));
    expect(packFile(id, "sub/x.json")).toBeNull();
  });
});

describe("item F: the pack scan takes the frames finishTake took", () => {
  test("pack videos are sampled with the clip's report seconds, not a default", async () => {
    const seen: Array<number | null> = []; __setKeyframesForTests(async (mp4, seconds) => { if (mp4[0] === 0x30) seen.push(seconds); return [new Uint8Array([7])]; }); // 0x30: the fake pack's clips
    const f = fakes(id); const make = f.clips.makeTakes.bind(f.clips);
    f.clips.makeTakes = async (input) => { const out = await make(input); const all = readStates(input.companionId); for (const t of all.states[input.state as "idle"]!.takes) if (t.report) t.report.seconds = 8; saveStates(input.companionId, all); return out; };
    __setPackDepsForTests(f.deps); await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "photo" }); await waitPackJob(id); await approvePackStage(id, person("maker-owner"), "B"); await waitPackJob(id);
    expect(seen.length).toBeGreaterThan(0); expect(seen.every((x) => x === 8)).toBe(true);
  });
});

describe("item G: keyframes", () => {
  test("the job's green-source keyframes are gone once the clips are made; a keyframe a person changed meanwhile stays", async () => {
    const f = fakes(id); f.clips.editKeyframe = true; __setPackDepsForTests(f.deps);
    await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "photo" }); await waitPackJob(id);
    expect(readPackJob(id)!.waiting_for).toBe("B");
    for (const state of ["idle", "listening", "thinking", "speaking"]) expect(existsSync(keyframePath(id, state))).toBe(true); // the person's edit (its hash differs from what the job wrote) stays
    expect([...readFileSync(keyframePath(id, "idle"))]).toEqual([9, 9, 9]);
  });
  test("with nothing edited, no green-source keyframe is left behind, after success or a cancel", async () => {
    const f = fakes(id); __setPackDepsForTests(f.deps);
    await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "photo" }); await waitPackJob(id);
    for (const state of ["idle", "listening", "thinking", "speaking"]) expect(existsSync(keyframePath(id, state))).toBe(false);
    const g = fakes(id); g.clips.block = new Promise(() => undefined); __setPackDepsForTests(g.deps);
    await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "photo", restart: true });
    for (let i = 0; i < 100 && g.clips.calls === 0; i++) await Bun.sleep(5);
    expect(existsSync(keyframePath(id, "idle"))).toBe(true); await cancelPackJob(id); expect(existsSync(keyframePath(id, "idle"))).toBe(false);
  });
});

describe("item H: the clip stage's Stack jobs are recorded and a resume cancels them", () => {
  test("video and finishing job ids land in the stage and are cancelled once on resume", async () => {
    const f = fakes(id); let release!: () => void; f.clips.block = new Promise<void>((r) => { release = r; }); __setPackDepsForTests(f.deps);
    await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "photo" });
    for (let i = 0; i < 100 && f.clips.calls === 0; i++) await Bun.sleep(5);
    expect(readPackJob(id)!.stages.clips.stack_jobs).toEqual(expect.arrayContaining(["video-1", "finish-1"]));
    __clearPackJobsForTests(); release(); f.clips.block = undefined;
    await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "photo" }); await waitPackJob(id);
    expect(f.ops.cancelled.filter((x) => x === "video-1").length).toBe(1); expect(f.ops.cancelled.filter((x) => x === "finish-1").length).toBe(1);
  });
});

describe("item I: interrupted activity rows are reconciled at server start", () => {
  test("reconcileInterruptedPackJobs marks the row", async () => {
    const f = fakes(id); f.clips.block = new Promise(() => undefined); __setPackDepsForTests(f.deps);
    await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "photo" });
    for (let i = 0; i < 100 && f.clips.calls === 0; i++) await Bun.sleep(5);
    expect(reconcileInterruptedPackJobs()).toBe(0); // a live job is not touched
    __clearPackJobsForTests();
    expect(reconcileInterruptedPackJobs()).toBe(1);
    expect(db.select().from(jobs).all().find((j) => j.kind === "companion_pack_job")).toMatchObject({ state: "failed", errorKind: "interrupted" });
  });
});

import { faceToolsReady } from "@/lib/companionPackMaker";
describe("faceToolsReady (the real Stack talk_frames status shape, found on the first real run)", () => {
  test("weights present and environment not built yet is ready (the first job builds it)", () => {
    expect(faceToolsReady({ state: "needs-setup", modelsVerified: true, models: { landmark: true, appearance: true } })).toBe(true);
  });
  test("a missing weights file, an unsupported machine or no status is not ready", () => {
    expect(faceToolsReady({ state: "needs-setup", modelsVerified: false, models: { landmark: false, appearance: true } })).toBe(false);
    expect(faceToolsReady({ state: "unsupported", modelsVerified: true })).toBe(false);
    expect(faceToolsReady(undefined)).toBe(false);
  });
});

describe("one shared pack frame (the clips, rest, mouth pictures and poses all use the frame defined from the rest picture)", () => {
  const workFile = (...parts: string[]) => join(householdCompanionFolder(id)!, "pack-job", "work", ...parts);
  const startAndRun = async (f: Fakes) => { __setPackDepsForTests(f.deps); await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "photo" }); return runTo(null, "waiting_approval"); };

  test("the frame is defined once after the source, kept in the job record, and handed to every clip", async () => {
    const f = fakes(id), rec = await startAndRun(f);
    expect(rec.frame).toEqual(EXPECTED_FRAME); expect(rec.frame_source).toEqual({ width: 64, height: 64 });
    expect(JSON.parse(readFileSync(join(householdCompanionFolder(id)!, "pack-job", "state.json"), "utf8")).frame).toEqual(EXPECTED_FRAME);
    expect(f.clips.frames.length).toBe(PACK_CLIP_STATES.length);
    for (const call of f.clips.frames) expect(call).toEqual({ frame: EXPECTED_FRAME, frameSource: { width: 64, height: 64 } });
    const meta = await sharp(workFile("rest_480.png")).metadata();
    expect([meta.width, meta.height, meta.channels]).toEqual([480, 480, 4]); // the keyed rest, with alpha
  });

  test("a calm mouth set measured outside 2 to 6.5 percent is asked again once with the lip ratios scaled to the target (found on the first real face: 33.4 percent)", async () => {
    const f = fakes(id); const scales: Array<number | undefined> = []; let shapesRuns = 0;
    const tf = f.ops.talkFrames; f.ops.talkFrames = async (input) => { scales.push(input.lipScale); return tf(input); };
    const run = f.ops.run; f.ops.run = async (kind, input, hooks) => {
      if (kind !== "media.companion_shapes") return run(kind, input, hooks);
      shapesRuns++;
      if (shapesRuns === 1) { const out = String(input.output_dir); mkdirSync(join(out, "shapes"), { recursive: true }); writeFileSync(join(out, "shapes", "report.json"), JSON.stringify({ sets: { calm: { opening_peak_pct: 33.4 } } })); return { ok: false, reasons: ["The calm set's widest mouth opening is 33.4 percent of the face height; it should be 2 to 6.5."], report: {} }; }
      return run(kind, input, hooks);
    };
    await startAndRun(f); await approvePackStage(id, person("maker-owner"), "B"); await runTo(null, "waiting_approval");
    expect(shapesRuns).toBe(2); expect(scales[0]).toBe(1); expect(scales[1]).toBeCloseTo(5.5 / 33.4, 5);
  });
  test("a calm mouth set that fails for another reason, or is already in range, is not asked again", async () => {
    const f = fakes(id); let shapesRuns = 0;
    const run = f.ops.run; f.ops.run = async (kind, input, hooks) => { if (kind === "media.companion_shapes") { shapesRuns++; return { ok: false, reasons: ["The face is turned too far."], report: {} }; } return run(kind, input, hooks); };
    await startAndRun(f); await approvePackStage(id, person("maker-owner"), "B"); await runTo(null, "failed");
    expect(shapesRuns).toBe(1);
  });
  test("the track op gets the 480x480 rest and clip_stacked; shapes and emotion get pictures and landmarks in the pack frame", async () => {
    const f = fakes(id); await startAndRun(f);
    await approvePackStage(id, person("maker-owner"), "B"); await runTo(null, "waiting_approval");
    const tracks = f.ops.inputs.filter((c) => c.kind === "media.companion_track");
    expect(tracks.length).toBe(5);
    for (const t of tracks) { expect(t.input.clip_stacked).toBe(true); expect(String(t.input.rest)).toEndWith("/work/rest_track_480.png"); }
    // every op that got a rest read a 480x480 one: the track op an opaque one flattened over black (the clip's own background), the others the RGBA one
    expect(f.ops.restSizes.every((s) => s[0] === 480 && s[1] === 480)).toBe(true);
    expect(f.ops.restSizes.slice(0, 5).every((s) => s[2] === 3)).toBe(true); expect(f.ops.restSizes.slice(5).every((s) => s[2] === 4)).toBe(true);
    expect(f.ops.restSizes.length).toBe(5 + 3); // track x5, shapes, emotion, pack
    const shapes = f.ops.inputs.find((c) => c.kind === "media.companion_shapes")!.input;
    const atX = ((10 - 14) * 480) / 36, atY = ((10 - 4) * 480) / 36; // the fake face has its first outer-lip point at (10, 10); the frame starts at (14, 4) and is 36 wide
    expect(shapes.landmarks.calm.B.outerLips[0][0]).toBeCloseTo(atX, 3); expect(shapes.landmarks.calm.B.outerLips[0][1]).toBeCloseTo(atY, 3);
    expect(shapes.landmarks.calm.H.outerLips[1][0]).toBeCloseTo((30 - 14) * 480 / 36, 3); expect(shapes.landmarks.calm.H.outerLips[1][1]).toBeCloseTo((18 - 4) * 480 / 36, 3);
    expect(shapes.landmarks.rest.points[1][0]).toBeCloseTo((1 - 14) * 480 / 36, 3); // the rest's own landmarks too (a point left of the frame goes negative)
    for (const letter of ["B", "H"]) { const m = await sharp(workFile("shapes-in", "calm", `${letter}.png`)).metadata(); expect([m.width, m.height]).toEqual([480, 480]); }
    for (const emotion of EMOTIONS) { const m = await sharp(workFile("emotion-in", `${emotion}.png`)).metadata(); expect([m.width, m.height]).toEqual([480, 480]); }
    const pack = f.ops.inputs.find((c) => c.kind === "media.companion_pack")!.input;
    expect(String(pack.rest)).toEndWith("/work/rest_480.png");
    expect(pack.descriptor.mouth.anchor.x).toBeCloseTo((10 - 14) / 36, 3); // lips [10,10]..[30,18] -> x -4/36 (left of the frame), width 20/36 of the 480 frame
    expect(pack.descriptor.mouth.anchor.w).toBeCloseTo(20 / 36, 3);
    expect(JSON.parse(readFileSync(workFile("landmarks.json"), "utf8")).outerLips[0][0]).toBeCloseTo(atX, 3);
  });

  test("a resume uses the frame in the record, not a new one", async () => {
    const f = fakes(id), first = await startAndRun(f); expect(first.frame).toEqual(EXPECTED_FRAME);
    f.ops.failKind = "media.companion_track";
    await approvePackStage(id, person("maker-owner"), "B"); await runTo(null, "failed");
    // change the stored frame and lose the rest picture made from it: the resume must rebuild it from the stored frame
    const path = join(householdCompanionFolder(id)!, "pack-job", "state.json"), state = JSON.parse(readFileSync(path, "utf8"));
    state.frame = { x: 2, y: 2, size: 40 }; writeFileSync(path, JSON.stringify(state)); rmSync(workFile("rest_480.png"));
    f.ops.failKind = null; f.ops.inputs.length = 0; const clipCalls = f.clips.calls;
    expect(await startPackJob({ actor: person("maker-owner"), companionId: id, stillId, shapes: "photo" })).toMatchObject({ ok: true, resumed: true });
    await runTo(null, "waiting_approval");
    expect(readPackJob(id)!.frame).toEqual({ x: 2, y: 2, size: 40 }); expect(f.clips.calls).toBe(clipCalls); // no new source, no new clips
    expect((await sharp(workFile("rest_480.png")).metadata()).width).toBe(480);
    const shapes = f.ops.inputs.find((c) => c.kind === "media.companion_shapes")!.input;
    expect(shapes.landmarks.calm.B.outerLips[0][0]).toBeCloseTo((10 - 2) * 480 / 40, 3);
  });

  test("the take maker passes the frame to the takes", async () => {
    const seen: unknown[] = [], original = takeDeps.start; takeDeps.start = (async (input: { pack?: unknown }) => { seen.push(input.pack); return "run-frame"; }) as never;
    try {
      await TakeClipMaker.makeTakes({ actor: person("maker-owner"), companionId: id, state: "idle", count: 1, job: "j", frame: EXPECTED_FRAME, frameSource: { width: 64, height: 64 }, signal: new AbortController().signal, onRun: () => undefined, onJob: () => undefined });
      await TakeClipMaker.makeTakes({ actor: person("maker-owner"), companionId: id, state: "idle", count: 1, job: "k", signal: new AbortController().signal, onRun: () => undefined, onJob: () => undefined });
    } finally { takeDeps.start = original; }
    expect(seen).toEqual([{ job: "j", frame: EXPECTED_FRAME, frameSource: { width: 64, height: 64 } }, { job: "k" }]);
  });
});

import { packFolderProblems } from "@/lib/companionPack";
import { tmpdir } from "node:os";
describe("the pack check runs the spec's JSON schema too (the first real pack used state names the schema rejects and still passed)", () => {
  test("household state names (listening, thinking, speaking) and an unknown provenance source are refused; the spec's own names pass", () => {
    const dir = join(tmpdir(), `pack-schema-${Date.now()}`); writePack(dir);
    const good = JSON.parse(readFileSync(join(dir, "pack.json"), "utf8"));
    expect(packFolderProblems(dir, good)).toEqual([]);
    const bad = JSON.parse(JSON.stringify(good)); bad.states.listening = bad.states.listen; delete bad.states.listen; bad.provenance = { ...bad.provenance, source: "MaiPai Home pack maker" };
    const problems = packFolderProblems(dir, bad).join("\n");
    expect(problems).toContain("schema:"); expect(problems).toMatch(/listen/); expect(problems).toMatch(/provenance/);
    rmSync(dir, { recursive: true, force: true });
  });
});
