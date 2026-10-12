// MINOR-SEARCH-01e-4: where the verified blocked-site list files live and what the sync job remembers.
//
//   <blockListsDir>/<list id>/<sha256>.txt   the verified file (name = its checksum, so a swap is atomic)
//   <blockListsDir>/state.json               the rollback mark, the index ETag, the back-off and, per list,
//                                            the current and the previous good copy
//
// A list file is trusted only while its bytes hash to the sha256 in its name AND in the state; boot re-hashes
// (`reverifyStoredLists`). The previous good copy stays for rollback; anything older is removed after a swap.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseHostList, type HostListFormat, type HostListParse } from "@maipai/spec/interpreters/ts/hostList.js";
import { blockListsDir } from "@/lib/paths";
import { sha256OfFile } from "@/lib/modelDownload";
import type { AgeBand } from "@/lib/ageBand";
import { enabledListIds } from "@/lib/blocklists/policy";

export interface StoredList {
  sha256: string;
  entries: number;
  bytes: number;
  format: HostListFormat;
  pinnedAt: string;
  loadedAt: string;
  /** The copy that was current before this one, kept for rollback until the next swap. */
  previousSha256: string | null;
}

export interface ListSyncState {
  version: 1;
  /** Highest `published` of any index this home has verified: the rollback mark. */
  publishedSeen: number;
  etag: string | null;
  /** ISO time before which the job does not look again (daily, hourly until the first load, or a back-off). */
  nextCheckAt: string | null;
  /** Days of the current back-off (0 = none), doubling to 7. */
  backoffDays: number;
  lastGoodAt: string | null;
  lists: Record<string, StoredList>;
}

export function emptyState(): ListSyncState {
  return { version: 1, publishedSeen: 0, etag: null, nextCheckAt: null, backoffDays: 0, lastGoodAt: null, lists: {} };
}

const SAFE_ID = /^[a-z][a-z0-9-]*$/;
const SHA = /^[0-9a-f]{64}$/;

function statePath(): string {
  return join(blockListsDir, "state.json");
}

export function listFilePath(id: string, sha256: string): string {
  if (!SAFE_ID.test(id) || !SHA.test(sha256)) throw new Error(`not a valid list file: ${id} ${sha256}`);
  return join(blockListsDir, id, `${sha256}.txt`);
}

export function readState(): ListSyncState {
  try {
    const raw = JSON.parse(readFileSync(statePath(), "utf-8")) as Partial<ListSyncState>;
    if (raw && raw.version === 1 && raw.lists && typeof raw.lists === "object") return { ...emptyState(), ...raw, lists: { ...raw.lists } } as ListSyncState;
  } catch {
    // missing or unreadable: start empty. Files are re-hashed against the pins on the next sync.
  }
  return emptyState();
}

export function writeState(state: ListSyncState): void {
  mkdirSync(blockListsDir, { recursive: true });
  const tmp = `${statePath()}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, statePath());
}

/** Removes every file in a list's folder except those named in `keep` (checksums). */
export function pruneListFiles(id: string, keep: Set<string>): void {
  if (!SAFE_ID.test(id)) return;
  const dir = join(blockListsDir, id);
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const sha = name.endsWith(".txt") ? name.slice(0, -4) : null;
    if (sha && keep.has(sha)) continue;
    rmSync(join(dir, name), { force: true });
  }
}

/** Parses a stored file with the spec's one reader. Null when the file is missing. */
export function parseStoredFile(id: string, entry: Pick<StoredList, "sha256" | "format">): HostListParse | null {
  const path = listFilePath(id, entry.sha256);
  if (!existsSync(path)) return null;
  return parseHostList(readFileSync(path, "utf-8"), entry.format);
}

function currentFileExists(id: string, entry: StoredList): boolean {
  try {
    return existsSync(listFilePath(id, entry.sha256));
  } catch {
    return false;
  }
}

/** True when a list has a verified copy loaded and its file is still on disk. A file that vanished while the hub
 * runs reads as not loaded, so the gate fails closed (the next sync fetches it again). */
export function isListLoaded(id: string): boolean {
  const entry = readState().lists[id];
  return Boolean(entry) && currentFileExists(id, entry!);
}

/** Every list enabled for the band has loaded at least once: the gate a child or teen's web search waits on
 * (design section 3, "offline and first boot"). An adult band with no list enabled is always ready. */
export function listsReadyForBand(band: AgeBand): boolean {
  const loaded = readState().lists;
  return enabledListIds(band).every((id) => Boolean(loaded[id]) && currentFileExists(id, loaded[id]!));
}

export interface ReverifyReport {
  /** Lists whose current copy no longer matched its checksum and were dropped (rolled back when a good previous copy exists). */
  dropped: string[];
  rolledBack: string[];
}

/** Boot check: re-hash each current file against the state. A mismatch deletes the file and rolls back to the
 * previous good copy when it still verifies, else the list reads as not loaded (and the next sync fetches it).
 * The hashing is slow, so the changes are applied to a fresh read of the state: a sync that finished meanwhile
 * keeps its newer entries and its rollback mark. */
export async function reverifyStoredLists(): Promise<ReverifyReport> {
  const before = readState();
  const report: ReverifyReport = { dropped: [], rolledBack: [] };
  const decisions: Array<{ id: string; from: string; to: StoredList | null }> = [];
  for (const [id, entry] of Object.entries(before.lists)) {
    try {
      if (await fileMatches(id, entry.sha256)) continue;
      rmSync(listFilePath(id, entry.sha256), { force: true });
      if (entry.previousSha256 && (await fileMatches(id, entry.previousSha256))) {
        const parsed = parseStoredFile(id, { sha256: entry.previousSha256, format: entry.format });
        if (parsed) {
          decisions.push({
            id,
            from: entry.sha256,
            to: { ...entry, sha256: entry.previousSha256, entries: parsed.entries, bytes: readFileSync(listFilePath(id, entry.previousSha256)).length, previousSha256: null },
          });
          continue;
        }
      }
    } catch {
      // A malformed row (a bad id or checksum) is a mismatch, not a reason to skip the lists after it.
    }
    decisions.push({ id, from: entry.sha256, to: null });
  }
  if (decisions.length === 0) return report;
  const fresh = readState();
  for (const d of decisions) {
    if (fresh.lists[d.id]?.sha256 !== d.from) continue;
    if (d.to) {
      fresh.lists[d.id] = d.to;
      report.rolledBack.push(d.id);
    } else {
      delete fresh.lists[d.id];
      report.dropped.push(d.id);
    }
    try {
      pruneListFiles(d.id, new Set(d.to ? [d.to.sha256] : []));
    } catch {
      // an unsafe id has no folder to prune
    }
  }
  writeState(fresh);
  return report;
}

async function fileMatches(id: string, sha256: string): Promise<boolean> {
  const path = listFilePath(id, sha256);
  if (!existsSync(path)) return false;
  return (await sha256OfFile(path)) === sha256;
}
