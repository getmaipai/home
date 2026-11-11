import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import sharp from "sharp";
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
  EMOTIONS, PACK_CLIP_STATES, StackPackOps, TALK_LETTERS, __clearPackJobsForTests, __setPackDepsForTests, cancelPackJob, packJobRunning, readPackJob, readPackJobReconciled, startPackJob, approvePackStage, waitPackJob, __setRenameForTests, PACK_EMPTY_LINE,
  type ClipMaker, type PackDeps, type PackJobStatus, type PackOpKind, type PackOpsClient,
} from "@/lib/companionPackMaker";
import { runMakeCharacter, parseArgs, LIVE_HUB_LINE, type MakeOptions } from "../../scripts/pack/make_character";
import type { PersonRow } from "@/types";
import { resetDb } from "./reset-db";

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
/** A real 64x64 picture (a grey figure on the key colour): the pack maker crops pictures, so the edit and mouth frames must decode. */
async function figure(): Promise<Uint8Array> {
  const w = 64, h = 64, raw = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4, inside = x >= 16 && x < 48 && y >= 8 && y < 56; raw[o] = inside ? 128 : 0; raw[o + 1] = inside ? 128 : 255; raw[o + 2] = inside ? 128 : 0; raw[o + 3] = 255; }
  raw[2] = ++n % 200;
  return new Uint8Array(await sharp(raw, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer());
}

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
interface Fakes { ops: PackOpsClient & { calls: string[]; jobs: string[]; cancelled: string[]; edits: number; eyes?: number[]; shapesWrite: string[]; block?: { release(): void; kind: PackOpKind } | null; failKind?: PackOpKind | null }; clips: ClipMaker & { calls: number; artRefuse: boolean; uploadDuring: boolean; throwAfterCreate: boolean; block?: Promise<void>; editKeyframe?: boolean; settleMs: number; settled: boolean; uploadTake?: string }; checks: Array<{ label: string; actor: string; kind: string }>; deps: Partial<PackDeps> }

function fakes(id: string): Fakes {
  const checks: Fakes["checks"] = [];
  let jobSeq = 0;
  const ops: Fakes["ops"] = {
    calls: [], jobs: [], cancelled: [], edits: 0, block: null, failKind: null, shapesWrite: ["atlas.png", "weight.png"],
    async imageEdit(input) { ops.edits++; const job = `stack-edit-${++jobSeq}`; ops.jobs.push(job); input.onJob(job); return figure(); },
    async talkFrames(input) { const job = `stack-talk-${++jobSeq}`; ops.jobs.push(job); input.onJob(job); const face = { outerLips: [[10, 10], [30, 18]], innerLips: [[12, 12]], nose: [[20, 8]], contour: [[1, 1]], points: [[1, 1]] };
      return { frames: Object.fromEntries(await Promise.all(input.letters.map(async (l) => [l, await figure()]))), sourceLandmarks: { ...face, points: Array.from({ length: 203 }, (_, i) => [i, i]) }, landmarks: Object.fromEntries(input.letters.map((l) => [l, face])) }; },
    async run(kind, input, hooks) {
      ops.calls.push(kind);
      const job = `stack-${kind}-${++jobSeq}`; ops.jobs.push(job); hooks.onJob(job);
      if (ops.block?.kind === kind) await new Promise<void>((resolve, reject) => { ops.block!.release = resolve; hooks.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))); });
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
    calls: 0, artRefuse: false, uploadDuring: false, throwAfterCreate: false, settleMs: 0, settled: true,
    async makeTakes({ companionId, state, count, job, onJob, signal }) {
      clips.calls++; onJob(`video-${clips.calls}`); onJob(`finish-${clips.calls}`);
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

// ---- MAKER-E: the driver of scripts/pack/make_character.ts against the real routes and the MAKER-D fakes
const BASE = "http://localhost";
function drive(extra: Partial<MakeOptions> = {}, tokenOf = "session-maker-owner") {
  const out: string[] = [];
  const opts: MakeOptions = { companion: id, still: stillId, shapes: "photo", devUrl: BASE, yesStages: [], pollMs: 5, ...extra };
  const run = () => runMakeCharacter(opts, { fetch: (url, init) => Promise.resolve(app.request(url, init)), out: (l) => out.push(l), sleep: (ms) => Bun.sleep(ms), cookie: tokenOf });
  return { out, run, opts };
}

describe("make_character driver", () => {
  test("full run: start, stage lines, waits at B (exit 2), approve B, waits at C, approve C, done (exit 0) with the pack installed", async () => {
    const f = fakes(id); __setPackDepsForTests(f.deps);
    const a = drive(); expect(await a.run()).toBe(2);
    expect(a.out.some((l) => l.startsWith("source: done"))).toBe(true);
    expect(a.out.some((l) => l.startsWith("clips: done"))).toBe(true);
    expect(a.out.join("\n")).toContain("WAITING for approval B"); expect(a.out.join("\n")).toContain("--approve B");
    expect(a.out.join("\n")).toContain("/api/companions/");
    expect(a.out.filter((l) => l.startsWith("CLIP ")).length).toBe(5); expect(a.out.join("\n")).toContain(`${BASE}/api/companions/${id}/states/idle/take-`);
    expect(readPackJob(id)!.approvals.B).toBeNull(); // nothing approved by itself
    const b = drive({ approve: "B" }); expect(await b.run()).toBe(2);
    expect(b.out.join("\n")).toContain("WAITING for approval C"); expect(b.out.join("\n")).toContain(`PACK: ${BASE}/api/companions/${id}/pack-job/preview/pack.json`); expect(b.out.some((l) => l.startsWith("validate: done"))).toBe(true);
    expect(existsSync(join(householdCompanionFolder(id)!, "pack", "pack.json"))).toBe(false);
    const c = drive({ approve: "C" }); expect(await c.run()).toBe(0);
    expect(c.out.join("\n")).toContain("Done: the pack is installed");
    expect(readCompanionPack(id)).not.toBeNull();
    const s = drive({ status: true }); expect(await s.run()).toBe(0);
  });

  test("stylised flags become the start body; bad numbers are refused before any request", async () => {
    const f = fakes(id); __setPackDepsForTests(f.deps);
    const eyes = { left: [[300, 300], [320, 296], [340, 300]], right: [[600, 300], [620, 296], [640, 300]] };
    const bad = drive({ shapes: "stylised", box: "1,2,x" }); expect(await bad.run()).toBe(1); expect(bad.out.join("\n")).toContain("--box takes four numbers"); expect(readPackJob(id)).toBeNull();
    const a = drive({ shapes: "stylised", box: "400,600,200,100", faceHeight: "700", eyesFile: "eyes.json" });
    const out: string[] = []; const code = await runMakeCharacter({ ...a.opts }, { fetch: (url, init) => Promise.resolve(app.request(url, init)), out: (l) => out.push(l), sleep: (ms) => Bun.sleep(ms), cookie: "session-maker-owner", readFile: () => JSON.stringify(eyes) });
    expect(code).toBe(2); expect(readPackJob(id)).toMatchObject({ shapes: "stylised", box: [400, 600, 200, 100], face_height_px: 700 });
  });

  test("--yes-stage approves only the stages named", async () => {
    const f = fakes(id); __setPackDepsForTests(f.deps);
    const a = drive({ yesStages: ["B"] }); expect(await a.run()).toBe(2);
    expect(a.out.join("\n")).toContain("Approved B (asked for with --yes-stage)"); expect(a.out.join("\n")).toContain("WAITING for approval C");
    expect(readPackJob(id)!.approvals.C).toBeNull();
    const b = drive({ approve: "C", yesStages: ["B", "C"] }); expect(await b.run()).toBe(0);
  });

  test("a failing stage prints its plain reason and exits 1; --restart starts again", async () => {
    const f = fakes(id); __setPackDepsForTests(f.deps);
    expect(await drive().run()).toBe(2);
    f.ops.failKind = "media.companion_track";
    const a = drive({ approve: "B" }); expect(await a.run()).toBe(1);
    expect(a.out.join("\n")).toContain("Failed at track"); expect(a.out.join("\n")).toContain("lighting step");
    f.ops.failKind = null; const clipCalls = f.clips.calls;
    const r = drive({ restart: true }); expect(await r.run()).toBe(2);
    expect(r.out[0]).toContain("Started again"); expect(f.clips.calls).toBeGreaterThan(clipCalls); // restart made the clips again
  });

  test("--cancel stops a running job", async () => {
    const f = fakes(id); __setPackDepsForTests(f.deps);
    expect(await drive().run()).toBe(2);
    const a = drive({ cancel: true }); expect(await a.run()).toBe(0);
    expect(a.out[0]).toContain("stopped"); expect(readPackJob(id)!.status).toBe("cancelled");
    expect(await drive({ status: true }).run()).toBe(1);
  });

  test("a refused start prints the reason and exits 1; a wrong approval is refused", async () => {
    const f = fakes(id); __setPackDepsForTests(f.deps);
    const a = drive({ still: "nope" }); expect(await a.run()).toBe(1); expect(a.out[0]).toContain("did not start");
    const b = drive({ approve: "B" }); expect(await b.run()).toBe(1);
  });

  test("the live hub address is refused without the flag, and no request is made", async () => {
    let calls = 0;
    const o: MakeOptions = { companion: id, still: stillId, shapes: "photo", devUrl: "http://127.0.0.1:3000", yesStages: [] };
    const out: string[] = [];
    const io = { fetch: async () => { calls++; return new Response("{}"); }, out: (l: string) => out.push(l), sleep: async () => {}, cookie: "x" };
    expect(await runMakeCharacter(o, io)).toBe(1); expect(out[0]).toBe(LIVE_HUB_LINE); expect(calls).toBe(0);
    expect(await runMakeCharacter({ ...o, devUrl: "https://maipai-studio.cow-tint.ts.net" }, io)).toBe(1); expect(calls).toBe(0);
  });

  test("parseArgs: needs a companion and a url, refuses a file path as the still", () => {
    expect(typeof parseArgs([], {}, "/nonexistent")).toBe("string");
    expect(typeof parseArgs(["--companion", "c"], {}, "/nonexistent")).toBe("string");
    expect(typeof parseArgs(["--companion", "c", "--dev-url", "http://127.0.0.1:8890", "--still", "/a/b.png"], {}, "/nonexistent")).toBe("string");
    expect(parseArgs(["--companion", "c", "--dev-url", "http://127.0.0.1:8890", "--yes-stage", "B,C"], {}, "/nonexistent")).toMatchObject({ yesStages: ["B", "C"], shapes: "photo" });
  });
});
