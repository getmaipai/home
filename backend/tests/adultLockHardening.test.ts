// ADULT-LOCK-02 verification (2026-11-02): leaks and holes the review of the build found. Same fixture as adultLock.test.ts.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { attachments, videoJobs } from "@/db/schema";
import { getVideoJobFor, startVideoJob } from "@/lib/videos/jobs";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { __setVideoStatusForTests } from "@/lib/videos/ready";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { currentLockout, LOCKOUT_THRESHOLD } from "@/lib/credentialLockout";
import { __resetAdultLockForTests, adultLockCounters } from "@/lib/adultLock";
import { newConversationTurnId } from "@/lib/id";
import { logTurn, resolveOrCreateConversation } from "@/lib/conversationHistory";
import { TestClient } from "./client";
import { scanRoot } from "@/lib/media/scan";
import { buildMediaTree } from "./support/mediaTree";
import { people, mediaItems } from "@/db/schema";
import { editMediaItem } from "@/lib/media/mediaEdit";
import { trashFile } from "@/lib/libraryTrash";
import { ADULT_PROMPT, ADULT_STRINGS, PASSCODE, adultClip, household, makeClip, textOf, unlock, unlockHeader } from "./fixtures/adultLock";
import type { PersonRow } from "@/types";

let fake: FakeVideoStack;
beforeEach(() => {
  resetDb(); __resetVideoAdapterCacheForTests(); __resetAdultLockForTests(); __resetThrottleForTests();
  fake = installFakeVideoStack();
  __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { adult: false } as never })));
});
afterEach(() => { fake.restore(); __setVideoStatusForTests(undefined); });

/** A chat turn of the person that carries the clip's job (as a generate_video turn does), so the history list names the job. */
function chatTurnWithJob(actor: PersonRow, jobId: string): { conversationId: string; turnId: string } {
  const conv = resolveOrCreateConversation(actor, "chat", undefined, { temporary: false });
  if (!conv.ok) throw new Error("no conversation");
  const turnId = newConversationTurnId();
  logTurn(actor, "chat", "make a video", { reply: { text: "Ready." }, source: "plugin", plugin_id: "generate_video", routing: { tier: "tool", score: 1 }, safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() }, conversation_id: conv.value.id, turn_id: turnId });
  db.update(videoJobs).set({ turnId }).where(eq(videoJobs.id, jobId)).run();
  const live = getVideoJobFor(actor, jobId); if (live) live.turnId = turnId;
  return { conversationId: conv.value.id, turnId };
}

describe("chat history", () => {
  test("a locked clip's job id is not in the history list, an unlocked one is, and an all-ages clip's always is", async () => {
    const { adult, row } = await household();
    const me = row("Marlow");
    const locked = await adultClip(adult.client, me);
    const plain = await makeClip(adult.client, me, "A paper boat floats down a rainy street");
    const a = chatTurnWithJob(me, locked.jobId);
    const b = chatTurnWithJob(me, plain.jobId);
    const turnsOf = async (conversationId: string, h?: Record<string, string>) => (await adult.client.get(`/api/conversations/${conversationId}/turns`, h));
    const res = await turnsOf(a.conversationId);
    const body = await textOf(res);
    expect(body).not.toContain(locked.jobId);
    expect(body).not.toContain(locked.fileId);
    for (const w of ADULT_STRINGS) expect(body).not.toContain(w);
    const turns = (await (await turnsOf(a.conversationId)).json()) as Array<{ id: string; video?: Record<string, unknown> }>;
    expect(turns.find((t) => t.id === a.turnId)?.video).toEqual({ locked: true });
    const plainTurns = (await (await turnsOf(b.conversationId)).json()) as Array<{ id: string; video?: Record<string, unknown> }>;
    expect(plainTurns.find((t) => t.id === b.turnId)?.video).toEqual({ id: plain.jobId });
    const proof = await unlock(adult.client);
    const open = (await (await turnsOf(a.conversationId, unlockHeader(proof))).json()) as Array<{ id: string; video?: Record<string, unknown> }>;
    expect(open.find((t) => t.id === a.turnId)?.video).toEqual({ id: locked.jobId });
  });
});

describe("holes a locked clip must not have", () => {
  test("trash and cancel of a locked clip answer like a missing one and change nothing; trashFile itself refuses it too", async () => {
    const { adult, row } = await household();
    const me = row("Marlow");
    const locked = await adultClip(adult.client, me);
    expect((await adult.client.request(`/api/files/${locked.fileId}`, { method: "DELETE" })).status).toBe(404);
    expect(trashFile(me, locked.fileId)).toMatchObject({ ok: false, status: 404 });
    expect(db.select().from(attachments).where(eq(attachments.id, locked.fileId)).get()!.deletedAt).toBeNull();
    expect((await adult.client.post(`/api/videos/jobs/${locked.jobId}/cancel`, {})).status).toBe(404);
  });

  test("a locked clip's poster cannot be set as a media item's artwork, and an unlocked one can be read by the same call path", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const tree = buildMediaTree();
    const added = await owner.post("/api/media/sources", { label: "music", path: tree.music, kinds: ["track"] });
    await scanRoot(((await added.json()) as { source: { id: string } }).source.id, { prober: null, pruneGraceMs: 0 });
    const me = db.select().from(people).where(eq(people.role, "owner")).get() as unknown as PersonRow;
    const track = db.select().from(mediaItems).where(eq(mediaItems.kind, "track")).all()[0]!;
    const locked = await adultClip(owner, me);
    expect(editMediaItem(me, "audio", { id: track.id, artwork: locked.posterId })).toEqual({ ok: false, status: 400, error: "That picture is not available." });
  });

  test("a style the adapter list does not know is treated as adult-only at job start (the lock fails closed)", async () => {
    const { adult, row } = await household();
    const me = row("Marlow");
    fake.pollsToFinish = 1000;
    const job = await startVideoJob({ actor: me, conversationId: null, turnId: null, temporary: false, kind: "generate", prompt: ADULT_PROMPT, body: { prompt: ADULT_PROMPT, loras: [{ id: "no-such-style", strength: 1 }] } as never });
    expect(job.request.adultOnly).toBe(true);
    const card = await adult.client.get(`/api/videos/jobs/${job.id}`);
    expect(await card.json()).toEqual({ locked: true, making: true });
  });
});

describe("the unlock guess counter", () => {
  test("parallel wrong guesses cannot all pass the lockout check: one at a time, and the counter and lockout follow", async () => {
    const { adult, row } = await household();
    const me = row("Marlow");
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => adult.client.post("/api/adult-lock/unlock", { secret: `99${i}`, visit: "v" })));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 401).length).toBeLessThanOrEqual(LOCKOUT_THRESHOLD);
    expect(statuses.every((s) => s === 401 || s === 429)).toBe(true);
    expect(currentLockout(me.id, "adult_unlock")?.failedAttempts ?? 0).toBeLessThanOrEqual(LOCKOUT_THRESHOLD);
  });

  test("a wrong code on /confirm is counted like one on /unlock", async () => {
    const { adult } = await household();
    const before = adultLockCounters().wrong;
    const res = await adult.client.post("/api/adult-lock/confirm", { secret: "9999", action: "unmark", item: "file-abc123" });
    expect(res.status).toBe(401);
    expect(adultLockCounters().wrong).toBe(before + 1);
    expect(PASSCODE).toBe("0000");
  });
});

describe("other readers of the clip", () => {
  test("notifications, the companion list and the media home name nothing of a locked clip", async () => {
    const { adult, row } = await household();
    await adultClip(adult.client, row("Marlow"));
    for (const path of ["/api/notifications", "/api/notifications/history", "/api/media/home", "/api/companions"]) {
      const res = await adult.client.get(path);
      const text = await textOf(res);
      for (const w of ADULT_STRINGS) expect({ path, leaked: text.includes(w) }).toEqual({ path, leaked: false });
    }
  });
});
