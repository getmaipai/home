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
import { testJpeg } from "./videoFixture";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { resetDb } from "./reset-db";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { installFakeEditStack, type FakeEditStack } from "./videoEditStackFixture";
import { until } from "./pictureFixture";
import type { PersonRow } from "@/types";
import type { TurnState } from "@/lib/turnMachine/contract";

let video: FakeVideoStack; let stack: FakeEditStack;
beforeEach(() => { resetDb(); __resetVideoAdapterCacheForTests(); video = installFakeVideoStack(); video.ltx25 = "ready"; __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready" })); __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { adult: false } as never }))); __setKeyframesForTests(async () => [testJpeg(), testJpeg(), testJpeg()]); stack = installFakeEditStack(); });
afterEach(() => { stack.restore(); video.restore(); __setVideoStatusForTests(undefined); __setKeyframesForTests(null); });
function person(): PersonRow {
  const now = new Date().toISOString(); const id = "person-filmops";
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
async function finish(actor: PersonRow, outcome: Awaited<ReturnType<typeof runEditVideo>>) {
  const id = (outcome.result?.data as { videoJobId?: string } | undefined)?.videoJobId; expect(id).toBeTruthy();
  await until(() => ["done", "failed", "cancelled"].includes(getVideoJobFor(actor, id!)?.state ?? "")); return getVideoJobFor(actor, id!)!;
}

describe("film finishing ops", () => {
  test("join forwards transition before its title and credits, and keeps every source", async () => {
    const actor = person(); const first = await clip(actor); const second = await clip(actor);
    const outcome = await runEditVideo({ state: second.chat, args: { clip: "latest", change: "join", clips: [first.job.id, second.job.id], transition: "wipeleft", transition_s: 0.7, title: "Summer at the Lake", subtitle: "August", credits: [{ role: "Camera", name: "Ari" }], credits_title: "Thanks" }, callId: "film", spoken: false });
    const made = await finish(actor, outcome); expect(made.state, JSON.stringify(made)).toBe("done");
    expect(stack.jobs).toHaveLength(1);
    expect(stack.jobs[0]!.input.ops).toEqual([
      { op: "transition", kind: "wipeleft", duration_s: 0.7 },
      { op: "title_card", text: "Summer at the Lake", subtitle: "August", duration_s: 3, position: "center", background: "black", text_color: "white", fade_in_s: 0.5, fade_out_s: 0.5, place: "start" },
      { op: "credits", lines: [{ role: "Camera", name: "Ari" }], duration_s: 4, background: "black", text_color: "white", title: "Thanks" },
    ]);
    expect(getVideoJobFor(actor, first.job.id)?.state).toBe("done"); expect(getVideoJobFor(actor, second.job.id)?.state).toBe("done");
  });

  test("bad transition and too many credit lines refuse before Stack submits", async () => {
    const actor = person(); const source = await clip(actor);
    for (const args of [
      { clip: "latest", change: "join", clips: [source.job.id, source.job.id], transition: "bad-kind" },
      { clip: "latest", change: "credits", credits: Array.from({ length: 61 }, (_, i) => ({ name: `Person ${i}` })) },
    ]) {
      const outcome = await runEditVideo({ state: source.chat, args, callId: "bad", spoken: false });
      expect((outcome.result?.data as { refused?: string } | undefined)?.refused).toBeTruthy();
    }
    expect(stack.jobs).toHaveLength(0);
  });
});

describe("seamJoinOps", () => {
  test("a run of one kind is one step; a different kind starts the next step; cut is a concat", async () => {
    const { seamJoinOps } = await import("@/lib/videos/editPlan");
    expect(seamJoinOps(["fade", "fade", "cut", "dissolve"])).toEqual([{ op: "transition", kind: "fade", duration_s: 0.5, with: [1, 2] }, { op: "concat", with: [3] }, { op: "transition", kind: "dissolve", duration_s: 0.5, with: [4] }]);
    expect(seamJoinOps(["dissolve", "dissolve"])).toEqual([{ op: "transition", kind: "dissolve", duration_s: 0.5 }]);
    expect(seamJoinOps([])).toEqual([]);
  });
  test("when the runs need more steps than allowed, the film takes its most common kind in one step", async () => {
    const { seamJoinOps } = await import("@/lib/videos/editPlan");
    const kinds = ["fade", "dissolve", "fade", "wipeleft", "fade", "dissolve", "fade", "dissolve", "fade"] as const;
    expect(seamJoinOps(kinds, 0.5, 5)).toEqual([{ op: "transition", kind: "fade", duration_s: 0.5 }]);
  });
});
