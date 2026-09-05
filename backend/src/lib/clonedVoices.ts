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
import { isOwnerOrAdmin } from "@/lib/access";
import { clearMatchingValues } from "@/lib/settings";
import type { PersonRow } from "@/types";
import type { ClonedVoiceInfo } from "@/wire";

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

function toInfo(row: typeof clonedVoices.$inferSelect, creatorName: string): ClonedVoiceInfo {
  return {
    id: row.id,
    label: row.label,
    creatorId: row.creatorId,
    creatorName,
    bytes: row.bytes,
    createdAt: row.createdAt,
  };
}

/** Household-wide, not per-person: the same "anyone can select any voice
 * regardless of who found it" visibility the community catalog already
 * has - see schema.ts's own comment on clonedVoices for why. */
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
): ClonedVoiceOpResult<ClonedVoiceInfo> {
  const trimmedLabel = label.trim();
  if (!trimmedLabel) return { ok: false, status: 400, error: "label is required" };
  if (bytes.byteLength === 0) return { ok: false, status: 400, error: "the uploaded file is empty" };
  if (bytes.byteLength > MAX_BYTES) {
    return { ok: false, status: 400, error: `file must be ${MAX_BYTES / (1024 * 1024)}MB or smaller` };
  }
  const extension = EXTENSION_BY_MIME[mimeType];
  if (!extension) return { ok: false, status: 400, error: `unsupported audio type: ${mimeType}` };

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
  return { ok: true, value: toInfo(row, creator.displayName) };
}

/** Creator or owner/admin only - the same "you, or a parent-tier role"
 * shape memory's forget() and the backups routes already use for
 * household-shared-but-personally-created data. */
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
  // 404s - pocket-tts's own /tts call would fail with no obvious cause.
  // Matches by the id's own path segment, not the full stored URL: a
  // code review caught that comparing the whole `clonedVoiceUrl(id)`
  // string would silently stop matching if the hub were ever restarted
  // on a different PORT between when a person selected this voice and
  // when it was deleted - the id itself never changes, so anchoring the
  // match to it (not the host/port it happened to resolve through) is
  // real going forward, not just checked once.
  clearMatchingValues("tts.voice_id", `/cloned/${id}/file`);
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
  return `${selfBaseUrl()}/api/voice/cloned/${id}/file`;
}
