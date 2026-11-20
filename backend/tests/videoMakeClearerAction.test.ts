// EDIT-AUDIT-2026-11-20: "Make clearer: Quick" in the video Studio posts to /api/plugins/video/actions/clearer and then navigates to the Create page (by design since
// 309c86681). This pins what it does with the clip: it ENHANCES the clip (the Stack's media.edit denoise then sharpen steps on the clip's own file) and never starts a
// new generation from the prompt; the original stays; the answer carries the new job so the Create feed shows it. Both the job id and the Library file id the Studio
// can hold work.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { newConversationTurnId } from "@/lib/id";
import { logTurn, resolveOrCreateConversation } from "@/lib/conversationHistory";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { __setKeyframesForTests } from "@/lib/pictures/keyframes";
import { __resetAdultLockForTests } from "@/lib/adultLock";
import { getVideoJobFor } from "@/lib/videos/jobs";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { runGenerateVideo } from "@/lib/videos/tool";
import { household } from "./fixtures/adultLock";
import { installFakeVideoStack, testJpeg, type FakeVideoStack } from "./videoFixture";
import { installFakeEditStack, type FakeEditStack } from "./videoEditStackFixture";
import { until } from "./pictureFixture";
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

function chatState(actor: PersonRow, conversationId?: string): TurnState {
  const conv = resolveOrCreateConversation(actor, "chat", conversationId, { temporary: false });
  if (!conv.ok) throw new Error("no conversation");
  const turnId = newConversationTurnId();
  logTurn(actor, "chat", "make a video", { reply: { text: "On its way." }, source: "plugin", plugin_id: "generate_video", routing: { tier: "tool", score: 1 }, safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() }, conversation_id: conv.value.id, turn_id: turnId });
  return { actor, surface: "chat", turnId, conversationId: conv.value.id, temporary: false, planBasis: { surfaceClass: "written" }, context: [], utterance: "make a video", persona: null, crisis: false } as unknown as TurnState;
}

async function createClip() {
  const fixture = await household();
  const me = fixture.row("Marlow");
  const made = await runGenerateVideo({ state: chatState(me), args: { prompt: "A paper boat floats down a rainy street, soft evening light" }, callId: "make", spoken: false });
  const id = (made.result?.data as { videoJobId: string }).videoJobId;
  await until(() => getVideoJobFor(me, id)?.state === "done");
  const { videoJobs } = await import("@/db/schema");
  db.update(videoJobs).set({ conversationId: null }).where(eq(videoJobs.id, id)).run();   // a clip made on the Create page has no chat behind it
  return { ...fixture, me, jobId: id };
}

describe("Make clearer: Quick on a finished clip (the video Studio and the Create feed)", () => {
  test("it enhances the clip: one media.edit job with the denoise then sharpen steps, no new generation, the original kept, the new job returned", async () => {
    const { adult, me, jobId } = await createClip();
    const generations = video.submitted.length;
    const res = await adult.client.post("/api/plugins/video/actions/clearer", { id: jobId, level: "quick" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; id: string; state: string };
    expect(body.ok).toBe(true);
    expect(body.id).not.toBe(jobId);
    await until(() => getVideoJobFor(me, body.id)?.state === "done");
    expect(video.submitted).toHaveLength(generations);   // not a new generation from the prompt
    const edit = stack.jobs.at(-1)!.input.ops as Array<{ op: string }>;
    expect(edit.map((step) => step.op)).toEqual(["denoise", "sharpen"]);
    expect(getVideoJobFor(me, jobId)!.state).toBe("done");
    expect(getVideoJobFor(me, body.id)!.request.edit).toMatchObject({ from: jobId, change: "upscale" });
  });

  test("the Library file id of the clip (My clips) works the same as the job id", async () => {
    const { adult, me, jobId } = await createClip();
    const fileId = getVideoJobFor(me, jobId)!.files[0]!.id;
    const res = await adult.client.post("/api/plugins/video/actions/clearer", { id: fileId, level: "quick" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    await until(() => ["done", "failed"].includes(getVideoJobFor(me, body.id)?.state ?? ""));
    expect(getVideoJobFor(me, body.id)!.state).toBe("done");
  });
});
