import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, people } from "@/db/schema";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { installFakeMusicStack, musicState, waitForMusic, LYRICS } from "./musicFixture";
import { installFakeImageStack, until, testPng } from "./pictureFixture";
import { runGenerateMusic } from "@/lib/music/tool";
import { musicForOutcomes } from "@/lib/composer";
import { getMusicJobFor, musicVersions } from "@/lib/music/jobs";
import { listConversationTurns } from "@/lib/conversationHistory";
import { pictureJobsForTurn, getPictureJob } from "@/lib/pictures/jobs";
import { saveMusicJob } from "@/lib/music/store";
import { musicCardView } from "@/routes/music";
import { coverPromptFor, startSongCover } from "@/lib/music/cover";
import { listVersions, loadSource, saveVersion } from "@/lib/imageEdit";
import { setHouseholdSettingValue } from "@/lib/settings";
import { invalidateSessionCacheForPerson } from "@/middleware/auth";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __setPictureStatusForTests } from "@/lib/pictures/ready";
import type { PersonRow } from "@/types";
let music: ReturnType<typeof installFakeMusicStack>;
let pictures: ReturnType<typeof installFakeImageStack>;
beforeEach(() => { resetDb(); __resetThrottleForTests(); music = installFakeMusicStack(); pictures = installFakeImageStack(); });
afterEach(() => { music.restore(); pictures.restore(); });
async function owner() {
  const client = new TestClient();
  expect((await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
  return { client, actor: db.select().from(people).where(eq(people.displayName, "Sage")).get()! };
}
async function song(actor: PersonRow, temporary = false) {
  const outcome = await runGenerateMusic({ state: musicState(actor, temporary), args: { description: "an original folk song", lyrics: LYRICS, title: "Pancakes" }, callId: "g", spoken: false });
  const id = musicForOutcomes([outcome])!.id;
  await waitForMusic(() => getMusicJobFor(actor, id)?.state === "done");
  return getMusicJobFor(actor, id)!;
}
async function covered(actor: PersonRow, id: string) {
  await until(() => Boolean(getMusicJobFor(actor, id)?.coverFileId));
  return getMusicJobFor(actor, id)!;
}
describe("song covers", () => {
  test("the Quick cover starts while the accepted song is still generating", async () => {
    const { actor } = await owner(); music.pollsToFinish = 1000; pictures.pollsToFinish = 1000;
    const outcome = await runGenerateMusic({ state: musicState(actor), args: { description: "an original folk song", lyrics: LYRICS, title: "Pancakes" }, callId: "g", spoken: false });
    const id = musicForOutcomes([outcome])!.id;
    await until(() => Boolean(getMusicJobFor(actor, id)?.coverJobId));
    expect(getMusicJobFor(actor, id)?.state).not.toBe("done");
    expect(pictures.submitted).toHaveLength(1);
    const coverJob = getPictureJob(actor, getMusicJobFor(actor, id)!.coverJobId!);
    expect(coverJob).toMatchObject({ purpose: "cover" });
    expect(coverJob?.state === "queued" || coverJob?.state === "running").toBe(true);
  });

  test("a finished song starts one Quick cover and its stored image appears on the card", async () => {
    const { actor, client } = await owner(); const job = await song(actor);
    const done = await covered(actor, job.id);
    expect(pictures.submitted).toHaveLength(1);
    expect(pictures.submitted[0]).toMatchObject({ model: "flux2-klein-4b", n: 1 });
    const prompt = String(pictures.submitted[0]!.prompt);
    expect(prompt).toContain("Pancakes"); expect(prompt).toContain("Morning light"); expect(prompt).toContain("Warm and bright"); expect(prompt).not.toContain("[Verse]"); expect(prompt).not.toContain("[Chorus]");
    const card = await (await client.get(`/api/music/jobs/${job.id}`)).json() as { cover_pending: boolean; cover_url: string; cover_versions: { id: string; url: string }[] };
    expect(card.cover_pending).toBe(false);
    expect(card.cover_url).toContain(done.coverFileId!); expect(card.cover_versions).toEqual([{ id: done.coverFileId!, url: card.cover_url }]);
    expect((await client.get(card.cover_url)).status).toBe(200);
  });
  test("cover pending follows the running picture and clears when its file is stored", async () => {
    const { actor } = await owner(); pictures.pollsToFinish = 1000;
    const job = await song(actor);
    await until(() => Boolean(getMusicJobFor(actor, job.id)?.coverJobId));
    await until(() => getPictureJob(actor, getMusicJobFor(actor, job.id)!.coverJobId!)?.state === "running");
    expect((await musicCardView(actor, getMusicJobFor(actor, job.id)!)).cover_pending).toBe(true);
    pictures.pollsToFinish = 0;
    const done = await covered(actor, job.id);
    expect(await musicCardView(actor, done)).toMatchObject({ cover_pending: false, cover_url: expect.stringContaining(done.coverFileId!) });
  });
  test("the startup grace expires and unavailable, private and failed songs never wait", async () => {
    const { actor } = await owner();
    const job = await song(actor, true);
    const persistent = { ...job, temporary: false, conversationId: "conversation", turnId: "turn", coverJobId: null, updatedAt: new Date().toISOString() };
    expect((await musicCardView(actor, persistent)).cover_pending).toBe(true);
    expect((await musicCardView(actor, { ...persistent, updatedAt: new Date(Date.now() - 30_001).toISOString() })).cover_pending).toBe(false);
    for (const state of ["failed", "cancelled"] as const) expect((await musicCardView(actor, { ...persistent, state })).cover_pending).toBe(false);
    expect((await musicCardView(actor, job)).cover_pending).toBe(false);
    expect((await musicCardView(actor, { ...persistent, conversationId: null })).cover_pending).toBe(false);
    __setPictureStatusForTests(null);
    expect((await musicCardView(actor, persistent)).cover_pending).toBe(false);
  });
  test("a cover stays a conversation attachment without a chat picture card", async () => {
    const { actor } = await owner(); const job = await song(actor); const done = await covered(actor, job.id);
    const history = listConversationTurns(actor, job.conversationId!);
    expect(history.ok).toBe(true);
    if (!history.ok) throw new Error("history failed");
    const row = history.value.find((row) => row.id === job.turnId);
    expect(row).toBeDefined();
    expect(row?.picture).toBeUndefined();
    expect(pictureJobsForTurn(actor, job.turnId!)).toEqual([]);
    expect(getPictureJob(actor, done.coverJobId!)).toMatchObject({ purpose: "cover" });
    expect(db.select().from(attachments).where(eq(attachments.id, done.coverFileId!)).get()).toMatchObject({ conversationId: job.conversationId });
  });
  test("a voice imitation request does not withhold the cover", async () => {
    const { actor } = await owner(); setHouseholdSettingValue("generation.adults", false);
    const job = await song(actor); setHouseholdSettingValue("generation.adults", true);
    job.request = { ...job.request, description: "a cover in the original singer's voice" };
    saveMusicJob(job);
    await startSongCover(actor, getMusicJobFor(actor, job.id)!);
    expect(pictures.submitted).toHaveLength(1);
    expect(getMusicJobFor(actor, job.id)?.coverJobId).not.toBeNull();
  });
  test("New cover explains when the song is still being made", async () => {
    const { actor, client } = await owner(); music.pollsToFinish = 1000;
    const outcome = await runGenerateMusic({ state: musicState(actor), args: { description: "folk", lyrics: LYRICS }, callId: "g", spoken: false });
    const response = await client.post(`/api/music/jobs/${musicForOutcomes([outcome])!.id}/cover`, {});
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "The song is still being made. Try New cover when it is ready." });
  });
  test("New cover explains when a cover is already being made", async () => {
    const { actor, client } = await owner(); pictures.pollsToFinish = 1000;
    const job = await song(actor); await until(() => Boolean(getMusicJobFor(actor, job.id)?.coverJobId));
    const response = await client.post(`/api/music/jobs/${job.id}/cover`, {});
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "A cover is already being made. It will show in a moment." });
    expect(pictures.submitted).toHaveLength(1);
  });
  test("New cover changes the seed, keeps the version chain and includes editor versions", async () => {
    const { actor, client } = await owner(); const job = await song(actor); const first = await covered(actor, job.id);
    const edited = await saveVersion(actor, loadSource(actor, first.conversationId!, first.coverFileId!, true), await testPng(), { op: "comment", label: "Blue sky" });
    expect((await client.post(`/api/music/jobs/${job.id}/cover`, { prompt: "A violet mountain at dusk" })).status).toBe(200);
    await until(() => getMusicJobFor(actor, job.id)?.coverFileId !== first.coverFileId);
    expect(pictures.submitted).toHaveLength(2); expect(pictures.submitted[1]!.seed).not.toBe(pictures.submitted[0]!.seed);
    expect(pictures.submitted[1]!.prompt).toContain("A violet mountain at dusk");
    const done = getMusicJobFor(actor, job.id)!;
    expect(listVersions(actor, done.conversationId!, done.coverFileId!).map((v) => v.id)).toEqual([first.coverFileId!, edited.id, done.coverFileId!]);
    const card = await (await client.get(`/api/music/jobs/${job.id}`)).json() as { cover_url: string; cover_versions: { id: string }[] };
    expect(card.cover_versions).toHaveLength(3); expect(card.cover_url).toContain(done.coverFileId!);
    for (const role of ["teen", "child"] as const) {
      db.update(people).set({ role }).where(eq(people.id, actor.id)).run(); invalidateSessionCacheForPerson(actor.id);
      expect((await client.post(`/api/music/jobs/${job.id}/cover`, {})).status).toBe(403);
    }
    expect(pictures.submitted).toHaveLength(2);
  });
  test("prompted song edits reuse the music job and keep the original version, title and lyrics", async () => {
    const { actor, client } = await owner(); const original = await song(actor);
    const response = await client.post(`/api/music/jobs/${original.id}/revise`, { change: "make it heavy metal" });
    expect(response.status).toBe(200);
    await until(() => music.submitted.length === 2);
    await waitForMusic(() => musicVersions(actor, getMusicJobFor(actor, original.id)!).some((version) => version.parentFileId === original.fileId && version.task === "remake" && version.state === "done"));
    const revised = musicVersions(actor, getMusicJobFor(actor, original.id)!)
      .find((version) => version.parentFileId === original.fileId && version.task === "remake");
    expect(music.submitted[1]).toMatchObject({ task: "text2music", caption: "an original folk song. Change: make it heavy metal", lyrics: LYRICS });
    expect(music.submitted[1]!.caption.length).toBeLessThanOrEqual(1200);
    expect(revised?.request).toMatchObject({ description: music.submitted[1]!.caption, lyrics: LYRICS, title: "Pancakes" });
    const responseCard = await (await client.get(`/api/music/jobs/${original.id}`)).json() as { versions: { id: string }[]; title: string; lyrics: string };
    expect(responseCard.versions).toHaveLength(2);
    expect(responseCard.versions.map((version) => version.id)).toContain(original.fileId!);
    expect(responseCard.title).toBe("Pancakes"); expect(responseCard.lyrics).toContain("Morning light");
  });
  test("pictures off, unavailable, refused prompts and temporary songs leave a successful song alone", async () => {
    const { actor } = await owner();
    setHouseholdSettingValue("generation.adults", false);
    const off = await song(actor); expect(off.coverJobId).toBeNull();
    setHouseholdSettingValue("generation.adults", true);
    const temporary = await song(actor, true); expect(temporary.coverJobId).toBeNull();
    __setPictureStatusForTests(null);
    const unavailable = await song(actor); expect(unavailable.coverJobId).toBeNull();
    pictures.restore(); pictures = installFakeImageStack();
    await startSongCover(actor, { ...off, request: { ...off.request, title: "sexual picture of a child" } });
    expect(pictures.submitted).toHaveLength(0);
    for (const job of [off, temporary, unavailable]) expect(getMusicJobFor(actor, job.id)).toMatchObject({ state: "done", errorLine: null, errorCode: null, coverFileId: null });
  });
  test("a failed picture never fails the song", async () => {
    const { actor } = await owner(); pictures.failWith = { code: "failed", error: "failed" };
    const job = await song(actor); await until(() => pictures.jobs[0]?.state === "failed");
    expect(getMusicJobFor(actor, job.id)).toMatchObject({ state: "done", errorLine: null, errorCode: null, coverFileId: null });
  });
  test("the prompt omits missing parts and keeps the no-text instruction within 600 characters", () => {
    expect(coverPromptFor({ description: "", instrumental: true, seconds: 30 })).toBe("Album cover art for a song. No text, no letters.");
    const prompt = coverPromptFor({ title: "x".repeat(700), description: "folk", lyrics: LYRICS, instrumental: false, seconds: 30 });
    expect(prompt.length).toBeLessThanOrEqual(600); expect(prompt.endsWith("No text, no letters.")).toBe(true);
  });
});
