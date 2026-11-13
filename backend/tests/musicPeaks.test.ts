// MP-10: server-side waveform peaks. The computation runs the real ffmpeg when this machine has one; the route tests use a fake decoder so they run anywhere.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db } from "@/db";
import { attachments, people } from "@/db/schema";
import { withMark } from "@/lib/adultLock";
import { dataDir } from "@/lib/paths";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { installFakeMusicStack, musicState, waitForMusic, LYRICS } from "./musicFixture";
import { runGenerateMusic } from "@/lib/music/tool";
import { musicForOutcomes } from "@/lib/composer";
import { getMusicJobFor } from "@/lib/music/jobs";
import { __setMusicMixToolsForTests, musicAudioTools } from "@/lib/music/mixParts";
import { __setPeaksDecoderForTests, bucketPeaks, computePeaks, PEAK_COUNT } from "@/lib/music/peaks";
import type { PersonRow } from "@/types";

function wav(samples: Int16Array, rate = 8000): Uint8Array {
  const data = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  const out = new Uint8Array(44 + data.length); const v = new DataView(out.buffer);
  const tag = (at: number, text: string) => { for (let i = 0; i < 4; i++) out[at + i] = text.charCodeAt(i); };
  tag(0, "RIFF"); v.setUint32(4, 36 + data.length, true); tag(8, "WAVE"); tag(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); tag(36, "data"); v.setUint32(40, data.length, true); out.set(data, 44);
  return out;
}

describe("bucketPeaks", () => {
  test("loudest bucket is 1, values keep three decimals, silence stays zero", () => {
    const got = bucketPeaks(Int16Array.from([0, 100, 0, 200, 0, -400, 0, 0]), 4);
    expect(got).toEqual([0.25, 0.5, 1, 0]);
    expect(bucketPeaks(new Int16Array(1000)).every((v) => v === 0)).toBe(true);
    expect(bucketPeaks(new Int16Array(100000).fill(5)).length).toBe(PEAK_COUNT);
  });
});

describe("computePeaks with the real ffmpeg", () => {
  const ffmpeg = musicAudioTools().ffmpeg;
  const real = ffmpeg ? test : test.skip;
  if (!ffmpeg) console.warn("musicPeaks: no ffmpeg on this machine, the real-ffmpeg test is skipped");
  real("a half-silent, half-sine wav gives silent then loud peaks and its length", async () => {
    const sec = 4, samples = new Int16Array(8000 * sec);
    for (let i = 8000 * 2; i < samples.length; i++) samples[i] = Math.round(Math.sin(i / 8) * 20000);
    const got = await computePeaks(wav(samples));
    expect(got.peaks.length).toBe(PEAK_COUNT);
    expect(got.duration).toBeGreaterThan(3.9); expect(got.duration).toBeLessThan(4.1);
    expect(Math.max(...got.peaks.slice(0, 280))).toBe(0);
    expect(Math.max(...got.peaks.slice(330))).toBe(1);
    expect(got.peaks.every((v) => v >= 0 && v <= 1)).toBe(true);
  });
  real("an m4a with its index at the end (not streamable) is read too", async () => {
    const dir = mkdtempSync(join(tmpdir(), "peaks-test-")); const src = join(dir, "a.wav"), out = join(dir, "a.m4a");
    writeFileSync(src, wav(Int16Array.from({ length: 16000 }, (_, i) => Math.round(Math.sin(i / 8) * 12000))));
    const run = Bun.spawn([ffmpeg!, "-v", "error", "-y", "-i", src, "-c:a", "aac", "-f", "ipod", out], { stdout: "ignore", stderr: "ignore" });
    expect(await run.exited).toBe(0);
    const got = await computePeaks(new Uint8Array(readFileSync(out)));
    expect(Math.max(...got.peaks)).toBe(1); expect(got.duration).toBeGreaterThan(1.9);
    rmSync(dir, { recursive: true, force: true });
  });
  real("an all-silent wav stays all zeros", async () => {
    expect(Math.max(...(await computePeaks(wav(new Int16Array(16000)))).peaks)).toBe(0);
  });
});

describe("GET /api/music/jobs/:id/files/:fileId/peaks", () => {
  let fake: ReturnType<typeof installFakeMusicStack>; let decodes = 0;
  beforeEach(() => {
    resetDb(); fake = installFakeMusicStack(); decodes = 0;
    __setMusicMixToolsForTests({ afconvert: null, ffmpeg: "ffmpeg" });
    __setPeaksDecoderForTests(async () => { decodes++; return Int16Array.from({ length: 16000 }, (_, i) => (i % 100) * 10); });
  });
  afterEach(() => { fake.restore(); __setMusicMixToolsForTests(null); __setPeaksDecoderForTests(null); });
  async function owner() {
    const client = new TestClient(); expect((await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
    const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get() as PersonRow;
    const outcome = await runGenerateMusic({ state: musicState(actor), args: { description: "an original folk song", lyrics: LYRICS, title: "Pancakes", seconds: 60 }, callId: "g", spoken: false });
    const id = musicForOutcomes([outcome])!.id;
    await waitForMusic(() => getMusicJobFor(actor, id)?.state === "done");
    return { client, actor, job: getMusicJobFor(actor, id)! };
  }
  const url = (job: { id: string; fileId: string | null }) => `/api/music/jobs/${job.id}/files/${job.fileId}/peaks`;

  test("the owner gets 600 peaks and the length; a second ask is a cache hit with no decode", async () => {
    const { client, job } = await owner();
    const first = await client.get(url(job)); expect(first.status).toBe(200);
    const body = await first.json() as { peaks: number[]; duration: number };
    expect(body.peaks.length).toBe(PEAK_COUNT); expect(Math.max(...body.peaks)).toBe(1); expect(body.duration).toBe(2);
    expect(decodes).toBe(1);
    expect(readdirSync(join(dataDir, "music-peaks")).length).toBe(1);
    expect((await client.get(url(job))).status).toBe(200);
    expect(decodes).toBe(1);
  });
  test("a changed file (new sha256) is decoded again", async () => {
    const { client, job } = await owner();
    await client.get(url(job));
    db.update(attachments).set({ sha256: "f".repeat(64) }).where(eq(attachments.id, job.fileId!)).run();
    await client.get(url(job));
    expect(decodes).toBe(2);
  });
  test("signed out is 401, someone else's file id is 404", async () => {
    const { client, job } = await owner();
    expect((await new TestClient().get(url(job))).status).toBe(401);
    expect((await client.get(`/api/music/jobs/${job.id}/files/nope/peaks`)).status).toBe(404);
    expect((await client.get(`/api/music/jobs/nope/files/${job.fileId}/peaks`)).status).toBe(404);
  });
  test("a locked (Adult lock) song is hidden and never decoded", async () => {
    const { client, job } = await owner();
    const row = db.select().from(attachments).where(eq(attachments.id, job.fileId!)).get()!;
    db.update(attachments).set({ provenance: withMark(row.provenance, { lock: "on", raiseToAdult: true })! }).where(eq(attachments.id, row.id)).run();
    const res = await client.get(url(job));
    expect(res.status).toBe(404); expect(decodes).toBe(0);
  });
  test("without ffmpeg it says so in plain words (503) so the browser draws it instead", async () => {
    const { client, job } = await owner();
    __setPeaksDecoderForTests(null); __setMusicMixToolsForTests({ afconvert: null, ffmpeg: null });
    const res = await client.get(url(job));
    expect(res.status).toBe(503); expect(((await res.json()) as { error: string }).error).toContain("no audio tool");
  });
});
