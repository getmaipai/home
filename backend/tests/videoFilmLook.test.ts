import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
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

let video: FakeVideoStack;
let stack: FakeEditStack;
beforeEach(() => {
  resetDb(); __resetVideoAdapterCacheForTests(); video = installFakeVideoStack(); video.detailed = "installed";
  __setVideoStatusForTests(readyVideoStatusForTests({ detailed: "installed" }));
  __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { adult: false } as never })));
  __setKeyframesForTests(async () => [testJpeg(), testJpeg(), testJpeg()]); stack = installFakeEditStack();
});
afterEach(() => { stack.restore(); video.restore(); __setVideoStatusForTests(undefined); __setKeyframesForTests(null); });

function person(): PersonRow {
  const now = new Date().toISOString(); const id = "person-filmlook";
  db.insert(people).values({ id, displayName: "Owner", role: "owner", avatarSeed: "owner", source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  return db.select().from(people).where(eq(people.id, id)).get() as PersonRow;
}
function state(actor: PersonRow): TurnState {
  const conv = resolveOrCreateConversation(actor, "chat", undefined, { temporary: false }); if (!conv.ok) throw new Error("no conversation");
  const turnId = newConversationTurnId();
  logTurn(actor, "chat", "make a video", { reply: { text: "On its way." }, source: "plugin", plugin_id: "generate_video", routing: { tier: "tool", score: 1 }, safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() }, conversation_id: conv.value.id, turn_id: turnId });
  return { actor, surface: "chat", turnId, conversationId: conv.value.id, temporary: false, planBasis: { surfaceClass: "written" }, context: [], utterance: "make a video", persona: null, crisis: false } as unknown as TurnState;
}
async function clip(actor: PersonRow) {
  const chat = state(actor); const made = await runGenerateVideo({ state: chat, args: { prompt: "A paper boat floats down a rainy street" }, callId: "make", spoken: false });
  const id = (made.result?.data as { videoJobId?: string } | undefined)?.videoJobId; if (!id) throw new Error("no generated video");
  await until(() => getVideoJobFor(actor, id)?.state === "done"); return { job: getVideoJobFor(actor, id)!, chat: state(actor) };
}
async function finish(actor: PersonRow, result: Awaited<ReturnType<typeof runEditVideo>>) {
  const id = (result.result?.data as { videoJobId?: string } | undefined)?.videoJobId; expect(id).toBeTruthy();
  await until(() => ["done", "failed", "cancelled"].includes(getVideoJobFor(actor, id!)?.state ?? "")); return getVideoJobFor(actor, id!)!;
}

describe("video film looks and letterbox", () => {
  test.each([
    ["film_look", { preset: "70s_color", strength: 0.7 }, [{ op: "film_look", preset: "70s_color", strength: 0.7 }]],
    ["letterbox", { ratio: "2.39:1" }, [{ op: "letterbox", ratio: "2.39:1" }]],
  ])("sends %s to the Stack", async (change, args, ops) => {
    const actor = person(); const made = await clip(actor);
    const result = await runEditVideo({ state: made.chat, args: { clip: "latest", change, ...args }, callId: "finish", spoken: false });
    expect((await finish(actor, result)).state).toBe("done");
    expect(stack.jobs).toHaveLength(1); expect(stack.jobs[0]!.input.ops).toEqual(ops);
  });

  test("join applies its look and bars before title and credits", async () => {
    const actor = person(); const first = await clip(actor); const second = await clip(actor);
    const result = await runEditVideo({ state: second.chat, args: { clip: "latest", change: "join", clips: [first.job.id, second.job.id], look: "70s_color", letterbox: "2.39:1", title: "Summer", credits: [{ name: "Ari" }] }, callId: "join", spoken: false });
    expect((await finish(actor, result)).state).toBe("done");
    expect(stack.jobs[0]!.input.ops.map((op) => op.op)).toEqual(["concat", "film_look", "letterbox", "title_card", "credits"]);
    expect(stack.jobs[0]!.input.ops[1]).toEqual({ op: "film_look", preset: "70s_color" });
    expect(stack.jobs[0]!.input.ops[2]).toEqual({ op: "letterbox", ratio: "2.39:1" });
  });

  test("bad presets and ratios refuse before a Stack job starts", async () => {
    const actor = person(); const made = await clip(actor);
    for (const args of [
      { clip: "latest", change: "film_look", preset: "sepia" },
      { clip: "latest", change: "letterbox", ratio: "4:3" },
      { clip: "latest", change: "join", clips: [made.job.id, made.job.id], look: "sepia" },
      { clip: "latest", change: "join", clips: [made.job.id, made.job.id], letterbox: "4:3" },
    ]) {
      const result = await runEditVideo({ state: made.chat, args, callId: "bad", spoken: false });
      expect((result.result?.data as { refused?: string } | undefined)?.refused).toBeTruthy();
    }
    expect(stack.jobs).toHaveLength(0);
  });
});
