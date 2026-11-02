#!/usr/bin/env bun
// MUSIC-DEMO-02: six finished AI-made songs for the owner of the seeded dev household, so the Music app's Create page and Library have
// cards to show. Run by scripts/seed.ts after the hub is up, as its own process pointed at the same dev data directory. It goes through
// the hub's own helpers (conversation, turn, file store, job store), never raw SQL. Audio is the synthesized demo tune (AAC in an m4a
// when ffmpeg is installed, else the WAV bytes), covers are the generated demo covers; two songs have no cover so the app draws one.
// Refuses to run unless the data directory is a dev one (it needs --data-dir and sets MAIPAI_DATA_DIR before the hub code loads).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { coverPng, synthTune, wavWithId3 } from "./seedMusic";

const SONGS = [
  { title: "Neon Rain", style: "dreamy synth pop, slow and warm", hue: 270, cover: true, lines: ["Neon on the window glass", "Rain keeps time with the traffic", "We walk home the long way round", "Every light is turning green"] },
  { title: "Slow Mornings", style: "soft acoustic folk with brushed drums", hue: 40, cover: true, lines: ["Coffee steam and open blinds", "Nowhere that we have to be", "The radio hums along", "Stay a little longer with me"] },
  { title: "Paper Planes", style: "bright indie pop, handclaps", hue: 200, cover: true, lines: ["Fold it once and let it fly", "Over the fence and past the trees", "Whatever you wrote down inside", "The wind will read it for you"] },
  { title: "Golden Hour", style: "warm soul, mellow groove", hue: 25, cover: true, lines: ["Sun is low and the street is gold", "Porch lights flicker on", "Hold this minute a while", "Before the evening is gone"] },
  { title: "Static Bloom", style: "lo-fi beats, vinyl crackle, instrumental feel", hue: 150, cover: false, lines: ["Static blooming in the speakers", "Petals made of tape hiss", "Turn it up and let it grow", "Quiet music for a quiet room"] },
  { title: "Night Bus", style: "late night electronic, steady pulse", hue: 230, cover: false, lines: ["Last bus rolling through the rain", "Windows fogged and half asleep", "Count the stops until the end", "Home is a few blocks away"] },
];
const lrcStamp = (s: number): string => `[${String(Math.floor(s / 60)).padStart(2, "0")}:${(s % 60).toFixed(2).padStart(5, "0")}]`;

function toM4a(wav: Buffer): { bytes: Uint8Array; mediaType: string } {
  const dir = mkdtempSync(join(tmpdir(), "seedsong-"));
  try {
    writeFileSync(join(dir, "in.wav"), wav);
    const run = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", join(dir, "in.wav"), "-c:a", "aac", "-b:a", "96k", "-f", "ipod", join(dir, "out.m4a")]);
    if (run.status === 0) return { bytes: new Uint8Array(readFileSync(join(dir, "out.m4a"))), mediaType: "audio/mp4" };
  } finally { rmSync(dir, { recursive: true, force: true }); }
  // The file route serves only audio/mp4; browsers sniff the real format, so the WAV still plays.
  return { bytes: new Uint8Array(wav), mediaType: "audio/mp4" };
}

const args = process.argv.slice(2);
const at = args.indexOf("--data-dir");
if (at < 0 || !args[at + 1]) { console.error("usage: bun run scripts/seedSongs.ts --data-dir <dev hub dir>"); process.exit(2); }
const dataDir = resolve(args[at + 1]!);
if (!/\/data\/dev\/|\/dev\//.test(`${dataDir}/`) && process.env.MAIPAI_SEED_SONGS_FORCE !== "1") { console.error(`refusing: ${dataDir} does not look like a dev data directory`); process.exit(2); }
process.env.MAIPAI_DATA_DIR = dataDir;

// The backend imports use the "@/" alias, which this folder's tsconfig does not map, so they load by a computed path and stay untyped here.
const load = (path: string): Promise<any> => import(path); // eslint-disable-line @typescript-eslint/no-explicit-any

const { db } = await load("../backend/src/db");
const { people } = await load("../backend/src/db/schema");
const { createAttachment } = await load("../backend/src/lib/attachments");
const { resolveOrCreateConversation, logTurn } = await load("../backend/src/lib/conversationHistory");
const { newConversationTurnId, newMusicJobId } = await load("../backend/src/lib/id");
const { saveMusicJob, jobsForPerson } = await load("../backend/src/lib/music/store");
const { MUSIC_NOTE } = await load("../backend/src/lib/music/types");
const { modelStampFor } = await load("../backend/src/lib/music/models");

const sage = db.select().from(people).all().find((person: { role: string }) => person.role === "owner");
if (!sage) throw new Error("no owner in the dev household to own the songs");
if (jobsForPerson(sage, 40).some((job: { state: string; task: string; request: { title: string } }) => job.state === "done" && job.task === "text2music" && SONGS.some((s) => s.title === job.request.title))) { console.log("demo songs already present"); process.exit(0); }

let index = 0;
for (const song of SONGS) {
  const seconds = 24;
  const conversation = resolveOrCreateConversation(sage, "chat", undefined, {});
  if (!conversation.ok) throw new Error("could not start a conversation for the demo songs");
  const conversationId = conversation.value.id;
  const turnId = newConversationTurnId();
  logTurn(sage, "chat", `Make a song: ${song.title}`, { reply: { text: "Here is your song." }, source: "plugin", plugin_id: "generate_music", routing: { tier: "tool", score: 1 }, safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() }, conversation_id: conversationId, turn_id: turnId });
  const jobId = newMusicJobId();
  const audio = toM4a(wavWithId3(synthTune(`${song.title}-ai`, seconds), Buffer.alloc(0)));
  const provenance = { kind: "music" as const, job_id: jobId, task: "text2music" as const, ...modelStampFor("text2music", "ace-step-1-5-turbo", null), seed: 1000 + index, duration_s: seconds, bpm: 90 + index * 6, key: null, parent_file_id: null, source_kind: "none" as const, made_at: new Date(Date.now() - (6 - index) * 3_600_000).toISOString() };
  const made = createAttachment(sage, { conversationId, turnId, mediaType: audio.mediaType, bytes: audio.bytes, provenance: MUSIC_NOTE + JSON.stringify(provenance), deduplicate: false, retention: "conversation" });
  if (!made.ok) throw new Error(`saving ${song.title} failed: ${made.error}`);
  let coverFileId: string | null = null;
  if (song.cover) {
    const png = coverPng(song.hue, `${song.title}-cover`);
    const cover = createAttachment(sage, { conversationId, turnId, mediaType: "image/png", bytes: new Uint8Array(png), provenance: `picture-gen:${JSON.stringify({ v: 1, audience: "all-ages", job: `cover-${jobId}`, index: 0, width: 480, height: 480 })}`, deduplicate: false, retention: "conversation" });
    if (!cover.ok) throw new Error(`saving the cover of ${song.title} failed: ${cover.error}`);
    coverFileId = cover.value.id;
  }
  const lyrics = song.lines.map((line, i) => (i === 0 ? "[Verse]\n" : i === 2 ? "[Chorus]\n" : "") + line).join("\n");
  const created = new Date(provenance.made_at).toISOString();
  saveMusicJob({
    id: jobId, personId: sage.id, conversationId, turnId, companionId: null, task: "text2music",
    request: { description: song.style, lyrics, title: song.title, instrumental: false, seconds, length: "quick", quality: "quick", bpm: provenance.bpm },
    stackJob: null, state: "done", stage: "ready", progress: 1, etaSeconds: 0, position: null, errorCode: null, errorLine: null,
    fileId: made.value.id, parentFileId: null, coverJobId: null, coverFileId, seed: provenance.seed, durationS: seconds,
    lrc: song.lines.map((line, i) => `${lrcStamp(2 + i * 5)} ${line}`).join("\n") + "\n", chosenAt: null, createdAt: created, updatedAt: created, temporary: false,
  });
  if (index === 0) {
    // The first song also has a finished split (vocals, drums, bass, other), so the Studio shows its track rows without waiting on the engine.
    const splitId = newMusicJobId();
    const splitTurn = newConversationTurnId();
    logTurn(sage, "chat", "Split into stems", { reply: { text: "Splitting it into stems." }, source: "plugin", plugin_id: "edit_music", routing: { tier: "tool", score: 1 }, safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() }, conversation_id: conversationId, turn_id: splitTurn });
    for (const stem of ["vocals", "drums", "bass", "other"]) {
      const stemJobId = stem === "vocals" ? splitId : newMusicJobId();
      const stemAudio = toM4a(wavWithId3(synthTune(`${song.title}-${stem}`, seconds), Buffer.alloc(0)));
      const stemFile = createAttachment(sage, { conversationId, turnId: splitTurn, mediaType: stemAudio.mediaType, bytes: stemAudio.bytes, provenance: MUSIC_NOTE + JSON.stringify({ ...provenance, job_id: stemJobId, task: "stems", parent_file_id: made.value.id }), deduplicate: false, retention: "conversation" });
      if (!stemFile.ok) throw new Error(`saving the ${stem} stem failed: ${stemFile.error}`);
      saveMusicJob({
        id: stemJobId, personId: sage.id, conversationId, turnId: splitTurn, companionId: null, task: "stems",
        request: { description: "", lyrics: null, title: `${song.title} (${stem.replace(/^./, (c) => c.toUpperCase())})`, instrumental: false, seconds, length: "quick", quality: "quick", stemsOf: splitId },
        stackJob: null, state: "done", stage: "ready", progress: 1, etaSeconds: 0, position: null, errorCode: null, errorLine: null,
        fileId: stemFile.value.id, parentFileId: made.value.id, coverJobId: null, coverFileId: null, seed: provenance.seed, durationS: seconds,
        lrc: null, chosenAt: null, createdAt: created, updatedAt: created, temporary: false,
      });
    }
  }
  index++;
}
console.log(`seeded ${index} demo songs`);
