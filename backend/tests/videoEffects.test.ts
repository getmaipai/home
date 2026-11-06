import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { __setKeyframesForTests } from "@/lib/pictures/keyframes";
import { newConversationTurnId } from "@/lib/id";
import { logTurn, resolveOrCreateConversation } from "@/lib/conversationHistory";
import { getVideoJobFor } from "@/lib/videos/jobs";
import { runEditVideo } from "@/lib/videos/editTool";
import { runGenerateVideo } from "@/lib/videos/tool";
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
  resetDb(); __resetVideoAdapterCacheForTests(); video = installFakeVideoStack(); video.detailed = "installed";
  __setVideoStatusForTests(readyVideoStatusForTests({ detailed: "installed" }));
  __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { adult: false } as never })));
  __setKeyframesForTests(async () => [testJpeg(), testJpeg(), testJpeg()]);
  stack = installFakeEditStack();
});
afterEach(() => { stack.restore(); video.restore(); __setKeyframesForTests(null); __setVideoStatusForTests(undefined); __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { adult: false } as never }))); });

function person(): PersonRow {
  const now = new Date().toISOString(); const id = "person-effects";
  db.insert(people).values({ id, displayName: "Owner", role: "owner", avatarSeed: "owner", source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  return db.select().from(people).where(eq(people.id, id)).get() as PersonRow;
}
function chatState(actor: PersonRow): TurnState {
  const conv = resolveOrCreateConversation(actor, "chat", undefined, { temporary: false }); if (!conv.ok) throw new Error("no conversation");
  const turnId = newConversationTurnId();
  logTurn(actor, "chat", "make a video", { reply: { text: "On its way." }, source: "plugin", plugin_id: "generate_video", routing: { tier: "tool", score: 1 }, safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() }, conversation_id: conv.value.id, turn_id: turnId });
  return { actor, surface: "chat", turnId, conversationId: conv.value.id, temporary: false, planBasis: { surfaceClass: "written" }, context: [], utterance: "make a video", persona: null, crisis: false } as unknown as TurnState;
}
async function makeClip(actor: PersonRow) {
  const state = chatState(actor); const made = await runGenerateVideo({ state, args: { prompt: "A paper boat floats down a rainy street" }, callId: "make", spoken: false });
  const id = (made.result?.data as { videoJobId?: string } | undefined)?.videoJobId; if (!id) throw new Error("no generated video");
  await until(() => getVideoJobFor(actor, id)?.state === "done"); return { job: getVideoJobFor(actor, id)!, state: chatState(actor) };
}

describe("video finishing effects", () => {
  test.each([
    ["speed_ramp", { from_factor: 1, to_factor: 2, at_s: 1, over_s: 2 }, [{ op: "speed_ramp", from_factor: 1, to_factor: 2, at_s: 1, over_s: 2 }]],
    ["reverse", {}, [{ op: "reverse" }]], ["freeze", { at_s: 1, hold_s: 2 }, [{ op: "freeze", at_s: 1, hold_s: 2 }]],
    ["loop", { times: 3 }, [{ op: "loop", times: 3 }]], ["fps_boost", { fps: 60 }, [{ op: "fps_boost", fps: 60 }]],
    ["flip", { direction: "horizontal" }, [{ op: "flip", direction: "horizontal" }]], ["rotate", { degrees: 90 }, [{ op: "rotate", degrees: 90 }]],
    ["sharpen", { amount: 0.5 }, [{ op: "sharpen", amount: 0.5 }]], ["denoise", { amount: 0.5 }, [{ op: "denoise", amount: 0.5 }]],
    ["kenburns", { from_factor: 1, to_factor: 1.5 }, [{ op: "kenburns", zoom_from: 1, zoom_to: 1.5, pan: "none" }]],
  ] as const)("sends %s and keeps the original", async (effect, args, ops) => {
    const actor = person(); const { job, state } = await makeClip(actor);
    const outcome = await runEditVideo({ state, args: { clip: "latest", change: "effect", effect, ...args }, callId: "effect", spoken: false });
    const id = (outcome.result?.data as { videoJobId?: string } | undefined)?.videoJobId; expect(id).toBeTruthy();
    await until(() => ["done", "failed", "cancelled"].includes(getVideoJobFor(actor, id!)?.state ?? ""));
    const edited = getVideoJobFor(actor, id!)!; expect(edited.state, `${edited.error}; stack jobs ${stack.jobs.length}`).toBe("done"); expect(edited.error).toBeNull(); expect(edited.request.edit?.from).toBe(job.id); expect(getVideoJobFor(actor, job.id)?.state).toBe("done"); expect(stack.jobs.at(-1)?.input.ops).toEqual([...ops]);
  }, 20000);

  test("pip uses the second clip as input 1", async () => {
    const actor = person(); const first = await makeClip(actor); const second = await makeClip(actor);
    const outcome = await runEditVideo({ state: first.state, args: { clip: "latest", change: "effect", effect: "pip", with_clip: second.job.id, corner: "bottom_right", size: 0.25 }, callId: "pip", spoken: false });
    const id = (outcome.result?.data as { videoJobId?: string } | undefined)?.videoJobId; expect(id).toBeTruthy();
    await until(() => getVideoJobFor(actor, id!)?.state === "done"); expect(stack.jobs.at(-1)?.input.ops).toEqual([{ op: "pip", input: 1, corner: "bottom_right", size: 0.25, margin: 0.05 }]);
    expect(getVideoJobFor(actor, first.job.id)?.state).toBe("done"); expect(getVideoJobFor(actor, second.job.id)?.state).toBe("done");
  }, 20000);

  test("refuses missing or invalid effect args before a Stack job", async () => {
    const actor = person(); const { state } = await makeClip(actor);
    for (const args of [{ effect: "pip", corner: "top_left", size: 0.2 }, { effect: "loop", times: 7 }, { effect: "freeze", at_s: 1, hold_s: 8 }, { effect: "speed_ramp", from_factor: 0.1, to_factor: 2, at_s: 1, over_s: 2 }]) {
      const result = await runEditVideo({ state, args: { clip: "latest", change: "effect", ...args }, callId: "bad", spoken: false }); expect(result.result?.data).toHaveProperty("refused");
    }
    expect(stack.jobs).toHaveLength(0);
  });
});
