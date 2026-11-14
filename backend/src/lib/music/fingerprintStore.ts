// MUSIC-ID-01: library song fingerprints (table music_fingerprints) and the best-effort background pass that fills them.
// One file at a time after a library scan, skipped when fpcalc is missing, never on the scan's own path (rule 6).
// Rule 6a: logs carry counts and timings only.
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { mediaItems, mediaSources, musicFingerprints } from "@/db/schema";
import { trackBackgroundWork } from "@/lib/backgroundWork";
import { resolveUnderRoot } from "@/lib/media/serve";
import { findFpcalc, fingerprintFile, packRaw, unpackRaw } from "./identifyAudio";

export type LibraryFingerprint = { itemId: string; title: string; artist: string; album: string | null; recordingId: string | null; artistId: string | null; releaseGroupId: string | null; raw: Uint32Array };

/** How many library songs have a usable fingerprint (an empty marker for an unreadable file does not count). */
export function libraryFingerprintCount(): number {
  return db.select({ n: sql<number>`count(*)` }).from(musicFingerprints).where(sql`${musicFingerprints.fingerprint} <> ''`).get()?.n ?? 0;
}

// Decoded fingerprints are kept in memory between calls and rebuilt when the stored count or newest write changes.
let memo: { stamp: string; rows: LibraryFingerprint[] } | null = null;
/** Every usable library fingerprint with the song it belongs to. Trashed and hidden songs are left out. */
export function loadLibraryFingerprints(): LibraryFingerprint[] {
  const stamp = db.select({ s: sql<string>`count(*) || ':' || coalesce(max(${musicFingerprints.createdAt}), '')` }).from(musicFingerprints).get()?.s ?? "0:";
  const live = db.select({ n: sql<number>`count(*)` }).from(mediaItems).where(and(eq(mediaItems.kind, "track"), isNull(mediaItems.deletedAt), eq(mediaItems.hidden, false))).get()?.n ?? 0;
  const key = `${stamp}:${live}`;
  if (memo?.stamp === key) return memo.rows;
  const rows = db.select({
    itemId: mediaItems.id, title: mediaItems.title, artist: mediaItems.artist, album: mediaItems.album,
    recordingId: mediaItems.musicbrainzRecordingId, artistId: mediaItems.musicbrainzArtistId, releaseGroupId: mediaItems.musicbrainzReleaseGroupId,
    fingerprint: musicFingerprints.fingerprint,
  }).from(musicFingerprints).innerJoin(mediaItems, eq(mediaItems.id, musicFingerprints.itemId))
    .where(and(sql`${musicFingerprints.fingerprint} <> ''`, eq(mediaItems.kind, "track"), isNull(mediaItems.deletedAt), eq(mediaItems.hidden, false))).all()
    .map((row) => ({ itemId: row.itemId, title: row.title, artist: row.artist ?? "", album: row.album, recordingId: row.recordingId, artistId: row.artistId, releaseGroupId: row.releaseGroupId, raw: unpackRaw(row.fingerprint) }));
  memo = { stamp: key, rows };
  return rows;
}
export function __resetFingerprintMemoForTests(): void { memo = null; }

export interface FingerprintPassDeps {
  fingerprint?: (path: string) => Promise<Uint32Array | null>;
  hasFpcalc?: () => boolean;
  now?: () => number;
  budget?: number;
}
export type FingerprintPassResult = { considered: number; stored: number; failed: number; skipped: boolean; ms: number };
const PASS_BUDGET = 25;

/** One pass: library songs with no fingerprint (or whose file changed), one at a time. Never throws. */
export async function runFingerprintPass(deps: FingerprintPassDeps = {}): Promise<FingerprintPassResult> {
  const now = deps.now ?? Date.now;
  const started = now();
  const result: FingerprintPassResult = { considered: 0, stored: 0, failed: 0, skipped: false, ms: 0 };
  try {
    if (!(deps.hasFpcalc ?? (() => findFpcalc() !== null))()) { result.skipped = true; return result; }
    const run = deps.fingerprint ?? fingerprintFile;
    const rows = db.select({ id: mediaItems.id, sourceId: mediaItems.locRootId, path: mediaItems.locPath, fileKey: mediaItems.fingerprint, existingKey: musicFingerprints.fileKey })
      .from(mediaItems)
      .innerJoin(mediaSources, eq(mediaSources.id, mediaItems.sourceId))
      .leftJoin(musicFingerprints, eq(musicFingerprints.itemId, mediaItems.id))
      .where(and(
        eq(mediaItems.kind, "track"), isNull(mediaItems.deletedAt), eq(mediaSources.kind, "root"),
        sql`${mediaItems.locRootId} IS NOT NULL AND ${mediaItems.locPath} IS NOT NULL`,
        sql`${mediaItems.provenance} <> 'music:generated-library'`, sql`${mediaItems.sourceId} NOT LIKE 'msrc-made%'`,
        sql`(${musicFingerprints.itemId} IS NULL OR ${musicFingerprints.fileKey} <> coalesce(${mediaItems.fingerprint}, ''))`,
      ))
      .limit(deps.budget ?? PASS_BUDGET).all();
    for (const row of rows) {
      result.considered++;
      const abs = resolveUnderRoot(row.sourceId!, row.path!);
      let packed = "";
      if (abs) {
        try {
          const raw = await run(abs);
          if (raw && raw.length > 0) packed = packRaw(raw);
        } catch { /* an unreadable file is marked below */ }
      }
      if (packed === "") result.failed++; else result.stored++;
      const values = { itemId: row.id, fingerprint: packed, fileKey: row.fileKey ?? "", createdAt: new Date(now()).toISOString() };
      db.insert(musicFingerprints).values(values).onConflictDoUpdate({ target: musicFingerprints.itemId, set: values }).run();
    }
  } catch { /* best effort */ }
  result.ms = now() - started;
  if (result.considered > 0) console.log(`[music] fingerprint pass considered=${result.considered} stored=${result.stored} failed=${result.failed} ms=${result.ms}`);
  return result;
}

let running: Promise<FingerprintPassResult> | null = null;
let again = false;
/** Start a pass in the background (a request during a pass asks for one more after it). Never awaited by a scan. */
export function kickFingerprintPass(deps: FingerprintPassDeps = {}): Promise<FingerprintPassResult> {
  if (process.env.MAIPAI_FINGERPRINT_NO_AUTOSTART === "1") return Promise.resolve({ considered: 0, stored: 0, failed: 0, skipped: true, ms: 0 });
  if (running) { again = true; return running; }
  const run = (async () => {
    let last: FingerprintPassResult;
    do {
      again = false;
      last = await runFingerprintPass(deps);
    } while (again && last.considered > 0);
    return last;
  })().finally(() => { running = null; });
  running = run;
  return trackBackgroundWork(run);
}
