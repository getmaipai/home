// MEDIA-LIB-01: media sources of kind `root`: a folder of media on a mounted NAS share (a `nas_mounts` row) or on the hub's own
// disk. Admin-only to create or remove. Roots may not overlap (design section 7): a folder inside another root, or holding one,
// would be scanned twice and show every title twice. Removing a root hides its items and keeps them: a removed or unmounted root
// never deletes anything, it is only in the trash until it is restored or purged.
import { and, eq, isNull } from "drizzle-orm";
import { existsSync, realpathSync, statSync } from "node:fs";
import { sep } from "node:path";
import { db } from "@/db";
import { mediaSources, nasMounts } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { newMediaSourceId } from "@/lib/id";
import type { PersonRow } from "@/types";
import { sourceFromRow, type MediaSource } from "./model";

export const ROOT_KINDS = ["video", "episode", "film", "track", "book", "audiobook"] as const;
export type RootKind = (typeof ROOT_KINDS)[number];
export const TRASH_DAYS = 30;

export type SourceResult = { ok: true; source: MediaSource } | { ok: false; status: 400 | 404 | 409; error: string };

export interface RootInput {
  label: string;
  path: string;
  mountId?: string | null;
  kinds: readonly RootKind[];
  visibleTo?: "household" | string[];
  pollMinutes?: number;
  prune?: boolean;
}

function withSep(path: string): string {
  return path.endsWith(sep) ? path : path + sep;
}

/** True when one folder is the other or sits inside it. */
export function pathsOverlap(a: string, b: string): boolean {
  return withSep(a).startsWith(withSep(b)) || withSep(b).startsWith(withSep(a));
}

export function liveRoots(): MediaSource[] {
  return db.select().from(mediaSources).where(and(eq(mediaSources.kind, "root"), isNull(mediaSources.deletedAt))).all().map(sourceFromRow);
}

export function createRootSource(actor: PersonRow, input: RootInput): SourceResult {
  const label = input.label.trim();
  if (!label) return { ok: false, status: 400, error: "Give the folder a name, such as Family movies." };
  const requested = input.path.trim();
  if (!requested) return { ok: false, status: 400, error: "Choose a folder to scan." };
  if (!requested.startsWith("/")) return { ok: false, status: 400, error: "Use the full path of the folder, starting with /." };
  let real: string;
  try {
    if (!existsSync(requested) || !statSync(requested).isDirectory()) return { ok: false, status: 400, error: `${requested} is not a folder on this computer. Check the path, or mount the share first.` };
    real = realpathSync(requested);
  } catch {
    return { ok: false, status: 400, error: `This computer cannot open ${requested}. Check the path and its permissions.` };
  }
  const kinds = [...new Set(input.kinds)];
  if (kinds.length === 0) return { ok: false, status: 400, error: "Say what the folder holds: videos, shows, films, music, books or audiobooks." };
  let mountId: string | null = null;
  if (input.mountId) {
    const mount = db.select().from(nasMounts).where(eq(nasMounts.id, input.mountId)).get();
    if (!mount) return { ok: false, status: 404, error: "That network share is not set up. Add it under Settings, Storage first." };
    let mountReal: string;
    try { mountReal = realpathSync(mount.path); } catch { return { ok: false, status: 400, error: `The share ${mount.label} is not mounted right now. Mount it, then try again.` }; }
    if (!withSep(real).startsWith(withSep(mountReal))) return { ok: false, status: 400, error: `${requested} is not inside the share ${mount.label}.` };
    mountId = mount.id;
  }
  for (const other of liveRoots()) {
    const otherPath = other.root?.path;
    if (otherPath && pathsOverlap(real, otherPath)) {
      return { ok: false, status: 409, error: `${requested} overlaps the folder "${other.label}" that is already scanned, so every title would appear twice. Pick a folder that is not inside it or around it.` };
    }
  }
  const visibleTo = input.visibleTo ?? "household";
  const now = new Date().toISOString();
  const id = newMediaSourceId();
  db.insert(mediaSources).values({
    id, kind: "root", scope: "household", ownerPersonId: actor.id, label, rootMountId: mountId, rootPath: real, rootKinds: JSON.stringify(kinds),
    pollMinutes: Math.min(Math.max(Math.round(input.pollMinutes ?? 60), 5), 24 * 60), visibleTo: JSON.stringify(visibleTo), prune: input.prune ?? true,
    createdAt: now, hlc: nextHlc(), provenance: `person:${actor.id}`,
  }).run();
  return { ok: true, source: sourceFromRow(db.select().from(mediaSources).where(eq(mediaSources.id, id)).get()!) };
}

/** Takes a root out of use. Its items stay (hidden because their source is gone) so a restore brings them back. */
export function removeSource(id: string): SourceResult {
  const row = db.select().from(mediaSources).where(and(eq(mediaSources.id, id), isNull(mediaSources.deletedAt))).get();
  if (!row) return { ok: false, status: 404, error: "That folder is not in the library." };
  const now = new Date();
  const until = new Date(now.getTime() + TRASH_DAYS * 24 * 3600 * 1000);
  db.update(mediaSources).set({ deletedAt: now.toISOString(), trashUntil: until.toISOString(), hlc: nextHlc() }).where(eq(mediaSources.id, id)).run();
  return { ok: true, source: sourceFromRow(db.select().from(mediaSources).where(eq(mediaSources.id, id)).get()!) };
}

export function listSourcesFor(visible: (source: MediaSource) => boolean): MediaSource[] {
  return db.select().from(mediaSources).where(isNull(mediaSources.deletedAt)).all().map(sourceFromRow).filter(visible);
}

/** "Deleted stays gone": remember a path a person deleted so a re-scan never brings it back. */
export function archivePath(sourceId: string, path: string): void {
  const row = db.select().from(mediaSources).where(eq(mediaSources.id, sourceId)).get();
  if (!row) return;
  const archive: string[] = JSON.parse(row.archive) as string[];
  if (archive.includes(path)) return;
  archive.push(path);
  db.update(mediaSources).set({ archive: JSON.stringify(archive), hlc: nextHlc() }).where(eq(mediaSources.id, sourceId)).run();
}
