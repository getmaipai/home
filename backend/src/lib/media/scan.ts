// MEDIA-LIB-01 (design section 8): the one scan orchestrator, ported from FileTube's scan/orchestrator.js. An async walker, one
// interval per root, overlap coalescing (a scan asked for while one runs joins it and runs once more after), the unchanged
// path+size+mtime fast path, and the prune guards: an item is dropped only after it is missing from two scans, never while the
// root is missing, empty, unattributable, partly unreadable, mostly gone, or prune is off. Removing or unmounting a root defers
// prune; nothing here ever deletes an item from the disk or from the database, a pruned item goes to the trash for 30 days.
import { and, eq, isNull, inArray } from "drizzle-orm";
import { readdir, stat } from "node:fs/promises";
import { statSync } from "node:fs";
import { join } from "node:path";
import { db, sqlite } from "@/db";
import { mediaItems, mediaSources, nasMounts } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { newMediaItemId } from "@/lib/id";
import { trackBackgroundWork } from "@/lib/backgroundWork";
import { bandOkAtIngest } from "./band";
import { draftsForDirectory, type Draft, type DirListing, type FileEntry, type IngestContext } from "./ingest";
import { decidePlayable } from "./kinds";
import { healMadeSources } from "./heal";
import { itemToRow, MediaItem, sourceFromRow, type MediaItemRow, type MediaSource } from "./model";
import { createStackProber, type Prober } from "./prober";
import { extensionOf } from "./parsers/text";
import { TRASH_DAYS, type RootKind } from "./sources";

export type PruneGuard = "prune_off" | "root_missing" | "root_empty" | "unattributable_root" | "unreadable_subtree" | "mass_missing";

export interface ScanSummary {
  scanId: string;
  sourceId: string;
  status: "ok" | "root_missing" | "failed";
  added: number;
  updated: number;
  unchanged: number;
  skipped: number;
  errors: number;
  /** Items not seen this time that were kept (the first miss, or a guard held). */
  missing: number;
  /** Items put in the trash because they stayed missing across scans. */
  pruned: number;
  probed: number;
  guards: PruneGuard[];
  startedAt: string;
  durationMs: number;
}

export interface ScanDeps {
  prober?: Prober | null;
  now?: () => number;
  /** How long an item must have been missing, across at least two scans, before it is pruned. */
  pruneGraceMs?: number;
  /** Re-parse every file even when its size and modified time are unchanged. */
  force?: boolean;
  /** The most items probed per scan (the rest wait for the next one). */
  probeBudget?: number;
}

export const DEFAULT_PRUNE_GRACE_MS = 30 * 60 * 1000;
const IGNORED_DIRS = new Set(["@eaDir", "#recycle", "$RECYCLE.BIN", "lost+found", "System Volume Information", ".Trash", ".Trashes", "node_modules"]);
const IGNORED_FILES = new Set(["Thumbs.db", "desktop.ini"]);
const MASS_MISSING_MIN = 20;

async function* walk(rootAbs: string, unreadable: string[]): AsyncGenerator<DirListing> {
  const queue: string[] = [""];
  while (queue.length > 0) {
    const rel = queue.pop()!;
    const abs = rel ? join(rootAbs, rel) : rootAbs;
    let entries;
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch {
      unreadable.push(rel || ".");
      continue;
    }
    if (entries.some((entry) => entry.name === ".nomedia")) continue;
    const files: FileEntry[] = [];
    const dirs: string[] = [];
    for (const entry of entries) {
      const name = entry.name;
      if (name.startsWith(".") || IGNORED_FILES.has(name)) continue;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(name)) dirs.push(name);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        try {
          const info = await stat(join(abs, name));
          if (info.isFile()) files.push({ name, rel: rel ? `${rel}/${name}` : name, abs: join(abs, name), size: info.size, mtimeMs: info.mtimeMs });
        } catch {
          unreadable.push(rel ? `${rel}/${name}` : name);
        }
      }
    }
    files.sort((a, b) => a.name.localeCompare(b.name));
    yield { rel, abs, files };
    // Pre-order, alphabetical: push in reverse so the first folder pops first.
    for (const dir of dirs.sort().reverse()) queue.push(rel ? `${rel}/${dir}` : dir);
  }
}

function underAny(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => prefix === "." || path === prefix || path.startsWith(`${prefix}/`));
}

function rootAttributable(row: typeof mediaSources.$inferSelect): boolean {
  if (row.kind !== "root" || !row.rootPath || row.deletedAt) return false;
  if (row.rootMountId && !db.select({ id: nasMounts.id }).from(nasMounts).where(eq(nasMounts.id, row.rootMountId)).get()) return false;
  return true;
}

function recordFor(scanned: Draft, source: MediaSource, existing: MediaItemRow | undefined, parentId: string | null, bandFloor: MediaItem["band_ok"] | null, now: string): { item: MediaItem; extras: { pages: number | null; probeFailedFp: string | null } } {
  // An edited field is locked: the existing row's value wins over the scanned one.
  const locked = (existing?.lockedFields ? JSON.parse(existing.lockedFields) : []) as MediaItem["locked_fields"];
  const draft: Draft = { ...scanned };
  const keptArtwork = existing && locked.includes("artwork") ? (existing.artwork ? JSON.parse(existing.artwork) as MediaItem["artwork"] : null) : undefined;
  if (existing) {
    if (locked.includes("title")) draft.title = existing.title;
    if (locked.includes("description")) draft.description = existing.description;
    if (locked.includes("artist")) draft.artist = existing.artist;
    if (locked.includes("artwork")) draft.artworkPath = (existing.artwork ? (JSON.parse(existing.artwork) as { path?: string }).path : null) ?? null;
  }
  const oldLyrics = existing?.lyrics ? JSON.parse(existing.lyrics) as MediaItem["lyrics"] : null;
  const lyrics = draft.lyrics ?? (oldLyrics && ["made", "lrclib"].includes(oldLyrics.source) ? oldLyrics : null);
  const verdict = bandOkAtIngest({ explicit: draft.explicit, title: draft.title, description: draft.description, lyrics: lyrics?.text, also: [draft.subtitle, draft.artist, draft.album, draft.series, draft.author] });
  let band = verdict.band;
  if (bandFloor === "adult") band = "adult"; // a chapter file is never lower than its book
  if (existing?.verifiedByPersonId) band = existing.bandOk as MediaItem["band_ok"]; // an adult marked it
  const item = MediaItem.parse({
    id: existing?.id ?? newMediaItemId(), kind: draft.kind, title: draft.title, subtitle: draft.subtitle, description: draft.description, source_id: source.id, parent_id: parentId,
    location: { root_id: source.id, path: draft.rel }, media_type: draft.mediaType, duration_s: draft.durationS, size: draft.size, width: draft.width, height: draft.height,
    video_codec: draft.videoCodec, audio_codec: draft.audioCodec, playable: draft.playable, artwork: keptArtwork !== undefined ? keptArtwork : draft.artworkPath ? { path: draft.artworkPath } : null, previews: null,
    chapters: draft.chapters, subtitles: [], series: draft.series, season: draft.season, episode: draft.episode, artist: draft.artist, album: draft.album, album_artist: draft.albumArtist,
    track_no: draft.trackNo, disc_no: draft.discNo, year: draft.year, genre: draft.genre, author: draft.author, narrator: draft.narrator, series_index: draft.seriesIndex,
    locator_kind: draft.locatorKind, external: null, lyrics, locked_fields: locked, advisory: { explicit: draft.explicit, source: verdict.advisorySource }, band_ok: band,
    verified_by_person_id: existing?.verifiedByPersonId ?? null, added_at: existing?.addedAt ?? now, fingerprint: draft.fingerprint || null, hidden: existing?.hidden ?? false,
    deleted_at: existing?.deletedAt && existing.missingSince === null ? existing.deletedAt : null, trash_until: existing?.deletedAt && existing.missingSince === null ? existing.trashUntil : null,
    created_at: existing?.createdAt ?? now, hlc: nextHlc(), provenance: `scan:${source.id}`,
  });
  return { item, extras: { pages: draft.pages, probeFailedFp: null } };
}

async function runScan(sourceId: string, deps: ScanDeps): Promise<ScanSummary> {
  const nowMs = deps.now ?? Date.now;
  const started = nowMs();
  const startedAt = new Date(started).toISOString();
  const scanId = `scan-${started.toString(36)}`;
  const summary: ScanSummary = { scanId, sourceId, status: "ok", added: 0, updated: 0, unchanged: 0, skipped: 0, errors: 0, missing: 0, pruned: 0, probed: 0, guards: [], startedAt, durationMs: 0 };
  const finish = (): ScanSummary => {
    summary.durationMs = nowMs() - started;
    db.update(mediaSources).set({ lastCheckedAt: new Date(nowMs()).toISOString(), lastStatus: summary.status === "ok" ? "ok" : summary.status === "root_missing" ? "root_missing" : "failed", lastScanSummary: JSON.stringify(summary) }).where(eq(mediaSources.id, sourceId)).run();
    return summary;
  };

  const row = db.select().from(mediaSources).where(eq(mediaSources.id, sourceId)).get();
  if (!row || row.deletedAt) {
    // A removed root: nothing is scanned and nothing is pruned.
    summary.status = "failed";
    summary.guards.push("unattributable_root");
    return row ? finish() : summary;
  }
  if (!rootAttributable(row)) {
    summary.status = "failed";
    summary.guards.push("unattributable_root");
    return finish();
  }
  const source = sourceFromRow(row);
  const rootAbs = row.rootPath!;
  try {
    if (!statSync(rootAbs).isDirectory()) throw new Error("not a directory");
  } catch {
    summary.status = "root_missing";
    summary.guards.push("root_missing");
    return finish();
  }

  const kinds = new Set<RootKind>(JSON.parse(row.rootKinds ?? "[]") as RootKind[]);
  const archive = new Set<string>(JSON.parse(row.archive) as string[]);
  const existing = new Map<string, MediaItemRow>();
  for (const item of db.select().from(mediaItems).where(eq(mediaItems.locRootId, sourceId)).all()) if (item.locPath !== null) existing.set(item.locPath, item);
  const liveBefore = [...existing.values()].filter((item) => !item.deletedAt).length;

  const unreadable: string[] = [];
  const listings = new Map<string, string[]>();
  let filesSeen = 0;
  const now = new Date(nowMs()).toISOString();
  const isUnchanged = (rel: string, fingerprint: string): boolean => {
    if (deps.force) return false;
    const prior = existing.get(rel);
    return prior !== undefined && prior.fingerprint === fingerprint;
  };

  for await (const listing of walk(rootAbs, unreadable)) {
    listings.set(listing.rel, listing.files.map((file) => file.name));
    // Names of the folder and its parent folders are what art lookups need; the walk is pre-order so parents are already here.
    filesSeen += listing.files.length;
    const ctx: IngestContext = { kinds, namesIn: (relDir) => listings.get(relDir) ?? [] };
    let built;
    try {
      built = await draftsForDirectory(listing, ctx, isUnchanged);
    } catch {
      summary.errors++;
      // The folder could not be read as media: keep what it held rather than treating it as gone.
      unreadable.push(listing.rel || ".");
      continue;
    }
    // Parsing yields to trash actions. Re-read tombstones before writing so a concurrent purge stays gone.
    const currentSource = db.select().from(mediaSources).where(eq(mediaSources.id, sourceId)).get();
    archive.clear();
    for (const path of JSON.parse(currentSource?.archive ?? "[]") as string[]) archive.add(path);
    summary.skipped += built.skipped;
    const writes: Array<() => void> = [];
    for (const draft of built.drafts) {
      if (archive.has(draft.rel)) { summary.skipped++; continue; }
      writes.push(() => {
        const prior = existing.get(draft.rel);
        const parent = recordFor(draft, source, prior, null, null, now);
        persist(parent.item, prior, scanId, parent.extras);
        prior ? summary.updated++ : summary.added++;
        for (const child of draft.children) {
          if (archive.has(child.rel)) { summary.skipped++; continue; }
          const priorChild = existing.get(child.rel);
          const record = recordFor(child, source, priorChild, parent.item.id, parent.item.band_ok, now);
          persist(record.item, priorChild, scanId, record.extras);
          priorChild ? summary.updated++ : summary.added++;
        }
      });
    }
    const touchedHere = built.touched.filter((path) => !archive.has(path));
    summary.unchanged += touchedHere.length;
    sqlite.transaction(() => {
      for (const write of writes) write();
      touch(sourceId, touchedHere, scanId);
    })();
    // Let other work in (requests, the next folder's reads) between folders.
    await new Promise((resolve) => setImmediate(resolve));
  }

  prune(source, row, existing, scanId, { unreadable, filesSeen, liveBefore, nowMs, graceMs: deps.pruneGraceMs ?? DEFAULT_PRUNE_GRACE_MS }, summary);

  const prober = deps.prober === undefined ? createStackProber() : deps.prober;
  if (prober) summary.probed = await probePending(sourceId, rootAbs, prober, deps.probeBudget ?? 200);
  return finish();
}

function persist(item: MediaItem, prior: MediaItemRow | undefined, scanId: string, extras: { pages: number | null; probeFailedFp: string | null }): void {
  const values = itemToRow(item, { lastSeenScan: scanId, missingSince: null, pages: extras.pages, probeFailedFp: extras.probeFailedFp });
  if (prior) {
    const { id: _id, createdAt: _created, ...rest } = values;
    db.update(mediaItems).set(rest).where(eq(mediaItems.id, prior.id)).run();
  } else {
    db.insert(mediaItems).values(values).run();
  }
}

/** The fast path: these paths are unchanged, so they are only marked seen (and brought back from the trash if a scan had pruned them). */
function touch(sourceId: string, paths: readonly string[], scanId: string): void {
  for (let i = 0; i < paths.length; i += 400) {
    const chunk = paths.slice(i, i + 400);
    const marks = chunk.map(() => "?").join(",");
    sqlite
      .query(
        `UPDATE media_items SET last_seen_scan = ?, deleted_at = CASE WHEN missing_since IS NOT NULL THEN NULL ELSE deleted_at END,
         trash_until = CASE WHEN missing_since IS NOT NULL THEN NULL ELSE trash_until END, missing_since = NULL
         WHERE loc_root_id = ? AND loc_path IN (${marks})`,
      )
      .run(scanId, sourceId, ...chunk);
  }
}

interface PruneContext {
  unreadable: readonly string[];
  filesSeen: number;
  liveBefore: number;
  nowMs: () => number;
  graceMs: number;
}

function prune(source: MediaSource, row: typeof mediaSources.$inferSelect, existing: Map<string, MediaItemRow>, scanId: string, ctx: PruneContext, summary: ScanSummary): void {
  // What this scan saw has lastSeenScan = scanId in the database (a new or changed file was written, an unchanged one touched).
  const seenNow = new Set(
    db.select({ path: mediaItems.locPath }).from(mediaItems).where(and(eq(mediaItems.locRootId, source.id), eq(mediaItems.lastSeenScan, scanId))).all().map((r) => r.path ?? ""),
  );
  const missing = [...existing.values()].filter((item) => !(item.deletedAt && item.missingSince === null) /* a person deleted it: stays gone */ && !seenNow.has(item.locPath ?? ""));
  if (!row.prune) summary.guards.push("prune_off");
  if (ctx.filesSeen === 0 && ctx.liveBefore > 0) summary.guards.push("root_empty");
  if (missing.length >= MASS_MISSING_MIN && missing.length / Math.max(ctx.liveBefore, 1) > 0.5) summary.guards.push("mass_missing");
  if (ctx.unreadable.length > 0) summary.guards.push("unreadable_subtree");
  const blocked = summary.guards.some((guard) => guard === "prune_off" || guard === "root_empty" || guard === "mass_missing");
  const nowIso = new Date(ctx.nowMs()).toISOString();
  const trashUntil = new Date(ctx.nowMs() + TRASH_DAYS * 24 * 3600 * 1000).toISOString();
  for (const item of missing) {
    const path = item.locPath ?? "";
    if (blocked || underAny(path, ctx.unreadable)) { summary.missing++; continue; }
    if (item.deletedAt) continue; // already in the trash, still missing
    if (item.missingSince === null) {
      // Deferred: the first miss only starts the clock.
      db.update(mediaItems).set({ missingSince: nowIso }).where(eq(mediaItems.id, item.id)).run();
      summary.missing++;
    } else if (ctx.nowMs() - new Date(item.missingSince).getTime() >= ctx.graceMs) {
      db.update(mediaItems).set({ deletedAt: nowIso, trashUntil, hlc: nextHlc() }).where(eq(mediaItems.id, item.id)).run();
      summary.pruned++;
    } else {
      summary.missing++;
    }
  }
}

/** Probes video items still `unknown` (see prober.ts). Stops at the first few "nothing answered", leaving the rest for a later scan. */
export async function probePending(sourceId: string, rootAbs: string, prober: Prober, budget: number): Promise<number> {
  const rows = db
    .select()
    .from(mediaItems)
    .where(and(eq(mediaItems.locRootId, sourceId), eq(mediaItems.playable, "unknown"), isNull(mediaItems.deletedAt), inArray(mediaItems.kind, ["video", "episode", "film"])))
    .limit(budget)
    .all()
    .filter((item) => item.probeFailedFp === null || item.probeFailedFp !== item.fingerprint);
  let probed = 0;
  let unavailable = 0;
  for (const item of rows) {
    if (unavailable >= 3) break;
    const result = await prober.probe(join(rootAbs, item.locPath ?? ""));
    if (result === "unavailable") { unavailable++; continue; }
    if (result === null) {
      db.update(mediaItems).set({ probeFailedFp: item.fingerprint, playable: "none" }).where(eq(mediaItems.id, item.id)).run();
      continue;
    }
    const playable = decidePlayable({ ext: extensionOf(item.locPath ?? ""), hasVideo: result.hasVideo, hasAudio: result.hasAudio, videoCodec: result.videoCodec, audioCodec: result.audioCodec });
    const keepChapters = JSON.parse(item.chapters) as unknown[];
    db.update(mediaItems)
      .set({
        durationS: result.durationS ?? item.durationS, width: result.width, height: result.height, videoCodec: result.videoCodec, audioCodec: result.audioCodec, playable,
        chapters: keepChapters.length > 0 ? item.chapters : JSON.stringify(result.chapters.map((chapter) => ({ ...chapter, source: "embedded" }))), probeFailedFp: null, hlc: nextHlc(),
      })
      .where(eq(mediaItems.id, item.id))
      .run();
    probed++;
  }
  return probed;
}

interface Running {
  again: boolean;
  promise: Promise<ScanSummary>;
}
const running = new Map<string, Running>();

/** Scans one root. A request while that root is being scanned joins the running scan and asks for one more pass after it, so a burst
 * of "rescan" clicks or interval ticks is at most two runs, never a pile. */
export function scanRoot(sourceId: string, deps: ScanDeps = {}): Promise<ScanSummary> {
  const live = running.get(sourceId);
  if (live) {
    live.again = true;
    return live.promise;
  }
  const entry: Running = { again: false, promise: Promise.resolve(null as unknown as ScanSummary) };
  entry.promise = (async () => {
    try {
      let summary: ScanSummary;
      do {
        entry.again = false;
        summary = await runScan(sourceId, deps);
      } while (entry.again);
      return summary;
    } finally {
      running.delete(sourceId);
    }
  })();
  running.set(sourceId, entry);
  return entry.promise;
}

export function isScanning(sourceId: string): boolean {
  return running.has(sourceId);
}

// One interval per root. `syncMediaScanner` reconciles the timers with the live roots (called at boot and after a root is added or removed).
const timers = new Map<string, { timer: ReturnType<typeof setInterval>; minutes: number }>();

export function syncMediaScanner(deps: ScanDeps = {}): void {
  const roots = db.select().from(mediaSources).where(and(eq(mediaSources.kind, "root"), isNull(mediaSources.deletedAt))).all();
  const wanted = new Map(roots.filter((root) => !root.paused).map((root) => [root.id, root.pollMinutes]));
  for (const [id, entry] of timers) {
    if (wanted.get(id) !== entry.minutes) {
      clearInterval(entry.timer);
      timers.delete(id);
    }
  }
  for (const [id, minutes] of wanted) {
    if (timers.has(id)) continue;
    const timer = setInterval(() => { trackBackgroundWork(scanRoot(id, deps).catch(() => undefined)); }, minutes * 60_000);
    timer.unref?.();
    timers.set(id, { timer, minutes });
  }
}



/** Boot: one interval per root, and a first pass a minute later for any root not scanned within its own interval. */
export function startMediaScanner(deps: ScanDeps = {}): void {
  healMadeSources();
  syncMediaScanner(deps);
  const first = setTimeout(() => {
    const now = Date.now();
    for (const root of db.select().from(mediaSources).where(and(eq(mediaSources.kind, "root"), isNull(mediaSources.deletedAt))).all()) {
      const last = root.lastCheckedAt ? new Date(root.lastCheckedAt).getTime() : 0;
      if (!root.paused && now - last >= root.pollMinutes * 60_000) trackBackgroundWork(scanRoot(root.id, deps).catch(() => undefined));
    }
  }, 60_000);
  first.unref?.();
}
