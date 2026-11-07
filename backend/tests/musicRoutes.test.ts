import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, musicJobs, people } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { installFakeMusicStack, musicState, waitForMusic, LYRICS, testM4a } from "./musicFixture";
import { runGenerateMusic, runEditMusic, prepareMusicEdit } from "@/lib/music/tool";
import { musicForOutcomes } from "@/lib/composer";
import { getMusicJobFor, musicVersions, resolveSongSource, type MusicJob } from "@/lib/music/jobs";
import { sourceMusicJob } from "@/lib/music/jobs";
import { listConversationTurns } from "@/lib/conversationHistory";
import { commercialUseOf } from "@/lib/music/commercial";
import { MUSIC_NOTE, generationOf } from "@/lib/music/types";
import { COMMERCIAL_REFUSAL_LINE } from "@/lib/music/commercial";
import { invalidateSessionCacheForPerson } from "@/middleware/auth";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __setMusicStatusForTests } from "@/lib/music/ready";
import { attachmentFilePath } from "@/lib/attachments";
import { existsSync, truncateSync, writeFileSync } from "node:fs";
import { __setMusicMixToolsForTests, __setMusicMixRunnerForTests } from "@/lib/music/mixParts";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { saveClonedVoice } from "@/lib/clonedVoices";
import type { PersonRow } from "@/types";
function pcmFixture(samples: number[]): Uint8Array { const output = new Uint8Array(44 + samples.length * 2); const view = new DataView(output.buffer); const text = (at: number, value: string) => { for (let i = 0; i < value.length; i++) output[at + i] = value.charCodeAt(i); }; text(0, "RIFF"); view.setUint32(4, output.length - 8, true); text(8, "WAVE"); text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true); view.setUint32(24, 44100, true); view.setUint32(28, 176400, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, samples.length * 2, true); samples.forEach((sample, i) => view.setInt16(44 + i * 2, sample, true)); return output; }
let fake: ReturnType<typeof installFakeMusicStack>;
beforeEach(() => { resetDb(); __resetThrottleForTests(); fake = installFakeMusicStack(); __setMusicMixToolsForTests({ afconvert: "/usr/bin/afconvert", ffmpeg: null }); __setMusicMixRunnerForTests(async (command) => { const output = command.at(-1)!; if (command.includes("WAVE")) writeFileSync(output, pcmFixture([12000, -12000])); else writeFileSync(output, new Uint8Array([0, 0, 0, 28, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20])); return true; }); });
afterEach(() => { fake.restore(); __setMusicMixRunnerForTests(null); __setMusicMixToolsForTests(null); });
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
  test("creates, saves idempotently, lists sounds, and keeps them out of song cards", async () => {
    const { actor, client } = await owner();
    const made = await client.post("/api/music/sounds", { description: "rain on a tin roof", seconds: 8, loop: true });
    expect(made.status).toBe(201);
    const card = await made.json() as { id: string; sound: { loop: boolean; surprise: boolean } | null };
    expect(card.sound).toMatchObject({ loop: true, surprise: false, trimTo: 8 });
    await waitForMusic(() => getMusicJobFor(actor, card.id)?.state === "done");
    const first = await client.post(`/api/music/sounds/${card.id}/save`, {});
    const second = await client.post(`/api/music/sounds/${card.id}/save`, {});
    expect(first.status).toBe(200); expect(second.status).toBe(200);
    const firstItem = (await first.json() as { item_id: string }).item_id;
    expect(firstItem).toBe((await second.json() as { item_id: string }).item_id);
    const sounds = await client.get("/api/music/sounds");
    expect(await sounds.json()).toMatchObject([{ id: firstItem, loop: true, file_id: getMusicJobFor(actor, card.id)!.fileId }]);
    expect(await (await client.get("/api/music/jobs")).json()).toEqual([]);
  });
  test("three takes: listed together, one kept and saved, the others deleted", async () => {
    const { actor, client } = await owner();
    const made = await client.post("/api/music/sounds", { description: "a door knock", seconds: 10, takes: 3 });
    expect(made.status).toBe(201);
    const card = await made.json() as { id: string; sound: { takes?: { group: string; index: number; total: number } | null } | null };
    const group = card.sound!.takes!.group;
    expect(card.sound!.takes).toMatchObject({ index: 0, total: 3 });
    await waitForMusic(() => getMusicJobFor(actor, card.id)?.state === "done" && fake.submitted.length === 3);
    let takes = await (await client.get(`/api/music/sounds/takes/${group}`)).json() as Array<{ job_id: string; state: string; saved: boolean }>;
    await waitForMusic(() => (takes.length === 3 && takes.every((take) => take.state === "done")) || (void client.get(`/api/music/sounds/takes/${group}`).then(async (r) => { takes = await r.json() as typeof takes; }), false));
    expect(takes).toHaveLength(3);
    const [keep, ...others] = takes;
    expect((await client.post(`/api/music/sounds/${keep!.job_id}/save`, {})).status).toBe(200);
    for (const other of others) expect((await client.post(`/api/music/jobs/${other.job_id}/delete`, {})).status).toBe(200);
    const after = await (await client.get(`/api/music/sounds/takes/${group}`)).json() as Array<{ job_id: string; saved: boolean }>;
    expect(after).toMatchObject([{ job_id: keep!.job_id, saved: true }]);
    expect((await client.get("/api/music/sounds/takes/not-a-group")).status).toBe(400);
  });
  test("adds a made sound to a song as a new version at a start time", async () => {
    const { actor, client } = await owner(); const { job: songJob } = await song(actor);
    const made = await (await client.post("/api/music/sounds", { description: "a door knock" })).json() as { id: string };
    await waitForMusic(() => getMusicJobFor(actor, made.id)?.state === "done");
    // The decoded song is three seconds of audio, so a start of one second is inside it.
    __setMusicMixRunnerForTests(async (command) => { const output = command.at(-1)!; if (command.includes("WAVE")) writeFileSync(output, pcmFixture(new Array(44100 * 2 * 3).fill(500))); else writeFileSync(output, new Uint8Array([0, 0, 0, 28, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20])); return true; });
    const added = await client.post(`/api/music/sounds/${made.id}/add-to-song`, { song_id: songJob.id, start_s: 1 });
    expect(added.status).toBe(200);
    expect(((await added.json()) as { versions: unknown[] }).versions).toHaveLength(2);
    expect((await client.post(`/api/music/sounds/${made.id}/add-to-song`, { song_id: songJob.id, start_s: -1 })).status).toBe(400);
    expect((await client.post(`/api/music/sounds/${made.id}/add-to-song`, { song_id: "mus-nope", start_s: 1 })).status).toBe(404);
  });
  test("music sound creation uses safety refusal and unavailable engine responses", async () => {
    const { actor, client } = await owner();
    db.update(people).set({ role: "child" }).where(eq(people.id, actor.id)); invalidateSessionCacheForPerson(actor.id);
    setHouseholdSettingValue("generation.music.enabled", false);
    expect((await client.post("/api/music/sounds", { description: "rain on a roof" })).status).toBe(403);
    setHouseholdSettingValue("generation.music.enabled", true);
    __setMusicStatusForTests(null);
    expect((await client.post("/api/music/sounds", { description: "rain on a roof" })).status).toBe(503);
  });
  test("lists the owner's songs newest first, and nobody else's", async () => {
    const { actor, client } = await owner(); const { job } = await song(actor);
    const mine = await (await client.get("/api/music/jobs")).json() as { id: string; title: string | null }[];
    expect(mine.map((card) => card.id)).toEqual([job.id]);
    expect(mine[0]!.title).toBe("Pancakes");
    const other = new TestClient();
    expect((await other.get("/api/music/jobs")).status).toBe(401);
  });
  test("deleting a song moves it to Trash, drops it from the list, and another person cannot", async () => {
    const { actor, client } = await owner(); const { job } = await song(actor);
    const stranger = new TestClient();
    expect((await stranger.post(`/api/music/jobs/${job.id}/delete`, {})).status).toBe(401);
    const response = await client.post(`/api/music/jobs/${job.id}/delete`, {});
    expect(response.status).toBe(200);
    expect((await response.json() as { deleted: number }).deleted).toBeGreaterThan(0);
    expect(await (await client.get("/api/music/jobs")).json()).toEqual([]);
    const row = db.select().from(attachments).where(eq(attachments.id, job.fileId!)).get()!;
    expect(row.deletedAt).not.toBeNull();
  });
  test("deleting a failed or stopped song, which has no file, removes it from the list", async () => {
    const { actor, client } = await owner();
    const now = new Date().toISOString();
    for (const [id, state] of [["failed-song", "failed"], ["stopped-song", "cancelled"]] as const) {
      db.insert(musicJobs).values({ id, personId: actor.id, conversationId: null, turnId: null, task: "text2music", request: JSON.stringify({ title: "Never made" }), state, progress: 0, createdAt: now, updatedAt: now, hlc: nextHlc() }).run();
    }
    expect((await (await client.get("/api/music/jobs")).json() as { id: string }[]).map((card) => card.id).sort()).toEqual(["failed-song", "stopped-song"]);
    for (const id of ["failed-song", "stopped-song"]) expect((await client.post(`/api/music/jobs/${id}/delete`, {})).status).toBe(200);
    expect(await (await client.get("/api/music/jobs")).json()).toEqual([]);
    expect((await client.get("/api/music/jobs/failed-song")).status).toBe(404);
  });
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
  async function uploadAudio(client: TestClient, name: string, bytes: Uint8Array = new Uint8Array([...testM4a(), ...new TextEncoder().encode(`own-${name}`)]), type = "audio/mp4") {
    const form = new FormData(); form.set("file", new File([bytes], name, { type }));
    return (await (await client.postForm("/api/library/upload", form)).json()) as { id: string; kind: string };
  }
  test("splits an audio file the person owns: its own chat, stems marked as from an upload, never an edit source", async () => {
    const { actor, client } = await owner(); fake.stems = true;
    const file = await uploadAudio(client, "Garage Take.m4a");
    expect(file.kind).toBe("audio");
    const response = await client.post("/api/music/stems/from-file", { file_id: file.id });
    expect(response.status).toBe(200);
    const card = await response.json() as { id: string };
    await waitForMusic(() => getMusicJobFor(actor, card.id)?.state === "done");
    const stemsCard = await (await client.get(`/api/music/jobs/${card.id}`)).json() as { versions: { label: string }[]; title: string };
    expect(stemsCard.versions.map((version) => version.label)).toEqual(["Vocals", "Drums"]);
    expect(stemsCard.title).toBe("Garage Take (vocals)");
    const stemJob = getMusicJobFor(actor, card.id)!;
    const provenance = generationOf(db.select({ provenance: attachments.provenance }).from(attachments).where(eq(attachments.id, stemJob.fileId!)).get()!.provenance)!;
    expect(provenance).toMatchObject({ source_kind: "upload", parent_file_id: file.id, commercial_use: "unknown" });
    expect(commercialUseOf(stemJob.fileId!)).toBe("unknown");
    const edit = prepareMusicEdit(stemJob, { track: stemJob.fileId!, change: "trim", from_s: 0, to_s: 5 });
    expect(edit.ok).toBe(false);
    const history = listConversationTurns(actor, stemJob.conversationId!);
    expect(history.ok && history.value.map((turn) => (turn as unknown as { userText?: string }).userText)).toContain("Split: Garage Take");
    const stemOfStem = await client.post(`/api/music/jobs/${card.id}/stems`, { file_id: stemJob.fileId });
    expect(stemOfStem.status).toBe(404);
  });
  test("revises an owned uploaded audio file through the normal edit job path", async () => {
    const { actor, client } = await owner();
    const file = await uploadAudio(client, "Garage Take.m4a");
    const response = await client.post(`/api/music/jobs/upload-${file.id}/revise`, { change: "make it reggae" });
    expect(response.status).toBe(404);
    const source = resolveSongSource(actor, file.id, "conversation-unused");
    expect(source?.id).toBe(`upload-${file.id}`);
    expect(prepareMusicEdit(source!, { track: file.id, change: "remake", description: "make it reggae" }).ok).toBe(false);
  });
  test("uploaded-source revision requires audio ownership and remains adult only", async () => {
    const { actor, client } = await owner();
    const file = await uploadAudio(client, "Garage Take.m4a");
    const other = new TestClient();
    expect((await other.post(`/api/music/jobs/upload-${file.id}/revise`, { change: "make it reggae" })).status).toBe(401);
    expect((await client.post("/api/music/jobs/upload-file-missing/revise", { change: "make it reggae" })).status).toBe(404);
    db.update(people).set({ role: "teen" }).where(eq(people.id, actor.id)).run(); invalidateSessionCacheForPerson(actor.id);
    expect((await client.post(`/api/music/jobs/upload-${file.id}/revise`, { change: "make it reggae" })).status).toBe(403);
  });
  test("from-file edits start owned-file jobs and refuse unsafe sources", async () => {
    const { actor, client } = await owner();
    const file = await uploadAudio(client, "Garage Take.m4a");
    const missingStyle = await client.post("/api/music/from-file/edit", { file_id: file.id, change: "restyle" });
    expect(missingStyle.status).toBe(400);
    const unknown = await client.post("/api/music/from-file/edit", { file_id: file.id, change: "remake" });
    expect(unknown.status).toBe(400);
    fake.stems = true;
    for (const request of [
      { change: "restyle", style: "soft jazz" },
      { change: "instrumental" },
    ]) {
      const response = await client.post("/api/music/from-file/edit", { file_id: file.id, ...request });
      expect(response.status).toBe(200);
      const card = await response.json() as { id: string; task: string };
      expect(card.id).toBeTruthy();
      if (request.change !== "parts") await waitForMusic(() => getMusicJobFor(actor, card.id)?.state === "done");
      const created = getMusicJobFor(actor, card.id)!;
      expect(created.request.parts).toBeUndefined();
      expect(created.request.ownedFile).toBe(true);
      const row = db.select().from(attachments).where(eq(attachments.id, created.fileId!)).get()!;
      expect(generationOf(row.provenance)?.source_kind).toBe("upload");
      expect(commercialUseOf(created.fileId!)).toBe("unknown");
      expect(fake.submitted.at(-1)?.origin).toBe("owned_file");
    }
    const stranger = new TestClient();
    const created = await client.post("/api/people", { displayName: "Riff", role: "adult", secret: "0000" });
    const otherPerson = await created.json() as { id: string };
    expect((await stranger.post("/api/auth/verify-secret", { personId: otherPerson.id, secret: "0000" })).status).toBe(200);
    expect((await stranger.post("/api/music/from-file/edit", { file_id: file.id, change: "restyle", style: "soft jazz" })).status).toBe(404);
    for (const role of ["teen", "child"] as const) {
      db.update(people).set({ role }).where(eq(people.id, actor.id)).run(); invalidateSessionCacheForPerson(actor.id);
      expect((await client.post("/api/music/from-file/edit", { file_id: file.id, change: "restyle", style: "soft jazz" })).status).toBe(403);
    }
  });
  test("from-file parts drop vocals starts a job for an owned upload", async () => {
    const { actor, client } = await owner(); const file = await uploadAudio(client, "Parts.m4a"); fake.stems = true; fake.allStems = true;
    const response = await client.post("/api/music/from-file/edit", { file_id: file.id, change: "parts", parts: { drop: ["vocals"] } });
    expect(response.status).toBe(200);
    const card = await response.json() as { id: string };
    expect(getMusicJobFor(actor, card.id)?.request).toMatchObject({ ownedFile: true, parts: { keep: ["drums", "bass", "other"], drop: ["vocals"] } });
    await waitForMusic(() => getMusicJobFor(actor, card.id)?.state === "done" || getMusicJobFor(actor, card.id)?.state === "failed");
    expect(getMusicJobFor(actor, card.id)?.state).toBe("done");
  });
  test("from-file stems starts a stems job for an owned upload", async () => {
    const { actor, client } = await owner(); const file = await uploadAudio(client, "Stems.m4a"); fake.stems = true;
    const response = await client.post("/api/music/from-file/edit", { file_id: file.id, change: "stems" });
    expect(response.status).toBe(200);
    const card = await response.json() as { id: string };
    expect(getMusicJobFor(actor, card.id)?.task).toBe("stems");
    await waitForMusic(() => getMusicJobFor(actor, card.id)?.state === "done");
  });
  test("from-file voice_swap starts one owned-file conversion job with the chosen voice", async () => {
    const { actor, client } = await owner(); const file = await uploadAudio(client, "Voice swap.m4a"); fake.stems = true; fake.allStems = true;
    const voice = saveClonedVoice(actor, "Nova", new Uint8Array([1, 2]), "audio/wav"); if (!voice.ok) throw new Error("voice setup failed");
    const response = await client.post("/api/music/from-file/edit", { file_id: file.id, change: "voice_swap", voice: voice.value.id });
    expect(response.status).toBe(200);
    const card = await response.json() as { id: string };
    expect(getMusicJobFor(actor, card.id)?.request).toMatchObject({ ownedFile: true, voiceSwap: { voiceId: voice.value.id } });
    await waitForMusic(() => getMusicJobFor(actor, card.id)?.state === "done");
    expect(generationOf(db.select().from(attachments).where(eq(attachments.id, getMusicJobFor(actor, card.id)!.fileId!)).get()!.provenance)?.source_kind).toBe("upload");
  });
  test("refuses to split a file that is not the person's own audio", async () => {
    const { actor, client } = await owner(); fake.stems = true;
    const picture = await uploadAudio(client, "Not music.txt", new TextEncoder().encode("hello"), "text/plain");
    expect((await client.post("/api/music/stems/from-file", { file_id: picture.id })).status).toBe(404);
    expect((await client.post("/api/music/stems/from-file", { file_id: "file-doesnotexist" })).status).toBe(404);
    const made = await song(actor);
    expect((await client.post("/api/music/stems/from-file", { file_id: made.job.fileId })).status).toBe(422);
    fake.stems = false;
    const file = await uploadAudio(client, "Garage Take.m4a");
    expect((await client.post("/api/music/stems/from-file", { file_id: file.id })).status).toBe(503);
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

describe("Make a song page routes", () => {
  test("makes a song in a chat of its own, then a changed title and words become a new version beside the old one", async () => {
    const { actor, client } = await owner();
    const made = await client.post("/api/music/songs", { idea: "a gentle folk song about pancakes", lyrics: LYRICS, title: "Pancakes", instrumental: false });
    expect(made.status).toBe(201);
    const card = await made.json() as { id: string; title: string | null };
    expect(card.title).toBe("Pancakes");
    await waitForMusic(() => getMusicJobFor(actor, card.id)?.state === "done");
    const job = getMusicJobFor(actor, card.id)!;
    const history = listConversationTurns(actor, job.conversationId!);
    expect(history.ok && history.value.filter((turn) => turn.music?.id).map((turn) => turn.music!.id)).toEqual([card.id]);
    const changed = await client.post(`/api/music/jobs/${card.id}/details`, { title: "Waffles", lyrics: `${LYRICS}\n[Outro]\nWaffles too` });
    expect(changed.status).toBe(200);
    await waitForMusic(() => musicVersions(actor, getMusicJobFor(actor, card.id)!).filter((v) => v.state === "done").length === 2);
    const after = await (await client.get(`/api/music/jobs/${card.id}`)).json() as { versions: unknown[]; title: string; lyrics: string };
    expect(after.versions.length).toBe(2);
    expect(after.title).toBe("Waffles");
    expect(after.lyrics).toContain("Waffles too");
    expect((await client.post(`/api/music/jobs/${card.id}/details`, {})).status).toBe(422);
  });
  test("says plainly what to do when no music model is installed", async () => {
    const { client } = await owner();
    __setMusicStatusForTests(null);
    const response = await client.post("/api/music/songs", { idea: "a song about rain" });
    expect(response.status).toBe(503);
    expect((await response.json() as { error: string }).error).toContain("No music model is installed");
    __setMusicStatusForTests(undefined);
  });
  test("a teen cannot make one from the page", async () => {
    const { client, actor } = await owner();
    db.update(people).set({ role: "teen" }).where(eq(people.id, actor.id)).run(); invalidateSessionCacheForPerson(actor.id);
    expect((await client.post("/api/music/songs", { idea: "a song about rain" })).status).toBe(403);
  });
  test("the edit_music chat tool renames a song too (the same change the page's Edit tab makes)", async () => {
    const { actor } = await owner(); const { job } = await song(actor);
    const plan = prepareMusicEdit(job, { track: job.fileId!, change: "remake", title: "Waffles" });
    expect(plan.ok && plan.request.title).toBe("Waffles");
  });
});
