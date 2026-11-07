import { describe, expect, test, beforeEach } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { db } from "@/db";
import { clonedVoices, people } from "@/db/schema";
import { resetDb } from "./reset-db";
import { clonedVoicesDir, logsDir } from "@/lib/paths";
import { __setClonedVoiceTranscriberForTests } from "@/lib/clonedVoiceTranscript";
import { listClonedVoices, previewInspiredVoice, readClonedVoiceClip, saveClonedVoice, saveInspiredVoice } from "@/lib/clonedVoices";
import { decodeWavClip, encodeWavClip, INSPIRED_SEMITONES, mixClips, shiftPitchAndFormants } from "@/lib/voiceShift";
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
  test("moves the pitch down for a negative shift and keeps the length", () => {
    const clip = decodeWavClip(tone(200))!;
    const shifted = shiftPitchAndFormants(clip, -4);
    expect(shifted.samples.length).toBe(clip.samples.length);
    const ratio = pitchOf(shifted.samples) / pitchOf(clip.samples);
    expect(ratio).toBeGreaterThan(2 ** (-4.5 / 12));
    expect(ratio).toBeLessThan(2 ** (-3.5 / 12));
  });
  test("zero shift returns the clip as it is", () => {
    const clip = decodeWavClip(tone(100))!;
    expect(shiftPitchAndFormants(clip, 0)).toBe(clip);
  });
});

describe("saveInspiredVoice()", () => {
  test("level mapping: Lower and Much lower go down 2 and 4 semitones, Different and Very different go up 2 and 4", () => {
    expect(INSPIRED_SEMITONES).toEqual({ much_lower: -4, lower: -2, different: 2, very_different: 4 });
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

describe("mixClips()", () => {
  test("averages two clips with equal weight, at the first clip's rate and length", () => {
    const a = { samples: new Float32Array([0.4, 0.4, 0.4, 0.4]), sampleRate: 1000 };
    const b = { samples: new Float32Array([0.2, 0.2]), sampleRate: 1000 };
    const mixed = mixClips(a, b);
    expect(mixed.sampleRate).toBe(1000);
    expect(Array.from(mixed.samples).map((v) => Math.round(v * 100) / 100)).toEqual([0.3, 0.3, 0.3, 0.3]);
  });
  test("resamples the second clip to the first clip's rate", () => {
    const a = { samples: new Float32Array(2000).fill(0.5), sampleRate: 2000 };
    const b = { samples: new Float32Array(1000).fill(-0.5), sampleRate: 1000 };
    const mixed = mixClips(a, b);
    expect(mixed.samples.length).toBe(2000);
    expect(Math.abs(mixed.samples[500]!)).toBeLessThan(1e-3);
  });
});

describe("lower levels, blending and preview", () => {
  test("a Lower voice is stored lower than the upload", async () => {
    const result = await saveInspiredVoice(makePerson("Plow", "member"), "Deep", tone(200), "audio/wav", "much_lower");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.inspiredLevel).toBe("much_lower");
    const stored = decodeWavClip(readClonedVoiceClip(result.value.id)!.bytes)!;
    expect(pitchOf(stored.samples) / pitchOf(decodeWavClip(tone(200))!.samples)).toBeLessThan(2 ** (-3 / 12));
  });

  test("blending keeps both sources in the record and mixes the waveforms", async () => {
    const maker = makePerson("Pblend", "member");
    const base = saveClonedVoice(maker, "Base", tone(300), "audio/wav");
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const result = await saveInspiredVoice(maker, "Mixed", tone(100), "audio/wav", "different", base.value.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.inspiredBaseId).toBe(base.value.id);
    expect(db.select().from(clonedVoices).all().find((r) => r.id === result.value.id)!.inspiredBaseId).toBe(base.value.id);
    const plain = await saveInspiredVoice(maker, "Plain", tone(100), "audio/wav", "different");
    const mixedSamples = decodeWavClip(readClonedVoiceClip(result.value.id)!.bytes)!.samples;
    const plainSamples = decodeWavClip(readClonedVoiceClip((plain as { ok: true; value: { id: string } }).value.id)!.bytes)!.samples;
    expect(Array.from(mixedSamples.slice(5000, 5100))).not.toEqual(Array.from(plainSamples.slice(5000, 5100)));
    const logs = readdirSync(logsDir).map((f) => readFileSync(join(logsDir, f), "utf8")).join("\n");
    expect(logs).toContain("blended=yes");
    expect(logs).not.toContain(base.value.id);
  });

  test("an unknown base voice is refused", async () => {
    const result = await saveInspiredVoice(makePerson("Pnobase", "member"), "X", tone(100), "audio/wav", "different", "voice-nosuchone1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
    expect(db.select().from(clonedVoices).all()).toHaveLength(0);
  });

  test("a preview is about four seconds, saves nothing, and a guest is refused", async () => {
    const result = await previewInspiredVoice(makePerson("Pprev", "teen"), tone(100), "audio/wav", "lower");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(decodeWavClip(result.value)!.samples.length).toBe(RATE * 4);
    expect(db.select().from(clonedVoices).all()).toHaveLength(0);
    const guest = await previewInspiredVoice(makePerson("Pgst", "guest"), tone(100), "audio/wav", "lower");
    expect(guest.ok).toBe(false);
    if (!guest.ok) expect(guest.status).toBe(403);
    const bad = await previewInspiredVoice(makePerson("Pbd", "member"), tone(100), "audio/wav", "nope");
    expect(bad.ok).toBe(false);
  });
});
