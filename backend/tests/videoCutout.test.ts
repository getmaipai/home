import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { db } from "@/db";
import { people } from "@/db/schema";
import { readVideoFile, getVideoJobFor, __setVideoJobForTests, __resetVideoJobsForTests } from "@/lib/videos/jobs";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { __setKeyframesForTests } from "@/lib/pictures/keyframes";
import { runEditVideo } from "@/lib/videos/editTool";
import { resetDb } from "./reset-db";
import type { FakeEditStack } from "./videoEditStackFixture";
import { testJpeg, testMp4 } from "./videoFixture";
import { getStackClient, __setStackClientForTests } from "@/lib/stackEngine";
import { __setStackEditTimingForTests } from "@/lib/videos/stackEdit";
import { until } from "./pictureFixture";
import { createAttachment } from "@/lib/attachments";
import { resolveOrCreateConversation, logTurn } from "@/lib/conversationHistory";
import { newConversationTurnId } from "@/lib/id";
import type { PersonRow } from "@/types";
import type { TurnState } from "@/lib/turnMachine/contract";

let edits: FakeEditStack;
beforeEach(() => {
  resetDb(); __resetVideoJobsForTests();
  edits = { jobs: [], speech: [], rootsSet: [], roots: { read: [], write: [] }, pollsToFinish: 1, progressPercent: 55, failWith: null, refuseSubmit: false, speechFails: false, durationS: 6, transcribedText: "", restore() {} };
  const fakeMediaRoot = join(process.env.MAIPAI_DATA_DIR!, "video-edit");
  mkdirSync(fakeMediaRoot, { recursive: true });
  const base = getStackClient();
  const client = { ...base,
    mediaRoots: async () => ({ read: [fakeMediaRoot], write: [fakeMediaRoot] }),
    setMediaRoots: async (roots: { read: string[]; write: string[] }) => { edits.roots.read = roots.read; edits.roots.write = roots.write; edits.rootsSet.push(roots); return roots; },
    submitJob: async (request: { input?: Record<string, unknown> }) => { const input = request.input as FakeEditStack["jobs"][number]["input"]; edits.jobs.push({ id: `edit-${edits.jobs.length + 1}`, input, staged: [], dirMode: 0o700, polls: 0, state: "queued", cancelled: false }); return { id: `edit-${edits.jobs.length}`, kind: "media.edit", role: null, state: "queued", percent: 0, completedBytes: 0, totalBytes: 0, status: "", position: null, input: null, result: null, reason: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; },
    job: async (id: string) => { const job = edits.jobs.find((item) => item.id === id)!; job.polls++; if (edits.failWith) return { id, kind: "media.edit", role: null, state: "failed", percent: 55, completedBytes: 0, totalBytes: 0, status: "", position: null, input: null, result: null, reason: edits.failWith, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; const webm = job.input.output.name.endsWith(".webm"), bytes = webm ? new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...new Uint8Array(2044)]) : testMp4(), path = join(job.input.output.dir, job.input.output.name); await Bun.write(path, bytes); return { id, kind: "media.edit", role: null, state: "done", percent: 100, completedBytes: 0, totalBytes: 0, status: "", position: null, input: null, result: { path, size_bytes: bytes.byteLength, container: webm ? "webm" : "mp4", duration_s: 6, width: 832, height: 448, ...(webm ? {} : { audio_codec: "aac" }), elapsed_ms: 1000 }, reason: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; },
  };
  __setStackEditTimingForTests({ pollMs: 5, deadlineMs: 5_000 });
  __setStackClientForTests(client as never);
  __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { adult: false } as never })));
  __setKeyframesForTests(async () => [testJpeg(), testJpeg(), testJpeg()]);
});
afterEach(() => { __setStackEditTimingForTests(null); __setStackClientForTests(null); __resetVideoJobsForTests(); });
function person(role: string): PersonRow {
  const now = new Date().toISOString(), id = `person-${role.replace(/[^a-z0-9]/gi, "").toLowerCase().padEnd(6, "x")}`;
  db.insert(people).values({ id, displayName: role, role, avatarSeed: role, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  return db.select().from(people).where(eq(people.id, id)).get() as PersonRow;
}
function stateFor(actor: PersonRow): TurnState {
  const conv = resolveOrCreateConversation(actor, "chat", undefined, { temporary: false });
  if (!conv.ok) throw new Error("no conversation");
  const turnId = newConversationTurnId();
  logTurn(actor, "chat", "make a video", { reply: { text: "Ready." }, source: "plugin", plugin_id: "generate_video", routing: { tier: "tool", score: 1 }, safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() }, conversation_id: conv.value.id, turn_id: turnId });
  return { actor, surface: "chat", turnId, conversationId: conv.value.id, temporary: false, planBasis: { surfaceClass: "written" }, context: [], utterance: "make a video", persona: null, crisis: false } as unknown as TurnState;
}
async function sourceClip(actor: PersonRow, seconds = 8, width = 832): Promise<{ id: string; file: string; state: TurnState }> {
  const state = stateFor(actor);
  const bytes = new Uint8Array(5000); bytes.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]);
  const saved = createAttachment(actor, { conversationId: state.conversationId!, turnId: state.turnId!, mediaType: "video/mp4", bytes, provenance: "video-gen:{\"v\":1,\"madeAudience\":\"all-ages\",\"lock\":\"off\"}", retention: "conversation", deduplicate: false });
  if (!saved.ok) throw new Error("source attachment failed");
  const poster = createAttachment(actor, { conversationId: state.conversationId!, turnId: state.turnId!, mediaType: "image/jpeg", bytes: new Uint8Array(200).fill(1), provenance: "video-poster:{\"v\":1}", retention: "conversation", deduplicate: false });
  if (!poster.ok) throw new Error("poster failed");
  const id = `source_${actor.id}`;
  const source = { id, personId: actor.id, conversationId: state.conversationId, turnId: state.turnId, companionId: null, kind: "generate" as const, state: "done" as const, stackJob: null, percent: 100, phase: "ready", position: null, prompt: "A cat", request: { size: `${width}x448`, seconds, seed: null, loras: [], source_file_id: null, audience: "all-ages" as const }, error: null, files: [{ id: saved.value.id, poster_id: poster.value.id, width, height: 448, seconds, seed: null, model: null, ms: 1, bytes: bytes.length }], temporary: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  __setVideoJobForTests(source);
  return { id, file: saved.value.id, state };
}
const run = (state: TurnState, clip: string, background?: string) => runEditVideo({ state, callId: "edit", spoken: false, args: { clip, change: "remove_background", ...(background === undefined ? {} : { background }) } });

describe("remove_background", () => {
  test("sends the exact default op, reports ETA, keeps the source, and saves a new version", async () => {
    const actor = person("owner"), source = await sourceClip(actor);
    const out = await run(source.state, source.id);
    if (!out.result?.data || !("videoJobId" in out.result.data)) throw new Error(JSON.stringify(out.result));
    expect(out.result.data).toHaveProperty("videoJobId");
    if (!edits.jobs[0]) throw new Error(`no edit submitted: ${JSON.stringify(out.result)} / ${JSON.stringify(edits.jobs)}`);
    expect(edits.jobs[0].input.ops).toEqual([{ op: "cutout", background: "green" }]);
    expect(out.result?.reply?.text).toContain("about 1 minute");
    const id = (out.result?.data as { videoJobId: string }).videoJobId;
    await until(() => getVideoJobFor(actor, id)?.state === "done");
    expect(getVideoJobFor(actor, source.id)?.files[0]?.id).toBe(source.file);
    expect(getVideoJobFor(actor, id)?.files[0]?.id).not.toBe(source.file);
  });
  test("passes all background kinds as the cutout op", async () => {
    for (const background of ["black", "white", "green", "blur", "transparent", "#1a2b3c"]) {
      const actor = person(`owner-${background.replace("#", "hex")}`), source = await sourceClip(actor);
      const out = await run(source.state, source.id, background);
      expect(edits.jobs.at(-1)!.input.ops).toEqual([{ op: "cutout", background }]);
      const id = (out.result?.data as { videoJobId: string }).videoJobId;
      await until(() => getVideoJobFor(actor, id)?.state === "done");
      const saved = readVideoFile(actor, getVideoJobFor(actor, id)!, getVideoJobFor(actor, id)!.files[0]!.id);
      expect(saved?.mediaType).toBe(background === "transparent" ? "video/webm" : "video/mp4");
    }
  });
  test("refuses length, width and invalid background before a Stack job", async () => {
    for (const [seconds, width, background, line] of [[90, 832, undefined, "up to a minute"], [8, 2048, undefined, "too large"], [8, 832, "purple", "six-digit hex"]] as const) {
      const actor = person(`limits-${seconds}-${width}-${background ?? "default"}`), source = await sourceClip(actor, seconds, width), before = edits.jobs.length;
      const out = await run(source.state, source.id, background);
      expect(out.result?.reply?.text).toContain(line);
      expect(edits.jobs).toHaveLength(before);
    }
  });
  test("relays Stack reason and refuses child, teen and guest", async () => {
    const adult = person("owner"), source = await sourceClip(adult);
    edits.failWith = "The subject model is not installed.";
    const failed = await run(source.state, source.id);
    const failedId = (failed.result?.data as { videoJobId: string }).videoJobId;
    await until(() => getVideoJobFor(adult, failedId)?.state === "failed");
    expect(getVideoJobFor(adult, failedId)?.error).toContain("The subject model is not installed.");
    edits.failWith = null;
    for (const role of ["child", "teen", "guest"]) {
      const actor = person(role), state = stateFor(actor), before = edits.jobs.length;
      const out = await runEditVideo({ state, callId: "edit", spoken: false, args: { clip: "missing", change: "remove_background" } });
      expect(out.result?.data).toMatchObject({ refused: role === "guest" ? "guest" : "minor" });
      expect(edits.jobs).toHaveLength(before);
    }
  });
});
