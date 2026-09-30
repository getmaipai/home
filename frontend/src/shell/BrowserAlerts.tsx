import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNotificationsQuery } from "@/shell/NotificationBell";
import { api, type NotificationDeliveryView, type Roster } from "@/lib/api";

const SETTING_KEY = "notifications.browser.enabled";
export function shouldShowBrowserAlert(notification: NotificationDeliveryView, enabled: boolean, permission: NotificationPermission): boolean {
  return enabled && permission === "granted" && (notification.level === "immediate" || notification.level === "time_sensitive");
}

export async function requestBrowserAlertPermission(requestPermission: () => Promise<NotificationPermission>, enabled: boolean): Promise<boolean> {
  if (!enabled) return false;
  return (await requestPermission()) === "granted";
}

export function BrowserAlerts({ person }: { person: Roster }) {
  const query = useNotificationsQuery();
  const seenIds = useRef(new Set<string>());
  const initialized = useRef(false);
  const settings = useQuery({ queryKey: ["settings-values", `person:${person.id}`], queryFn: () => api.settingsValues(`person:${person.id}`) });
  const enabled = settings.data?.find((value) => value.key === SETTING_KEY)?.value === true;

  useEffect(() => {
    if (!Array.isArray(query.data)) return;
    if (!initialized.current) {
      initialized.current = true;
      for (const item of query.data) seenIds.current.add(item.id);
      return;
    }
    for (const item of query.data) {
      if (seenIds.current.has(item.id)) continue;
      seenIds.current.add(item.id);
      if (!enabled || typeof Notification === "undefined") continue;
      if (!shouldShowBrowserAlert(item, enabled, Notification.permission)) continue;
      void navigator.serviceWorker?.ready.then((registration) => registration.showNotification("MaiPai needs attention", {
        body: "MaiPai needs attention. Open Status to review.",
        data: { url: "/status" },
        tag: item.id,
      })).catch(() => {});
    }
  }, [query.data, enabled]);

  return null;
}
