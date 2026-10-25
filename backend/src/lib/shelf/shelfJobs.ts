// KS-05: the two scheduler entries for the shelf (lib/scheduler.ts core
// jobs, registered in index.ts): a 15-minute poll tick and a daily prune.
import { sweepNewsPictures } from "@/lib/news/pictures";
import { pruneReads } from "@/lib/news/records";
import { reportShelfEvent } from "./shelfEvents";
import { bumpShelfCounter } from "./shelfCounters";
import { pollDueFeeds, type PollDeps } from "./shelfPoller";
import { retentionDays, shelfEnabled } from "./shelfPolicy";
import { sharedShelfStore, type ShelfStore } from "./shelfStore";
import { syncShelfFeeds } from "./shelfFeeds";
import { classifyPendingTopics } from "@/lib/news/topicTagger";
import { markBusy, markIdle } from "@/lib/perfWatch";

/** Brings the feeds table in line with the settings, then polls what is due. */
export async function runShelfTick(deps: PollDeps = {}): Promise<void> {
  const busyName = "shelf.tick";
  markBusy(busyName);
  try {
  const now = deps.now ?? Date.now;
  try { syncShelfFeeds({ nowIso: new Date(now()).toISOString(), store: deps.store }); }
  catch { reportShelfEvent("sync_failed"); }
  // Podcast feeds are the household's own subscriptions: the news shelf switch does not stop them.
  await pollDueFeeds(deps, shelfEnabled() ? ["news", "podcast"] : ["podcast"]);
  // Settle each new story on one topic by reading its words; a Stack that is down leaves the feed's own label in place.
  if (shelfEnabled()) { try { await classifyPendingTopics({ store: deps.store }); } catch { reportShelfEvent("topics_failed"); } }
  } finally {
    markIdle(busyName);
  }
}

export function pruneShelf(nowMs: number = Date.now(), store: ShelfStore | null = sharedShelfStore()): number {
  if (!store) return 0;
  const cutoff = new Date(nowMs - retentionDays() * 86_400_000).toISOString();
  const removed = store.prune(cutoff);
  if (removed > 0) bumpShelfCounter("items_pruned", undefined, removed);
  // NEWS-02: the same daily job keeps the News picture cache to its size and 14 days, and drops reads older than 90 days.
  try { sweepNewsPictures(); } catch { /* disposable: a failed sweep never fails the shelf prune */ }
  try { pruneReads(new Date(nowMs)); } catch { /* best effort, and independent of the picture sweep */ }
  return removed;
}
