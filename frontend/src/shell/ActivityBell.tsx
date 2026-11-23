import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { i18n } from "@lingui/core";
import type { ActivityPopoverItem } from "@maipai/ui/src/elements/activity-popover";
import { ACTIVITY_KEY, ACTIVITY_PATH } from "@/shell/activity";
import { useActivityFeed, type FeedItem } from "@/shell/activityFeed";
import { ACTIVITY_CARD_KIND, actionLabel, feedIcon, isFinished, lineOf, stateWord } from "@/shell/activityRows";
import { NOTIFICATIONS_HISTORY_QUERY_KEY, NOTIFICATIONS_QUERY_KEY } from "@/shell/NotificationBell";
import { api } from "@/lib/api";

// The Activity bell in the header (STUDIO-LOOK-01, Artlist-style): the viewer's own making jobs with a thumbnail and live progress.
// The rows come from the same helpers as the Activity page (state word, line, icon and card kind are shared there). The rail's Activity entry stays.

const KIND = { picture: "picture", video: "video", song: "music", job: undefined } as const;

export function activityPopoverItems(rows: readonly FeedItem[], clear?: (row: FeedItem) => void): ActivityPopoverItem[] {
  return rows.map((row): ActivityPopoverItem => ({
    id: row.id,
    state: row.state === "waiting" || row.state === "making" ? "running" : row.state === "failed" ? "failed" : "done",
    title: row.title,
    // A notice row has no making kind (source "notice" is not in KIND): undefined renders the plain done row.
    kind: KIND[row.source as keyof typeof KIND],
    progress: row.percent ?? undefined,
    thumbnailUrl: isFinished(row) ? row.thumbnailUrl ?? undefined : undefined,
    at: row.at,
    href: row.href ?? undefined,
    line: lineOf(row),
    cardKind: ACTIVITY_CARD_KIND[row.state],
    stateWord: stateWord(row.state),
    icon: feedIcon(row),
    actionLabel: actionLabel(row),
    onClear: clear && isFinished(row) ? () => clear(row) : undefined,
  }));
}

/** The props for the kit ActivityPopover, rendered directly by the shell header (RULES.md rule 9: no wrapper component around a kit Element). */
export function useActivityPopoverProps(enabled: boolean) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const feed = useActivityFeed(enabled);
  const clear = (row: FeedItem) => {
    void (async () => {
      try {
        if (row.source === "notice" && row.notificationId) {
          await api.dismissNotifications({ ids: [row.notificationId] });
          await client.invalidateQueries({ queryKey: NOTIFICATIONS_HISTORY_QUERY_KEY });
          await client.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
        } else {
          client.setQueryData(ACTIVITY_KEY, await api.clearActivity({ keys: [row.id] }));
        }
        await client.invalidateQueries({ queryKey: ACTIVITY_KEY });
      } catch {
        // A failed clear keeps the row; the next open or refresh reconciles it.
      }
    })();
  };
  const items = activityPopoverItems(feed.items, clear);
  return {
    items,
    onOpen: (id: string) => navigate(items.find((item) => item.id === id)?.href ?? ACTIVITY_PATH),
    emptyLabel: i18n._({ id: "Nothing new right now.", message: "Nothing new right now." }),
    limit: 5,
    seeAllLabel: i18n._({ id: "See all", message: "See all" }),
    onSeeAll: () => navigate(ACTIVITY_PATH),
  };
}
