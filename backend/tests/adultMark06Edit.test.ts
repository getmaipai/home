// ADULT-LOCK-06 (docs/design/video-loras-2026-11-02.md 3.10, "Edit audience table"): every row of the table, as the pure function and as real trims and joins:
// an edit follows its sources' CURRENT flags (a lock the creator cleared stays cleared), the audience floor never drops, and an adult-only style turns the lock on.
import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { attachments, people } from "@/db/schema";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { __setKeyframesForTests } from "@/lib/pictures/keyframes";
import { newConversationTurnId } from "@/lib/id";
import { logTurn, resolveOrCreateConversation } from "@/lib/conversationHistory";
import { getVideoJobFor, type VideoJob } from "@/lib/videos/jobs";
import { runEditVideo } from "@/lib/videos/editTool";
import { clipMarkNow } from "@/lib/videos/editGate";
import { prepareContinueFrame } from "@/lib/videos/editTool";
import { runGenerateVideo } from "@/lib/videos/tool";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { __resetAdultLockForTests, __unlockRestOfTest, lockItemOfProvenance, newItemMark, withMark, type MarkSource } from "@/lib/adultLock";
import { installFakeVideoStack, testJpeg, type FakeVideoStack } from "./videoFixture";
import { installFakeEditStack, type FakeEditStack } from "./videoEditStackFixture";
import { until } from "./pictureFixture";
import type { PersonRow } from "@/types";
import type { TurnState } from "@/lib/turnMachine/contract";

setDefaultTimeout(30_000);
let video: FakeVideoStack;
let stack: FakeEditStack;
beforeEach(() => {
  resetDb(); __resetAdultLockForTests();
  __resetVideoAdapterCacheForTests();
  video = installFakeVideoStack();
  video.ltx25 = "ready";
  __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready", ltx25Picture: true }));
  __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { adult: false } as never })));
  __setKeyframesForTests(async () => [testJpeg(), testJpeg(), testJpeg()]);
  stack = installFakeEditStack();
});
afterEach(() => { stack.restore(); video.restore(); __setKeyframesForTests(null); __setVideoStatusForTests(undefined); });

function person(role: string, name = role): PersonRow {
  const now = new Date().toISOString();
  const id = `person-${name}xyz`;
  db.insert(people).values({ id, displayName: name, role, avatarSeed: name, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  return db.select().from(people).where(eq(people.id, id)).get() as PersonRow;
}
function chatState(actor: PersonRow, conversationId?: string, temporary = false): TurnState {
  // A temporary chat is a saved conversation row here with the turn's `temporary` flag set, as in the other video tests.
  const conv = resolveOrCreateConversation(actor, "chat", conversationId, { temporary: false });
  if (!conv.ok) throw new Error("no conversation");
  const turnId = newConversationTurnId();
  logTurn(actor, "chat", "make a video", { reply: { text: "On its way." }, source: "plugin", plugin_id: "generate_video", routing: { tier: "tool", score: 1 }, safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() }, conversation_id: conv.value.id, turn_id: turnId });
  return { actor, surface: "chat", turnId, conversationId: conv.value.id, temporary, planBasis: { surfaceClass: "written" }, context: [], utterance: "make a video", persona: null, crisis: false } as unknown as TurnState;
}
const BOAT = "A paper boat floats down a rainy street, soft evening light";

async function makeClip(actor: PersonRow, conversationId?: string, temporary = false, prompt = BOAT): Promise<{ job: VideoJob; state: TurnState }> {
  const state = chatState(actor, conversationId, temporary);
  const outcome = await runGenerateVideo({ state, args: { prompt }, callId: "make", spoken: false });
  const id = (outcome.result?.data as { videoJobId?: string } | undefined)?.videoJobId;
  if (!id) throw new Error(`no job: ${outcome.result?.reply?.text ?? outcome.detail}`);
  await until(() => getVideoJobFor(actor, id)?.state === "done");
  return { job: getVideoJobFor(actor, id)!, state: chatState(actor, state.conversationId!, temporary) };
}
const edit = (state: TurnState, args: Record<string, unknown>) => runEditVideo({ state, args, callId: "edit", spoken: false });
const jobOf = (actor: PersonRow, outcome: Awaited<ReturnType<typeof edit>>) => getVideoJobFor(actor, (outcome.result?.data as { videoJobId: string }).videoJobId)!;
const finished = async (actor: PersonRow, outcome: Awaited<ReturnType<typeof edit>>) => { const id = (outcome.result?.data as { videoJobId: string }).videoJobId; await until(() => ["done", "failed", "cancelled"].includes(getVideoJobFor(actor, id)?.state ?? "")); return getVideoJobFor(actor, id)!; };

const ADULT_ON: MarkSource = { madeAudience: "adult-only", lock: "on" };
const ADULT_CLEARED: MarkSource = { madeAudience: "adult-only", lock: "off" };
const ALL_AGES: MarkSource = { madeAudience: "all-ages", lock: "off" };
const adultOn = { madeAudience: "adult-only", lock: "on" } as const;
const adultOff = { madeAudience: "adult-only", lock: "off" } as const;

describe("the audience table, row by row (newItemMark)", () => {
  test("a clip locked on: adult-only, on", () => expect(newItemMark([ADULT_ON], false)).toEqual(adultOn));
  test("a clip the creator cleared, no adult style: adult-only (the content came from an adult style), off", () => expect(newItemMark([ADULT_CLEARED], false)).toEqual(adultOff));
  test("a clip the creator cleared, adding an adult-only style: adult-only, on", () => expect(newItemMark([ADULT_CLEARED], true)).toEqual(adultOn));
  test("an all-ages clip, adding an adult-only style: adult-only, on", () => expect(newItemMark([ALL_AGES], true)).toEqual(adultOn));
  test("an all-ages clip, no adult style: all-ages, off", () => expect(newItemMark([ALL_AGES], false)).toEqual({ madeAudience: "all-ages", lock: "off" }));
  test("a join or mix with any source locked on: adult-only, on", () => {
    expect(newItemMark([ADULT_CLEARED, ADULT_ON], false)).toEqual(adultOn);
    expect(newItemMark([ALL_AGES, ADULT_ON], false)).toEqual(adultOn);
  });
  test("a join or mix whose adult sources are all cleared, none locked: adult-only, off", () => {
    expect(newItemMark([ADULT_CLEARED, ADULT_CLEARED], false)).toEqual(adultOff);
    expect(newItemMark([ADULT_CLEARED, ALL_AGES], false)).toEqual(adultOff);
  });
  test("another take of a cleared clip using the same adult-only style again (a new job): adult-only, on", () => expect(newItemMark([ADULT_CLEARED], true)).toEqual(adultOn));
  test("a source that carries no flags is all-ages with the lock off", () => expect(newItemMark([{ madeAudience: "all-ages", lock: "off" }], false)).toEqual({ madeAudience: "all-ages", lock: "off" }));
});

/** A finished clip of `actor` in a chat, with its flags set the way the pipeline or the creator would leave them. */
async function clipWith(actor: PersonRow, flags: "locked" | "cleared" | "all-ages", conversationId?: string) {
  const made = await makeClip(actor, conversationId);
  if (flags !== "all-ages") {
    for (const file of [made.job.files[0]!.id, made.job.files[0]!.poster_id]) {
      const row = db.select().from(attachments).where(eq(attachments.id, file)).get()!;
      db.update(attachments).set({ provenance: withMark(row.provenance, { lock: flags === "locked" ? "on" : "off", raiseToAdult: true })! }).where(eq(attachments.id, file)).run();
    }
  }
  return made;
}
const flagsOf = (actor: PersonRow, job: VideoJob) => {
  const row = db.select().from(attachments).where(eq(attachments.id, getVideoJobFor(actor, job.id)!.files[0]!.id)).get()!;
  const item = lockItemOfProvenance(actor.id, row.provenance)!;
  return { madeAudience: item.madeAudience, lock: item.lock };
};

describe("real edits follow their sources' current flags", () => {
  test("an unlabeled saved clip is all-ages and unlocked for edits", async () => {
    const owner = person("owner");
    video.ltx25 = "ready";
    const { job, state } = await makeClip(owner);
    const file = job.files[0]!;
    const row = db.select().from(attachments).where(eq(attachments.id, file.id)).get()!;
    db.update(attachments).set({ provenance: "video-gen:{\"v\":1}" }).where(eq(attachments.id, file.id)).run();
    expect(clipMarkNow(job)).toEqual({ madeAudience: "all-ages", lock: "off" });
    const continued = await prepareContinueFrame({ actor: owner, audience: { band: "adult" } as never, source: job, body: { prompt: BOAT } as never, conversationId: state.conversationId!, turnId: state.turnId, temporary: false });
    expect(continued).toMatchObject({ ok: true, adultOnly: false, adultLock: "off" });
    const next = await finished(owner, await edit(state, { clip: "latest", change: "trim", from_s: 1, to_s: 4 }));
    expect(next.state).toBe("done");
    expect(flagsOf(owner, next)).toEqual({ madeAudience: "all-ages", lock: "off" });
  });
  test("a trim of a locked clip is adult-only and locked, from the moment it starts", async () => {
    const owner = person("owner");
    __unlockRestOfTest(owner.id);
    const { job, state } = await clipWith(owner, "locked");
    const outcome = await edit(state, { clip: "latest", change: "trim", from_s: 1, to_s: 4 });
    expect(jobOf(owner, outcome).request).toMatchObject({ adultOnly: true, adultLock: "on" });
    const next = await finished(owner, outcome);
    expect(next.state).toBe("done");
    expect(flagsOf(owner, next)).toEqual(adultOn);
    expect(job.id).not.toBe(next.id);
  });

  test("a trim of a clip the creator cleared stays cleared (off), with the audience floor kept", async () => {
    const owner = person("owner");
    const { state } = await clipWith(owner, "cleared");
    const outcome = await edit(state, { clip: "latest", change: "trim", from_s: 1, to_s: 4 });
    expect(jobOf(owner, outcome).request).toMatchObject({ adultOnly: true, adultLock: "off" });
    const next = await finished(owner, outcome);
    expect(next.state).toBe("done");
    expect(flagsOf(owner, next)).toEqual(adultOff);
  });

  test("a trim of an all-ages clip is all-ages and off", async () => {
    const owner = person("owner");
    const { state } = await clipWith(owner, "all-ages");
    const next = await finished(owner, await edit(state, { clip: "latest", change: "trim", from_s: 1, to_s: 4 }));
    expect(next.state).toBe("done");
    expect(flagsOf(owner, next)).toEqual({ madeAudience: "all-ages", lock: "off" });
  });

  test("a join with one clip locked on is locked; a join of cleared clips is cleared", async () => {
    const owner = person("owner");
    __unlockRestOfTest(owner.id);
    const a = await clipWith(owner, "cleared");
    const b = await clipWith(owner, "cleared", a.state.conversationId!);
    const cleared = await finished(owner, await edit(chatState(owner, a.state.conversationId!), { clip: "latest", change: "join", clips: [a.job.id, b.job.id] }));
    expect(cleared.state).toBe("done");
    expect(flagsOf(owner, cleared)).toEqual(adultOff);
    const c = await clipWith(owner, "locked", a.state.conversationId!);
    const locked = await finished(owner, await edit(chatState(owner, a.state.conversationId!), { clip: "latest", change: "join", clips: [a.job.id, c.job.id] }));
    expect(locked.state).toBe("done");
    expect(flagsOf(owner, locked)).toEqual(adultOn);
  });
});
