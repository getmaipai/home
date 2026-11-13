// QUEUE-HOME-S3S5 round 3: every video edit (a reference video, an extend, a restyle) joins the household queue like a clip made from words.
// It waits behind a running Max job with the queue's line, goes back to waiting when the Stack refuses it, registers its level and class
// with the queue, and a Home restart ends an edit the restart interrupted with the plain interrupted line.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people, videoJobs } from "@/db/schema";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import { EDIT_RESTART_LINE, getVideoJobFor, resumeVideoJobs, startVideoEditJob, __resetVideoJobsForTests, type EditRun, type VideoJob } from "@/lib/videos/jobs";
import { phaseLabel } from "@/lib/videos/phaseLabel";
import { jobQueueCopy } from "@/lib/jobQueueCopy";
import { releaseHouseholdQueue, resetTierStateForTests, setBudgetReader, setNoRoomRecheckForTests } from "@/lib/jobs/householdQueue";
import { setProfileSource } from "@/lib/jobs/admissionFit";
import { setReducedChat } from "@/lib/reducedChat";
import { __setStackClientForTests, __resetStackEngineForTests } from "@/lib/stackEngine";
import { __setKeyframesForTests } from "@/lib/pictures/keyframes";
import { installFakeVideoStack, testMp4, type FakeVideoStack } from "./videoFixture";
import { until } from "./pictureFixture";
import type { PersonRow } from "@/types";

const NEVER_FITS_LINE = "This is too big for this computer even with everything else paused. Try Boost.";

let fake: FakeVideoStack;
beforeEach(() => {
  resetDb(); __resetVideoJobsForTests(); resetTierStateForTests();
  fake = installFakeVideoStack();
  setNoRoomRecheckForTests(60_000);
  __setKeyframesForTests(async (_mp4, _seconds, count) => Promise.all(Array.from({ length: count ?? 3 }, async () => new Uint8Array(await sharp({ create: { width: 128, height: 128, channels: 3, background: "#808080" } }).png().toBuffer()))));
});
afterEach(() => {
  fake.restore(); __setKeyframesForTests(null); setNoRoomRecheckForTests(null); __resetVideoJobsForTests();
  setProfileSource(null); setBudgetReader(null); resetTierStateForTests(); setReducedChat(null); __resetStackEngineForTests();
});

function person(name: string): PersonRow {
  const now = new Date().toISOString();
  const id = `person-${name.toLowerCase()}xyz`;
  db.insert(people).values({ id, displayName: name, role: "owner", avatarSeed: name, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  return db.select().from(people).where(eq(people.id, id)).get() as PersonRow;
}
function conversation(actor: PersonRow): string {
  const conv = resolveOrCreateConversation(actor, "chat", undefined, { temporary: false });
  if (!conv.ok) throw new Error("no conversation");
  return conv.value.id;
}
function sourceFor(actor: PersonRow, conversationId: string): VideoJob {
  const now = new Date().toISOString();
  return { id: `source-${actor.id}`, personId: actor.id, conversationId, turnId: null, companionId: null, kind: "edit", state: "done", stackJob: null, percent: 100, phase: null, position: null, prompt: "a paper boat",
    request: { size: "768x448", seconds: 5, seed: 1, loras: [], source_file_id: null, audience: "adult" }, error: null, files: [], temporary: false, createdAt: now, updatedAt: now };
}
const clip = () => ({ video: testMp4(), seconds: 5, width: 768, height: 448, audio: false, ms: 10 });
function gate() { let open!: () => void; const wait = new Promise<void>((resolve) => { open = resolve; }); return { wait, open }; }

/** One edit for one person. `run` is the edit's Stack work; `tier` rides the request as a reference video's does. */
function startEdit(actor: PersonRow, run: EditRun, tier?: "max") {
  const started = startVideoEditJob({ actor, conversationId: conversation(actor), turnId: null, temporary: true, source: sourceFor(actor, "c"), edit: { from: "x", change: "ingredients" }, run, adultOnly: false, ...(tier ? { request: { tier } } : {}) });
  if (!started.ok) throw new Error(started.line);
  return started.job;
}
const stateOf = (actor: PersonRow, id: string) => getVideoJobFor(actor, id)!;

describe("an edit joins the household queue", () => {
  test("a Max edit waits behind a running Max job with the queue's line and starts only when released", async () => {
    const sage = person("Sage"); const marlow = person("Marlow");
    const first = gate(); let secondRuns = 0;
    const a = startEdit(sage, async () => { await first.wait; return { ok: true, clip: clip() }; }, "max");
    await until(() => stateOf(sage, a.id).state === "running");
    const b = startEdit(marlow, async () => { secondRuns += 1; return { ok: true, clip: clip() }; }, "max");
    expect(stateOf(marlow, b.id).state).toBe("queued");
    await releaseHouseholdQueue();
    await Bun.sleep(50);
    const waiting = stateOf(marlow, b.id);
    expect(waiting.state).toBe("queued");
    expect(secondRuns).toBe(0);
    expect(phaseLabel(waiting, "adult")).toBe(jobQueueCopy("queued", "max_window", waiting.position, null, "adult"));
    expect(phaseLabel(waiting, "adult")).toContain("Home is running a Max job");
    first.open();
    await until(() => secondRuns === 1);
    await until(() => !["queued", "running"].includes(stateOf(marlow, b.id).state));
  });

  test("a queued Max edit is a Max video job to the queue: it holds a following video job (max_drain)", async () => {
    // Other names than the test above: the queue weighs each person's recent use, which would reorder the three.
    const sage = person("Iris"); const marlow = person("Quill"); const nova = person("Raven");
    const running = gate(); let maxRuns = 0; let thirdRuns = 0;
    const a = startEdit(sage, async () => { await running.wait; return { ok: true, clip: clip() }; });
    await until(() => stateOf(sage, a.id).state === "running");
    const b = startEdit(marlow, async () => { maxRuns += 1; return { ok: true, clip: clip() }; }, "max");
    await Bun.sleep(5);
    const c = startEdit(nova, async () => { thirdRuns += 1; return { ok: true, clip: clip() }; });
    await releaseHouseholdQueue();
    await Bun.sleep(50);
    expect(stateOf(marlow, b.id).phase).toBe("held:max_drain");
    expect(stateOf(nova, c.id).phase).toBe("held:max_drain");
    expect(maxRuns + thirdRuns).toBe(0);
    running.open();
    await until(() => maxRuns === 1);
  });

  test("a Max edit asks the Stack to take chat to Reduced before it starts when the fit plan says so", async () => {
    const calls: boolean[] = []; let reduced = false;
    __setStackClientForTests({ setReducedChat: async (on: boolean) => { calls.push(on); reduced = on; return { state: "ok", reduced }; }, memory: async () => ({ reduced_chat: reduced }) } as never);
    setProfileSource({ table: [{ lead: "video", tier: "max", cells: { chat: { state: "reduced" }, video: { state: "max" } } }], hw: { budgetGb: 80, marginGb: 2, peakGb: { video: { max: 40 } }, residentGb: { chat: { reduced: 5 } } }, pins: {}, priorityWeight: {}, lowerWithoutAsking: {} });
    setBudgetReader(async () => ({ freeMemoryBytes: 70e9, loaded: [] }));
    const sage = person("Sage"); const hold = gate(); let runs = 0;
    const job = startEdit(sage, async () => { runs += 1; await hold.wait; return { ok: true, clip: clip() }; }, "max");
    await until(() => runs === 1);
    expect(calls).toContain(true);
    expect(stateOf(sage, job.id).state).toBe("running");
    hold.open();
    await until(() => !["queued", "running"].includes(stateOf(sage, job.id).state));
  });
});

describe("a Stack refusal sends an edit back to waiting", () => {
  const table: Array<{ code: string; tier?: "max"; phase: string | RegExp }> = [
    { code: "queue_full", phase: /^(queued|held:max_window)$/ },
    { code: "no_memory", tier: "max", phase: "held:tier_no_room" },
    { code: "never_fits", phase: "held:tier_no_room" },
  ];
  for (const row of table) {
    test(`${row.code}${row.tier ? " at Max" : ""}: back to queued with its hold, never failed, finishes after the second attempt`, async () => {
      const sage = person("Sage"); let attempts = 0; const seen: string[] = [];
      const job = startEdit(sage, async () => {
        attempts += 1;
        await Bun.sleep(30); // the Stack call takes a moment, as a real refusal does
        return attempts === 1 ? { ok: false, line: "I couldn't change that video. engine text 57 GB.", refusalCode: row.code } : { ok: true, clip: clip() };
      }, row.tier);
      await until(() => attempts === 1 && stateOf(sage, job.id).state === "queued");
      const waiting = stateOf(sage, job.id);
      expect(waiting.state).toBe("queued");
      expect(waiting.error).toBeNull();
      if (typeof row.phase === "string") expect(waiting.phase).toBe(row.phase); else expect(waiting.phase ?? "").toMatch(row.phase);
      seen.push(waiting.state);
      await releaseHouseholdQueue();
      await until(() => attempts === 2);
      await until(() => !["queued", "running"].includes(stateOf(sage, job.id).state));
      expect(attempts).toBe(2);
      expect(stateOf(sage, job.id).error ?? "").not.toContain("57");
      expect(seen).not.toContain("failed");
    });
  }

  test("a true Max never_fits ends with the plain line: no figures, no failed-video prefix, one attempt", async () => {
    const sage = person("Sage"); let attempts = 0;
    const job = startEdit(sage, async () => { attempts += 1; return { ok: false, line: "I couldn't change that video. This needs about 57 GB.", refusalCode: "never_fits" }; }, "max");
    await until(() => stateOf(sage, job.id).state === "failed");
    const line = stateOf(sage, job.id).error!;
    expect(line).toBe(NEVER_FITS_LINE);
    expect(line).not.toMatch(/\d/);
    expect(line).not.toContain("I couldn't");
    await releaseHouseholdQueue();
    await Bun.sleep(50);
    expect(attempts).toBe(1);
  });
});

describe("Home restarting while edits wait or run", () => {
  function orphan(actor: PersonRow, id: string, state: "queued" | "running", phase: string) {
    const now = new Date().toISOString();
    db.insert(videoJobs).values({ id, createdAt: now, updatedAt: now, personId: actor.id, conversationId: null, turnId: null, companionId: null, kind: "edit", state, stackJob: null, percent: 5, phase, position: null, prompt: "a paper boat",
      request: JSON.stringify({ size: "768x448", seconds: 5, seed: 1, loras: [], source_file_id: null, audience: "adult", tier: "max", edit: { from: "x", change: "extend" } }), error: null, files: "[]", hlc: "1:0:test" }).run();
  }
  test("a queued or running edit with no run in memory is failed with the plain interrupted line, never left queued", async () => {
    const sage = person("Sage");
    orphan(sage, "video-orphan-queued", "queued", "held:max_window");
    orphan(sage, "video-orphan-running", "running", "editing");
    resumeVideoJobs();
    await until(() => ["video-orphan-queued", "video-orphan-running"].every((id) => stateOf(sage, id).state === "failed"));
    for (const id of ["video-orphan-queued", "video-orphan-running"]) expect(stateOf(sage, id).error).toBe(EDIT_RESTART_LINE);
    await releaseHouseholdQueue();
    expect(stateOf(sage, "video-orphan-queued").state).toBe("failed");
  });
});
