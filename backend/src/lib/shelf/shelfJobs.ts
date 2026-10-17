// KS-05: the two scheduler entries for the shelf (lib/scheduler.ts core
// jobs, registered in index.ts): a 15-minute poll tick and a daily prune.
import { sweepNewsPictures } from "@/lib/news/pictures";
import { pruneReads } from "@/lib/news/records";
import { bumpShelfCounter } from "./shelfCounters";
import { pollDueFeeds, type PollDeps } from "./shelfPoller";
import { retentionDays, shelfEnabled } from "./shelfPolicy";
import { sharedShelfStore, type ShelfStore } from "./shelfStore";
import { syncShelfFeeds } from "./shelfFeeds";

/** Brings the feeds table in line with the settings, then polls what is due. */
export async function runShelfTick(deps: PollDeps = {}): Promise<void> {
  const now = deps.now ?? Date.now;
  syncShelfFeeds({ nowIso: new Date(now()).toISOString(), store: deps.store });
  if (!shelfEnabled()) return;
  await pollDueFeeds(deps);
}

export function pruneShelf(nowMs: number = Date.now(), store: ShelfStore | null = sharedShelfStore()): number {
  if (!store) return 0;
  const cutoff = new Date(nowMs - retentionDays() * 86_400_000).toISOString();
  const removed = store.prune(cutoff);
  if (removed > 0) bumpShelfCounter("items_pruned", undefined, removed);
  // NEWS-02: the same daily job keeps the News picture cache to its size and 14 days, and drops reads older than 90 days.
  try {
    sweepNewsPictures();
    pruneReads(new Date(nowMs));
  } catch {
    // both are disposable or best effort: a failed sweep never fails the shelf prune
  }
  return removed;
}
