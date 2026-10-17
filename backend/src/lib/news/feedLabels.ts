// NEWS-02: a feed's publisher name by feed id, for a channel's label (a source channel is named after its publisher).
import { listFeeds } from "@/lib/shelf/feedStore";

export function feedLabels(): Map<string, string> {
  return new Map(listFeeds().map((feed) => [feed.id, feed.publisher]));
}
