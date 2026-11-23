import { useQuery } from "@tanstack/react-query";
import { api, type ActivityItemView, type NotificationDeliveryView } from "@/lib/api";
import { useActivity } from "@/shell/activity";
import { NOTIFICATIONS_HISTORY_QUERY_KEY, notificationLine, NOTIFICATION_RESULT_LINKS } from "@/shell/NotificationBell";

// ACTIVITY-MERGE-01: Activity and Notifications are one list. A notification becomes a feed row shaped like a job row so the kit
// popover (and later the Activity page) can render one merged, time-sorted feed instead of two surfaces saying the same thing.

export type FeedItem = Omit<ActivityItemView, "source"> & { source: ActivityItemView["source"] | "notice"; notificationId?: string };

const THIRTY_DAYS_MS = 30 * 24 * 3_600_000;

/** One notification as a feed row: immediate ones need a look, the rest are done; a finished clip links to its result. */
export function noticeToFeedItem(n: NotificationDeliveryView): FeedItem {
  return {
    id: `notice:${n.id}`,
    source: "notice",
    state: n.level === "immediate" ? "attention" : "done",
    title: notificationLine(n),
    line: null,
    percent: null,
    typicalMinutes: null,
    href: NOTIFICATION_RESULT_LINKS[n.typeId] ?? null,
    at: n.createdAt,
    thumbnailUrl: null,
    notificationId: n.id,
  };
}

/** Jobs plus notices, newest first. Dismissed notices and notices older than 30 days are dropped; job rows are kept as they are. */
export function mergeFeed(items: readonly ActivityItemView[], notices: readonly NotificationDeliveryView[], now = Date.now()): FeedItem[] {
  const cutoff = now - THIRTY_DAYS_MS;
  const noticeRows = notices
    .filter((n) => !n.dismissedAt && Date.parse(n.createdAt) >= cutoff)
    .map(noticeToFeedItem);
  const all: FeedItem[] = [...items, ...noticeRows];
  return all.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** The merged feed for the header bell: the viewer's own making jobs plus their notifications, on the same reads each surface already uses. */
export function useActivityFeed(enabled = true) {
  const activity = useActivity(enabled);
  const notices = useQuery<NotificationDeliveryView[]>({
    queryKey: NOTIFICATIONS_HISTORY_QUERY_KEY,
    queryFn: async () => {
      const next = await api.notificationHistory();
      // A reply that is not a list is a missed read, not an empty history.
      return Array.isArray(next) ? next : [];
    },
    enabled,
    retry: false,
    staleTime: 10_000,
    refetchInterval: 60_000,
  });
  const items = mergeFeed(activity.data?.items ?? [], notices.data ?? []);
  return {
    items,
    activity,
    notices,
    // A failed notices read must not turn the whole feed into an error: the jobs alone are still worth showing.
    isError: activity.isError,
    isFetching: activity.isFetching || notices.isFetching,
    refetch: () => {
      void activity.refetch();
      void notices.refetch();
    },
  };
}
