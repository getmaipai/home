// MP-06: a song made in Music is the music bed of a video or film. One resolution (checkTrack) serves the chat mix and the film tool:
// "latest" means the newest finished song, a locked or unfinished song is refused with its own plain line, a film takes the song as its music.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "@/db";
import { attachments, mediaSources, musicJobs, people } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { __resetAdultLockForTests } from "@/lib/adultLock";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { installFakeMusicStack, musicState, waitForMusic, LYRICS } from "./musicFixture";
import { runGenerateMusic } from "@/lib/music/tool";
import { musicForOutcomes } from "@/lib/composer";
import { getMusicJobFor } from "@/lib/music/jobs";
import { LOCKED_MUSIC_START_LINE } from "@/lib/music/lock";
import { checkTrack, resolveTrackRef, SONG_NOT_READY_LINE } from "@/lib/videos/editGate";
import { __setStartFilmForTests, runMakeFilm } from "@/lib/films/tool";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import type { PersonRow } from "@/types";

let music: ReturnType<typeof installFakeMusicStack>;
let sage: PersonRow;
beforeEach(async () => {
  resetDb(); __resetAdultLockForTests(); music = installFakeMusicStack(); __setVideoStatusForTests(readyVideoStatusForTests());
  const client = new TestClient();
  const setup = await (await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).json() as { person: { id: string } };
  sage = db.select().from(people).where(eq(people.id, setup.person.id)).get() as PersonRow;
});
afterEach(() => { music.restore(); __setStartFilmForTests(null); __setVideoStatusForTests(undefined); });

async function song(conversationId?: string) {
  const state = musicState(sage, false, conversationId);
  const outcome = await runGenerateMusic({ state, args: { description: "an original folk song", lyrics: LYRICS, title: "Pancakes" }, callId: "g", spoken: false });
  const id = musicForOutcomes([outcome])!.id;
  await waitForMusic(() => getMusicJobFor(sage, id)?.state === "done");
  return { job: getMusicJobFor(sage, id)!, conversationId: state.conversationId! };
}
function addRow(id: string, opts: { locked?: boolean; state?: string }) {
  const fileId = `file-${id}`, now = new Date().toISOString();
  db.insert(mediaSources).values({ id: `src-${id}`, kind: "root", scope: "person", ownerPersonId: sage.id, label: "Music", createdAt: now, hlc: nextHlc(), provenance: "test" }).run();
  db.insert(attachments).values({ id: fileId, ownerPersonId: sage.id, conversationId: null, turnId: null, mediaType: "audio/mpeg", size: 8, sha256: createHash("sha256").update(id).digest("hex"), storagePath: `people/${sage.id}/attachments/${fileId}`, provenance: opts.locked ? `music-gen:{"audience":"adult-only","lock":"on","job":"${id}"}` : `music-gen:{"audience":"all-ages","job":"${id}"}`, createdAt: now, hlc: nextHlc() }).run();
  db.insert(musicJobs).values({ id, personId: sage.id, conversationId: "conv-bed", turnId: `turn-${id}`, task: "text2music", request: JSON.stringify({ title: "T" }), state: opts.state ?? "done", progress: 1, fileId, createdAt: new Date(Date.now() + 60_000).toISOString(), updatedAt: now, hlc: nextHlc() }).run();
  return id;
}

describe("resolving the song a person names", () => {
  test("'latest' and its plain wordings mean the newest finished song of this chat; a job id is used as given", async () => {
    const first = await song();
    const second = await song(first.conversationId);
    for (const words of ["latest", "last", "the song I just made", "That song"]) expect(resolveTrackRef(sage, words, false, first.conversationId)).toBe(second.job.id);
    expect(resolveTrackRef(sage, first.job.id, false, first.conversationId)).toBe(first.job.id);
    expect(resolveTrackRef(sage, "file-abc", false, first.conversationId)).toBe("file-abc");
  });
  test("a finished song of this chat resolves to its audio file by job id and by 'latest'", async () => {
    const made = await song();
    for (const ref of [made.job.id, "latest"]) {
      const checked = checkTrack(sage, ref, false, made.conversationId);
      expect(checked.ok).toBe(true);
      if (checked.ok) expect(checked.found.fileId).toBe(made.job.fileId);
    }
  });
  test("a song someone else made, or one that does not exist, is not found", async () => {
    const made = await song();
    expect(checkTrack(sage, "missing-song", false, made.conversationId)).toMatchObject({ ok: false, why: "no_track" });
  });
});

describe("a song that cannot be used", () => {
  test("a locked song is refused with the lock line, by job id and by file id", () => {
    const id = addRow("job-locked-bed", { locked: true });
    expect(checkTrack(sage, id, false, null)).toEqual({ ok: false, line: LOCKED_MUSIC_START_LINE, why: "locked_track" });
    expect(checkTrack(sage, `file-${id}`, false, null)).toEqual({ ok: false, line: LOCKED_MUSIC_START_LINE, why: "locked_track" });
  });
  test("a song still being made is refused with its own line", () => {
    const id = addRow("job-running-bed", { state: "running" });
    expect(checkTrack(sage, id, false, null)).toEqual({ ok: false, line: SONG_NOT_READY_LINE, why: "track_not_ready" });
  });
});

describe("the film takes a song as its music", () => {
  const state = () => ({ actor: sage, surface: "chat", planBasis: { surfaceClass: "written" }, plan: { surfaceClass: "written" }, context: [], crisis: false, temporary: false, utterance: "make a film" } as never);
  test("a finished song of the person is handed to the film as its music file", async () => {
    const made = await song();
    let got: Record<string, unknown> | undefined;
    __setStartFilmForTests((input) => { got = input as unknown as Record<string, unknown>; return { id: "run-bed" }; });
    const outcome = runMakeFilm({ state: { ...state(), conversationId: made.conversationId }, args: { idea: "A boat crosses a rainy street", track: "latest" }, callId: "c", spoken: false });
    expect(got?.musicFileId).toBe(made.job.fileId);
    expect(outcome.result?.data).toMatchObject({ filmRunId: "run-bed" });
  });
  test("a locked song starts no film and says why", () => {
    const id = addRow("job-locked-film", { locked: true });
    let started = false;
    __setStartFilmForTests(() => { started = true; return { id: "x" }; });
    const outcome = runMakeFilm({ state: state(), args: { idea: "A boat crosses a rainy street", track: id }, callId: "c", spoken: false });
    expect(started).toBe(false);
    expect(outcome.result?.data).toEqual({ refused: "locked_track" });
    expect(outcome.result?.reply?.text).toContain(LOCKED_MUSIC_START_LINE);
  });
});
