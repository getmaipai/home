import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people, videoJobs } from "@/db/schema";
import { newConversationTurnId } from "@/lib/id";
import { logTurn, resolveOrCreateConversation } from "@/lib/conversationHistory";
import { getVideoJobFor } from "@/lib/videos/jobs";
import { runEditVideo } from "@/lib/videos/editTool";
import { runGenerateVideo } from "@/lib/videos/tool";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { __setKeyframesForTests } from "@/lib/pictures/keyframes";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { resetDb } from "./reset-db";
import { installFakeVideoStack, testJpeg, type FakeVideoStack } from "./videoFixture";
import { installFakeEditStack, type FakeEditStack } from "./videoEditStackFixture";
import { until } from "./pictureFixture";
import type { PersonRow } from "@/types";
import type { TurnState } from "@/lib/turnMachine/contract";

let video: FakeVideoStack; let stack: FakeEditStack;
beforeEach(() => {
  resetDb(); __resetVideoAdapterCacheForTests(); video = installFakeVideoStack(); video.ltx25 = "ready";
  __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready" }));
  __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { adult: false } as never })));
  __setKeyframesForTests(async () => [testJpeg(), testJpeg(), testJpeg()]);
  stack = installFakeEditStack();
});
afterEach(() => { stack.restore(); video.restore(); __setVideoStatusForTests(undefined); });

function person(role: string, id = `person-${role}upscale`): PersonRow {
  const now = new Date().toISOString();
  db.insert(people).values({ id, displayName: role, role, avatarSeed: role, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  return db.select().from(people).where(eq(people.id, id)).get() as PersonRow;
}
function state(actor: PersonRow, conversationId?: string): TurnState {
  const conv = resolveOrCreateConversation(actor, "chat", conversationId, { temporary: false }); if (!conv.ok) throw new Error("no conversation");
  const turnId = newConversationTurnId();
  logTurn(actor, "chat", "make a video", { reply: { text: "On its way." }, source: "plugin", plugin_id: "generate_video", routing: { tier: "tool", score: 1 }, safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() }, conversation_id: conv.value.id, turn_id: turnId });
  return { actor, surface: "chat", turnId, conversationId: conv.value.id, temporary: false, planBasis: { surfaceClass: "written" }, context: [], utterance: "make a video", persona: null, crisis: false } as unknown as TurnState;
}
async function makeClip(actor: PersonRow) {
  const chat = state(actor); const made = await runGenerateVideo({ state: chat, args: { prompt: "A paper boat floats down a rainy street" }, callId: "make", spoken: false });
  const id = (made.result?.data as { videoJobId?: string } | undefined)?.videoJobId; if (!id) throw new Error("no generated video");
  await until(() => getVideoJobFor(actor, id)?.state === "done"); return { job: getVideoJobFor(actor, id)!, chat: state(actor, chat.conversationId!) };
}
async function finish(actor: PersonRow, outcome: Awaited<ReturnType<typeof runEditVideo>>) {
  const id = (outcome.result?.data as { videoJobId?: string } | undefined)?.videoJobId; expect(id).toBeTruthy();
  await until(() => ["done", "failed", "cancelled"].includes(getVideoJobFor(actor, id!)?.state ?? "")); return getVideoJobFor(actor, id!)!;
}
function setSource(actor: PersonRow, id: string, update: { seconds?: number; width?: number }) {
  const job = getVideoJobFor(actor, id)!; const files = [...job.files]; files[0] = { ...files[0]!, ...update };
  db.update(videoJobs).set({ files: JSON.stringify(files), request: JSON.stringify({ ...job.request, ...(update.seconds === undefined ? {} : { seconds: update.seconds }) }) }).where(eq(videoJobs.id, id)).run();
}

describe("edit_video upscale", () => {
  test("sends only the 2x upscale op, keeps the source, makes a new version, estimates time and relays Stack reason", async () => {
    const actor = person("owner"); const source = await makeClip(actor);
    const outcome = await runEditVideo({ state: source.chat, args: { clip: "latest", change: "upscale" }, callId: "upscale", spoken: false });
    expect(outcome.result?.reply?.text).toContain("2 minutes");
    expect(outcome.result?.reply?.text).toContain("video card shows progress");
    const made = await finish(actor, outcome);
    expect(made.state, JSON.stringify({ error: made.error, stack: stack.jobs[0] })).toBe("done"); expect(stack.jobs[0]!.input.ops).toEqual([{ op: "upscale", factor: 2 }]);
    expect(getVideoJobFor(actor, source.job.id)?.state).toBe("done"); expect(made.id).not.toBe(source.job.id);

    const second = await makeClip(actor); stack.failWith = "The sharpening model is not installed.";
    const failed = await runEditVideo({ state: second.chat, args: { clip: "latest", change: "upscale" }, callId: "reason", spoken: false });
    expect((await finish(actor, failed)).error).toBe("I couldn't change that video. The sharpening model is not installed.");
  });

  test("refuses clips over a minute and clips already 2048 pixels wide before a job is submitted", async () => {
    const actor = person("owner"); const source = await makeClip(actor);
    setSource(actor, source.job.id, { seconds: 90 });
    let result = await runEditVideo({ state: source.chat, args: { clip: "latest", change: "upscale" }, callId: "long", spoken: false });
    expect(result.result?.reply?.text).toContain("Sharpening works on clips up to a minute. Trim it first.");
    setSource(actor, source.job.id, { seconds: 6, width: 2048 });
    result = await runEditVideo({ state: source.chat, args: { clip: "latest", change: "upscale" }, callId: "wide", spoken: false });
    expect(result.result?.reply?.text).toContain("This clip is already large; sharpening would make a very big file.");
    expect(stack.jobs).toHaveLength(0);
  });

  test("maps Stack progress to the video card and labels the running phase sharpening", async () => {
    const actor = person("owner"); const source = await makeClip(actor); stack.pollsToFinish = 30; stack.progressPercent = 47;
    const outcome = await runEditVideo({ state: source.chat, args: { clip: "latest", change: "upscale" }, callId: "progress", spoken: false });
    const id = (outcome.result?.data as { videoJobId: string }).videoJobId;
    await until(() => getVideoJobFor(actor, id)?.percent === 47);
    expect(getVideoJobFor(actor, id)?.phase).toBe("sharpening");
  });

  test("uses the adult editor gate for children, teens and guests", async () => {
    const owner = person("owner"); const source = await makeClip(owner);
    for (const [role, expected] of [["child", "minor"], ["teen", "minor"], ["guest", "guest"]] as const) {
      const actor = person(role); db.update(videoJobs).set({ personId: actor.id }).where(eq(videoJobs.id, source.job.id)).run();
      const denied = await runEditVideo({ state: state(actor), args: { clip: source.job.id, change: "upscale" }, callId: role, spoken: false });
      expect(denied.result?.data).toEqual({ refused: expected });
      db.update(videoJobs).set({ personId: owner.id }).where(eq(videoJobs.id, source.job.id)).run();
    }
    expect(stack.jobs).toHaveLength(0);
  });
});
