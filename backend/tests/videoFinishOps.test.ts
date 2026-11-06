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

let video: FakeVideoStack;
let stack: FakeEditStack;
beforeEach(() => {
  resetDb(); __resetVideoAdapterCacheForTests(); video = installFakeVideoStack(); video.ltx25 = "ready";
  __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready" }));
  __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { adult: false } as never })));
  __setKeyframesForTests(async () => [testJpeg(), testJpeg(), testJpeg()]); stack = installFakeEditStack();
});
afterEach(() => { stack.restore(); video.restore(); __setKeyframesForTests(null); __setVideoStatusForTests(undefined); });

function person(): PersonRow {
  const now = new Date().toISOString(); const id = "person-finishops";
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

describe("finished video ops", () => {
  test.each([
    ["reframe" as const, { aspect: "9:16", fill: "blur" }, [{ op: "reframe", aspect: "9:16", fill: "blur" }]],
    ["grade" as const, { warmth: 0.4, grain: 0.7 }, [{ op: "grade", warmth: 0.4, grain: 0.7 }]],
    ["speed" as const, { factor: 0.5 }, [{ op: "speed", factor: 0.5 }]],
    ["captions" as const, { captions: [{ from_s: 0, to_s: 2, text: "Hello there" }], position: "top" }, [{ op: "captions", lines: [{ from_s: 0, to_s: 2, text: "Hello there" }], position: "top" }]],
  ])("sends %s and keeps its source", async (change, args, ops) => {
    const actor = person(); const { job, state } = await makeClip(actor);
    const outcome = await runEditVideo({ state, args: { clip: "latest", change, ...args }, callId: "edit", spoken: false });
    const id = (outcome.result?.data as { videoJobId?: string } | undefined)?.videoJobId; expect(id).toBeTruthy();
    await until(() => ["done", "failed", "cancelled"].includes(getVideoJobFor(actor, id!)?.state ?? ""));
    const next = getVideoJobFor(actor, id!)!;
    expect(next.state).toBe("done"); expect(next.kind).toBe("edit"); expect(next.request.edit).toEqual({ from: job.id, change });
    expect(getVideoJobFor(actor, job.id)?.state).toBe("done"); expect(stack.jobs).toHaveLength(1); expect(stack.jobs[0]!.input.ops).toEqual(ops);
  });

  test("refuses bad values before a Stack job starts", async () => {
    const actor = person(); const { state } = await makeClip(actor);
    for (const args of [
      { change: "reframe" }, { change: "grade" }, { change: "speed", factor: 5 },
      { change: "captions", captions: [{ from_s: 3, to_s: 2, text: "bad timing" }] },
      { change: "captions", captions: [{ from_s: 0, to_s: 2, text: "x".repeat(161) }] },
      { change: "captions", captions: Array.from({ length: 41 }, (_, i) => ({ from_s: i, to_s: i + 0.5, text: "line" })) },
    ]) {
      const outcome = await runEditVideo({ state, args: { clip: "latest", ...args }, callId: "edit", spoken: false });
      expect(outcome.status === "failed" || (outcome.result?.data as { refused?: string } | undefined)?.refused).toBeTruthy();
    }
    expect(stack.jobs).toHaveLength(0);
  });
});
