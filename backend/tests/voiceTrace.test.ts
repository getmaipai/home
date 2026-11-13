// VOICE-TRACE-01: an owner's live voice trace reaches the record folder; a household member cannot post one; free text cannot get in.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetVoiceTraceForTests, formatVoiceTrace, VoiceTraceUploadSchema, voiceTraces } from "@/lib/voiceTrace";

beforeEach(async () => { await resetDb(); __resetVoiceTraceForTests(); });
afterEach(() => { __resetVoiceTraceForTests(); });

const upload = { session: "abcd1234", utterance: 0, events: [{ t: 0, e: "session_open", bargein: true }, { t: 12, e: "mic_settings", aec: true, ns: true, agc: false, rate: 48000 }, { t: 900, e: "edge", words: 7, level: "gentle", score: 1 }, { t: 1650, e: "final", words: 7 }] };

describe("VOICE-TRACE-01", () => {
  test("an owner's trace is kept in the record store and prints as one line per event", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const res = await owner.post("/api/voice/trace", upload);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ kept: true, events: 4 });
    const kept = voiceTraces();
    expect(kept).toHaveLength(1);
    expect(kept[0]!.actor_role).toBe("owner");
    const text = formatVoiceTrace(kept[0]!);
    expect(text).toContain("edge words=7 level=gentle score=1");
    expect(text).toContain("mic_settings aec=true ns=true agc=false rate=48000");
  });

  test("another adult in the household is refused; the store stays empty", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const adult = (await (await owner.post("/api/people", { displayName: "Marlow", role: "adult", secret: "adultsecret" })).json()) as { id: string };
    const member = new TestClient();
    await member.post("/api/auth/verify-secret", { personId: adult.id, secret: "adultsecret" });
    const res = await member.post("/api/voice/trace", upload);
    expect(res.status).toBe(403);
    expect(voiceTraces()).toHaveLength(0);
  });

  test("the schema takes event names from the list and numbers, booleans or short tokens only: a transcript cannot get in", () => {
    expect(VoiceTraceUploadSchema.safeParse(upload).success).toBe(true);
    expect(VoiceTraceUploadSchema.safeParse({ ...upload, events: [{ t: 1, e: "final", text: "what is a good name for a cat" }] }).success).toBe(false);
    expect(VoiceTraceUploadSchema.safeParse({ ...upload, events: [{ t: 1, e: "transcript", words: 3 }] }).success).toBe(false);
    expect(VoiceTraceUploadSchema.safeParse({ ...upload, events: [{ t: 1, e: "final", words: 3, note: "a b" }] }).success).toBe(false);
    expect(VoiceTraceUploadSchema.safeParse({ ...upload, session: "../etc" }).success).toBe(false);
  });
});
