// MEDIA-PROGRESS-01: the two providers behind the Pick up shelf, registered once at module load (routes/continue.ts imports this).
import { listConversations } from "@/lib/conversationHistory";
import { readableItem } from "@/lib/media/access";
import { recentProgress, percentOf } from "@/lib/media/progress";
import type { PersonRow } from "@/types";
import { registerContinueProvider, type ContinueRow } from "./registry";

/** The person's own last chats. */
registerContinueProvider("chat", (actor, limit) =>
  listConversations(actor)
    .filter((conversation) => conversation.last_turn_at !== null && conversation.turn_count > 0)
    .sort((a, b) => (b.last_turn_at ?? "").localeCompare(a.last_turn_at ?? ""))
    .slice(0, limit)
    .map((conversation): ContinueRow => ({
      source: "chat", kind: "chat", id: conversation.id, title: conversation.title?.trim() || "Chat", subtitle: null,
      href: `/chat?conversation=${encodeURIComponent(conversation.id)}`, at: conversation.last_turn_at!, percent: null, media_kind: null, artwork_url: null,
    })),
);

/** The person's own unfinished titles, newest first. A part of a folder audiobook shows as the book. A track is not "picked up", and a
 * finished title is done. A title the person may no longer read (the band, a removed folder) is left out. */
export function mediaContinueRows(actor: PersonRow, limit: number): ContinueRow[] {
  const rows: ContinueRow[] = [];
  const seen = new Set<string>();
  for (const progress of recentProgress(actor.id, limit * 6 + 6)) {
    if (progress.completed) continue;
    let item = readableItem(actor, progress.media_id);
    if (!item || item.kind === "track") continue;
    if (item.kind === "chapter" && item.parent_id) {
      item = readableItem(actor, item.parent_id);
      if (!item) continue;
    }
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const percent = percentOf(progress.position, item.kind === "chapter" ? progress.duration_s : (progress.duration_s ?? item.duration_s));
    rows.push({
      source: "media", kind: "media", id: item.id, title: item.title, subtitle: item.subtitle, href: `/media/${encodeURIComponent(item.id)}`, at: progress.updated_at,
      percent: percent === null ? null : Math.round(percent), media_kind: item.kind, artwork_url: item.artwork ? `/api/media/items/${encodeURIComponent(item.id)}/artwork` : null,
    });
    if (rows.length >= limit) break;
  }
  return rows;
}

registerContinueProvider("media", mediaContinueRows);
