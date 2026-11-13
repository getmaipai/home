import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { setHouseholdSettingValue } from "@/lib/settings";
import { synthesizeSpeech } from "@/lib/tts";
import { __setTtsTagsForTests } from "@/lib/ttsCapabilities";
import { __setRecordedSpeechFetchForTests } from "@/lib/recordedSpeech";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people } from "@/db/schema";
import { clonedVoiceUrl, deleteClonedVoice, saveClonedVoice, whisperSamplePath, whisperVoiceSpeech } from "@/lib/clonedVoices";
import { __setClonedVoiceTranscriberForTests, transcribeClonedVoiceOnce } from "@/lib/clonedVoiceTranscript";
import { clonedVoicesDir } from "@/lib/paths";
import { __resetWhisperSamplesForTests, ensureWhisperSample, hasWhisperSample, WHISPER_SAMPLE_TEXT } from "@/lib/whisperSample";
import { hasWhisperTag, stripWhisperTags } from "@/lib/voiceCues";
import { __resetWhisperTurnsForTests, createWhisperDeltaFilter, isWhisperTurn, markWhisperTurn } from "@/lib/whisperTurns";

const whisperAudio = new Uint8Array(120_000);
whisperAudio.set([82, 73, 70, 70]); // "RIFF"
let ready = true;
let available = true;
let submitted: string[] = [];
let spoken: FormData[] = [];

function owner() {
  const now = new Date().toISOString();
  const row = { id: "person-owner01", displayName: "Owner", nickname: null, birthdate: null, role: "owner", avatarSeed: "seed", source: "manual", localOnly: false, createdAt: now, updatedAt: now, deletedAt: null, hlc: "1700000000000:0:node" };
  db.insert(people).values(row as never).run();
  return row;
}

async function savedVoice(): Promise<string> {
  __setClonedVoiceTranscriberForTests(async () => "exact sample words");
  const saved = saveClonedVoice(owner() as never, "Voice", new Uint8Array([1, 2]), "audio/wav");
  if (!saved.ok) throw new Error("voice setup failed");
  await transcribeClonedVoiceOnce(saved.value.id, new Uint8Array([1, 2]), "audio/wav");
  await new Promise((resolve) => setTimeout(resolve, 20)); // the save's own background attempt settles (the engine is not ready then)
  __resetWhisperSamplesForTests();
  return saved.value.id;
}

describe("whisper tags and turns", () => {
  test("a whisper tag is found and hidden, in each spelling", () => {
    for (const tag of ["[whisper]", "[whispers]", "[Whispering]", "[ whispered ]"]) {
      expect(hasWhisperTag(`${tag} Come closer.`)).toBe(true);
      expect(stripWhisperTags(`${tag} Come closer.`)).toBe("Come closer.");
    }
    expect(stripWhisperTags("Read [whispering](https://example.com) now")).toBe("Read [whispering](https://example.com) now");
    expect(hasWhisperTag("A plain reply [1].")).toBe(false);
  });
  test("a marked turn stays marked, an unmarked one does not", () => {
    __resetWhisperTurnsForTests();
    markWhisperTurn("turn-a");
    expect(isWhisperTurn("turn-a")).toBe(true);
    expect(isWhisperTurn("turn-b")).toBe(false);
    expect(isWhisperTurn(undefined)).toBe(false);
  });
});

describe("whisper sample", () => {
  beforeEach(() => {
    resetDb(); setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8771");
    if (existsSync(clonedVoicesDir)) for (const f of readdirSync(clonedVoicesDir)) rmSync(join(clonedVoicesDir, f), { force: true });
    ready = true; available = true; submitted = []; spoken = [];
    __setTtsTagsForTests([]); __resetWhisperSamplesForTests();
    __setRecordedSpeechFetchForTests((async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/stack/v1/speech-recorded")) return Response.json({ recorded_speech: { available, ready, installed: true } });
      if (url.endsWith("/v1/audio/speech/recorded")) { submitted.push(JSON.parse(String(init?.body)).text); return Response.json({ job: "job-1", data: { url: "/v1/audio/speech/recorded/job-1/file", content_type: "audio/wav" } }); }
      if (url.endsWith("/v1/audio/speech/recorded/job-1/file")) return new Response(whisperAudio, { headers: { "content-type": "audio/wav" } });
      return new Response("no", { status: 404 });
    }) as typeof fetch);
    __setStackClientForTests({ speak: async (form: FormData) => { spoken.push(form); return new Response(new Uint8Array([9]), { headers: { "content-type": "audio/wav" } }); } } as never);
  });
  afterEach(() => { __setRecordedSpeechFetchForTests(null); __setClonedVoiceTranscriberForTests(null); __setTtsTagsForTests(null); __resetStackEngineForTests(); });

  test("makes the sample once, from the voice's own clip, with the whisper cue", async () => {
    ready = false;
    const id = await savedVoice();
    ready = true;
    expect(await ensureWhisperSample(id)).toBe(true);
    expect(hasWhisperSample(id)).toBe(true);
    expect(submitted).toEqual([WHISPER_SAMPLE_TEXT]);
    expect(submitted[0]).toStartWith("[whispers]");
    expect(await ensureWhisperSample(id)).toBe(true);
    expect(submitted).toHaveLength(1);
  });

  test("saving a voice never starts the engine: onlyIfReady is a no-op until it is loaded", async () => {
    ready = false;
    const id = await savedVoice();
    expect(await ensureWhisperSample(id, { onlyIfReady: true })).toBe(false);
    expect(submitted).toHaveLength(0);
    expect(hasWhisperSample(id)).toBe(false);
  });

  test("a whispered reply is spoken from the sample, and a voice without one speaks normally", async () => {
    ready = false;
    const id = await savedVoice();
    const voice = clonedVoiceUrl(id);
    expect(whisperVoiceSpeech(voice)).toBeNull();
    await synthesizeSpeech("Come closer.", voice, { whisper: true });
    expect(String(spoken[0]!.get("voice_url"))).not.toContain("w=1");
    ready = true;
    __resetWhisperSamplesForTests();
    expect(await ensureWhisperSample(id)).toBe(true);
    await synthesizeSpeech("Come closer.", voice, { whisper: true });
    await synthesizeSpeech("Come closer.", voice);
    expect(String(spoken[1]!.get("voice_url"))).toContain("&w=1");
    expect(String(spoken[2]!.get("voice_url"))).not.toContain("w=1");
  });

  test("deleting the voice removes its sample", async () => {
    ready = false;
    const id = await savedVoice();
    ready = true;
    await ensureWhisperSample(id);
    expect(existsSync(whisperSamplePath(id))).toBe(true);
    const result = deleteClonedVoice(owner0() as never, id);
    expect(result.ok).toBe(true);
    expect(existsSync(whisperSamplePath(id))).toBe(false);
  });

  test("a failed attempt is not repeated for a minute", async () => {
    ready = false;
    const id = await savedVoice();
    ready = true; available = false;
    expect(await ensureWhisperSample(id)).toBe(false);
    available = true;
    expect(await ensureWhisperSample(id)).toBe(false);
    expect(submitted).toHaveLength(0);
  });
});

function owner0() {
  return db.select().from(people).get();
}

describe("whisper tag in the streamed reply", () => {
  const run = (chunks: string[]) => {
    let noted = 0;
    const filter = createWhisperDeltaFilter(() => { noted++; });
    const out = chunks.map((c) => filter.feed(c)).join("") + filter.flush();
    return { out, noted };
  };
  test("a whole tag is noted and never streamed", () => {
    expect(run(["[whispering] Come closer."])).toEqual({ out: "Come closer.", noted: 1 });
    expect(run(["Oh! [whispers] Come closer."])).toEqual({ out: "Oh! Come closer.", noted: 1 });
  });
  test("a tag split across chunks is held until it is whole", () => {
    expect(run(["[whi", "spering] Come", " closer."])).toEqual({ out: "Come closer.", noted: 1 });
    expect(run(["Hi [", "whisper", "] there"])).toEqual({ out: "Hi there", noted: 1 });
  });
  test("other brackets and ordinary text pass through, even when held for a moment", () => {
    expect(run(["See [1] and ", "[link](https://example.com)"])).toEqual({ out: "See [1] and [link](https://example.com)", noted: 0 });
    expect(run(["An unfinished [bracket"])).toEqual({ out: "An unfinished [bracket", noted: 0 });
  });
});
