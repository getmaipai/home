// Voice cloning (2026-09-04, the follow-up to voice.hf_token): a
// household member uploads a real audio sample of a voice, and it
// becomes selectable as `tts.voice_id` the same way a preset or
// community-catalog voice is. No `pocket-tts export-voice` subprocess
// for v1 - Pocket TTS's own model-level `@lru_cache` on
// `_cached_get_state_for_audio_prompt` already caches the computed
// audio-conditioning state per URL after first use, so storing the file
// and serving it at a stable local URL is sufficient; precomputing is a
// later optimization (faster reload), not a correctness requirement.
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clonedVoices, people } from "@/db/schema";
import { clonedVoicesDir, ensureDataDir } from "@/lib/paths";
import { newClonedVoiceId } from "@/lib/id";
import { selfBaseUrl } from "@/lib/selfUrl";
import { isRemoteStackSelected } from "@/lib/stackEngine";
import { isOwnerOrAdmin } from "@/lib/access";
import { clearMatchingValues } from "@/lib/settings";
import { companionVoiceSettingsKeys } from "@/settings/companionVoiceKeys";
import type { PersonRow } from "@/types";
import type { ClonedVoiceInfo } from "@/wire";
import type { StackVoice } from "@/lib/stack/types";
import { appendLogLine } from "@/lib/log";

export type ClonedVoiceOpResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 403 | 404; error: string };

// A person's actual voice, so kept smaller than a generic upload cap
// would need to be - a few minutes of audio is already far more than
// Pocket TTS's own conditioning step uses, and this bounds a household's
// disk use (still-unbacked-up, lib/paths.ts's own note) and the time a
// browser upload takes on the LAN.
export const MAX_BYTES = 20 * 1024 * 1024;

// Only formats a browser can realistically produce (a file picker's
// "any audio file" or a recorder's own output) - not an exhaustive list
// of everything Pocket TTS's underlying decoder could read, but everything
// unrecognized is rejected rather than guessed at.
const EXTENSION_BY_MIME: Record<string, string> = {
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/x-wav": "wav",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
};

const NEW_VOICE_EXTENSIONS = new Set(["wav", "mp3", "flac"]);

function toInfo(row: typeof clonedVoices.$inferSelect, creatorName: string): ClonedVoiceInfo {
  return {
    id: row.id,
    label: row.label,
    creatorId: row.creatorId,
    creatorName,
    bytes: row.bytes,
    createdAt: row.createdAt,
    ...(row.temperature !== null ? { temperature: row.temperature } : {}),
    ...(row.pitchSemitones !== null ? { pitchSemitones: row.pitchSemitones } : {}),
  };
}

// VOICES-03: the HouseholdVoice record's own ranges.
const MAX_LABEL_LENGTH = 60;
const TEMPERATURE_RANGE = { min: 0.1, max: 2.0 };
const PITCH_RANGE = { min: -12, max: 12 };
const inRange = (value: number, range: { min: number; max: number }) => Number.isFinite(value) && value >= range.min && value <= range.max;

export interface HouseholdVoiceOptions {
  /** Sampling temperature, 0.1 to 2.0; null or absent means the engine default. */
  temperature?: number | null;
  /** Pitch offset in semitones, -12 to 12, formants kept; null or absent means no shift. */
  pitchSemitones?: number | null;
}

/** Household-wide, like the community catalog: anyone can select any voice. */
export function listClonedVoices(): ClonedVoiceInfo[] {
  const rows = db
    .select({ voice: clonedVoices, creatorName: people.displayName })
    .from(clonedVoices)
    .leftJoin(people, eq(clonedVoices.creatorId, people.id))
    .all();
  return rows.map((r) => toInfo(r.voice, r.creatorName ?? "Someone"));
}

export function saveClonedVoice(
  creator: PersonRow,
  label: string,
  bytes: Uint8Array,
  mimeType: string,
  options: HouseholdVoiceOptions = {},
): ClonedVoiceOpResult<ClonedVoiceInfo> {
  // VOICES-04: making a voice is for an owner or an admin, with no other limit (SAFETY.md, owner-approved 2026-10-18).
  if (!isOwnerOrAdmin(creator)) return { ok: false, status: 403, error: "Only an owner or an admin can make a voice." };
  const trimmedLabel = label.trim();
  if (!trimmedLabel) return { ok: false, status: 400, error: "label is required" };
  if (trimmedLabel.length > MAX_LABEL_LENGTH) return { ok: false, status: 400, error: `The name can be ${MAX_LABEL_LENGTH} characters or fewer.` };
  if (bytes.byteLength === 0) return { ok: false, status: 400, error: "the uploaded file is empty" };
  if (bytes.byteLength > MAX_BYTES) {
    return { ok: false, status: 400, error: `file must be ${MAX_BYTES / (1024 * 1024)}MB or smaller` };
  }
  const extension = EXTENSION_BY_MIME[mimeType];
  // The voice engine on this computer decodes WAV, MP3 and FLAC only (it has no ffmpeg); older rows in other formats stay usable.
  if (!extension || !NEW_VOICE_EXTENSIONS.has(extension)) return { ok: false, status: 400, error: "Use a WAV, MP3 or FLAC recording. Save it in one of those formats and choose it again." };
  const temperature = options.temperature ?? null;
  const pitchSemitones = options.pitchSemitones ?? null;
  if (temperature !== null && !inRange(temperature, TEMPERATURE_RANGE)) return { ok: false, status: 400, error: "The sampling temperature must be a number from 0.1 to 2.0." };
  if (pitchSemitones !== null && !inRange(pitchSemitones, PITCH_RANGE)) return { ok: false, status: 400, error: "The pitch offset must be a number from -12 to 12 semitones." };

  ensureDataDir(clonedVoicesDir);
  const id = newClonedVoiceId();
  const fileName = `${id}.${extension}`;
  const filePath = join(clonedVoicesDir, fileName);
  writeFileSync(filePath, bytes, { mode: 0o600 });

  const row = {
    id,
    creatorId: creator.id,
    label: trimmedLabel,
    fileName,
    mimeType,
    bytes: bytes.byteLength,
    createdAt: new Date().toISOString(),
    temperature,
    pitchSemitones,
  };
  try {
    db.insert(clonedVoices).values(row).run();
  } catch (err) {
    // The file and the row are two independent writes with no shared
    // transaction (a DB insert can't roll back a filesystem write) - a
    // code review (2026-09-04) found a failed insert left the file
    // behind with no row to ever reference or clean it up again. Best
    // effort: if this cleanup itself fails, the original DB error is
    // still the one that matters to the caller.
    try {
      unlinkSync(filePath);
    } catch {
      // already gone, or a real filesystem problem the caller can't fix
      // by retrying - not worth masking the real (DB) error below with.
    }
    throw err;
  }
  // One audit line: who made it and with which settings; never the person's name, the voice's name or the clip.
  appendLogLine(`voice.created id=${id} by=${creator.id} role=${creator.role} temperature=${temperature ?? "default"} pitch=${pitchSemitones ?? 0}`);
  return { ok: true, value: toInfo(row, creator.displayName) };
}

const MAX_RENAME_LENGTH = 40;

/** Renames a voice made at home. Owner or admin only; changes the label and nothing else (not the id, the clip, or anyone's choice). */
export function renameClonedVoice(actor: PersonRow, id: string, label: string): ClonedVoiceOpResult<ClonedVoiceInfo> {
  if (!isOwnerOrAdmin(actor)) return { ok: false, status: 403, error: "Only an owner or an admin can rename a voice." };
  const trimmed = label.trim();
  if (!trimmed) return { ok: false, status: 400, error: "Type a name for the voice." };
  if (trimmed.length > MAX_RENAME_LENGTH) return { ok: false, status: 400, error: `The name can be ${MAX_RENAME_LENGTH} characters or fewer.` };
  const row = db.select().from(clonedVoices).where(eq(clonedVoices.id, id)).get();
  if (!row) return { ok: false, status: 404, error: "cloned voice not found" };
  db.update(clonedVoices).set({ label: trimmed }).where(eq(clonedVoices.id, id)).run();
  appendLogLine(`voice.renamed id=${id} by=${actor.id} role=${actor.role}`);
  const creator = db.select({ name: people.displayName }).from(people).where(eq(people.id, row.creatorId)).get();
  return { ok: true, value: toInfo({ ...row, label: trimmed }, creator?.name ?? "Someone") };
}

/** Creator or owner/admin may remove a household recording. */
export function deleteClonedVoice(actor: PersonRow, id: string): ClonedVoiceOpResult<true> {
  const row = db.select().from(clonedVoices).where(eq(clonedVoices.id, id)).get();
  if (!row) return { ok: false, status: 404, error: "cloned voice not found" };
  if (row.creatorId !== actor.id && !isOwnerOrAdmin(actor)) {
    return { ok: false, status: 403, error: "only the person who uploaded this voice, or an owner/admin, can delete it" };
  }
  // DB row first, filesystem second: a code review (2026-09-04) found
  // the original order meant a locked/permission-denied file (EPERM,
  // EBUSY - anything other than "already gone") threw BEFORE the row was
  // removed, so a delete that appeared to fail outright still left the
  // voice fully listed and selectable. This order means the worst case
  // of a stuck file is a harmless orphan on disk (this directory already
  // isn't backed up - lib/paths.ts's own note), never a voice that can't
  // be removed from the household's list.
  db.delete(clonedVoices).where(eq(clonedVoices.id, id)).run();
  // Found live (2026-09-04): deleting a voice someone currently has
  // selected left their `tts.voice_id` pointing at a URL that now
  // 404s - the Stack's own speech call would fail with no obvious cause.
  // Matches by the id's own path segment, not the full stored URL: a
  // code review caught that comparing the whole `clonedVoiceUrl(id)`
  // string would silently stop matching if the hub were ever restarted
  // on a different PORT between when a person selected this voice and
  // when it was deleted - the id itself never changes, so anchoring the
  // match to it (not the host/port it happened to resolve through) is
  // real going forward, not just checked once.
  clearMatchingValues("tts.voice_id", `/cloned/${id}/file`);
  // The plain-token form (a person's tts.voice_id, a robot's robot.voice.id) holds the bare id.
  clearMatchingValues("tts.voice_id", id);
  clearMatchingValues("robot.voice.id", id);
  clearMatchingValues("tts.home_voice", id);
  for (const key of companionVoiceSettingsKeys()) clearMatchingValues(key.key, id);
  appendLogLine(`voice.deleted id=${id} by=${actor.id} role=${actor.role}`);
  const filePath = join(clonedVoicesDir, row.fileName);
  try {
    if (existsSync(filePath)) unlinkSync(filePath);
  } catch {
    // Same "harmless orphan, not a stuck delete" reasoning as the
    // reordering above - the voice is already gone from the household's
    // list and from anyone's tts.voice_id by this point regardless.
  }
  return { ok: true, value: true };
}

/** For routes/voice.ts's unauthenticated file-serving route only: looks
 * the id up against the real table rather than trusting anything about
 * the URL itself, so a request for an id that was never issued (or was
 * deleted) 404s instead of resolving to an arbitrary path on disk. Also
 * checks the file is actually still there (a code review, 2026-09-04,
 * found this didn't - unlike deleteClonedVoice()'s own existsSync guard
 * a few lines below in the same file - so a row surviving a crash
 * between writeFileSync and the DB insert, or the file being removed by
 * hand, would pass a nonexistent path straight to the route's
 * `Bun.file()` instead of the clean 404 a missing voice should always
 * produce). */
export function getClonedVoiceFile(id: string): { path: string; mimeType: string } | null {
  const row = db.select().from(clonedVoices).where(eq(clonedVoices.id, id)).get();
  if (!row) return null;
  const path = join(clonedVoicesDir, row.fileName);
  if (!existsSync(path)) return null;
  return { path, mimeType: row.mimeType };
}

export function clonedVoiceExists(id: string): boolean {
  return db.select({ id: clonedVoices.id }).from(clonedVoices).where(eq(clonedVoices.id, id)).get() !== undefined;
}

/** The real value `tts.voice_id` gets set to on select - a plain http URL
 * back at this same process, which is exactly what Pocket TTS's own
 * `/tts` route already accepts for `voice_url` (spec/voice/ts/client.ts),
 * no new scheme or translation needed. */
export function clonedVoiceUrl(id: string): string {
  const baseUrl = isRemoteStackSelected() ? "http://127.0.0.1:8772" : selfBaseUrl();
  return `${baseUrl}/api/voice/cloned/${id}/file`;
}

const VOICE_TOKEN = /^voice-[a-z0-9]{6,}$/;
const VOICE_ADDRESS = /\/cloned\/(voice-[a-z0-9]{6,})\/file/;

/** What a saved voice choice (`tts.voice_id`, `robot.voice.id`) means when it names a voice made at home: the clip's address and the
 * voice's own temperature and pitch. Both the plain token and the older address form are understood; null for anything else. */
export function householdVoiceSpeech(stored: unknown): { voiceUrl: string; temperature?: number; pitchSemitones?: number } | null {
  if (typeof stored !== "string") return null;
  const id = VOICE_TOKEN.test(stored) ? stored : VOICE_ADDRESS.exec(stored)?.[1];
  if (!id) return null;
  const row = db.select().from(clonedVoices).where(eq(clonedVoices.id, id)).get();
  if (!row) return null;
  return {
    voiceUrl: clonedVoiceUrl(id),
    ...(row.temperature !== null ? { temperature: row.temperature } : {}),
    ...(row.pitchSemitones !== null ? { pitchSemitones: row.pitchSemitones } : {}),
  };
}

/** The household's voices as entries of the voice list (speech engine: Chatterbox Turbo). */
export function householdVoiceEntries(): StackVoice[] {
  return db.select().from(clonedVoices).all().map((row) => ({
    id: row.id, name: row.label, description: "A voice made at home.", language: "en", country: "unknown", gender: "unknown" as const,
    source: "cloned" as const, engine: "chatterbox-turbo", onDisk: true, licence: null, revision: "1",
  }));
}
