// ADULT-LOCK-06 (docs/design/video-loras-2026-11-02.md 3.10 and test 10, docs/dev/adult-lock.md): the auto-mark at job start, the creator's unmark (confirm,
// a fresh passcode, a single-use ticket), the admin's re-mark, the audit row with no content, and the minor ceiling before and after.
import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { db } from "@/db";
import { adultMarkLog, attachments, videoJobs } from "@/db/schema";
import { getVideoJobFor, startVideoJob } from "@/lib/videos/jobs";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { installFakeVideoStack, testJpeg, type FakeVideoStack } from "./videoFixture";
import { __setKeyframesForTests } from "@/lib/pictures/keyframes";
import { __setVideoStatusForTests } from "@/lib/videos/ready";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetAdultLockForTests, lockItemOfProvenance, lockState } from "@/lib/adultLock";
import { __markRowsForTests } from "@/lib/adultMarks";
import { redactLockedVideoOutcome, LOCKED_RESULT_TEXT } from "@/lib/videos/lock";
import { usesAdultOnlyStyle } from "@/lib/videos/adultStyle";
import { outcomeOf } from "@/lib/turnContext";
import { until } from "./pictureFixture";
import { ADULT_PROMPT, ADULT_STRINGS, PASSCODE, PLAIN_PROMPT, household, makeClip, textOf, unlock, unlockHeader } from "./fixtures/adultLock";
import type { PersonRow } from "@/types";

const ADULT_LORA = "lora-2222222222222222";
const NUDE_VERDICT = { people_count: 1, apparent_min_age_estimate: 30, label: "adult", is_nude_or_sexual: true, confidence: 0.9 } as never;
const PLAIN_VERDICT = { people_count: 1, apparent_min_age_estimate: 30, label: "adult", is_nude_or_sexual: false, confidence: 0.9 } as never;

setDefaultTimeout(30_000);
let fake: FakeVideoStack;
beforeEach(() => {
  __setKeyframesForTests(async () => [testJpeg(), testJpeg(), testJpeg()]);
  resetDb(); __resetVideoAdapterCacheForTests(); __resetAdultLockForTests(); __resetThrottleForTests();
  fake = installFakeVideoStack();
  __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: PLAIN_VERDICT })));
});
afterEach(() => { __setKeyframesForTests(null); fake.restore(); __setVideoStatusForTests(undefined); });

type Row = Record<string, any>;
const data = (client: TestClient, body: Record<string, unknown>, headers?: Record<string, string>) => client.post("/api/plugins/videos/data/recipes", body, headers);
const noteOf = (fileId: string) => lockItemOfProvenance("x", db.select().from(attachments).where(eq(attachments.id, fileId)).get()!.provenance);

/** A clip made with the adult-only style (the way chat starts one), started for `actor`; resolves once started, with the job. */
async function startStyled(actor: PersonRow) {
  return startVideoJob({ actor, conversationId: null, turnId: null, temporary: false, kind: "generate", prompt: PLAIN_PROMPT, body: { prompt: PLAIN_PROMPT, audience: "adult", loras: [{ id: ADULT_LORA, strength: 0.9 }], seed: 7 } as never });
}
async function styledClip(actor: PersonRow) {
  const job = await startStyled(actor);
  await until(() => getVideoJobFor(actor, job.id)?.state === "done");
  const done = getVideoJobFor(actor, job.id)!;
  return { jobId: job.id, fileId: done.files[0]!.id, posterId: done.files[0]!.poster_id };
}
const ticketFor = async (client: TestClient, item: string, secret = PASSCODE) => client.post("/api/adult-lock/confirm", { secret, action: "unmark", item });
const mark = (client: TestClient, jobId: string, body: Record<string, unknown>, headers?: Record<string, string>) => client.post(`/api/videos/jobs/${jobId}/adult-mark`, body, headers);

describe("auto-mark at job start", () => {
  test("a clip with an adult-only style is adult-only with the lock on before the Stack is called, and its card is the lock tile from the first poll", async () => {
    const { adult, row } = await household();
    const me = row("Marlow");
    fake.pollsToFinish = 1000;
    const job = await startStyled(me);
    // The flags are on the stored job record the Stack call is made from, not something added when the clip is finished.
    expect(JSON.parse(db.select().from(videoJobs).where(eq(videoJobs.id, job.id)).get()!.request)).toMatchObject({ adultOnly: true, adultLock: "on" });
    expect(job.request).toMatchObject({ adultOnly: true, adultLock: "on" });
    expect(await (await adult.client.get(`/api/videos/jobs/${job.id}`)).json()).toEqual({ locked: true, making: true });
    expect(await (await data(adult.client, { scope: "feed" })).json()).toEqual([{ locked: true, making: true }]);
  });

  test("the finished clip and its poster carry made_audience adult-only and lock on, and the pipeline's auto mark is audited with no content", async () => {
    const { row } = await household();
    const me = row("Marlow");
    const clip = await styledClip(me);
    for (const id of [clip.fileId, clip.posterId]) {
      const stored = db.select().from(attachments).where(eq(attachments.id, id)).get()!;
      expect(stored.provenance).toContain('"made_audience":"adult-only"');
      expect(stored.provenance).toContain('"audience":"adult-only"');
      expect(stored.provenance).toContain('"lock":"on"');
    }
    expect(__markRowsForTests(clip.fileId)).toEqual([{ action: "mark", via: "auto", actorId: me.id }]);
  });

  test("the adult-only style predicate is one function: an all-ages style, no style and an adult-only style", async () => {
    expect(await usesAdultOnlyStyle([])).toBe(false);
    expect(await usesAdultOnlyStyle(["lora-1111111111111111"])).toBe(false);
    expect(await usesAdultOnlyStyle(["lora-1111111111111111", ADULT_LORA])).toBe(true);
    // A style Home can no longer resolve fails closed.
    expect(await usesAdultOnlyStyle(["lora-gone"])).toBe(true);
  });

  test("the prompt word check raises made_audience only (the minor ceiling) and never sets the lock; the finished-clip check's nude verdict sets it", async () => {
    const { adult, row } = await household();
    const me = row("Marlow");
    const worded = await makeClip(adult.client, me, "a woman with no clothes on, charcoal sketch");
    expect(noteOf(worded.fileId)).toMatchObject({ madeAudience: "adult-only", lock: "off" });
    expect(__markRowsForTests(worded.fileId)).toEqual([]);
    // The clip shows in the owner's lists with no unlock: it is not locked.
    const clips = await (await data(adult.client, { scope: "clips" })).json() as Row[];
    expect(clips.some((r) => r.id === worded.fileId)).toBe(true);
    __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: NUDE_VERDICT })));
    const verdict = await makeClip(adult.client, me, PLAIN_PROMPT);
    expect(noteOf(verdict.fileId)).toMatchObject({ madeAudience: "adult-only", lock: "on" });
    expect(__markRowsForTests(verdict.fileId)).toEqual([{ action: "mark", via: "auto", actorId: me.id }]);
  });
});

describe("a job that starts from a cleared source follows it", () => {
  test("a continued clip of a source the creator cleared stays cleared even when the finished-clip check says nude; a plain start with that verdict locks", async () => {
    const { row } = await household();
    const me = row("Marlow");
    __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: NUDE_VERDICT })));
    const job = await startVideoJob({ actor: me, conversationId: null, turnId: null, temporary: false, kind: "generate", prompt: PLAIN_PROMPT, adultOnly: true, adultLock: "off", body: { prompt: PLAIN_PROMPT, audience: "adult", seed: 3 } as never });
    expect(job.request).toMatchObject({ adultOnly: true, adultLock: "off" });
    await until(() => getVideoJobFor(me, job.id)?.state === "done");
    expect(noteOf(getVideoJobFor(me, job.id)!.files[0]!.id)).toMatchObject({ madeAudience: "adult-only", lock: "off" });
    const plain = await startVideoJob({ actor: me, conversationId: null, turnId: null, temporary: false, kind: "generate", prompt: PLAIN_PROMPT, body: { prompt: PLAIN_PROMPT, audience: "adult", seed: 4 } as never });
    await until(() => getVideoJobFor(me, plain.id)?.state === "done");
    expect(noteOf(getVideoJobFor(me, plain.id)!.files[0]!.id)).toMatchObject({ madeAudience: "adult-only", lock: "on" });
  });
});

describe("unmark: the creator, the confirm, a fresh passcode", () => {
  test("a ticket from a fresh passcode clears the lock; the clip then shows with no unlock, the audit row holds no content, and made_audience stays adult-only", async () => {
    const { adult, row } = await household();
    const me = row("Marlow");
    const clip = await styledClip(me);
    const ticket = (await (await ticketFor(adult.client, clip.jobId)).json() as { ticket: string }).ticket;
    const cleared = await mark(adult.client, clip.jobId, { action: "clear", ticket });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({ made_audience: "adult-only", lock: "off" });
    // Open with no proof, in the card, the lists and the media.
    const card = await (await adult.client.get(`/api/videos/jobs/${clip.jobId}`)).json() as { items: Row[] };
    expect(card.items[0]!.state).toBe("done");
    expect(card.items[0]!.adult).toMatchObject({ made_audience: "adult-only", lock: "off", can_clear: false, can_mark: true });
    expect(card.items[0]!.adult.line).toContain("lock removed");
    expect((await adult.client.get(`/api/files/${clip.fileId}/content`)).status).toBe(200);
    const feed = await (await data(adult.client, { scope: "feed" })).json() as Row[];
    expect(feed.some((r) => r.id === clip.jobId)).toBe(true);
    // The minor ceiling is untouched.
    for (const id of [clip.fileId, clip.posterId]) expect(db.select().from(attachments).where(eq(attachments.id, id)).get()!.provenance).toContain('"made_audience":"adult-only"');
    // Audit: who, when, how, the item id; nothing else.
    const rows = db.select().from(adultMarkLog).where(eq(adultMarkLog.itemId, clip.fileId)).all();
    expect(rows.map((r) => [r.action, r.via, r.actorId])).toEqual([["mark", "auto", me.id], ["clear", "creator_passcode", me.id]]);
    const text = JSON.stringify(rows);
    for (const word of [...ADULT_STRINGS, PLAIN_PROMPT, "Boudoir"]) expect(text).not.toContain(word);
    expect(Object.keys(rows[0]!).sort()).toEqual(["action", "actorId", "at", "hlc", "id", "itemId", "provenance", "via"]);
    // The creator sees their own rows in the item's menu.
    expect(card.items[0]!.adult.history.map((h: Row) => h.action)).toEqual(expect.arrayContaining(["clear", "mark"]));
  });

  test("an unlock proof is refused in place of the ticket; a wrong passcode gets no ticket; a ticket is single use and bound to its item", async () => {
    const { adult, row } = await household();
    const me = row("Marlow");
    const clip = await styledClip(me);
    const other = await styledClip(me);
    const proof = await unlock(adult.client);
    // The proof opens the card and shows the action to the creator...
    const open = await (await adult.client.get(`/api/videos/jobs/${clip.jobId}`, unlockHeader(proof))).json() as { items: Row[] };
    expect(open.items[0]!.adult).toMatchObject({ lock: "on", can_clear: true, can_mark: false });
    // ...but it does not clear the lock: no ticket, a made-up ticket and the proof as a ticket all fail.
    expect((await mark(adult.client, clip.jobId, { action: "clear" }, unlockHeader(proof))).status).toBe(403);
    expect((await mark(adult.client, clip.jobId, { action: "clear", ticket: "made-up" }, unlockHeader(proof))).status).toBe(403);
    expect((await mark(adult.client, clip.jobId, { action: "clear", ticket: proof }, unlockHeader(proof))).status).toBe(403);
    expect((await ticketFor(adult.client, clip.jobId, "9999")).status).toBe(401);
    // A ticket for one item does not clear another; a ticket works once.
    const first = (await (await ticketFor(adult.client, clip.jobId)).json() as { ticket: string }).ticket;
    expect((await mark(adult.client, other.jobId, { action: "clear", ticket: first })).status).toBe(403);
    expect(noteOf(other.fileId)).toMatchObject({ lock: "on" });
    const spent = (await (await ticketFor(adult.client, clip.jobId)).json() as { ticket: string }).ticket;
    expect((await mark(adult.client, clip.jobId, { action: "clear", ticket: spent })).status).toBe(200);
    expect((await mark(adult.client, clip.jobId, { action: "clear", ticket: spent })).status).toBe(200); // already clear: nothing to spend
    expect(noteOf(clip.fileId)).toMatchObject({ lock: "off" });
    expect(__markRowsForTests(clip.fileId).filter((r) => r.action === "clear")).toHaveLength(1);
  });

  test("an admin cannot unmark another person's item, and neither can another adult; both get the answer a missing clip gets", async () => {
    const { adult, owner, other, row } = await household();
    const clip = await styledClip(row("Marlow"));
    for (const client of [owner, other.client]) {
      expect((await mark(client, clip.jobId, { action: "clear", ticket: "x" })).status).toBe(404);
      const ticket = await ticketFor(client, clip.jobId, client === owner ? "correcthorse" : PASSCODE);
      expect(ticket.status).toBe(200); // the passcode is theirs; the ticket is for them only
      const t = (await ticket.json() as { ticket: string }).ticket;
      expect((await mark(client, clip.jobId, { action: "clear", ticket: t })).status).toBe(404);
      // A ticket an admin holds is no use on the creator's session either.
      expect((await mark(adult.client, clip.jobId, { action: "clear", ticket: t })).status).toBe(403);
    }
    expect(noteOf(clip.fileId)).toMatchObject({ lock: "on" });
    expect(__markRowsForTests(clip.fileId).filter((r) => r.action === "clear")).toHaveLength(0);
  });

  test("a paired device or a request with no browser session cannot clear, and a minor has nothing to clear", async () => {
    const { adult, teen, row } = await household();
    const clip = await styledClip(row("Marlow"));
    const ticket = (await (await ticketFor(adult.client, clip.jobId)).json() as { ticket: string }).ticket;
    const bare = new TestClient();
    expect((await mark(bare, clip.jobId, { action: "clear", ticket })).status).toBe(401);
    expect((await mark(teen.client, clip.jobId, { action: "clear", ticket })).status).toBe(404);
    expect((await ticketFor(teen.client, clip.jobId)).status).toBe(403);
    expect(noteOf(clip.fileId)).toMatchObject({ lock: "on" });
  });
});

describe("re-mark: no passcode, the creator or an admin", () => {
  test("the creator marks it again with no passcode, it is locked again, and the row says creator", async () => {
    const { adult, row } = await household();
    const clip = await styledClip(row("Marlow"));
    const t = (await (await ticketFor(adult.client, clip.jobId)).json() as { ticket: string }).ticket;
    await mark(adult.client, clip.jobId, { action: "clear", ticket: t });
    const again = await mark(adult.client, clip.jobId, { action: "mark" });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ made_audience: "adult-only", lock: "on" });
    expect(await (await adult.client.get(`/api/videos/jobs/${clip.jobId}`)).json()).toEqual({ locked: true, making: false });
    expect(__markRowsForTests(clip.fileId).map((r) => [r.action, r.via])).toEqual([["mark", "auto"], ["clear", "creator_passcode"], ["mark", "creator"]]);
  });

  test("an admin marks another person's cleared item with no passcode and sees nothing of it; another adult cannot", async () => {
    const { adult, owner, other, row } = await household();
    const clip = await styledClip(row("Marlow"));
    const t = (await (await ticketFor(adult.client, clip.jobId)).json() as { ticket: string }).ticket;
    await mark(adult.client, clip.jobId, { action: "clear", ticket: t });
    expect((await mark(other.client, clip.jobId, { action: "mark" })).status).toBe(404);
    expect(noteOf(clip.fileId)).toMatchObject({ lock: "off" });
    const res = await mark(owner, clip.jobId, { action: "mark" });
    expect(res.status).toBe(200);
    const body = await textOf(res);
    expect(JSON.parse(body.slice(0, body.indexOf("[[")))).toEqual({ made_audience: "adult-only", lock: "on" });
    expect(body).not.toContain("Boudoir");
    expect(noteOf(clip.fileId)).toMatchObject({ lock: "on" });
    expect(__markRowsForTests(clip.fileId).at(-1)).toMatchObject({ action: "mark", via: "admin" });
    // The admin's own view of the clip is still nothing.
    expect((await owner.get(`/api/videos/jobs/${clip.jobId}`)).status).toBe(404);
    expect((await owner.get(`/api/files/${clip.fileId}/content`)).status).toBe(404);
  });

  test("marking an all-ages clip NSFW raises made_audience and locks it", async () => {
    const { adult, row } = await household();
    const plain = await makeClip(adult.client, row("Marlow"), PLAIN_PROMPT);
    const card = await (await adult.client.get(`/api/videos/jobs/${plain.jobId}`)).json() as { items: Row[] };
    expect(card.items[0]!.adult).toMatchObject({ made_audience: "all-ages", can_mark: true, can_clear: false, line: null });
    expect((await mark(adult.client, plain.jobId, { action: "mark" })).status).toBe(200);
    expect(noteOf(plain.fileId)).toMatchObject({ madeAudience: "adult-only", lock: "on" });
    expect(await (await adult.client.get(`/api/videos/jobs/${plain.jobId}`)).json()).toEqual({ locked: true, making: false });
  });
});

describe("a minor never sees it, before or after the unmark", () => {
  test("teen and child get nothing of a clip locked, cleared or marked again; lockState is hidden for them every time", async () => {
    const { adult, teen, child, row } = await household();
    const me = row("Marlow");
    const clip = await styledClip(me);
    const check = async (label: string) => {
      for (const minor of [teen, child]) {
        for (const path of [`/api/videos/jobs/${clip.jobId}`, `/api/files/${clip.fileId}`, `/api/files/${clip.fileId}/content`, `/api/files/${clip.posterId}/content`, "/api/library", "/api/library/summary", "/api/files", "/api/search?q=paper"]) {
          const res = await minor.client.get(path);
          const text = await textOf(res);
          expect({ label, path, leaked: text.includes(clip.fileId) || text.includes(clip.jobId) || text.includes("paper boat") }).toEqual({ label, path, leaked: false });
        }
        expect(JSON.stringify(await (await data(minor.client, { scope: "feed" })).json())).not.toContain(clip.jobId);
      }
      const stored = db.select().from(attachments).where(eq(attachments.id, clip.fileId)).get()!;
      for (const minorId of [teen.id, child.id]) expect({ label, state: lockState(lockItemOfProvenance(me.id, stored.provenance), { id: minorId, role: minorId === teen.id ? "teen" : "child", birthdate: minorId === teen.id ? "2011-03-01" : "2018-03-01" } as PersonRow, { token: null, sessionKey: null }) }).toEqual({ label, state: "hidden" });
    };
    await check("locked");
    const t = (await (await ticketFor(adult.client, clip.jobId)).json() as { ticket: string }).ticket;
    await mark(adult.client, clip.jobId, { action: "clear", ticket: t });
    await check("cleared");
    await mark(adult.client, clip.jobId, { action: "mark" });
    await check("marked again");
  });
});

describe("chat parity: a locked clip is a placeholder, a cleared one is not", () => {
  test("the stored tool part of a locked clip is the placeholder; after the creator clears the lock it is an ordinary result", async () => {
    const { adult, row } = await household();
    const me = row("Marlow");
    const clip = await styledClip(me);
    const make = () => outcomeOf({ callId: "c", packageId: "generate_video", status: "succeeded", via: "tool_call", args: { prompt: PLAIN_PROMPT }, durationMs: 1, result: { reply: { text: "ok" }, data: { videoJobId: clip.jobId }, actions: [] } });
    const locked = redactLockedVideoOutcome(me, make());
    expect(locked.args).toEqual({ locked: true });
    expect(locked.result?.reply?.text).toBe(LOCKED_RESULT_TEXT);
    expect(JSON.stringify(locked)).not.toContain(clip.jobId);
    const t = (await (await ticketFor(adult.client, clip.jobId)).json() as { ticket: string }).ticket;
    await mark(adult.client, clip.jobId, { action: "clear", ticket: t });
    expect(redactLockedVideoOutcome(me, make()).args).toMatchObject({ prompt: PLAIN_PROMPT });
  });
});
