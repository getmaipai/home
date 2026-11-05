import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { resetDb } from "./reset-db";
import { newConversationTurnId } from "@/lib/id";
import { logTurn, resolveOrCreateConversation } from "@/lib/conversationHistory";
import { getVideoJobFor, type VideoJob } from "@/lib/videos/jobs";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { runGenerateVideo } from "@/lib/videos/tool";
import { __setKeyframesForTests } from "@/lib/pictures/keyframes";
import { runEditVideo } from "@/lib/videos/editTool";
import { installFakeVideoStack, testJpeg, type FakeVideoStack } from "./videoFixture";
import { until } from "./pictureFixture";
import type { PersonRow } from "@/types";
import type { TurnState } from "@/lib/turnMachine/contract";

let fake: FakeVideoStack;
beforeEach(() => {
  resetDb();
  fake = installFakeVideoStack();
  fake.ltx25max = "ready";
  const status = readyVideoStatusForTests({ ltx25max: "ready" });
  status.qualities!.ltx25max = { ...status.qualities!.ltx25max!, extend: true, retake: true, extend_seconds: { min: 1, max: 10 }, retake_from_seconds: { min: 0, max: 9 } };
  __setVideoStatusForTests(status);
  __setKeyframesForTests(async () => [testJpeg(), testJpeg(), testJpeg()]);
});
afterEach(async () => { fake.restore(); __setKeyframesForTests(null); __setVideoStatusForTests(undefined); await new Promise((resolve) => setTimeout(resolve, 50)); });

function person(role: string, name = role): PersonRow {
  const now = new Date().toISOString();
  const id = `person-${name}xyz`;
  db.insert(people).values({ id, displayName: name, role, avatarSeed: name, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  return db.select().from(people).where(eq(people.id, id)).get() as PersonRow;
}
function chatState(actor: PersonRow, conversationId?: string): TurnState {
  const conv = resolveOrCreateConversation(actor, "chat", conversationId, { temporary: false });
  if (!conv.ok) throw new Error("no conversation");
  const turnId = newConversationTurnId();
  logTurn(actor, "chat", "make a video", { reply: { text: "On its way." }, source: "plugin", plugin_id: "generate_video", routing: { tier: "tool", score: 1 }, safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() }, conversation_id: conv.value.id, turn_id: turnId });
  return { actor, surface: "chat", turnId, conversationId: conv.value.id, temporary: false, planBasis: { surfaceClass: "written" }, context: [], utterance: "make a video", persona: null, crisis: false } as unknown as TurnState;
}
const edit = (state: TurnState, args: Record<string, unknown>) => runEditVideo({ state, args, callId: "edit", spoken: false });
async function makeClip(actor: PersonRow): Promise<{ job: VideoJob; state: TurnState }> {
  const state = chatState(actor);
  const made = await runGenerateVideo({ state, args: { prompt: "A paper boat floats on a river at sunset", tier: "max" }, callId: "make", spoken: false });
  const id = (made.result?.data as { videoJobId?: string }).videoJobId;
  if (!id) throw new Error("clip was not started");
  await until(() => getVideoJobFor(actor, id)?.state === "done");
  return { job: getVideoJobFor(actor, id)!, state: chatState(actor, state.conversationId! ) };
}

describe("edit_video extend and retake", () => {
  test("extend sends a Stack source path and added seconds at Max; original stays done", async () => {
    const actor = person("owner");
    const { job, state } = await makeClip(actor);
    const result = await edit(state, { clip: job.id, change: "extend", seconds: 4 });
    expect(result.status).toBe("succeeded");
    await until(() => fake.submitted.length >= 2);
    expect(fake.submitted[1]).toMatchObject({ model: "ltx25-max", source_video: expect.stringContaining("video-edit"), extend_seconds: 4, tier: "max" });
    const newId = (result.result?.data as { videoJobId: string }).videoJobId;
    await until(() => ["done", "failed"].includes(getVideoJobFor(actor, newId)?.state ?? ""));
    expect(getVideoJobFor(actor, newId)?.state).toBe("done");
    expect(newId).not.toBe(job.id);
    expect(getVideoJobFor(actor, job.id)?.state).toBe("done");
  });

  test("retake sends its start time and optional new words", async () => {
    const actor = person("owner");
    const { job, state } = await makeClip(actor);
    const result = await edit(state, { clip: job.id, change: "retake", from_s: 3, prompt: "A paper boat reaches the sea" });
    expect(result.status).toBe("succeeded");
    await until(() => fake.submitted.length >= 2);
    expect(fake.submitted[1]).toMatchObject({ model: "ltx25-max", source_video: expect.stringContaining("video-edit"), retake_from_seconds: 3, prompt: "A paper boat reaches the sea" });
    const newId = (result.result?.data as { videoJobId: string }).videoJobId;
    await until(() => ["done", "failed"].includes(getVideoJobFor(actor, newId)?.state ?? ""));
    expect(getVideoJobFor(actor, newId)?.state).toBe("done");
    expect(getVideoJobFor(actor, job.id)?.state).toBe("done");
  });

  test("missing grant, Stack flag, and an out of range duration refuse without submit", async () => {
    const nonAdmin = person("adult");
    const noGrantClip = await makeClip(nonAdmin);
    const noGrant = await edit(noGrantClip.state, { clip: noGrantClip.job.id, change: "extend", seconds: 4 });
    expect(noGrant.result?.reply?.text).toContain("Max");
    expect(fake.submitted).toHaveLength(1);
    const actor = person("owner", "maxowner");
    const { job, state } = await makeClip(actor);
    const broken = readyVideoStatusForTests({ ltx25max: "ready" });
    broken.qualities!.ltx25max = { ...broken.qualities!.ltx25max!, extend: false, retake: true, extend_seconds: { min: 1, max: 10 }, retake_from_seconds: { min: 0, max: 9 } };
    __setVideoStatusForTests(broken);
    const noFlag = await edit(state, { clip: job.id, change: "extend", seconds: 4 });
    expect(noFlag.result?.reply?.text).toContain("cannot extend or retake");
    const ready = readyVideoStatusForTests({ ltx25max: "ready" });
    ready.qualities!.ltx25max = { ...ready.qualities!.ltx25max!, extend: true, retake: true, extend_seconds: { min: 1, max: 10 }, retake_from_seconds: { min: 0, max: 9 } };
    __setVideoStatusForTests(ready);
    const narrow = readyVideoStatusForTests({ ltx25max: "ready" });
    narrow.qualities!.ltx25max = { ...narrow.qualities!.ltx25max!, extend: true, retake: true, extend_seconds: { min: 1, max: 5 }, retake_from_seconds: { min: 0, max: 9 } };
    __setVideoStatusForTests(narrow);
    const out = await edit(state, { clip: job.id, change: "extend", seconds: 6 });
    expect(out.result?.reply?.text).toContain("outside the range");
    expect(fake.submitted).toHaveLength(2);
  });
});
