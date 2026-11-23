import { i18n } from "@lingui/core";
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@maipai/ui/src/primitives/Toast";
import { NOTIFICATION_COPY } from "@maipai/home-backend/src/lib/notificationCopy";
import { api, type NotificationDeliveryView } from "@/lib/api";

/** ACTIVITY-PAGE-01: a notification that says a job finished opens its result (existing types only; no new notification type). */
export const NOTIFICATION_RESULT_LINKS: Readonly<Record<string, string>> = { "video.clip_ready": "/apps/video/create" };

/** I18N-B1: a typed notification renders from its { typeId, values } in the viewer's language; a row with no values or no template (an older
 * row, a pass-through type, a safety or child line) shows the English text it was stored with. */
export function notificationLine(n: Pick<NotificationDeliveryView, "typeId" | "text" | "values">): string {
  const line = NOTIFICATION_COPY[n.typeId];
  if (!line || !n.values) return n.text;
  const values = Object.fromEntries(Object.entries(n.values).map(([key, value]) => [key, /^\d+$/.test(value) && String(Number(value)) === value ? Number(value) : value]));
  try { return i18n._({ id: line.id, message: line.message, values }); } catch { return n.text; }
}

// Exported: chatMemoryChip.tsx reads this same cached list (the "memory
// updated" chip, getmaipai/home#64) and polls it on the same schedule,
// rather than duplicating the query key/interval and risking the two
// drifting apart.
export const POLL_MS = 15_000;
export const NOTIFICATIONS_QUERY_KEY = ["notifications"];
// NotificationsPage.tsx's own history query key, exported from here (not
// the other way around) so this shell-level file never has to import
// from an app page: a dismiss from EITHER surface has to invalidate both
// caches, or whichever one isn't showing the dismiss keeps a stale row
// until an unrelated remount forces a refetch (a code review, 2026-09-06,
// caught this file only ever invalidating its own).
export const NOTIFICATIONS_HISTORY_QUERY_KEY = ["notifications-history"];
const QUERY_KEY = NOTIFICATIONS_QUERY_KEY;

// The one place the shell reads pending notifications from (the rail
// profile menu's count, the phone header's avatar dot/count,
// HOME-UI-02f) - the same queryKey/queryFn/refetchInterval retyped in
// each caller was a real drift risk a code review caught (a future
// change to the query touching one copy and not the other), not just an
// efficiency nit: react-query already dedupes identical queryKeys to one
// fetch/poll regardless of how many components call this, so this exists
// for one definition, not for caching.
// getmaipai/home#181: ChatPage.tsx's own ProjectResultReload consumes
// this exact query too (React Query dedupes an identical queryKey to one
// fetch/poll, this file's own header comment) - a background project's
// `project.done`/`project.failed` delivery is what tells the open chat
// its already-loaded turn just gained an artifact, so it reuses this
// poll instead of standing up a second one.
export function useNotificationsQuery() {
  return useQuery<NotificationDeliveryView[]>({
    queryKey: QUERY_KEY,
    queryFn: () => api.notifications(),
    refetchInterval: POLL_MS,
  });
}

// The phone header's own avatar dot (HOME-UI-02f: "the bell's count
// shows as a dot on the avatar") needs the pending count without
// mounting a component.
export function usePendingNotificationCount(): number {
  return useNotificationsQuery().data?.length ?? 0;
}

// ACTIVITY-PAGE-01 / ACTIVITY-MERGE-01: the bell component is gone - browsing and dismissing
// live on the Activity page now, opened from the rail's profile menu, and the pending count
// shows through `usePendingNotificationCount` (the avatar dot, HOME-UI-02f).

// A new arrival becoming a Toast - lib/notifications.ts's own `in_app`
// channel is just a persisted row; this is what turns "a new row
// exists" into something a person actually notices without having to
// open Activity. Split out of the old bell popover (a code review,
// HOME-UI-02f: the phone header fold hid that whole component on phone,
// which silently took this toast behavior with it - the only place it
// lived) and mounted once, unconditionally, in AppShell.tsx, so a toast
// fires the same way regardless of where the person is. Renders nothing
// - `useToast()`'s own provider does the actual on-screen work.
export function NotificationToaster(): null {
  const query = useNotificationsQuery();
  const seenIds = useRef<Set<string> | null>(null);
  const { push } = useToast();

  useEffect(() => {
    if (!query.data) return;
    if (seenIds.current === null) {
      // First load: everything already pending is real history, not a
      // "just arrived" toast flood the moment the page opens.
      seenIds.current = new Set(query.data.map((n) => n.id));
      return;
    }
    for (const n of query.data) {
      if (!seenIds.current.has(n.id)) {
        seenIds.current.add(n.id);
        // Jesse, 2026-09-13: no toast for a memory save. When the
        // originating message is still on screen, chatMemoryChip.tsx's
        // "Memory updated" chip already shows it there; when it isn't
        // (the judge can finish well after someone has moved on to
        // another page - memoryJudge.ts runs off a background queue),
        // the Activity page's pending list is the fallback - a real
        // delivery still lands there and in the 30-day history, only
        // the toast itself is skipped.
        if (!n.toast || n.typeId === "alarm.due") continue;
        push(notificationLine(n));
      }
    }
  }, [query.data, push]);

  return null;
}
