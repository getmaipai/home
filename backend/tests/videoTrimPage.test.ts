// The Trim and join page (video package, /apps/video/trim): pick a clip, trim and join with the Studio's own timeline (its `export` and `add` actions),
// and Split into two clips (`actions/split`, lib/videos/clipEditStart.ts). Real finished clips made through the fake video Stack; every edit runs
// through the fake edit Stack, so each test reads the exact steps the Stack was sent.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { videoJobs } from "@/db/schema";
import { __resetAdultLockForTests } from "@/lib/adultLock";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { __setKeyframesForTests } from "@/lib/pictures/keyframes";
import { getVideoJobFor, type VideoJob } from "@/lib/videos/jobs";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { SPLIT_POINT_LINE } from "@/lib/videos/clipEditStart";
import { LOCKED_START_LINE } from "@/lib/videos/lock";
import { PageNodeSchema } from "@/kit/schema/types";
import { household, markAdultOnly } from "./fixtures/adultLock";
import { installFakeVideoStack, testJpeg, type FakeVideoStack } from "./videoFixture";
import { installFakeEditStack, type FakeEditStack } from "./videoEditStackFixture";
import { until } from "./pictureFixture";
import { runGenerateVideo } from "@/lib/videos/tool";
import { logTurn, resolveOrCreateConversation } from "@/lib/conversationHistory";
import { newConversationTurnId } from "@/lib/id";
import type { PersonRow } from "@/types";
import type { TurnState } from "@/lib/turnMachine/contract";

let video: FakeVideoStack;
let stack: FakeEditStack;
beforeEach(() => {
  resetDb(); __resetAdultLockForTests(); __resetVideoAdapterCacheForTests();
  video = installFakeVideoStack(); video.ltx25 = "ready";
  __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready" }));
  __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { adult: false } as never })));
  __setKeyframesForTests(async () => [testJpeg(), testJpeg(), testJpeg()]);
  stack = installFakeEditStack();
});
afterEach(() => { stack.restore(); video.restore(); __setKeyframesForTests(null); __setVideoStatusForTests(undefined); });

function chatState(actor: PersonRow): TurnState {
  const conv = resolveOrCreateConversation(actor, "chat", undefined, { temporary: false });
  if (!conv.ok) throw new Error("no conversation");
  const turnId = newConversationTurnId();
  logTurn(actor, "chat", "make a video", { reply: { text: "On its way." }, source: "plugin", plugin_id: "generate_video", routing: { tier: "tool", score: 1 }, safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() }, conversation_id: conv.value.id, turn_id: turnId });
  return { actor, surface: "chat", turnId, conversationId: conv.value.id, temporary: false, planBasis: { surfaceClass: "written" }, context: [], utterance: "make a video", persona: null, crisis: false } as unknown as TurnState;
}

/** A finished clip on the Create page (no conversation), like the clips the page lists. */
async function clipOf(me: PersonRow, prompt = "A paper boat floats down a rainy street, soft evening light"): Promise<VideoJob> {
  const made = await runGenerateVideo({ state: chatState(me), args: { prompt }, callId: "make", spoken: false });
  const id = (made.result?.data as { videoJobId: string }).videoJobId;
  await until(() => getVideoJobFor(me, id)?.state === "done");
  db.update(videoJobs).set({ conversationId: null }).where(eq(videoJobs.id, id)).run();
  return getVideoJobFor(me, id)!;
}
const doneEdits = (me: PersonRow, count: number) => until(() => stack.jobs.length >= count && !db.select().from(videoJobs).all().some((row) => row.personId === me.id && (row.state === "queued" || row.state === "running")));

const piece = (ref: string, in_s: number, out_s: number) => ({ ref, in_s, out_s, level_db: 0, fade_in_s: 0, fade_out_s: 0 });
const lane = { level_db: 0, muted: false, pieces: [] };
const plan = (pieces: ReturnType<typeof piece>[], transitions: Array<{ kind: "cut" | "crossfade"; seconds: number }> = []) =>
  ({ version: 1, film_s: pieces.reduce((sum, p) => sum + p.out_s - p.in_s, 0), video: { level_db: 0, muted: false, pieces, transitions }, voice: lane, music: lane });

describe("the page", () => {
  test("it is a real page, not the coming-soon stub, valid for an adult, and a teen and a child never get it", async () => {
    const { owner, teen, child } = await household();
    const res = await owner.get("/api/plugins/video/pages/trim");
    expect(res.status).toBe(200);
    const page = await res.json();
    expect(PageNodeSchema.safeParse(page).success).toBe(true);
    const text = JSON.stringify(page);
    expect(text).not.toContain("coming soon");
    expect(text).not.toContain("/api/plugins/video/actions/split"); // VF-IA-02 (a): Split into two clips moved into the Studio page
    expect((await (await owner.get("/api/plugins/video/pages/studio")).text())).toContain("/api/plugins/video/actions/split");
    expect(text).toContain("/api/plugins/video/actions/export");
    expect(text).toContain("/api/plugins/video/actions/add");
    for (const minor of [teen.client, child.client]) expect([403, 404]).toContain((await minor.get("/api/plugins/video/pages/trim")).status);
  });

  test("it asks for no more than the Studio element offers, and keeps its own tools to cut, delete and add a clip", () => {
    const page = JSON.parse(readFileSync(new URL("../packages/video/pages/trim.json", import.meta.url), "utf8")) as { body: Array<Record<string, unknown>> };
    const studio = page.body.find((node) => node.type === "studio")!;
    expect(studio.tools).toEqual(["split", "delete", "add_clip"]);
    expect(studio.panels).toEqual(["crossfade"]);
  });
});

describe("Trim and Join through the Studio's export", () => {
  test("a trim is one trim step on the clip, and the new clip is linked to the original, which is kept", async () => {
    const { adult, row } = await household(); const me = row("Marlow");
    const clip = await clipOf(me);
    const res = await adult.client.post("/api/plugins/video/actions/export", { clip: clip.files[0]!.id, plan: plan([piece(clip.files[0]!.id, 1, 3.5)]) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    await until(() => getVideoJobFor(me, body.id)?.state === "done");
    expect(stack.jobs.at(-1)!.input.ops).toEqual([{ op: "trim", in_s: 1, out_s: 3.5 }]);
    const made = getVideoJobFor(me, body.id)!;
    expect(made.request.edit).toMatchObject({ from: clip.id, change: "trim" });
    expect(getVideoJobFor(me, clip.id)?.state).toBe("done");
  });

  test("a join of two clips with a crossfade sends one crossfade step, the first clip is the source and the second is named", async () => {
    const { adult, row } = await household(); const me = row("Marlow");
    const a = await clipOf(me); const b = await clipOf(me, "A red kite over a quiet green hill, bright morning");
    const res = await adult.client.post("/api/plugins/video/actions/export", { clip: a.files[0]!.id, plan: plan([piece(a.files[0]!.id, 0, 4), piece(b.files[0]!.id, 0, 4)], [{ kind: "crossfade", seconds: 0.5 }]) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    await until(() => getVideoJobFor(me, body.id)?.state === "done");
    const made = getVideoJobFor(me, body.id)!;
    expect(made.request.edit).toMatchObject({ from: a.id, change: "join", with: [b.id] });
    expect(JSON.stringify(stack.jobs.at(-1)!.input.ops)).toContain("crossfade");
  });

  test("a locked clip, someone else's clip and a child are each refused with a plain line, and no job starts", async () => {
    const { adult, other, child, row } = await household(); const me = row("Marlow");
    const clip = await clipOf(me); const locked = await clipOf(me, "Zebraquill velvet cabaret dancer under violet lamps");
    markAdultOnly(locked.id);
    const before = stack.jobs.length;
    const mine = clip.files[0]!.id;
    const lockedRes = await adult.client.post("/api/plugins/video/actions/export", { clip: locked.files[0]!.id, plan: plan([piece(locked.files[0]!.id, 0, 3)]) });
    expect(lockedRes.status).toBe(403);
    expect(((await lockedRes.json()) as { error: string }).error).toContain("Unlock it with your passcode");
    expect((await other.client.post("/api/plugins/video/actions/export", { clip: mine, plan: plan([piece(mine, 0, 3)]) })).status).toBe(404);
    expect([403, 404]).toContain((await child.client.post("/api/plugins/video/actions/export", { clip: mine, plan: plan([piece(mine, 0, 3)]) })).status);
    expect(stack.jobs.length).toBe(before);
  });
});

describe("Split into two clips", () => {
  const SPLIT = "/api/plugins/video/actions/split";

  test("the first part starts now, the second after it is saved: two trims that meet at the split time, the original kept", async () => {
    const { adult, row } = await household(); const me = row("Marlow");
    const clip = await clipOf(me);
    const length = clip.files[0]!.seconds!;
    const res = await adult.client.post(SPLIT, { id: clip.id, at: "2" });
    expect(res.status).toBe(200);
    const first = (await res.json()) as { id: string; state: string };
    expect(["queued", "running"]).toContain(first.state);
    await doneEdits(me, 2);
    const trims = stack.jobs.map((job) => job.input.ops);
    expect(trims[0]).toEqual([{ op: "trim", in_s: 0, out_s: 2 }]);
    expect(trims[1]).toEqual([{ op: "trim", in_s: 2, out_s: length }]);
    const edits = db.select().from(videoJobs).all().filter((row) => row.id !== clip.id && row.kind === "edit");
    expect(edits.length).toBe(2);
    expect(edits.every((row) => row.state === "done")).toBe(true);
    expect(getVideoJobFor(me, clip.id)?.state).toBe("done");
    // Each new clip names its parent, so How it was made shows where it came from.
    for (const row of edits) expect(getVideoJobFor(me, row.id)!.request.edit).toMatchObject({ from: clip.id, change: "trim" });
  });

  test("a time that is not a number, or too close to an end, is one plain line and nothing starts", async () => {
    const { adult, row } = await household(); const me = row("Marlow");
    const clip = await clipOf(me);
    const length = clip.files[0]!.seconds!;
    for (const at of ["", "soon", "-1", "0", "0.2", String(length), String(length + 3)]) {
      const res = await adult.client.post(SPLIT, { id: clip.id, at });
      expect(res.status).toBe(422);
      const line = ((await res.json()) as { error: string }).error;
      expect(line.length).toBeGreaterThan(10);
      expect(line).not.toMatch(/undefined|NaN|Error/);
    }
    expect(((await (await adult.client.post(SPLIT, { id: clip.id, at: "abc" })).json()) as { error: string }).error).toBe(SPLIT_POINT_LINE);
    expect(stack.jobs.length).toBe(0);
  });

  test("a locked clip, someone else's clip and a made-up id are refused, and a teen and a child never split", async () => {
    const { adult, other, teen, child, row } = await household(); const me = row("Marlow");
    const clip = await clipOf(me); const locked = await clipOf(me, "Zebraquill velvet cabaret dancer under violet lamps");
    markAdultOnly(locked.id);
    const lockedRes = await adult.client.post(SPLIT, { id: locked.id, at: "2" });
    expect(lockedRes.status).toBe(423);
    expect(((await lockedRes.json()) as { error: string; locked?: boolean })).toMatchObject({ error: LOCKED_START_LINE, locked: true });
    expect((await other.client.post(SPLIT, { id: clip.id, at: "2" })).status).toBe(404);
    expect((await adult.client.post(SPLIT, { id: "no-such-clip", at: "2" })).status).toBe(404);
    for (const minor of [teen.client, child.client]) expect([403, 404, 422]).toContain((await minor.post(SPLIT, { id: clip.id, at: "2" })).status);
    expect(stack.jobs.length).toBe(0);
  });

  test("while another video is being made the split says so in one line and starts nothing", async () => {
    const { adult, row } = await household(); const me = row("Marlow");
    const clip = await clipOf(me);
    expect((await adult.client.post(SPLIT, { id: clip.id, at: "2" })).status).toBe(200);
    const again = await adult.client.post(SPLIT, { id: clip.id, at: "3" });
    expect(again.status).toBe(422);
    expect(((await again.json()) as { error: string }).error).toContain("already have a video being made");
    await doneEdits(me, 2);
  });
});
