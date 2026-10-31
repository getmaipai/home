import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, people } from "@/db/schema";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { installFakeMusicStack, musicState, waitForMusic, LYRICS, testM4a } from "./musicFixture";
import { runGenerateMusic, runEditMusic } from "@/lib/music/tool";
import { musicForOutcomes } from "@/lib/composer";
import { getMusicJobFor, type MusicJob } from "@/lib/music/jobs";
import { sourceMusicJob } from "@/lib/music/jobs";
import { listConversationTurns } from "@/lib/conversationHistory";
import { MUSIC_NOTE } from "@/lib/music/types";
import { COMMERCIAL_REFUSAL_LINE } from "@/lib/music/commercial";
import { invalidateSessionCacheForPerson } from "@/middleware/auth";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __setMusicStatusForTests } from "@/lib/music/ready";
import { attachmentFilePath } from "@/lib/attachments";
import { existsSync, truncateSync } from "node:fs";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import type { PersonRow } from "@/types";
let fake: ReturnType<typeof installFakeMusicStack>;
beforeEach(() => { resetDb(); __resetThrottleForTests(); fake = installFakeMusicStack(); });
afterEach(() => fake.restore());
async function owner() {
  const client = new TestClient(); expect((await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
  return { client, actor: db.select().from(people).where(eq(people.displayName, "Sage")).get()! };
}
async function song(actor: PersonRow, temporary = false) {
  const state = musicState(actor, temporary);
  const outcome = await runGenerateMusic({ state, args: { description: "an original folk song", lyrics: LYRICS, title: "Pancakes" }, callId: "g", spoken: false });
  const id = musicForOutcomes([outcome])!.id;
  await waitForMusic(() => getMusicJobFor(actor, id)?.state === "done");
  return { state, job: getMusicJobFor(actor, id)! };
}
function entrances(job: MusicJob) {
  return [
    { path: "/api/music/status", method: "GET" }, { path: `/api/music/jobs/${job.id}`, method: "GET" },
    { path: `/api/music/jobs/${job.id}`, method: "DELETE" },
    { path: `/api/music/jobs/${job.id}/files/${job.fileId}`, method: "GET" },
    { path: `/api/music/jobs/${job.id}/use`, method: "POST", body: { file_id: job.fileId } },
    { path: `/api/music/files/${job.fileId}?purpose=commercial`, method: "GET" },
  ];
}
async function makeStems(client: TestClient, source: MusicJob) {
  const response = await client.post(`/api/music/jobs/${source.id}/stems`, { file_id: source.fileId });
  return { response, client };
}
describe("music routes", () => {
  test("splits the shown song and shows its stems as one card that steps through them in order", async () => {
    const { actor, client } = await owner(); const { job } = await song(actor);
    fake.stems = true;
    const { response } = await makeStems(client, job);
    expect(response.status).toBe(200);
    const card = await response.json() as { id: string; task: string };
    expect(card.task).toBe("stems");
    await waitForMusic(() => getMusicJobFor(actor, card.id)?.state === "done");
    const stemsCard = await (await client.get(`/api/music/jobs/${card.id}`)).json() as { versions: { id: string; label: string }[]; title: string };
    expect(stemsCard.versions.map((version) => version.label)).toEqual(["Vocals", "Drums"]);
    // The card opens on the first track, and the split is its own message: the chat lists one music card per turn, so it must not share the song's turn.
    expect((stemsCard as unknown as { current_id: string }).current_id).toBe((stemsCard.versions[0] as unknown as { file_id?: string; id: string }).file_id ?? stemsCard.versions[0]!.id);
    const stemJob = getMusicJobFor(actor, card.id)!;
    expect(stemJob.turnId).not.toBe(job.turnId);
    const history = listConversationTurns(actor, job.conversationId!);
    expect(history.ok && history.value.filter((turn) => turn.music?.id).map((turn) => turn.music!.id)).toEqual([job.id, card.id]);
  });
  test("refuses splitting a stem and reports an unavailable stem engine", async () => {
    const { actor, client } = await owner(); const { job } = await song(actor); fake.stems = true; const { response } = await makeStems(client, job);
    expect(response.status).toBe(200); const stemsCard = await response.json() as { id: string };
    await waitForMusic(() => getMusicJobFor(actor, stemsCard.id)?.state === "done");
    const stemJob = getMusicJobFor(actor, stemsCard.id)!;
    expect((await client.post(`/api/music/jobs/${stemJob.id}/stems`, { file_id: stemJob.fileId })).status).toBe(404);
    fake.stems = false;
    const unavailable = await client.post(`/api/music/jobs/${job.id}/stems`, { file_id: job.fileId });
    expect(unavailable.status).toBe(503);
    expect((await unavailable.json() as { error: string }).error).toContain("Try again");
  });
  test("every route requires authentication, and refuses a child, teen or guest even when they own the song", async () => {
    const { client, actor } = await owner(); const { job } = await song(actor);
    for (const route of entrances(job)) expect((await new TestClient().request(route.path, route)).status).toBe(401);
    for (const role of ["child", "teen", "guest"] as const) {
      db.update(people).set({ role }).where(eq(people.id, actor.id)).run(); invalidateSessionCacheForPerson(actor.id);
      for (const route of entrances(job)) expect((await client.request(route.path, route)).status).toBe(403);
    }
  });
  test("another adult, including an admin, cannot read, stop, select or export the owner's song", async () => {
    const { client, actor } = await owner(); const { job } = await song(actor);
    const created = await client.post("/api/people", { displayName: "Riff", role: "adult", secret: "0000" });
    const person = await created.json() as { id: string }; const other = new TestClient();
    expect((await other.post("/api/auth/verify-secret", { personId: person.id, secret: "0000" })).status).toBe(200);
    for (const role of ["adult", "admin"] as const) {
      db.update(people).set({ role }).where(eq(people.id, person.id)).run(); invalidateSessionCacheForPerson(person.id);
      for (const route of entrances(job).filter((r) => r.path !== "/api/music/status")) expect((await other.request(route.path, route)).status).toBe(404);
    }
  });
  test("the household switch closes making a song, not the owner's own existing songs", async () => {
    const { client, actor } = await owner(); const { job } = await song(actor);
    expect(setHouseholdSettingValue("generation.music.enabled", false).ok).toBe(true);
    expect((await client.get("/api/music/status")).status).toBe(403);
    for (const route of entrances(job).filter((r) => r.path !== "/api/music/status")) expect((await client.request(route.path, route)).status).toBe(200);
    const out = await runGenerateMusic({ state: musicState(actor), args: { description: "an original folk song" }, callId: "g", spoken: false });
    expect(JSON.stringify(out.result)).toContain("household_off");
  });
  test("the owner gets private title and lyrics, versions and Use this version; original files remain seekable", async () => {
    const { client, actor } = await owner(); const { state, job } = await song(actor);
    const outcome = await runEditMusic({ state, args: { track: "latest", change: "remake", bpm: 84 }, callId: "e", spoken: false });
    const id = musicForOutcomes([outcome])!.id; await waitForMusic(() => getMusicJobFor(actor, id)?.state === "done");
    const second = getMusicJobFor(actor, id)!;
    const card = await (await client.get(`/api/music/jobs/${job.id}`)).json() as { description: string; started_at: number; versions: { id: string; label: string; url: string }[]; current_id: string; lyrics: string; title: string; duration_s: number };
    expect(card).toMatchObject({ current_id: second.fileId, title: "Pancakes", description: "an original folk song", lyrics: LYRICS, duration_s: 52, started_at: Date.parse(job.createdAt) });
    expect(card.versions.map((v) => v.label)).toEqual(["Version 1", "Version 2"]);
    const use = await client.post(`/api/music/jobs/${id}/use`, { file_id: job.fileId });
    expect(use.status).toBe(200); expect((await use.json() as { current_id: string }).current_id).toBe(job.fileId!);
    expect(sourceMusicJob(actor, state.conversationId, "latest", false)?.fileId).toBe(job.fileId);
    const file = await client.get(`/api/music/jobs/${id}/files/${job.fileId}`, { Range: "bytes=4-11" });
    expect(file.status).toBe(206); expect(file.headers.get("content-range")).toBe("bytes 4-11/4096");
    expect(Array.from(new Uint8Array(await file.arrayBuffer()))).toEqual(Array.from(testM4a().subarray(4, 12)));
    expect((await client.get(card.versions[1]!.url)).status).toBe(200);
    expect((await client.get(card.versions[0]!.url, { Range: "bytes=5000-" })).status).toBe(416);
    expect((await client.get(card.versions[0]!.url, { Range: "bytes=-8" })).status).toBe(206);
    const unrelated = await song(actor);
    expect((await client.post(`/api/music/jobs/${id}/use`, { file_id: unrelated.job.fileId })).status).toBe(404);
  });
  test("commercial export checks the whole chain while personal download remains available", async () => {
    const { client, actor } = await owner(); const { job } = await song(actor);
    expect((await client.get(`/api/music/files/${job.fileId}?purpose=commercial`)).status).toBe(200);
    const row = db.select().from(attachments).where(eq(attachments.id, job.fileId!)).get()!;
    const note = JSON.parse(row.provenance.slice(MUSIC_NOTE.length)) as Record<string, unknown>;
    for (const commercial_use of ["personal_only", "unknown"]) {
      db.update(attachments).set({ provenance: MUSIC_NOTE + JSON.stringify({ ...note, commercial_use }) }).where(eq(attachments.id, job.fileId!)).run();
      const response = await client.get(`/api/music/files/${job.fileId}?purpose=commercial`);
      expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: COMMERCIAL_REFUSAL_LINE });
      expect((await client.get(`/api/music/files/${job.fileId}`)).status).toBe(200);
    }
  });
  test("a running card carries the stage, progress, ETA and queue position", async () => {
    const { client, actor } = await owner(); fake.pollsToFinish = 1000; fake.queued = true;
    const out = await runGenerateMusic({ state: musicState(actor, true), args: { description: "a folk tune" }, callId: "g", spoken: false });
    const id = musicForOutcomes([out])!.id;
    const queued = await (await client.get(`/api/music/jobs/${id}`)).json() as { stage_label: string; stages: Array<{ id: string; label: string }> };
    expect(queued.stage_label).toBe("You are next.");
    expect(queued.stages).toEqual([
      { id: "queued", label: "Queued" }, { id: "model", label: "Loading" }, { id: "planning", label: "Planning" },
      { id: "making", label: "Making" }, { id: "mixing", label: "Mixing" }, { id: "finishing", label: "Finishing" },
    ]);
    fake.queued = false;
    await waitForMusic(() => getMusicJobFor(actor, id)?.state === "running");
    expect(await (await client.get(`/api/music/jobs/${id}`)).json()).toMatchObject({ state: "running", stage_label: "Planning", progress: 0.25, eta_seconds: 15, position: null });
    await client.request(`/api/music/jobs/${id}`, { method: "DELETE" });
  });
  test("Stop cancels the job and the Stack copy, while a finished job stays done", async () => {
    const { client, actor } = await owner(); const { job } = await song(actor, true);
    expect((await client.request(`/api/music/jobs/${job.id}`, { method: "DELETE" })).status).toBe(200);
    expect(getMusicJobFor(actor, job.id)?.state).toBe("done");
    fake.pollsToFinish = 1000;
    const out = await runGenerateMusic({ state: musicState(actor, true), args: { description: "a jazz tune" }, callId: "g", spoken: false });
    const id = musicForOutcomes([out])!.id;
    const res = await client.request(`/api/music/jobs/${id}`, { method: "DELETE" });
    expect(res.status).toBe(200); expect(getMusicJobFor(actor, id)?.state).toBe("cancelled");
  });
  test("the owner can still stop, read, play and download when the switch is off and the Stack is not ready", async () => {
    const { client, actor } = await owner(); const { job } = await song(actor);
    fake.pollsToFinish = 1000;
    const running = await runGenerateMusic({ state: musicState(actor), args: { description: "a second tune" }, callId: "g", spoken: false });
    const runningId = musicForOutcomes([running])!.id;
    setHouseholdSettingValue("generation.music.enabled", false); __setMusicStatusForTests(null);
    expect((await client.get(`/api/music/jobs/${job.id}`)).status).toBe(200);
    expect((await client.get(`/api/music/jobs/${job.id}/files/${job.fileId}`)).status).toBe(200);
    expect((await client.get(`/api/music/files/${job.fileId}`)).status).toBe(200);
    expect((await client.request(`/api/music/jobs/${runningId}`, { method: "DELETE" })).status).toBe(200);
    expect(getMusicJobFor(actor, runningId)?.state).toBe("cancelled");
    expect((await client.get("/api/music/status")).status).toBe(403);
  });
  test("Range slices come from the file after one integrity check, and a changed file is refused", async () => {
    const { client, actor } = await owner(); const { job } = await song(actor);
    const url = `/api/music/jobs/${job.id}/files/${job.fileId}`;
    const full = new Uint8Array(await (await client.get(url)).arrayBuffer()); expect(full.length).toBe(4096);
    const slice = await client.get(url, { Range: "bytes=100-199" });
    expect(slice.status).toBe(206); expect(new Uint8Array(await slice.arrayBuffer())).toEqual(full.subarray(100, 200));
    const row = db.select().from(attachments).where(eq(attachments.id, job.fileId!)).get()!;
    expect(existsSync(attachmentFilePath(row.storagePath))).toBe(true);
    truncateSync(attachmentFilePath(row.storagePath), 100);
    expect((await client.get(url, { Range: "bytes=0-9" })).status).toBe(404);
  });
});
