import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { setHouseholdSettingValue } from "@/lib/settings";
import { synthesizeRecordedSpeech, synthesizeSpeech } from "@/lib/tts";
import { __setTtsTagsForTests } from "@/lib/ttsCapabilities";
import { __setRecordedSpeechFetchForTests, __setRecordedSpeechReferenceForTests } from "@/lib/recordedSpeech";
import { resetDb } from "./reset-db";

const fixtureRef = "voice-abcdef";
const audio = new Uint8Array([1, 2, 3]);
let fallbackCalls = 0;
let stackAvailable = true;
let installed = true;
let jobState: "done" | "failed" = "done";
let submittedText = "";
let consoleText = "";
let requests: string[] = [];

describe("recorded speech V6", () => {
  beforeEach(() => {
    resetDb(); setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8771");
    fallbackCalls = 0; stackAvailable = true; installed = true; jobState = "done"; submittedText = ""; consoleText = ""; requests = [];
    __setTtsTagsForTests([]);
    __setRecordedSpeechReferenceForTests((voice) => voice === fixtureRef ? { bytes: new Uint8Array([4, 5]), mimeType: "audio/wav", transcript: "reference words" } : null);
    __setRecordedSpeechFetchForTests((async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith("/stack/v1/speech-recorded")) return Response.json({ recorded_speech: { available: stackAvailable, ready: stackAvailable, installed, models: [{ installed: true, revision: "fish-rev" }] } });
      if (url.endsWith("/v1/audio/speech/recorded")) { submittedText = JSON.parse(String(init?.body)).text; return Response.json({ job: "job-1", data: jobState === "done" ? { url: "/v1/audio/speech/recorded/job-1/file", content_type: "audio/wav" } : null }, { status: jobState === "done" ? 200 : 202 }); }
      if (url.endsWith("/v1/audio/speech/recorded/job-1")) return Response.json({ state: jobState, data: null });
      if (url.endsWith("/v1/audio/speech/recorded/job-1/file")) return new Response(audio, { headers: { "content-type": "audio/wav" } });
      return new Response("no", { status: 404 });
    }) as typeof fetch);
    __setStackClientForTests({ speak: async (_form: FormData) => { fallbackCalls++; return new Response(new Uint8Array([9]), { headers: { "content-type": "audio/wav" } }); } } as never);
  });
  afterEach(() => { __setRecordedSpeechFetchForTests(null); __setRecordedSpeechReferenceForTests(null); __setTtsTagsForTests(null); __resetStackEngineForTests(); });

  test("uses Fish with normalized words, preserved typed emotion cues, and model revision", async () => {
    const result = await synthesizeRecordedSpeech("On 3 PM [whispers] [angry] [laughs]", fixtureRef);
    expect(result).toMatchObject({ ok: true, engine: "fish-audio-drama-3", revision: "fish-rev" });
    expect(submittedText).toBe("On three P M [whispers] [angry] [laughs]");
    expect(fallbackCalls).toBe(0);
  });
  test.each([
    ["unsupported", () => { stackAvailable = false; }],
    ["not installed", () => { installed = false; }],
    ["failed job", () => { jobState = "failed"; }],
    ["missing transcript", () => { __setRecordedSpeechReferenceForTests(() => ({ bytes: new Uint8Array([4]), mimeType: "audio/wav" })); }],
    ["preset without clip", () => {}],
  ])("falls back to Chatterbox for %s", async (_name, setup) => {
    setup();
    const voice = _name === "preset without clip" ? "preset-voice" : fixtureRef;
    const result = await synthesizeRecordedSpeech("A private line", voice);
    expect(result).toMatchObject({ ok: true, engine: "chatterbox-turbo" });
    expect(fallbackCalls).toBe(1);
  });
  test("does not log speech text and realtime stays on synthesizeSpeech", async () => {
    const secret = "private line that must never log";
    const old = console.log; console.log = (...args: unknown[]) => { consoleText += args.join(" "); };
    try { await synthesizeRecordedSpeech(secret, fixtureRef); await synthesizeSpeech(secret); } finally { console.log = old; }
    expect(consoleText).not.toContain(secret);
    expect(fallbackCalls).toBe(1);
  });
});
