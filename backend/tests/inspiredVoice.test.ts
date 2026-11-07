import { describe, expect, test, beforeEach } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { db } from "@/db";
import { clonedVoices, people } from "@/db/schema";
import { resetDb } from "./reset-db";
import { clonedVoicesDir, logsDir } from "@/lib/paths";
import { __setClonedVoiceTranscriberForTests } from "@/lib/clonedVoiceTranscript";
import { listClonedVoices, readClonedVoiceClip, saveInspiredVoice } from "@/lib/clonedVoices";
import { decodeWavClip, encodeWavClip, INSPIRED_SEMITONES, shiftPitchAndFormants } from "@/lib/voiceShift";
import type { PersonRow } from "@/types";

function resetDir(): void {
  if (!existsSync(clonedVoicesDir)) return;
  for (const f of readdirSync(clonedVoicesDir)) rmSync(join(clonedVoicesDir, f), { force: true });
}
beforeEach(() => { resetDb(); resetDir(); __setClonedVoiceTranscriberForTests(async () => "hello there"); });

function makePerson(name: string, role: string): PersonRow {
  const row = { id: `person-${name.toLowerCase()}`, displayName: name, nickname: null, birthdate: null, role, avatarSeed: "s", source: "manual", localOnly: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deletedAt: null, hlc: "1700000000000:0:testfix" };
  db.insert(people).values(row).run();
  return row as unknown as PersonRow;
}

const RATE = 24000;
/** A 7 second voiced test tone at `hz` with two harmonics. */
function tone(hz: number, seconds = 7): Uint8Array {
  const samples = new Float32Array(RATE * seconds);
  for (let i = 0; i < samples.length; i++) samples[i] = 0.4 * Math.sin((2 * Math.PI * hz * i) / RATE) + 0.2 * Math.sin((4 * Math.PI * hz * i) / RATE) + 0.1 * Math.sin((6 * Math.PI * hz * i) / RATE);
  return encodeWavClip({ samples, sampleRate: RATE });
}
/** Fundamental in Hz by autocorrelation over one second starting at the one-second mark. */
function pitchOf(samples: Float32Array): number {
  let best = 0, bestLag = 1;
  for (let lag = Math.round(RATE / 400); lag < RATE / 60; lag++) {
    let sum = 0;
    for (let i = 0; i < RATE; i++) sum += samples[RATE + i]! * samples[RATE + i + lag]!;
    if (sum > best) { best = sum; bestLag = lag; }
  }
  return RATE / bestLag;
}

describe("shiftPitchAndFormants()", () => {
  test("moves the pitch up by the semitones and keeps the length", () => {
    const clip = decodeWavClip(tone(100))!;
    const shifted = shiftPitchAndFormants(clip, 2);
    expect(shifted.samples.length).toBe(clip.samples.length);
    const ratio = pitchOf(shifted.samples) / pitchOf(clip.samples);
    expect(ratio).toBeGreaterThan(2 ** (1.7 / 12));
    expect(ratio).toBeLessThan(2 ** (2.3 / 12));
    expect(Math.max(...shifted.samples.slice(RATE, RATE * 2))).toBeGreaterThan(0.2);
  });
  test("zero shift returns the clip as it is", () => {
    const clip = decodeWavClip(tone(100))!;
    expect(shiftPitchAndFormants(clip, 0)).toBe(clip);
  });
});

describe("saveInspiredVoice()", () => {
  test("level mapping: Different is 2 semitones, Very different is 4", () => {
    expect(INSPIRED_SEMITONES).toEqual({ different: 2, very_different: 4 });
  });

  test("keeps a shifted copy, not the upload, with provenance saying inspired and the level", async () => {
    const maker = makePerson("Pmaker", "member");
    const original = tone(100);
    const result = await saveInspiredVoice(maker, "Spark", original, "audio/wav", "very_different");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe("inspired");
    expect(result.value.inspiredLevel).toBe("very_different");
    const row = db.select().from(clonedVoices).get()!;
    expect(row.kind).toBe("inspired");
    expect(row.inspiredLevel).toBe("very_different");
    const stored = readClonedVoiceClip(result.value.id)!;
    expect(stored.mimeType).toBe("audio/wav");
    const storedClip = decodeWavClip(stored.bytes)!;
    expect(storedClip.samples.length).toBe(RATE * 7);
    const ratio = pitchOf(storedClip.samples) / pitchOf(decodeWavClip(original)!.samples);
    expect(ratio).toBeGreaterThan(2 ** (3.5 / 12));
    expect(Buffer.from(stored.bytes).equals(Buffer.from(original))).toBe(false);
    expect(listClonedVoices()[0]!.kind).toBe("inspired");
  });

  test("a plain voice has no inspired fields", async () => {
    const { saveClonedVoice } = await import("@/lib/clonedVoices");
    const result = saveClonedVoice(makePerson("Pplain", "member"), "Plain", tone(100), "audio/wav");
    expect(result.ok && result.value.kind).toBeFalsy();
  });

  test("a guest is refused and nothing is stored", async () => {
    const result = await saveInspiredVoice(makePerson("Pguest", "guest"), "Nope", tone(100), "audio/wav", "different");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
    expect(db.select().from(clonedVoices).all()).toHaveLength(0);
  });

  test("a child and a teen may make one; an unknown level is refused", async () => {
    expect((await saveInspiredVoice(makePerson("Pkid", "child"), "Kid", tone(100), "audio/wav", "different")).ok).toBe(true);
    expect((await saveInspiredVoice(makePerson("Pteen", "teen"), "Teen", tone(100), "audio/wav", "different")).ok).toBe(true);
    const bad = await saveInspiredVoice(makePerson("Pmem", "member"), "Bad", tone(100), "audio/wav", "extreme");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.status).toBe(400);
  });

  test("an unreadable recording is refused with a plain message", async () => {
    const result = await saveInspiredVoice(makePerson("Pbad", "member"), "Broken", new Uint8Array([1, 2, 3, 4]), "audio/wav", "different");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("could not read");
  });

  test("the log line names the role and level only, never a voice or person id or name", async () => {
    const maker = makePerson("Pwho", "admin");
    const result = await saveInspiredVoice(maker, "Secretname", tone(100), "audio/wav", "different");
    expect(result.ok).toBe(true);
    const logs = existsSync(logsDir) ? readdirSync(logsDir).map((f) => readFileSync(join(logsDir, f), "utf8")).join("\n") : "";
    if (!result.ok) return;
    expect(logs).toContain("voice.created role=admin");
    expect(logs).toContain("kind=inspired level=different");
    expect(logs).not.toContain(result.value.id);
    expect(logs).not.toContain("Secretname");
    expect(logs).not.toContain(maker.id);
  });
});
