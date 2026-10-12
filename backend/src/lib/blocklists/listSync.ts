// MINOR-SEARCH-01e-4: the `lists.sync` core job. It keeps the blocked-site list files current from the signed
// catalog list index, and it is the only code that fetches them (rule: no MaiPai-operated service in a data path;
// the index is a static release asset and each list comes from its pinned immutable commit on one host).
//
// Order of a pass: decide which lists the household needs -> respect the schedule and back-off -> rate-limited
// conditional GET of the index -> verify (signature, expiry, rollback, pin shape) -> for each needed list whose
// pin differs from the loaded copy, download to <id>/<sha256>.txt (checksum verified by downloadUrl), parse with
// the spec's one reader and require the entry count to equal the pin -> swap the state, keeping the previous copy.
// Any failure deletes the bad file, keeps the last good copy, raises a Repairs item and never touches a copy that
// is already serving.
import { isNull } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { raiseIssue, resolveIssue } from "@/lib/issues";
import { tryConsume } from "@/lib/rateLimiter";
import { downloadUrl, sha256OfFile } from "@/lib/modelDownload";
import { speakerAgeBand, type AgeBand } from "@/lib/ageBand";
import { warmHostIndex } from "@/lib/blocklists/hostLists";
import { bandSwitchOff } from "@/lib/retrieval/sourceMode";
import type { PersonRow } from "@/types";
import type { SignedEnvelope } from "@/lib/storeIndex";
import { enabledListIds } from "@/lib/blocklists/policy";
import { LIST_INDEX_MAX_BYTES, LIST_INDEX_URL, verifyListIndex, type ListIndexMetadata, type ListPin } from "@/lib/blocklists/listIndex";
import { isListLoaded, listFilePath, parseStoredFile, pruneListFiles, readState, writeState, type ListSyncState } from "@/lib/blocklists/listStore";
import { existsSync, rmSync, statSync } from "node:fs";

export const LIST_SYNC_ISSUE_SOURCE = "block-lists";
const ISSUE_KEY = "sync";
/** One index look and a few list downloads in a burst, then roughly one look an hour at most. */
const INDEX_RATE_LIMIT = { capacity: 3, refillPerSecond: 1 / 3600 };
const INDEX_RATE_KEY = "lists.index";
const FILE_RATE_LIMIT = { capacity: 12, refillPerSecond: 1 / 3600 };
const FILE_RATE_KEY = "lists.files";
const INDEX_TIMEOUT_MS = 15_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const MAX_BACKOFF_DAYS = 7;

export type ListSyncOutcome =
  | { status: "idle"; reason: string }
  | { status: "ok"; updated: string[]; ignored: string[] }
  | { status: "unchanged" }
  | { status: "failed"; error: string };

export interface ListSyncOptions {
  now?: Date;
  fetchImpl?: typeof fetch;
  /** Tests only: skip the schedule gate. */
  force?: boolean;
}

/** Bands that have at least one person and whose web side is on. A band nobody is in, or whose web search the
 * household switched off, needs no list, so a home of adults with no adult list makes no connection at all. */
export function bandsInUse(now: Date): AgeBand[] {
  const rows = db.select().from(people).where(isNull(people.deletedAt)).all() as PersonRow[];
  const bands = new Set<AgeBand>();
  for (const row of rows) bands.add(speakerAgeBand(row, now));
  return [...bands].filter((band) => !bandSwitchOff(band));
}

/** The list ids the household needs loaded right now. */
export function neededListIds(now: Date): string[] {
  const ids = new Set<string>();
  for (const band of bandsInUse(now)) for (const id of enabledListIds(band)) ids.add(id);
  return [...ids];
}

function failure(state: ListSyncState, now: Date, error: string, backoff: boolean): ListSyncOutcome {
  if (backoff) {
    state.backoffDays = Math.min(MAX_BACKOFF_DAYS, Math.max(1, state.backoffDays * 2));
    state.nextCheckAt = new Date(now.getTime() + state.backoffDays * DAY_MS).toISOString();
  } else {
    state.nextCheckAt = new Date(now.getTime() + HOUR_MS).toISOString();
  }
  writeState(state);
  void raiseIssue({
    source: LIST_SYNC_ISSUE_SOURCE,
    key: ISSUE_KEY,
    severity: "warning",
    title: "Blocked-site lists could not update",
    detail: `${error}. Children's and teens' web search stays off until every list their profile uses has loaded once; lists that already loaded keep working. MaiPai will try again on its own (${backoff ? `in ${state.backoffDays} day${state.backoffDays === 1 ? "" : "s"}` : "within the hour"}). If this keeps happening, check that this computer can reach github.com, then open Settings and Updates.`,
  });
  return { status: "failed", error };
}

async function fetchIndex(state: ListSyncState, fetchImpl: typeof fetch): Promise<{ status: "not-modified" } | { status: "ok"; envelope: SignedEnvelope<ListIndexMetadata>; etag: string | null } | { status: "http"; code: number } | { status: "error"; error: string }> {
  try {
    const headers: Record<string, string> = { accept: "application/json" };
    if (state.etag) headers["if-none-match"] = state.etag;
    const res = await fetchImpl(LIST_INDEX_URL, { headers, signal: AbortSignal.timeout(INDEX_TIMEOUT_MS), redirect: "follow" });
    if (res.status === 304) return { status: "not-modified" };
    if (!res.ok) return { status: "http", code: res.status };
    const text = await res.text();
    if (text.length > LIST_INDEX_MAX_BYTES) return { status: "error", error: "the blocked-site list index is larger than any real index" };
    return { status: "ok", envelope: JSON.parse(text) as SignedEnvelope<ListIndexMetadata>, etag: res.headers.get("etag") };
  } catch (err) {
    return { status: "error", error: `could not reach the blocked-site list index (${err instanceof Error ? err.message : String(err)})` };
  }
}

async function loadPin(pin: ListPin, state: ListSyncState, now: Date): Promise<void> {
  const dest = listFilePath(pin.id, pin.sha256);
  // downloadUrl trusts a file already at the destination, so a leftover is hashed first and removed when it is
  // not the pinned bytes. A leftover that does match (the retained previous copy) is kept on a later failure.
  let existed = false;
  if (existsSync(dest)) {
    if ((await sha256OfFile(dest)) === pin.sha256) existed = true;
    else rmSync(dest, { force: true });
  }
  try {
    await downloadUrl(pin.source_url, dest, { expectedSha256: pin.sha256, expectedBytes: pin.bytes });
    const parsed = parseStoredFile(pin.id, { sha256: pin.sha256, format: pin.format });
    if (!parsed) throw new Error(`${pin.id} was not saved`);
    if (parsed.entries !== pin.entries) throw new Error(`${pin.id} has ${parsed.entries} sites but its pin says ${pin.entries}`);
  } catch (err) {
    if (!existed) rmSync(dest, { force: true });
    throw err;
  }
  const current = state.lists[pin.id];
  state.lists[pin.id] = {
    sha256: pin.sha256,
    entries: pin.entries,
    bytes: statSync(dest).size,
    format: pin.format,
    pinnedAt: pin.pinned_at,
    loadedAt: now.toISOString(),
    previousSha256: current && current.sha256 !== pin.sha256 ? current.sha256 : (current?.previousSha256 ?? null),
  };
  const keep = new Set([pin.sha256]);
  const prev = state.lists[pin.id]!.previousSha256;
  if (prev) keep.add(prev);
  pruneListFiles(pin.id, keep);
}

export async function runListSync(opts: ListSyncOptions = {}): Promise<ListSyncOutcome> {
  const now = opts.now ?? new Date();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const needed = neededListIds(now);
  if (needed.length === 0) return { status: "idle", reason: "no list is in use" };

  const state = readState();
  const allLoaded = needed.every((id) => isListLoaded(id));
  // A list that is needed and not loaded (a child just joined, a file was lost) does not wait for the daily
  // schedule, but a back-off after a refusal or a bad file is always honoured.
  if (!opts.force && (allLoaded || state.backoffDays > 0) && state.nextCheckAt && Date.parse(state.nextCheckAt) > now.getTime()) return { status: "idle", reason: "not due yet" };

  if (!tryConsume(INDEX_RATE_KEY, INDEX_RATE_LIMIT)) return { status: "idle", reason: "rate limited" };
  const got = await fetchIndex(state, fetchImpl);
  if (got.status === "error") return failure(state, now, got.error, false);
  if (got.status === "http") return failure(state, now, `the blocked-site list index answered with HTTP ${got.code}`, true);

  if (got.status === "not-modified" && allLoaded) {
    state.nextCheckAt = new Date(now.getTime() + DAY_MS).toISOString();
    state.backoffDays = 0;
    writeState(state);
    resolveIssue(LIST_SYNC_ISSUE_SOURCE, ISSUE_KEY);
    return { status: "unchanged" };
  }
  // A 304 with a list still unloaded (a file was lost) re-reads the index without the ETag next time.
  if (got.status === "not-modified") {
    state.etag = null;
    state.nextCheckAt = new Date(now.getTime()).toISOString();
    writeState(state);
    return runListSync({ ...opts, force: true });
  }

  const verified = verifyListIndex(got.envelope, { now: now.getTime(), lastPublished: state.publishedSeen });
  if (!verified.ok) return failure(state, now, verified.error, true);

  const updated: string[] = [];
  try {
    for (const pin of verified.pins) {
      if (!needed.includes(pin.id)) continue;
      if (state.lists[pin.id]?.sha256 === pin.sha256 && isListLoaded(pin.id)) continue;
      if (!tryConsume(FILE_RATE_KEY, FILE_RATE_LIMIT)) throw new Error("too many list downloads in a short time");
      await loadPin(pin, state, now);
      updated.push(pin.id);
    }
  } catch (err) {
    // Lists already swapped in this pass are good copies; keep them. The bad one was deleted above.
    if (updated.length > 0) writeState(state);
    return failure(readState(), now, `a blocked-site list failed its check (${err instanceof Error ? err.message : String(err)})`, true);
  }

  const missing = needed.filter((id) => !state.lists[id] || !isListLoaded(id));
  state.publishedSeen = Math.max(state.publishedSeen, verified.published);
  state.etag = got.etag;
  state.backoffDays = 0;
  state.lastGoodAt = now.toISOString();
  state.nextCheckAt = new Date(now.getTime() + (missing.length === 0 ? DAY_MS : HOUR_MS)).toISOString();
  writeState(state);
  warmHostIndex();
  if (missing.length === 0) resolveIssue(LIST_SYNC_ISSUE_SOURCE, ISSUE_KEY);
  else
    void raiseIssue({
      source: LIST_SYNC_ISSUE_SOURCE,
      key: ISSUE_KEY,
      severity: "warning",
      title: "Some blocked-site lists are not published yet",
      detail: `The catalog has no copy of ${missing.join(", ")} yet, so web search for the ages that use ${missing.length === 1 ? "it" : "them"} stays off. MaiPai checks again within the hour. If this lasts, update MaiPai or turn that list off in Settings, Search.`,
    });
  return { status: "ok", updated, ignored: verified.ignored };
}
