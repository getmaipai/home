// KS-05: the two scheduler entries for the shelf (lib/scheduler.ts core
// jobs, registered in index.ts): a 15-minute poll tick and a daily prune.
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
  return removed;
}
