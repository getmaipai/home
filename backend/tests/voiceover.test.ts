import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { owner, teen } from "./support/testAuth";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { __setTtsTagsForTests } from "@/lib/ttsCapabilities";
import { __setRecordedSpeechFetchForTests, __setRecordedSpeechReferenceForTests } from "@/lib/recordedSpeech";
import { __setStackClientForTests, __resetStackEngineForTests } from "@/lib/stackEngine";
import { saveClonedVoice } from "@/lib/clonedVoices";
import { tagsForEngine, FISH_DRAMA_TAGS } from "@/lib/recordedTags";
import { plannedRecordedEngine } from "@/lib/tts";
import { makeVoiceover, voicesFor } from "@/lib/voiceover";

const ref = "voice-abcdef";
let ready = true;

beforeEach(() => {
  resetDb(); ready = true;
  __setTtsTagsForTests(["[laugh]", "[gasp]", "[not-known]"]);
  __setRecordedSpeechReferenceForTests((voice) => voice === ref ? { bytes: new Uint8Array([1, 2]), mimeType: "audio/wav", transcript: "sample" } : null);
  __setRecordedSpeechFetchForTests((async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/stack/v1/speech-recorded")) return Response.json({ recorded_speech: { available: ready, ready, installed: ready, models: [{ installed: true, revision: "fish-test" }] } });
    if (url.endsWith("/v1/audio/speech/recorded")) return Response.json({ job: "j", data: { url: "/v1/audio/speech/recorded/j/file", content_type: "audio/wav" } });
    if (url.endsWith("/v1/audio/speech/recorded/j/file")) return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/wav" } });
    return new Response("no", { status: 404 });
  }) as typeof fetch);
  __setStackClientForTests({ speak: async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/wav" } }), voices: async () => [{ id: "preset-default", name: "Default", description: "Preset", language: "en", country: "US", gender: "neutral", source: "preset", engine: "chatterbox-turbo", onDisk: true, licence: null, revision: "r1" }] } as never);
});
afterEach(() => { __setTtsTagsForTests(null); __setRecordedSpeechReferenceForTests(null); __setRecordedSpeechFetchForTests(null); __resetStackEngineForTests(); });

describe("recorded voiceover", () => {
  test("advertises only documented or known advertised tags", async () => {
    expect(await tagsForEngine("chatterbox-turbo")).toEqual(["laugh", "gasp"]);
    expect(await tagsForEngine("fish-audio-drama-3")).toEqual([...FISH_DRAMA_TAGS]);
    expect(FISH_DRAMA_TAGS.every((tag) => !tag.includes("["))).toBe(true);
  });

  test("plans Fish only for a ready transcript-backed clip", async () => {
    expect(await plannedRecordedEngine(ref)).toBe("fish-audio-drama-3");
    ready = false;
    expect(await plannedRecordedEngine(ref)).toBe("chatterbox-turbo");
  });

  test("a minor sees a voice made from a clip like anyone else (AUDIO-PARITY-01 V4); a guest sees presets only", async () => {
    const household = await owner();
    const saved = saveClonedVoice(household.row, "Home voice", new Uint8Array([4, 5]), "audio/wav");
    if (!saved.ok) throw new Error("voice setup failed");
    const teenClient = await teen(household.client);
    const response = await teenClient.get("/api/auth/me");
    const { id } = await response.json() as { id: string };
    const actor = db.query.people.findFirst({ where: (p, { eq }) => eq(p.id, id) })!;
    expect((await voicesFor(actor as never)).some((v) => v.kind === "clip")).toBe(true);
    expect((await voicesFor({ ...(actor as object), role: "guest" } as never)).every((v) => v.kind === "preset")).toBe(true);
  });

  test("stores a private script-free Library audio record", async () => {
    const { row } = await owner();
    const saved = saveClonedVoice(row, "Test voice", new Uint8Array([4, 5]), "audio/wav");
    if (!saved.ok) throw new Error("voice setup failed");
    __setRecordedSpeechReferenceForTests((voice) => voice === saved.value.id ? { bytes: new Uint8Array([1, 2]), mimeType: "audio/wav", transcript: "sample" } : null);
    const result = await makeVoiceover(row, { script: "Secret script", voice: saved.value.id });
    expect(result).toMatchObject({ ok: true, engine: "fish-audio-drama-3", voice: saved.value.id, kind: "clip" });
    if (!result.ok) return;
    const file = db.select().from(attachments).where(eq(attachments.id, result.file_id)).get()!;
    expect(file).toMatchObject({ mediaType: "audio/wav", retention: "kept", name: expect.stringMatching(/^Voiceover /) });
    expect(file.provenance).toContain('"engine":"fish-audio-drama-3"');
    expect(file.provenance).toContain(`"voice":"${saved.value.id}"`);
    expect(file.provenance).toContain('"kind":"clip"');
    expect(JSON.stringify(file)).not.toContain("Secret script");
    const { listLibrary } = await import("@/lib/library");
    expect(listLibrary(row, { type: "audio" }).items.some((item) => item.id === result.file_id)).toBe(true);
  });

  test.each([["", 400], ["x".repeat(2001), 400]] as const)("rejects invalid script (%s chars)", async (script, status) => {
    const { row } = await owner();
    expect(await makeVoiceover(row, { script })).toMatchObject({ ok: false, status });
  });

  test("passes video policy refusals through and rejects unknown voices", async () => {
    const { row } = await owner();
    expect(await makeVoiceover(row, { script: "child porn" })).toMatchObject({ ok: false, status: 403 });
    expect(await makeVoiceover(row, { script: "Hello there", voice: "missing" })).toMatchObject({ ok: false, status: 422 });
  });

  test("returns a plain line when speech is down", async () => {
    const { row } = await owner();
    __setStackClientForTests({ speak: async () => { throw new Error("secret backend error"); }, voices: async () => [] } as never);
    const result = await makeVoiceover(row, { script: "Hello" });
    expect(result).toMatchObject({ ok: false, status: 503, line: "Home can't speak right now. Try again in a minute." });
  });

  test("serves options and makes a file through authenticated routes", async () => {
    const { client } = await owner();
    const options = await client.get("/api/voiceover/options");
    expect(options.status).toBe(200);
    expect((await options.json() as { voices: unknown[] }).voices.length).toBeGreaterThan(0);
    const made = await client.post("/api/voiceover", { script: "A short line", voice: "preset-default" });
    expect(made.status).toBe(200);
    expect(await made.json()).toMatchObject({ engine: "chatterbox-turbo", voice: "preset-default", kind: "preset" });
  });
});
