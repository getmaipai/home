import { describe, expect, test, beforeEach } from "bun:test";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { db } from "@/db";
import { people } from "@/db/schema";
import { resetDb } from "./reset-db";
import { clonedVoicesDir } from "@/lib/paths";
import {
  listClonedVoices,
  saveClonedVoice,
  deleteClonedVoice,
  getClonedVoiceFile,
  clonedVoiceExists,
  clonedVoiceUrl,
} from "@/lib/clonedVoices";
import { setPersonTtsVoiceUnchecked, getPersonSettingValue, setHouseholdSettingValue } from "@/lib/settings";
import type { PersonRow } from "@/types";

// clonedVoicesDir is a real filesystem directory, not a DB table
// resetDb() clears - the same reason backup.test.ts's own
// resetBackupDir() exists.
function resetClonedVoicesDir(): void {
  if (!existsSync(clonedVoicesDir)) return;
  for (const f of readdirSync(clonedVoicesDir)) rmSync(join(clonedVoicesDir, f), { force: true });
}

beforeEach(() => {
  resetDb();
  resetClonedVoicesDir();
});

function makePerson(displayName: string, role: string): PersonRow {
  const row = {
    id: `person-${displayName.toLowerCase()}`,
    displayName,
    nickname: null,
    birthdate: null,
    role,
    avatarSeed: "seed",
    source: "manual",
    localOnly: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    hlc: "1700000000000:0:testfix",
  };
  db.insert(people).values(row).run();
  return row as unknown as PersonRow;
}

const WAV_BYTES = new Uint8Array([1, 2, 3, 4]);

describe("saveClonedVoice()", () => {
  test("rejects an empty label", () => {
    const jesse = makePerson("Jesse", "owner");
    const result = saveClonedVoice(jesse, "   ", WAV_BYTES, "audio/wav");
    expect(result.ok).toBe(false);
  });

  test("rejects an empty file", () => {
    const jesse = makePerson("Jesse", "owner");
    const result = saveClonedVoice(jesse, "Dad", new Uint8Array(0), "audio/wav");
    expect(result.ok).toBe(false);
  });

  test("rejects an unsupported mime type", () => {
    const jesse = makePerson("Jesse", "owner");
    const result = saveClonedVoice(jesse, "Dad", WAV_BYTES, "application/octet-stream");
    expect(result.ok).toBe(false);
  });

  test("rejects a file over the size cap", () => {
    const jesse = makePerson("Jesse", "owner");
    const tooBig = new Uint8Array(21 * 1024 * 1024);
    const result = saveClonedVoice(jesse, "Dad", tooBig, "audio/wav");
    expect(result.ok).toBe(false);
  });

  test("saves a real file to disk and a matching row", () => {
    const jesse = makePerson("Jesse", "owner");
    const result = saveClonedVoice(jesse, "Dad's voice", WAV_BYTES, "audio/wav");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.label).toBe("Dad's voice");
    expect(result.value.creatorName).toBe("Jesse");
    expect(result.value.bytes).toBe(4);

    const file = getClonedVoiceFile(result.value.id);
    expect(file).not.toBeNull();
    expect(existsSync(file!.path)).toBe(true);
    expect(file!.mimeType).toBe("audio/wav");
  });
});

describe("listClonedVoices()", () => {
  test("lists recordings uploaded by any household member", () => {
    const jesse = makePerson("Jesse", "owner");
    const admin = makePerson("Marlow", "admin");
    const adult = makePerson("Pip", "adult");
    const teen = makePerson("Nova", "teen");
    const child = makePerson("Poppy", "child");
    saveClonedVoice(jesse, "Dad's voice", WAV_BYTES, "audio/wav");
    saveClonedVoice(admin, "Marlow's voice", WAV_BYTES, "audio/wav");
    expect(listClonedVoices().map((v) => v.label).sort()).toEqual(["Dad's voice", "Marlow's voice"]);
    void adult;
    void teen;
    void child;
  });
});

describe("deleteClonedVoice()", () => {
  test("the creator can delete their own", () => {
    const jesse = makePerson("Jesse", "owner");
    const saved = saveClonedVoice(jesse, "Dad's voice", WAV_BYTES, "audio/wav");
    if (!saved.ok) throw new Error("setup failed");
    const filePath = getClonedVoiceFile(saved.value.id)!.path;

    const result = deleteClonedVoice(jesse, saved.value.id);
    expect(result.ok).toBe(true);
    expect(clonedVoiceExists(saved.value.id)).toBe(false);
    expect(existsSync(filePath)).toBe(false);
  });

  test("an owner/admin can delete someone else's recording", () => {
    const jesse = makePerson("Jesse", "owner");
    const marlow = makePerson("Marlow", "admin");
    const saved = saveClonedVoice(marlow, "Marlow's voice", WAV_BYTES, "audio/wav");
    if (!saved.ok) throw new Error("setup failed");

    const result = deleteClonedVoice(jesse, saved.value.id);
    expect(result.ok).toBe(true);
    expect(clonedVoiceExists(saved.value.id)).toBe(false);
  });

  test("a non-creator, non-admin is refused", () => {
    const jesse = makePerson("Jesse", "owner");
    const marlow = makePerson("Marlow", "adult");
    const saved = saveClonedVoice(jesse, "Dad's voice", WAV_BYTES, "audio/wav");
    if (!saved.ok) throw new Error("setup failed");

    const result = deleteClonedVoice(marlow, saved.value.id);
    expect(result.ok).toBe(false);
    expect(clonedVoiceExists(saved.value.id)).toBe(true);
  });

  test("a missing id 404s", () => {
    const jesse = makePerson("Jesse", "owner");
    const result = deleteClonedVoice(jesse, "voice-doesnotexist");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });

  // Found live (2026-09-04): deleting a voice a person had selected left
  // their tts.voice_id pointing at a now-404ing URL.
  test("deleting a voice someone has selected resets their tts.voice_id back to the default", () => {
    const jesse = makePerson("Jesse", "owner");
    const saved = saveClonedVoice(jesse, "Dad's voice", WAV_BYTES, "audio/wav");
    if (!saved.ok) throw new Error("setup failed");
    const select = setPersonTtsVoiceUnchecked(jesse, clonedVoiceUrl(saved.value.id));
    expect(select.ok).toBe(true);
    expect(getPersonSettingValue(jesse, "tts.voice_id")).toBe(clonedVoiceUrl(saved.value.id));

    deleteClonedVoice(jesse, saved.value.id);

    const after = getPersonSettingValue(jesse, "tts.voice_id");
    expect(after).not.toBe(clonedVoiceUrl(saved.value.id));
  });

  test("deleting a voice leaves an UNRELATED person's own selection untouched", () => {
    const jesse = makePerson("Jesse", "owner");
    const nova = makePerson("Nova", "adult");
    const saved = saveClonedVoice(jesse, "Dad's voice", WAV_BYTES, "audio/wav");
    if (!saved.ok) throw new Error("setup failed");
    setPersonTtsVoiceUnchecked(nova, "alba");
    expect(getPersonSettingValue(nova, "tts.voice_id")).toBe("alba");

    deleteClonedVoice(jesse, saved.value.id);

    expect(getPersonSettingValue(nova, "tts.voice_id")).toBe("alba");
  });

  // A code review (2026-09-04) found the original cleanup compared the
  // FULL stored URL (host and port included) against clonedVoiceUrl(id)
  // computed fresh at delete time - if the hub restarted on a different
  // PORT between select and delete, the comparison would silently never
  // match, leaving the dangling setting this whole mechanism exists to
  // clear. The fix matches on the id's own path segment instead.
  test("cleanup still finds a selection made while the hub was on a DIFFERENT port", () => {
    const originalPort = process.env.PORT;
    try {
      const jesse = makePerson("Jesse", "owner");
      const saved = saveClonedVoice(jesse, "Dad's voice", WAV_BYTES, "audio/wav");
      if (!saved.ok) throw new Error("setup failed");

      process.env.PORT = "8787";
      setPersonTtsVoiceUnchecked(jesse, clonedVoiceUrl(saved.value.id));
      expect(getPersonSettingValue(jesse, "tts.voice_id")).toContain(":8787/");

      process.env.PORT = "9999";
      deleteClonedVoice(jesse, saved.value.id);

      expect(getPersonSettingValue(jesse, "tts.voice_id")).not.toContain(saved.value.id);
    } finally {
      if (originalPort === undefined) delete process.env.PORT;
      else process.env.PORT = originalPort;
    }
  });
});

describe("getClonedVoiceFile() / clonedVoiceExists()", () => {
  test("an unissued id resolves to nothing, never an arbitrary path", () => {
    expect(getClonedVoiceFile("voice-neverissued")).toBeNull();
    expect(clonedVoiceExists("voice-neverissued")).toBe(false);
  });

  // A code review (2026-09-04) found this didn't check the file was
  // actually still on disk, unlike deleteClonedVoice()'s own guard a few
  // lines away in the same file - a row surviving without its file (a
  // crash between the write and the insert, or manual cleanup) would
  // otherwise pass a nonexistent path straight to the serving route.
  test("a row whose file is missing from disk resolves to nothing too", () => {
    const jesse = makePerson("Jesse", "owner");
    const saved = saveClonedVoice(jesse, "Dad's voice", WAV_BYTES, "audio/wav");
    if (!saved.ok) throw new Error("setup failed");
    const path = getClonedVoiceFile(saved.value.id)!.path;
    rmSync(path);

    expect(getClonedVoiceFile(saved.value.id)).toBeNull();
    // clonedVoiceExists() is deliberately unaffected: it's the row that
    // still exists, only the file is gone - a distinct problem from "was
    // this id ever issued", and callers that only need "is this a real
    // id" (routes/voice.ts's /select) shouldn't 404 for it.
    expect(clonedVoiceExists(saved.value.id)).toBe(true);
  });
});

describe("clonedVoiceUrl()", () => {
  test("uses Home's loopback address when the Stack is local", () => {
    setHouseholdSettingValue("engines.stack.where", "this_computer");
    const url = clonedVoiceUrl("voice-abc123");
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/api\/voice\/cloned\/voice-abc123\/file$/);
  });

  test("uses the reverse SSH forward when the Stack is remote", () => {
    setHouseholdSettingValue("engines.stack.where", "another_computer");
    expect(clonedVoiceUrl("voice-abc123")).toBe("http://127.0.0.1:8772/api/voice/cloned/voice-abc123/file");
  });
});

// VOICES-03/04: who may make a voice, the record's ranges, the audit line, and what a saved choice means.
import { householdVoiceEntries, householdVoiceSpeech } from "@/lib/clonedVoices";

describe("making a voice (VOICES-04)", () => {
  test("only an owner or an admin can make one: a member, teen and child get 403 and nothing is stored", () => {
    for (const role of ["adult", "teen", "child"]) {
      const result = saveClonedVoice(makePerson(`P${role}`, role), "Nope", WAV_BYTES, "audio/wav");
      expect(result).toEqual({ ok: false, status: 403, error: "Only an owner or an admin can make a voice." });
    }
    expect(listClonedVoices()).toHaveLength(0);
    expect(existsSync(clonedVoicesDir) ? readdirSync(clonedVoicesDir) : []).toHaveLength(0);
    expect(saveClonedVoice(makePerson("Mara", "admin"), "Ok", WAV_BYTES, "audio/wav").ok).toBe(true);
    expect(saveClonedVoice(makePerson("Jess", "owner"), "Ok too", WAV_BYTES, "audio/wav").ok).toBe(true);
  });

  test("temperature and pitch are kept and listed; without them both keys are absent", () => {
    const jesse = makePerson("Jesse", "owner");
    const cutey = saveClonedVoice(jesse, "Cutey", WAV_BYTES, "audio/wav", { temperature: 1.05, pitchSemitones: -1 });
    const plain = saveClonedVoice(jesse, "Plain", WAV_BYTES, "audio/wav");
    if (!cutey.ok || !plain.ok) throw new Error("setup failed");
    expect(cutey.value).toMatchObject({ temperature: 1.05, pitchSemitones: -1 });
    expect("temperature" in plain.value).toBe(false);
    expect("pitchSemitones" in plain.value).toBe(false);
    expect(listClonedVoices().find((v) => v.id === cutey.value.id)).toMatchObject({ temperature: 1.05, pitchSemitones: -1 });
  });

  test.each([[0.05, undefined], [2.5, undefined], [Number.NaN, undefined]])("temperature %p is refused with the plain message", (temperature, pitchSemitones) => {
    const result = saveClonedVoice(makePerson("Jesse", "owner"), "X", WAV_BYTES, "audio/wav", { temperature, pitchSemitones });
    expect(result).toEqual({ ok: false, status: 400, error: "The sampling temperature must be a number from 0.1 to 2.0." });
  });
  test.each([13, -13, Number.NaN])("pitch %p is refused with the plain message", (pitchSemitones) => {
    const result = saveClonedVoice(makePerson("Jesse", "owner"), "X", WAV_BYTES, "audio/wav", { pitchSemitones });
    expect(result).toEqual({ ok: false, status: 400, error: "The pitch offset must be a number from -12 to 12 semitones." });
  });
  test("the boundary values are accepted", () => {
    const jesse = makePerson("Jesse", "owner");
    for (const options of [{ temperature: 0.1, pitchSemitones: -12 }, { temperature: 2.0, pitchSemitones: 12 }]) {
      expect(saveClonedVoice(jesse, "Edge", WAV_BYTES, "audio/wav", options).ok).toBe(true);
    }
  });
  test("a 61-character name is refused; a recording the engine cannot read is refused in plain words", () => {
    const jesse = makePerson("Jesse", "owner");
    expect(saveClonedVoice(jesse, "n".repeat(61), WAV_BYTES, "audio/wav")).toEqual({ ok: false, status: 400, error: "The name can be 60 characters or fewer." });
    const webm = saveClonedVoice(jesse, "Rec", WAV_BYTES, "audio/webm");
    expect(webm).toMatchObject({ ok: false, status: 400 });
    if (!webm.ok) expect(webm.error).toContain("WAV, MP3 or FLAC");
  });

  test("householdVoiceSpeech understands the plain token and the older address form, and nothing else", () => {
    const jesse = makePerson("Jesse", "owner");
    const made = saveClonedVoice(jesse, "Cutey", WAV_BYTES, "audio/wav", { temperature: 1.05, pitchSemitones: -1 });
    if (!made.ok) throw new Error("setup failed");
    const expected = { voiceUrl: clonedVoiceUrl(made.value.id), temperature: 1.05, pitchSemitones: -1 };
    expect(householdVoiceSpeech(made.value.id)).toEqual(expected);
    expect(householdVoiceSpeech(`http://127.0.0.1:8787/api/voice/cloned/${made.value.id}/file`)).toEqual(expected);
    for (const other of ["voice-unknownunknown", "default", "alba", "", 5, null, undefined]) expect(householdVoiceSpeech(other)).toBeNull();
  });

  test("householdVoiceEntries lists each voice as a cloned entry named by its label", () => {
    const made = saveClonedVoice(makePerson("Jesse", "owner"), "Cutey", WAV_BYTES, "audio/wav");
    if (!made.ok) throw new Error("setup failed");
    expect(householdVoiceEntries()).toEqual([expect.objectContaining({ id: made.value.id, name: "Cutey", source: "cloned", engine: "chatterbox-turbo", onDisk: true })]);
  });

  test("deleting a voice clears a person's saved choice that holds the plain token, and a robot's", () => {
    const jesse = makePerson("Jesse", "owner");
    const made = saveClonedVoice(jesse, "Cutey", WAV_BYTES, "audio/wav");
    if (!made.ok) throw new Error("setup failed");
    setPersonTtsVoiceUnchecked(jesse, made.value.id);
    expect(getPersonSettingValue(jesse, "tts.voice_id")).toBe(made.value.id);
    expect(deleteClonedVoice(jesse, made.value.id).ok).toBe(true);
    expect(getPersonSettingValue(jesse, "tts.voice_id")).not.toBe(made.value.id);
  });
});
