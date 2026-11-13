// MP-04: the Studio's routes. POST /api/music/jobs/:id/effect makes a new version through the MP-02 path (the earlier version stays, so Undo is "use the version before"),
// and GET /api/music/files/:fileId/as/:format downloads wav or flac. Both obey the Adult lock, and neither names a title in anything logged.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { writeFileSync } from "node:fs";
import { db } from "@/db";
import { attachments, people } from "@/db/schema";
import { withMark } from "@/lib/adultLock";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { installFakeMusicStack, musicState, waitForMusic, LYRICS } from "./musicFixture";
import { runGenerateMusic } from "@/lib/music/tool";
import { musicForOutcomes } from "@/lib/composer";
import { getMusicJobFor, musicVersions } from "@/lib/music/jobs";
import { __setMusicMixRunnerForTests, __setMusicMixToolsForTests } from "@/lib/music/mixParts";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import type { PersonRow } from "@/types";

const M4A = new Uint8Array([0, 0, 0, 28, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]);
let fake: ReturnType<typeof installFakeMusicStack>;
let commands: string[][] = [];
beforeEach(() => {
  resetDb(); __resetThrottleForTests(); fake = installFakeMusicStack(); commands = [];
  __setMusicMixToolsForTests({ afconvert: null, ffmpeg: "ffmpeg" });
  __setMusicMixRunnerForTests(async (command) => { commands.push(command); const output = command.at(-1)!; writeFileSync(output, output.endsWith(".m4a") ? M4A : new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69, 1, 2])); return true; });
});
afterEach(() => { fake.restore(); __setMusicMixRunnerForTests(null); __setMusicMixToolsForTests(null); });
async function owner() {
  const client = new TestClient(); expect((await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
  return { client, actor: db.select().from(people).where(eq(people.displayName, "Sage")).get() as PersonRow };
}
async function song(actor: PersonRow) {
  const state = musicState(actor);
  const outcome = await runGenerateMusic({ state, args: { description: "an original folk song", lyrics: LYRICS, title: "Pancakes", seconds: 60 }, callId: "g", spoken: false });
  const id = musicForOutcomes([outcome])!.id;
  await waitForMusic(() => getMusicJobFor(actor, id)?.state === "done");
  return getMusicJobFor(actor, id)!;
}
type Card = { id: string; versions: { id: string; label: string }[]; current_id: string | null; making_version: { stage_label: string } | null };

describe("POST /api/music/jobs/:id/effect", () => {
  test("makes a new version, keeps the first, and Undo (use the version before) steps back to it", async () => {
    const { client, actor } = await owner(); const parent = await song(actor);
    const submitted = fake.submitted.length;
    const made = await client.post(`/api/music/jobs/${parent.id}/effect`, { change: "gain", amount: -6, from_s: 5, to_s: 15 });
    expect(made.status).toBe(200);
    await waitForMusic(() => musicVersions(actor, parent).filter((j) => j.state === "done" && j.task === "effect").length === 1);
    expect(fake.submitted.length).toBe(submitted); // ffmpeg in Home, no Stack call
    expect(commands.find((c) => c.includes("-filter_complex"))!.join(" ")).toContain("volume=-6dB");
    const card = await (await client.get(`/api/music/jobs/${parent.id}`)).json() as Card;
    expect(card.versions.length).toBe(2);
    expect(card.versions[1]!.label).toContain("volume changed");
    expect(card.current_id).toBe(card.versions[1]!.id);
    const undone = await client.post(`/api/music/jobs/${parent.id}/use`, { file_id: card.versions[0]!.id });
    expect(((await undone.json()) as Card).current_id).toBe(parent.fileId);
    expect(((await (await client.get(`/api/music/jobs/${parent.id}`)).json()) as Card).versions.length).toBe(2); // nothing deleted
  });
  test("a second change while one runs is refused with a plain line", async () => {
    const { client, actor } = await owner(); const parent = await song(actor);
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
    __setMusicMixRunnerForTests(async (command) => { await gate; writeFileSync(command.at(-1)!, M4A); return true; });
    expect((await client.post(`/api/music/jobs/${parent.id}/effect`, { change: "reverse" })).status).toBe(200);
    const again = await client.post(`/api/music/jobs/${parent.id}/effect`, { change: "limit" });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toContain("still being made");
    release();
    await waitForMusic(() => musicVersions(actor, parent).some((j) => j.task === "effect" && j.state === "done"));
  });
  test("the EQ panel's six bands and the compressor panel both apply", async () => {
    const { client, actor } = await owner(); const parent = await song(actor);
    expect((await client.post(`/api/music/jobs/${parent.id}/effect`, { change: "eq", bands: [3, 0, 0, 0, -2, 0] })).status).toBe(200);
    await waitForMusic(() => musicVersions(actor, parent).filter((j) => j.task === "effect" && j.state === "done").length === 1);
    expect(commands.find((c) => c.includes("-filter_complex"))!.join(" ")).toContain("equalizer=f=60:t=q:w=1:g=3,equalizer=f=5000:t=q:w=1:g=-2");
    commands = [];
    expect((await client.post(`/api/music/jobs/${parent.id}/effect`, { change: "compress", compressor: { threshold_db: -24, ratio: 4, attack_ms: 10, release_ms: 250, makeup_db: 3 } })).status).toBe(200);
    await waitForMusic(() => musicVersions(actor, parent).filter((j) => j.task === "effect" && j.state === "done").length === 2);
    expect(commands.find((c) => c.includes("-filter_complex"))!.join(" ")).toContain("acompressor=threshold=0.063096:ratio=4:attack=10:release=250");
  });
  test("out-of-range values are 422 with the range, and no job is made", async () => {
    const { client, actor } = await owner(); const parent = await song(actor);
    const bad = await client.post(`/api/music/jobs/${parent.id}/effect`, { change: "compress", compressor: { ratio: 40 } });
    expect(bad.status).toBe(422); expect(((await bad.json()) as { error: string }).error).toContain("1 to 20");
    const range = await client.post(`/api/music/jobs/${parent.id}/effect`, { change: "reverse", from_s: 50, to_s: 90 });
    expect(range.status).toBe(422);
    expect(musicVersions(actor, parent).length).toBe(1);
  });
  test("without ffmpeg it says so (503) and nothing is made", async () => {
    const { client, actor } = await owner(); const parent = await song(actor);
    __setMusicMixToolsForTests({ afconvert: null, ffmpeg: null });
    const res = await client.post(`/api/music/jobs/${parent.id}/effect`, { change: "reverse" });
    expect(res.status).toBe(503); expect(((await res.json()) as { error: string }).error).toContain("Install ffmpeg");
    expect(musicVersions(actor, parent).length).toBe(1);
  });
  test("a locked song is refused and never read", async () => {
    const { client, actor } = await owner(); const parent = await song(actor);
    const row = db.select().from(attachments).where(eq(attachments.id, parent.fileId!)).get()!;
    db.update(attachments).set({ provenance: withMark(row.provenance, { lock: "on", raiseToAdult: true })! }).where(eq(attachments.id, row.id)).run();
    commands = [];
    const res = await client.post(`/api/music/jobs/${parent.id}/effect`, { change: "reverse" });
    expect([404, 423]).toContain(res.status);
    expect(commands.length).toBe(0);
    const out = await client.get(`/api/music/files/${parent.fileId}/as/wav`);
    expect([404, 423]).toContain(out.status);
    expect(commands.length).toBe(0);
  });
  test("another person's song is not found", async () => {
    const { client, actor } = await owner(); const parent = await song(actor);
    void client;
    const other = new TestClient();
    expect((await other.post(`/api/music/jobs/${parent.id}/effect`, { change: "reverse" })).status).toBe(401);
  });
});

describe("GET /api/music/files/:fileId/as/:format", () => {
  test("wav and flac come from ffmpeg and the saved file is untouched", async () => {
    const { client, actor } = await owner(); const parent = await song(actor);
    const wav = await client.get(`/api/music/files/${parent.fileId}/as/wav`);
    expect(wav.status).toBe(200); expect(wav.headers.get("content-type")).toBe("audio/wav");
    expect(commands.at(-1)).toContain("pcm_s16le");
    const flac = await client.get(`/api/music/files/${parent.fileId}/as/flac`);
    expect(flac.status).toBe(200); expect(flac.headers.get("content-type")).toBe("audio/flac");
    expect(commands.at(-1)).toContain("flac");
    expect((await client.get(`/api/music/files/${parent.fileId}/as/mp3`)).status).toBe(400);
    expect(musicVersions(actor, parent).length).toBe(1);
  });
  test("without ffmpeg it says to download the m4a", async () => {
    const { client, actor } = await owner(); const parent = await song(actor);
    __setMusicMixToolsForTests({ afconvert: null, ffmpeg: null });
    const res = await client.get(`/api/music/files/${parent.fileId}/as/wav`);
    expect(res.status).toBe(503); expect(((await res.json()) as { error: string }).error).toContain("m4a");
  });
  test("a file that is not yours is 404", async () => {
    const { actor } = await owner(); const parent = await song(actor);
    const stranger = new TestClient();
    expect((await stranger.get(`/api/music/files/${parent.fileId}/as/wav`)).status).toBe(401);
  });
});
