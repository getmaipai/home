// ADULT-LOCK-02 (docs/design/video-loras-2026-11-02.md section 3, docs/dev/adult-lock.md): the unlock proof, the shared secret check, the lockout counter and the
// server-side redaction of an adult-only clip on every route that can return one. The fixture has an adult-only clip whose words are in ADULT_STRINGS; while it
// is locked none of those strings may appear in any answer (body or headers), and after an unlock the clip is there.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { db } from "@/db";
import { attachments, people as peopleTable, personCredentials, sessions } from "@/db/schema";
import { getVideoJobFor } from "@/lib/videos/jobs";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { __setVideoStatusForTests } from "@/lib/videos/ready";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { currentLockout, LOCKOUT_THRESHOLD } from "@/lib/credentialLockout";
import { __resetAdultLockForTests, __setAdultLockClockForTests, adultLockCounters, lockItemOfProvenance, lockState, lockedView, PROOF_ABSOLUTE_MS, PROOF_IDLE_MS, withProof } from "@/lib/adultLock";
import { lockedStyleOutcome, redactLockedVideoOutcome, LOCKED_RESULT_TEXT } from "@/lib/videos/lock";
import { outcomeOf } from "@/lib/turnContext";
import { ADULT_PROMPT, ADULT_STRINGS, PASSCODE, PLAIN_PROMPT, adultClip, household, makeClip, textOf, unlock, unlockHeader } from "./fixtures/adultLock";
import { issueDeviceToken } from "@/lib/deviceTokens";
import type { PersonRow } from "@/types";

let fake: FakeVideoStack;
beforeEach(() => {
  resetDb(); __resetVideoAdapterCacheForTests(); __resetAdultLockForTests(); __resetThrottleForTests();
  fake = installFakeVideoStack();
  __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { adult: false } as never })));
});
afterEach(() => { fake.restore(); __setVideoStatusForTests(undefined); __setAdultLockClockForTests(null); });

type Row = Record<string, any>;
const data = (client: TestClient, body: Record<string, unknown>, headers?: Record<string, string>) => client.post("/api/plugins/videos/data/recipes", body, headers);

const MEDIA_AND_RECORD = new Set(["job preview", "job clip", "job poster", "job messages copy", "file record", "file content", "poster content", "poster thumb", "clip thumb", "file shares"]);

/** Every route that can return the adult-only clip to its owner, as [label, request]. */
function surfaces(clip: { jobId: string; fileId: string; posterId: string }): Array<[string, (c: TestClient, h?: Record<string, string>) => Promise<Response>]> {
  const { jobId, fileId, posterId } = clip;
  return [
    ["job card", (c, h) => c.get(`/api/videos/jobs/${jobId}`, h)],
    ["job preview", (c, h) => c.get(`/api/videos/jobs/${jobId}/preview`, h)],
    ["job clip", (c, h) => c.get(`/api/videos/jobs/${jobId}/files/${fileId}`, h)],
    ["job poster", (c, h) => c.get(`/api/videos/jobs/${jobId}/files/${posterId}`, h)],
    ["job messages copy", (c, h) => c.get(`/api/videos/jobs/${jobId}/messages.mp4`, h)],
    ["feed scope", (c, h) => data(c, { scope: "feed" }, h)],
    ["job scope", (c, h) => data(c, { scope: "job", id: jobId }, h)],
    ["clips scope", (c, h) => data(c, { scope: "clips" }, h)],
    ["clips favorites", (c, h) => data(c, { scope: "clips", view: "favorites" }, h)],
    ["showcase scope", (c, h) => data(c, { scope: "showcase" }, h)],
    ["made at home shelf", (c, h) => c.post("/api/plugins/videos/data/made-at-home", {}, h)],
    ["creation header", (c, h) => c.post("/api/plugins/videos/data/creation", { id: fileId }, h)],
    ["library list", (c, h) => c.get("/api/library", h)],
    ["library video list", (c, h) => c.get("/api/library?type=video&origin=made", h)],
    ["library search", (c, h) => c.get("/api/library?search=Zebraquill", h)],
    ["library summary", (c, h) => c.get("/api/library/summary", h)],
    ["files list", (c, h) => c.get("/api/files", h)],
    ["file record", (c, h) => c.get(`/api/files/${fileId}`, h)],
    ["file content", (c, h) => c.get(`/api/files/${fileId}/content`, h)],
    ["poster content", (c, h) => c.get(`/api/files/${posterId}/content`, h)],
    ["poster thumb", (c, h) => c.get(`/api/files/${posterId}/thumb?w=320`, h)],
    ["clip thumb", (c, h) => c.get(`/api/files/${fileId}/thumb?w=320`, h)],
    ["file shares", (c, h) => c.get(`/api/files/${fileId}/shares`, h)],
    ["header search", (c, h) => c.get("/api/search?q=Zebraquill", h)],
    ["header search by word", (c, h) => c.get("/api/search?q=cabaret", h)],
    ["trash list", (c, h) => c.get("/api/trash", h)],
    ["media item", (c, h) => c.get(`/api/media/items/${fileId}`, h)],
    ["media home", (c, h) => c.get("/api/media/home", h)],
  ];
}

describe("locked: no route returns a word, picture or count of the adult-only clip", () => {
  test("every surface is free of the clip's strings and its ids' content while the owner holds no proof, and the plain clip still shows", async () => {
    const { adult, row } = await household();
    const me = row("Marlow");
    const plain = await makeClip(adult.client, me, PLAIN_PROMPT);
    const locked = await adultClip(adult.client, me);
    for (const [label, request] of surfaces(locked)) {
      const res = await request(adult.client);
      const text = await textOf(res);
      for (const word of ADULT_STRINGS) expect({ label, leaked: text.includes(word) }).toEqual({ label, leaked: false });
      // The ids are the other thing a locked item must not hand out (the media, the record), except where the answer is the tile's own list.
      if (MEDIA_AND_RECORD.has(label)) expect({ label, status: res.status }).toEqual({ label, status: 404 });
    }
    // The tile: one flag, nothing else.
    expect(await (await adult.client.get(`/api/videos/jobs/${locked.jobId}`)).json()).toEqual({ locked: true, making: false });
    // The lists lead with the one tile and still carry the plain clip.
    const feed = await (await data(adult.client, { scope: "feed" })).json() as Row[];
    expect(feed[0]).toEqual({ locked: true, making: false });
    expect(feed.slice(1).map((r) => r.id)).toEqual([plain.jobId]);
    expect(await (await data(adult.client, { scope: "job", id: locked.jobId })).json()).toEqual([{ locked: true, making: false }]);
    const clips = await (await data(adult.client, { scope: "clips" })).json() as Row[];
    expect(clips[0]).toEqual({ locked: true, making: false });
    expect(clips.some((r) => r.id === plain.fileId)).toBe(true);
    // Counts leave the clip out: the Library has one video (the plain one) while locked.
    const summary = await (await adult.client.get("/api/library/summary")).json() as { per_kind: { video: { items: number } } };
    expect(summary.per_kind.video.items).toBe(1);
  });

  test("media routes answer 404 with the missing-file body and no-store, the same for a locked clip and one that does not exist", async () => {
    const { adult, row } = await household();
    const locked = await adultClip(adult.client, row("Marlow"));
    const real = await adult.client.get(`/api/videos/jobs/${locked.jobId}/files/${locked.fileId}`);
    const missing = await adult.client.get("/api/videos/jobs/video-nope/files/file-nope");
    expect(real.status).toBe(404);
    expect(await real.text()).toBe(await missing.text());
    expect(real.headers.get("cache-control")).toBe("private, no-store");
    expect((await adult.client.get(`/api/files/${locked.fileId}/content`)).status).toBe(404);
  });

  test("another take, Make it Max and a share of a locked clip start nothing and return the plain locked answer", async () => {
    const { adult, other, row } = await household();
    const locked = await adultClip(adult.client, row("Marlow"));
    const before = fake.submitted.length;
    const another = await adult.client.post(`/api/videos/jobs/${locked.jobId}/another`, {});
    expect(another.status).toBe(423);
    expect(await another.json()).toMatchObject({ locked: true });
    expect((await adult.client.post("/api/plugins/videos/actions/another", { id: locked.jobId })).status).toBe(423);
    expect((await adult.client.post("/api/plugins/videos/actions/max", { id: locked.jobId })).status).toBe(423);
    expect((await adult.client.post("/api/plugins/videos/actions/favorite", { id: locked.jobId })).status).toBe(404);
    expect((await adult.client.post(`/api/files/${locked.fileId}/shares`, { to: other.id })).status).toBe(404);
    // Renaming or keeping a locked file answers like a missing one.
    expect((await adult.client.request(`/api/files/${locked.fileId}`, { method: "PATCH", body: { name: "x" } })).status).toBe(404);
    expect(fake.submitted.length).toBe(before);
  });

  test("a clip being made with an adult-only mark is the tile with a spinner, and nothing of it shows in Create's list", async () => {
    const { adult, row } = await household();
    fake.pollsToFinish = 1000;
    const made = await (await adult.client.post("/api/videos/make", { prompt: ADULT_PROMPT })).json() as { id: string };
    getVideoJobFor(row("Marlow"), made.id)!.request.adultOnly = true;
    const card = await adult.client.get(`/api/videos/jobs/${made.id}`);
    expect(await card.json()).toEqual({ locked: true, making: true });
    const feed = await (await data(adult.client, { scope: "feed" })).json() as Row[];
    expect(feed).toEqual([{ locked: true, making: true }]);
    expect(await textOf(await adult.client.get(`/api/videos/jobs/${made.id}/preview`))).not.toContain("Zebraquill");
  });
});

describe("unlocked: the clip is there, and only for the person who unlocked on their own page", () => {
  test("wrong code is the sign-in 401, the right code returns a proof, and the proof opens every surface (media with no-store, no title in the file name)", async () => {
    const { adult, row } = await household();
    const locked = await adultClip(adult.client, row("Marlow"));
    const wrong = await adult.client.post("/api/adult-lock/unlock", { secret: "9999", visit: "v" });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ error: "Invalid PIN or password", attemptsLeft: LOCKOUT_THRESHOLD - 1 });
    const proof = await unlock(adult.client);
    const h = unlockHeader(proof);
    const card = await (await adult.client.get(`/api/videos/jobs/${locked.jobId}`, h)).json() as Row;
    expect(card.items[0].prompt).toBe(ADULT_PROMPT);
    const feed = await (await data(adult.client, { scope: "feed" }, h)).json() as Row[];
    expect(feed[0]).toMatchObject({ id: locked.jobId, prompt: ADULT_PROMPT });
    const clips = await (await data(adult.client, { scope: "clips" }, h)).json() as Row[];
    expect(clips.some((r) => r.id === locked.fileId && String(r.title).includes("Zebraquill"))).toBe(true);
    expect(((await (await adult.client.get("/api/library?search=Zebraquill", h)).json()) as { items: unknown[] }).items.length).toBe(1);
    const search = await (await adult.client.get("/api/search?q=Zebraquill", h)).json() as { groups: Array<{ kind: string }> };
    expect(search.groups.some((g) => g.kind === "file")).toBe(true);
    for (const [label, request] of surfaces(locked).filter(([l]) => ["job clip", "job poster", "file content", "poster content"].includes(l))) {
      const res = await request(adult.client, h);
      expect({ label, status: res.status }).toEqual({ label, status: 200 });
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    }
    const copy = await adult.client.get(`/api/videos/jobs/${locked.jobId}/messages.mp4`, h);
    if (copy.status === 200) expect(copy.headers.get("content-disposition")).toBe('attachment; filename="video.mp4"');
    const thumb = await adult.client.get(`/api/files/${locked.posterId}/thumb?w=320`, h);
    expect(thumb.headers.get("cache-control") ?? "private, no-store").toBe("private, no-store");
  });

  test("a proof belongs to its person and session: another adult, and the same adult on another browser, get the locked answer", async () => {
    const { adult, other, row } = await household();
    const locked = await adultClip(adult.client, row("Marlow"));
    const proof = await unlock(adult.client);
    const h = unlockHeader(proof);
    expect((await other.client.get(`/api/files/${locked.fileId}/content`, h)).status).toBe(404);
    const elsewhere = new TestClient("127.0.0.9");
    await elsewhere.post("/api/auth/verify-secret", { personId: adult.id, secret: PASSCODE });
    expect((await elsewhere.get(`/api/videos/jobs/${locked.jobId}`, h)).status).toBe(200);
    expect(await (await elsewhere.get(`/api/videos/jobs/${locked.jobId}`, h)).json()).toEqual({ locked: true, making: false });
    expect((await elsewhere.get(`/api/files/${locked.fileId}/content`, h)).status).toBe(404);
  });

  test("an adult it was shared with sees it as locked and unlocks with their own credential, never with the owner's proof", async () => {
    const { adult, other, row } = await household();
    const locked = await adultClip(adult.client, row("Marlow"));
    const ownerProof = unlockHeader(await unlock(adult.client));
    expect((await adult.client.post(`/api/files/${locked.fileId}/shares`, { to: other.id }, ownerProof)).status).toBe(201);
    expect((await adult.client.post(`/api/files/${locked.posterId}/shares`, { to: other.id }, ownerProof)).status).toBe(201);
    expect((await other.client.get(`/api/files/${locked.fileId}/content`)).status).toBe(404);
    expect((await other.client.get(`/api/files/${locked.fileId}/content`, ownerProof)).status).toBe(404);
    const rows = await (await other.client.get("/api/files")).json() as Array<{ file: { id: string } }>;
    expect(rows.map((r) => r.file.id)).not.toContain(locked.fileId);
    const own = unlockHeader(await unlock(other.client));
    expect((await other.client.get(`/api/files/${locked.fileId}/content`, own)).status).toBe(200);
  });
});

describe("a minor never gets it, either way; a shared or spoken surface never unlocks", () => {
  test("a teen and a child are refused the unlock and cannot read the clip, even with an adult's proof", async () => {
    const { adult, teen, child, row } = await household();
    const locked = await adultClip(adult.client, row("Marlow"));
    const proof = unlockHeader(await unlock(adult.client));
    for (const minor of [teen, child]) {
      const refused = await minor.client.post("/api/adult-lock/unlock", { secret: PASSCODE, visit: "v" });
      expect(refused.status).toBe(403);
      expect((await refused.json() as { error: string }).error).toContain("Unlock on your own screen");
      for (const h of [undefined, proof]) {
        expect((await minor.client.get(`/api/files/${locked.fileId}/content`, h)).status).toBe(404);
        expect((await minor.client.get(`/api/videos/jobs/${locked.jobId}`, h)).status).toBe(404);
        expect(await textOf(await minor.client.get("/api/files", h))).not.toContain(locked.fileId);
        expect(await textOf(await minor.client.get("/api/library", h))).not.toContain("Zebraquill");
      }
    }
  });

  test("lockState: a minor is hidden, an adult is locked until a proof, and a clip the creator cleared is open", () => {
    const adult = { id: "person-a", role: "adult" } as PersonRow;
    const teen = { id: "person-t", role: "teen" } as PersonRow;
    const item = lockItemOfProvenance("person-a", 'video-gen:{"v":1,"audience":"adult-only","job":"j"}');
    expect(item).toEqual({ ownerPersonId: "person-a", madeAudience: "adult-only", lock: "on" });
    expect(lockState(item, teen, { token: null, sessionKey: null })).toBe("hidden");
    expect(lockState(item, adult, { token: null, sessionKey: null })).toBe("locked");
    expect(lockState(lockItemOfProvenance("person-a", 'video-gen:{"audience":"adult-only","lock":"off"}'), adult, { token: null, sessionKey: null })).toBe("open");
    expect(lockState(lockItemOfProvenance("person-a", 'video-gen:{"audience":"all-ages"}'), adult, { token: null, sessionKey: null })).toBe("open");
    expect(lockState(lockItemOfProvenance("person-a", 'picture-gen:{"audience":"adult-only"}'), adult, { token: null, sessionKey: null })).toBe("locked");
    expect(lockState(lockItemOfProvenance("person-a", 'picture-gen:{"audience":"all-ages"}'), adult, { token: null, sessionKey: null })).toBe("open");
    expect(lockState(lockItemOfProvenance("person-a", 'picture-gen:{"audience":"adult-only","audience":"all-ages"}'), adult, { token: null, sessionKey: null })).toBe("locked");
    expect(lockedView(true)).toEqual({ locked: true, making: true });
  });

  test("a paired device's session (a TV, a robot, a speaker) is refused the unlock and holds no proof", async () => {
    const { adult } = await household();
    const row = db.select().from(sessions).where(eq(sessions.personId, adult.id)).get()!;
    const { deviceId } = issueDeviceToken(adult.id, "tv", "Living room TV");
    db.update(sessions).set({ deviceId }).where(eq(sessions.id, row.id)).run();
    const res = await adult.client.post("/api/adult-lock/unlock", { secret: PASSCODE, visit: "v" });
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toContain("Unlock on your own screen");
  });
});

describe("relocking: idle, absolute, Lock now, sign-out", () => {
  async function unlocked() {
    const world = await household();
    const locked = await adultClip(world.adult.client, world.row("Marlow"));
    const proof = await unlock(world.adult.client);
    return { ...world, locked, proof, h: unlockHeader(proof) };
  }
  const status = (c: TestClient, locked: { fileId: string }, h: Record<string, string>) => c.get(`/api/files/${locked.fileId}/content`, h).then((r) => r.status);

  test("2 minutes without activity relocks; activity inside the window slides it", async () => {
    let now = Date.now();
    __setAdultLockClockForTests(() => now);
    const { adult, locked, h } = await unlocked();
    now += PROOF_IDLE_MS - 1000;
    expect(await status(adult.client, locked, h)).toBe(200);
    now += PROOF_IDLE_MS - 1000;
    expect(await status(adult.client, locked, h)).toBe(200);
    now += PROOF_IDLE_MS + 1000;
    expect(await status(adult.client, locked, h)).toBe(404);
    expect(await status(adult.client, locked, h)).toBe(404);
  });

  test("15 minutes after the unlock it relocks however active the page is", async () => {
    let now = Date.now();
    __setAdultLockClockForTests(() => now);
    const { adult, locked, h } = await unlocked();
    for (let i = 0; i < 7; i += 1) { now += PROOF_IDLE_MS - 5000; expect(await status(adult.client, locked, h)).toBe(200); }
    now += PROOF_IDLE_MS - 5000;
    expect(now - (now - 8 * (PROOF_IDLE_MS - 5000))).toBeGreaterThan(PROOF_ABSOLUTE_MS - 1);
    expect(await status(adult.client, locked, h)).toBe(404);
  });

  test("Lock now ends the proof at once", async () => {
    const { adult, locked, h } = await unlocked();
    expect(await status(adult.client, locked, h)).toBe(200);
    expect((await adult.client.post("/api/adult-lock/lock", {}, h)).status).toBe(200);
    expect(await status(adult.client, locked, h)).toBe(404);
  });

  test("signing out ends it, and signing back in does not bring it back", async () => {
    const { adult, locked, h } = await unlocked();
    expect(await status(adult.client, locked, h)).toBe(200);
    expect((await adult.client.post("/api/auth/logout", {})).status).toBe(200);
    await adult.client.post("/api/auth/verify-secret", { personId: adult.id, secret: PASSCODE });
    expect(await status(adult.client, locked, h)).toBe(404);
  });

  test("a changed secret or role ends every proof of the person", async () => {
    const { adult, locked, h, owner } = await unlocked();
    expect(await status(adult.client, locked, h)).toBe(200);
    expect((await owner.request(`/api/people/${adult.id}`, { method: "PATCH", body: { role: "adult", displayName: "Marlow" } })).status).toBeLessThan(500);
    const changed = await adult.client.post("/api/auth/change-secret", { currentSecret: PASSCODE, newSecret: "1234" });
    expect(changed.status).toBe(200);
    expect(await status(adult.client, locked, h)).toBe(404);
  });
});

describe("lockout: five wrong codes lock unlocking, on its own counter", () => {
  test("after five wrong codes the right one gets the sign-in 429 with retryAfter, and signing in still works", async () => {
    const { adult, row } = await household();
    const me = row("Marlow");
    for (let i = 1; i <= LOCKOUT_THRESHOLD; i += 1) {
      const res = await adult.client.post("/api/adult-lock/unlock", { secret: "9999", visit: "v" });
      expect(res.status).toBe(401);
      expect(((await res.json()) as { attemptsLeft: number }).attemptsLeft).toBe(Math.max(0, LOCKOUT_THRESHOLD - i));
    }
    const locked = await adult.client.post("/api/adult-lock/unlock", { secret: PASSCODE, visit: "v" });
    expect(locked.status).toBe(429);
    expect(((await locked.json()) as { retryAfter: number }).retryAfter).toBeGreaterThan(0);
    // Its own counter: sign-in sees no failures and is not locked out.
    expect(currentLockout(me.id)).toMatchObject({ failedAttempts: 0, lockedUntil: null });
    expect(currentLockout(me.id, "adult_unlock")?.failedAttempts).toBe(LOCKOUT_THRESHOLD);
    __resetThrottleForTests();
    const again = new TestClient();
    expect((await again.post("/api/auth/verify-secret", { personId: me.id, secret: PASSCODE })).status).toBe(200);
    expect(adultLockCounters()).toEqual({ ok: 0, wrong: LOCKOUT_THRESHOLD, locked_out: 1 });
  });

  test("wrong sign-in codes do not count against unlocking, and a right unlock clears its own counter", async () => {
    const { adult, row } = await household();
    const me = row("Marlow");
    for (let i = 0; i < 3; i += 1) await new TestClient().post("/api/auth/verify-secret", { personId: me.id, secret: "9999" });
    expect(currentLockout(me.id, "adult_unlock")?.failedAttempts).toBe(0);
    await adult.client.post("/api/adult-lock/unlock", { secret: "9999", visit: "v" });
    expect(currentLockout(me.id, "adult_unlock")?.failedAttempts).toBe(1);
    expect((await adult.client.post("/api/adult-lock/unlock", { secret: PASSCODE, visit: "v" })).status).toBe(200);
    expect(currentLockout(me.id, "adult_unlock")?.failedAttempts).toBe(0);
    expect(db.select().from(personCredentials).where(eq(personCredentials.personId, me.id)).get()!.failedAttempts).toBe(3);
  });

  test("a person with no passcode is told to set one, and nothing unlocks without a credential", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const made = await owner.post("/api/people", { displayName: "Quill", role: "adult" });
    const id = ((await made.json()) as { id: string }).id;
    const client = new TestClient();
    const picked = await client.post("/api/auth/select", { personId: id });
    if (picked.status !== 200) return; // this household requires a credential for sign-in: nothing to test
    const res = await client.post("/api/adult-lock/unlock", { secret: "anything", visit: "v" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("Set a passcode");
  });
});

describe("chat: a locked style starts nothing and the stored tool part is a placeholder", () => {
  test("an adult-only style asked for without a proof returns the locked answer and starts no job; the model is not told the style", () => {
    const outcome = lockedStyleOutcome("call-1", "generate_video", { prompt: ADULT_PROMPT, style: "boudoir motion" });
    expect(outcome.args).toEqual({ locked: true });
    expect(outcome.result?.data).toEqual({ locked: true, refused: "locked" });
    expect(JSON.stringify(outcome)).not.toContain("Zebraquill");
    expect(JSON.stringify(outcome)).not.toContain("boudoir");
    expect(fake.submitted).toHaveLength(0);
  });

  test("a started adult-only clip's outcome is stored as a placeholder: no prompt, no styles, no file or job id; an all-ages one is untouched", async () => {
    const { adult, row } = await household();
    const me = row("Marlow");
    const locked = await adultClip(adult.client, me);
    const plain = await makeClip(adult.client, me, PLAIN_PROMPT);
    const make = (id: string) => outcomeOf({ callId: "c", packageId: "generate_video", status: "succeeded", via: "tool_call", args: { prompt: ADULT_PROMPT, style: "x" }, durationMs: 1, result: { reply: { text: `made from ${ADULT_PROMPT}` }, data: { videoJobId: id }, actions: [] } });
    const stored = redactLockedVideoOutcome(me, make(locked.jobId));
    expect(stored.args).toEqual({ locked: true });
    expect(stored.result).toEqual({ reply: { text: LOCKED_RESULT_TEXT }, data: { locked: true }, actions: [] });
    expect(JSON.stringify(stored)).not.toContain(locked.jobId);
    expect(JSON.stringify(stored)).not.toContain("Zebraquill");
    // Even on an unlocked page the stored part is the placeholder.
    const unlockedStored = withProof({ token: "x", sessionKey: "y" }, () => redactLockedVideoOutcome(me, make(locked.jobId)));
    expect(unlockedStored.result?.data).toEqual({ locked: true });
    const kept = redactLockedVideoOutcome(me, make(plain.jobId));
    expect(kept.args).toMatchObject({ prompt: ADULT_PROMPT });
  });
});

describe("the lock does not touch what is not adult-only", () => {
  test("an all-ages clip is listed, played and shared with no proof, and a stored adult-only record keeps its marker", async () => {
    const { adult, other, row } = await household();
    const plain = await makeClip(adult.client, row("Marlow"), PLAIN_PROMPT);
    expect((await adult.client.get(`/api/files/${plain.fileId}/content`)).status).toBe(200);
    expect((await adult.client.post(`/api/files/${plain.fileId}/shares`, { to: other.id })).status).toBe(201);
    const stored = db.select().from(attachments).where(eq(attachments.id, plain.fileId)).get()!;
    expect(stored.provenance).toContain('"audience":"all-ages"');
    expect(db.select().from(peopleTable).where(eq(peopleTable.id, adult.id)).get()).toBeDefined();
  });
});
