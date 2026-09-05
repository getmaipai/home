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
import { setPersonTtsVoiceUnchecked, getPersonSettingValue } from "@/lib/settings";
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
  test("is household-wide: shows a voice uploaded by any person", () => {
    const jesse = makePerson("Jesse", "owner");
    const nova = makePerson("Nova", "child");
    saveClonedVoice(jesse, "Dad's voice", WAV_BYTES, "audio/wav");
    saveClonedVoice(nova, "Nova's voice", WAV_BYTES, "audio/wav");

    const all = listClonedVoices();
    expect(all.length).toBe(2);
    expect(all.map((v) => v.label).sort()).toEqual(["Dad's voice", "Nova's voice"]);
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

  test("an owner/admin can delete someone else's", () => {
    const jesse = makePerson("Jesse", "owner");
    const nova = makePerson("Nova", "child");
    const saved = saveClonedVoice(nova, "Nova's voice", WAV_BYTES, "audio/wav");
    if (!saved.ok) throw new Error("setup failed");

    const result = deleteClonedVoice(jesse, saved.value.id);
    expect(result.ok).toBe(true);
  });

  test("a non-creator, non-admin is refused", () => {
    const nova = makePerson("Nova", "child");
    const marlow = makePerson("Marlow", "adult");
    const saved = saveClonedVoice(nova, "Nova's voice", WAV_BYTES, "audio/wav");
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
    const nova = makePerson("Nova", "child");
    const saved = saveClonedVoice(jesse, "Dad's voice", WAV_BYTES, "audio/wav");
    if (!saved.ok) throw new Error("setup failed");
    setPersonTtsVoiceUnchecked(nova, "some-other-preset");

    deleteClonedVoice(jesse, saved.value.id);

    expect(getPersonSettingValue(nova, "tts.voice_id")).toBe("some-other-preset");
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
  test("is a real http URL back at this hub's own file-serving route", () => {
    const url = clonedVoiceUrl("voice-abc123");
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/api\/voice\/cloned\/voice-abc123\/file$/);
  });
});
